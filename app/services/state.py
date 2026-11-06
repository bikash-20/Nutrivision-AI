"""State store with PostgreSQL persistence (Render/Neon/Supabase) and local JSON fallback.

Provides:
- Dual-mode persistence: connects to PostgreSQL via DATABASE_URL if configured,
  automatically running migrations for `nv_users`, `nv_meals`, and `nv_grocery`.
  Falls back gracefully to `state.json` if DATABASE_URL is not set or unreachable.
- Multi-tenant authenticated user partitions with clean empty states for new users.
- Automated startup cleanup of legacy synthetic/demo accounts so that only real
  authenticated users are tracked.
- Telemetry & analytics aggregation for the Admin Dashboard (Overview, Users,
  Popular Foods, and Review Queue).
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import urllib.parse
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Generic, Literal, TypeVar

from fastapi import HTTPException, status

from app.models.schemas import (
    AdminMetrics,
    AdminUserDetail,
    AdminUserSummary,
    DailyMealVolume,
    DetectedItem,
    GroceryItem,
    HealthGoals,
    MealEntry,
    MealTotals,
    PopularFoodItem,
    ReviewQueueAction,
    ReviewQueueItem,
    Role,
    UserProfile,
)

log = logging.getLogger(__name__)

T = TypeVar("T")


class StateError(ValueError):
    """Raised when a mutation references an unknown entity id."""


PHOTO_UPLOAD_WINDOW = timedelta(hours=1)


def get_photo_upload_limit() -> int:
    """Return the configured positive per-user photo quota."""
    raw_limit = os.environ.get("PHOTO_UPLOAD_LIMIT", "2")
    try:
        limit = int(raw_limit)
    except ValueError as exc:
        raise RuntimeError("PHOTO_UPLOAD_LIMIT must be a positive integer.") from exc
    if limit < 1:
        raise RuntimeError("PHOTO_UPLOAD_LIMIT must be a positive integer.")
    return limit


def make_clean_profile(name: str = "") -> UserProfile:
    """Create a pristine empty profile for new users without seeded persona data."""
    return UserProfile(
        name=name,
        age=None,
        sex=None,
        height_cm=None,
        weight_kg=None,
        height_unit="cm",
        weight_unit="kg",
        activity_level=None,
        goal=None,
        target_rate_kg_per_week=None,
        diet_type=None,
        medical_conditions=[],
        meals_per_day=3,
        consent_anonymized_data=True,
        language="en",
        goals=HealthGoals(diabetic=False, protein=False, budget=False, mediter=False),
        preferences=[],
        allergens=[],
        budget=None,
        serving=1,
        daily_kcal_target=None,
    )


LEGACY_SEEDED_EMAILS: set[str] = {
    "judge.google.user@nutrivision.ai",
    "admin@nutrivision.ai",
    "user@nutrivision.ai",
    "demo@nutrivision.ai",
    "rafi@nutrivision.ai",
}


def is_legacy_seeded_email(email: str, admin_emails: set[str] | None = None) -> bool:
    """Identify strictly known legacy seeded demo accounts.
    Never uses substring or domain wildcard matching, protecting real users."""
    clean = email.lower().strip()
    if admin_emails and clean in admin_emails:
        return False
    return clean in LEGACY_SEEDED_EMAILS


# Backward-compatible alias
is_demo_or_synthetic_email = is_legacy_seeded_email


def _calculate_streak(dates: set[str]) -> int:
    """Calculate consecutive daily streak from a set of YYYY-MM-DD dates."""
    if not dates:
        return 0
    now = datetime.now(UTC).date()
    cur = now
    today_str = cur.isoformat()
    yesterday_str = (cur - timedelta(days=1)).isoformat()
    if today_str not in dates and yesterday_str not in dates:
        return 0
    if today_str not in dates:
        cur = cur - timedelta(days=1)
    streak = 0
    while cur.isoformat() in dates:
        streak += 1
        cur -= timedelta(days=1)
    return streak


class UserData:
    """Per-user data partition: profile, meals, grocery."""

    def __init__(
        self,
        email: str,
        name: str | None = None,
        avatar_url: str | None = None,
        role: Role = "user",
        joined_date: str | None = None,
        last_active: str | None = None,
    ) -> None:
        self.email = email.lower().strip()
        self.name = name or self.email.split("@")[0]
        self.avatar_url = avatar_url
        self.role: Role = role
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        self.joined_date = joined_date or now
        self.last_active = last_active or now
        self.profile = make_clean_profile(self.name)
        self.meals = Bucket[MealEntry](newest_first=True)
        self.grocery = Bucket[GroceryItem]()


class Bucket(Generic[T]):
    """An ordered, indexed collection of items keyed by `.id`."""

    def __init__(
        self,
        factory: Callable[[], T] | None = None,
        *,
        newest_first: bool = False,
    ) -> None:
        self.items: list[T] = []
        self.factory = factory
        self.newest_first = newest_first

    def by_id(self) -> dict[str, T]:
        return {x.id: x for x in self.items}

    def upsert(self, item: T, *, index: int | None = None) -> T:
        if index is None:
            index = 0 if self.newest_first else len(self.items)
        self.items.insert(index, item)
        return item

    def remove(self, item_id: str) -> None:
        before = len(self.items)
        self.items = [x for x in self.items if x.id != item_id]
        if len(self.items) == before:
            raise StateError(f"unknown id: {item_id}")


def extract_db_host(dsn: str) -> str:
    """Extract host (and port) safely from a connection string, omitting credentials."""
    try:
        normalized = dsn
        if normalized.startswith("postgres://"):
            normalized = "postgresql://" + normalized[len("postgres://"):]
        parsed = urllib.parse.urlsplit(normalized)
        if parsed.hostname:
            if parsed.port:
                return f"{parsed.hostname}:{parsed.port}"
            return parsed.hostname
    except Exception:
        pass
    return "configured-host"


def sanitize_db_error(exc: Exception, raw_dsn: str = "") -> str:
    """Ensure error string doesn't leak any connection passwords or URI credentials."""
    msg = str(exc)
    if raw_dsn:
        try:
            parsed = urllib.parse.urlsplit(raw_dsn)
            if parsed.password:
                msg = msg.replace(parsed.password, "******")
        except Exception:
            pass
    msg = re.sub(r"://([^:@/]+):([^@/]+)@", r"://\1:******@", msg)
    return msg


class PostgresStore:
    """PostgreSQL storage adapter using psycopg with auto-migration."""

    def __init__(self, dsn: str) -> None:
        self.raw_dsn = dsn
        self.dsn = self._clean_dsn(dsn)
        self.host = extract_db_host(dsn)
        self._test_connection_and_migrate()

    def _clean_dsn(self, dsn: str, strip_channel_binding: bool = False) -> str:
        cleaned = dsn
        if cleaned.startswith("postgres://"):
            cleaned = "postgresql://" + cleaned[len("postgres://"):]
        if strip_channel_binding:
            cleaned = re.sub(r"[?&]channel_binding=[^&]+", "", cleaned)
            if "?" not in cleaned and "&" in cleaned:
                cleaned = cleaned.replace("&", "?", 1)
        return cleaned

    def _get_conn(self):
        import psycopg
        try:
            return psycopg.connect(self.dsn, autocommit=True, prepare_threshold=None)
        except Exception as exc:
            err_str = str(exc).lower()
            if "channel binding" in err_str or "scram-sha-256-plus" in err_str:
                clean_dsn = self._clean_dsn(self.dsn, strip_channel_binding=True)
                return psycopg.connect(clean_dsn, autocommit=True, prepare_threshold=None)
            raise

    def _test_connection_and_migrate(self) -> None:
        """Run schema migrations and verify each table exists in public schema."""
        msg_storage = f"Storage backend: postgres (host={self.host})"
        print(msg_storage, flush=True)
        log.info(msg_storage)

        print("Running PostgreSQL schema migrations...", flush=True)
        log.info("Running PostgreSQL schema migrations...")

        with self._get_conn() as conn:
            with conn.cursor() as cur:
                # 1. nv_users table
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nv_users (
                        email TEXT PRIMARY KEY,
                        name TEXT,
                        avatar_url TEXT,
                        role TEXT NOT NULL DEFAULT 'user',
                        joined_date TEXT NOT NULL,
                        last_active TEXT NOT NULL,
                        profile_json JSONB NOT NULL
                    );
                """)
                cur.execute("SELECT to_regclass('public.nv_users');")
                row = cur.fetchone()
                if not row or not row[0]:
                    raise RuntimeError("Verification failed: table 'nv_users' was not found in public schema.")
                print("Table 'nv_users' verified in public schema.", flush=True)
                log.info("Table 'nv_users' verified in public schema.")

                # 2. nv_meals table
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nv_meals (
                        id TEXT PRIMARY KEY,
                        user_email TEXT NOT NULL REFERENCES nv_users(email) ON DELETE CASCADE,
                        date TEXT NOT NULL,
                        label TEXT NOT NULL,
                        photo_url TEXT,
                        review_status TEXT,
                        active_goals JSONB NOT NULL,
                        meal_json JSONB NOT NULL
                    );
                """)
                cur.execute("SELECT to_regclass('public.nv_meals');")
                row = cur.fetchone()
                if not row or not row[0]:
                    raise RuntimeError("Verification failed: table 'nv_meals' was not found in public schema.")
                print("Table 'nv_meals' verified in public schema.", flush=True)
                log.info("Table 'nv_meals' verified in public schema.")

                # 3. nv_grocery table
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nv_grocery (
                        id TEXT NOT NULL,
                        user_email TEXT NOT NULL REFERENCES nv_users(email) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        price NUMERIC NOT NULL DEFAULT 0,
                        checked BOOLEAN NOT NULL DEFAULT false,
                        PRIMARY KEY (user_email, id)
                    );
                """)
                cur.execute("SELECT to_regclass('public.nv_grocery');")
                row = cur.fetchone()
                if not row or not row[0]:
                    raise RuntimeError("Verification failed: table 'nv_grocery' was not found in public schema.")
                print("Table 'nv_grocery' verified in public schema.", flush=True)
                log.info("Table 'nv_grocery' verified in public schema.")

                # 4. Authenticated image-upload quota windows
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nv_photo_uploads (
                        user_email TEXT NOT NULL REFERENCES nv_users(email) ON DELETE CASCADE,
                        upload_id TEXT NOT NULL,
                        image_hash TEXT NOT NULL DEFAULT '',
                        created_at TIMESTAMPTZ NOT NULL,
                        PRIMARY KEY (user_email, upload_id)
                    );
                """)
                cur.execute("ALTER TABLE nv_photo_uploads ADD COLUMN IF NOT EXISTS image_hash TEXT NOT NULL DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_photo_uploads_user_created ON nv_photo_uploads(user_email, created_at);")

                # 5. nv_migrations table (tracked schema and data migrations)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nv_migrations (
                        id TEXT PRIMARY KEY,
                        applied_at TEXT NOT NULL
                    );
                """)
                cur.execute("SELECT to_regclass('public.nv_migrations');")
                row = cur.fetchone()
                if not row or not row[0]:
                    raise RuntimeError("Verification failed: table 'nv_migrations' was not found in public schema.")
                print("Table 'nv_migrations' verified in public schema.", flush=True)
                log.info("Table 'nv_migrations' verified in public schema.")

                # Indexes
                cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_meals_user ON nv_meals(user_email);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_meals_date ON nv_meals(date);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_nv_grocery_user ON nv_grocery(user_email);")

                # Tracked one-time migration: purge_legacy_seeded_accounts_v1
                cur.execute("SELECT 1 FROM nv_migrations WHERE id = %s;", ("purge_legacy_seeded_accounts_v1",))
                if not cur.fetchone():
                    admin_emails_raw = os.environ.get("ADMIN_EMAILS", "")
                    admin_emails = {e.strip().lower() for e in admin_emails_raw.split(",") if e.strip()}
                    candidates = list(LEGACY_SEEDED_EMAILS - admin_emails)
                    if candidates:
                        # Deletes ONLY exact known legacy seeded accounts who have 0 logged meals
                        cur.execute(
                            """
                            DELETE FROM nv_users
                            WHERE email = ANY(%s)
                              AND NOT EXISTS (
                                  SELECT 1 FROM nv_meals WHERE nv_meals.user_email = nv_users.email
                              );
                            """,
                            (candidates,),
                        )
                    cur.execute(
                        "INSERT INTO nv_migrations (id, applied_at) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING;",
                        ("purge_legacy_seeded_accounts_v1", datetime.now(UTC).isoformat()),
                    )
                    msg_mig = "Tracked migration 'purge_legacy_seeded_accounts_v1' applied successfully."
                    print(msg_mig, flush=True)
                    log.info(msg_mig)
                else:
                    log.info("Tracked migration 'purge_legacy_seeded_accounts_v1' already applied — skipping.")

        success_msg = "PostgreSQL schema migrations completed successfully (nv_users, nv_meals, nv_grocery, nv_photo_uploads, nv_migrations verified)."
        print(success_msg, flush=True)
        log.info(success_msg)


class State:
    """Thread-safe in-memory store with dual PostgreSQL / JSON persistence."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self.profile: UserProfile = make_clean_profile("Guest")
        self.meals = Bucket[MealEntry](newest_first=True)
        self.grocery = Bucket[GroceryItem]()
        self.users: dict[str, UserData] = {}
        self.photo_uploads: list[dict[str, str]] = []
        self.applied_migrations: set[str] = set()

        self.postgres_store: PostgresStore | None = None
        db_url = os.environ.get("DATABASE_URL", "").strip()
        self.storage_type: Literal["postgres", "json"] = "postgres" if db_url else "json"
        self.is_healthy: bool = True
        self.init_error: str | None = None
        self.db_host: str | None = None

        if db_url:
            self.db_host = extract_db_host(db_url)
            try:
                import psycopg
                psycopg_ver = getattr(psycopg, "__version__", "unknown")
                msg_ver = f"psycopg import OK (version {psycopg_ver})"
                print(msg_ver, flush=True)
                log.info(msg_ver)
            except ImportError as imp_err:
                self.is_healthy = False
                self.init_error = f"psycopg is not installed: {imp_err}"
                err_line = (
                    f"FATAL: DATABASE_URL is set but psycopg is not installed: {imp_err}\n"
                    f"Refusing to silently fall back to JSON file store. Backend storage state is UNHEALTHY."
                )
                print(err_line, file=sys.stderr, flush=True)
                log.error(err_line)
                self.postgres_store = None
                return

            try:
                self.postgres_store = PostgresStore(db_url)
                log.info("Initialized PostgreSQL persistence adapter via DATABASE_URL.")
            except Exception as exc:
                sanitized = sanitize_db_error(exc, db_url)
                self.is_healthy = False
                self.init_error = sanitized
                err_line = (
                    f"FATAL: DATABASE_URL is set but PostgreSQL initialization/migration failed: {sanitized}\n"
                    f"Refusing to silently fall back to JSON file store. Backend storage state is UNHEALTHY."
                )
                print(err_line, file=sys.stderr, flush=True)
                log.error(err_line)
                self.postgres_store = None
        else:
            msg = "Storage backend: json file"
            print(msg, flush=True)
            log.info(msg)

    # ── Health & Introspection ───────────────────────────────────────────

    def get_health_status(self) -> dict[str, Any]:
        """Return storage health status without exposing credentials."""
        status_val = "ok" if self.is_healthy else "degraded"
        db_ok = False
        if self.storage_type == "postgres" and self.postgres_store and self.is_healthy:
            try:
                with self.postgres_store._get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1;")
                        db_ok = True
            except Exception:
                status_val = "unhealthy"
                db_ok = False
        elif self.storage_type == "json":
            db_ok = True

        return {
            "status": status_val,
            "storage_backend": self.storage_type,
            "db_connected": db_ok,
            "host": self.db_host,
            "migrations": sorted(list(self.applied_migrations)),
            "error": self.init_error if not self.is_healthy else None,
        }

    def _sync_users_from_db_unlocked(self) -> None:
        """Synchronize users and meals from PostgreSQL so multi-worker and multi-device updates appear immediately."""
        if self.storage_type != "postgres" or not self.is_healthy or not self.postgres_store:
            return
        try:
            with self.postgres_store._get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT email, name, avatar_url, role, joined_date, last_active, profile_json FROM nv_users"
                    )
                    rows = cur.fetchall()
                    db_emails = set()
                    for email, name, avatar_url, role, joined_date, last_active, profile_json in rows:
                        clean = email.lower().strip()
                        db_emails.add(clean)
                        assigned_role: Role = "admin" if clean == "bikashtalukder040@gmail.com" else role
                        if clean not in self.users:
                            udata = UserData(
                                email=clean,
                                name=name,
                                avatar_url=avatar_url,
                                role=assigned_role,
                                joined_date=joined_date,
                                last_active=last_active,
                            )
                            if profile_json:
                                try:
                                    udata.profile = UserProfile.model_validate(profile_json)
                                except Exception:
                                    pass
                            self.users[clean] = udata
                        else:
                            u = self.users[clean]
                            u.last_active = last_active or u.last_active
                            if name and (not u.name or u.name == clean.split("@")[0]):
                                u.name = name
                            if avatar_url and not u.avatar_url:
                                u.avatar_url = avatar_url
                            if assigned_role == "admin" or (role and u.role != role):
                                u.role = assigned_role
                            if profile_json and (not u.profile or not u.profile.name):
                                try:
                                    u.profile = UserProfile.model_validate(profile_json)
                                except Exception:
                                    pass

                    for clean in db_emails:
                        if clean in self.users and len(self.users[clean].meals.items) == 0:
                            cur.execute(
                                "SELECT meal_json FROM nv_meals WHERE user_email = %s ORDER BY date DESC",
                                (clean,),
                            )
                            for (mjson,) in cur.fetchall():
                                try:
                                    self.users[clean].meals.items.append(MealEntry.model_validate(mjson))
                                except Exception:
                                    pass
        except Exception as exc:
            log.warning("Could not sync users from PostgreSQL: %s", exc)

    def has_user(self, email: str) -> bool:
        clean = email.lower().strip()
        with self._lock:
            if clean not in self.users:
                self._sync_users_from_db_unlocked()
            return clean in self.users

    def get_user(self, email: str) -> UserData | None:
        clean = email.lower().strip()
        with self._lock:
            if clean not in self.users:
                self._sync_users_from_db_unlocked()
            return self.users.get(clean)

    # ── Persistence ──────────────────────────────────────────────────────

    def load(self) -> None:
        """Load state from PostgreSQL if configured, otherwise from disk."""
        admin_emails_raw = os.environ.get("ADMIN_EMAILS", "")
        admin_emails = {e.strip().lower() for e in admin_emails_raw.split(",") if e.strip()} | {"bikashtalukder040@gmail.com"}

        # 1. PostgreSQL branch
        if self.storage_type == "postgres":
            if not self.is_healthy or not self.postgres_store:
                log.error("Skipping state.load() because PostgreSQL backend is unhealthy (%s).", self.init_error)
                return

            try:
                with self.postgres_store._get_conn() as conn:
                    with conn.cursor() as cur:
                        # Load applied migrations from nv_migrations
                        cur.execute("SELECT id FROM nv_migrations;")
                        self.applied_migrations = {r[0] for r in cur.fetchall()}

                        # Load users directly (no deletion on startup; migrations are tracked)
                        cur.execute("SELECT email, name, avatar_url, role, joined_date, last_active, profile_json FROM nv_users")
                        for email, name, avatar_url, role, joined_date, last_active, profile_json in cur.fetchall():
                            clean = email.lower().strip()
                            udata = UserData(
                                email=clean,
                                name=name,
                                avatar_url=avatar_url,
                                role=role,
                                joined_date=joined_date,
                                last_active=last_active,
                            )
                            if profile_json:
                                try:
                                    udata.profile = UserProfile.model_validate(profile_json)
                                except Exception:
                                    pass
                            self.users[clean] = udata

                        # Load meals
                        cur.execute("SELECT user_email, meal_json FROM nv_meals ORDER BY date DESC")
                        for uemail, mjson in cur.fetchall():
                            clean = uemail.lower().strip()
                            if clean in self.users:
                                try:
                                    self.users[clean].meals.items.append(MealEntry.model_validate(mjson))
                                except Exception:
                                    pass

                        # Load grocery
                        cur.execute("SELECT user_email, id, name, price, checked FROM nv_grocery")
                        for uemail, gid, gname, gprice, gchecked in cur.fetchall():
                            clean = uemail.lower().strip()
                            if clean in self.users:
                                self.users[clean].grocery.items.append(
                                    GroceryItem(id=gid, name=gname, price=float(gprice), checked=bool(gchecked))
                                )

                # No unauthenticated admin users are seeded. Only real signed-in users are kept in nv_users.
                return
            except Exception as exc:
                sanitized = sanitize_db_error(exc, self.postgres_store.dsn)
                self.is_healthy = False
                self.init_error = sanitized
                log.error("FATAL: Loading state from PostgreSQL failed: %s. Refusing to fall back to JSON.", sanitized)
                return

        # 2. File branch (only when storage_type == "json")
        if not self.path.exists():
            self.applied_migrations.add("purge_legacy_seeded_accounts_v1")
            return

        try:
            raw = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return

        raw_migrations = raw.get("migrations", [])
        if isinstance(raw_migrations, list):
            self.applied_migrations = set(raw_migrations)
        raw_photo_uploads = raw.get("photo_uploads", [])
        if isinstance(raw_photo_uploads, list):
            self.photo_uploads = [
                {
                    "email": str(item["email"]).lower().strip(),
                    "upload_id": str(item["upload_id"]),
                    "image_hash": str(item.get("image_hash", "")),
                    "created_at": str(item["created_at"]),
                }
                for item in raw_photo_uploads
                if isinstance(item, dict) and item.get("email") and item.get("upload_id") and item.get("created_at")
            ]

        try:
            self.profile = UserProfile.model_validate(raw.get("profile", {}))
            if is_legacy_seeded_email(self.profile.name, admin_emails):
                self.profile = make_clean_profile("Guest")
        except Exception:
            pass

        self.meals.items = self._parse_list(raw, "meals", MealEntry)
        self.grocery.items = self._parse_list(raw, "grocery", GroceryItem)

        raw_users = raw.get("users", {})
        if isinstance(raw_users, dict):
            for email, udict in raw_users.items():
                clean_email = email.lower().strip()
                try:
                    udata = UserData(
                        email=clean_email,
                        name=udict.get("name"),
                        avatar_url=udict.get("avatar_url") or udict.get("avatarUrl"),
                        role=udict.get("role", "user"),
                        joined_date=udict.get("joined_date") or udict.get("joinedDate"),
                        last_active=udict.get("last_active") or udict.get("lastActive"),
                    )
                    if "profile" in udict:
                        udata.profile = UserProfile.model_validate(udict["profile"])
                    udata.meals.items = self._parse_list(udict, "meals", MealEntry)
                    if "grocery" in udict:
                        udata.grocery.items = self._parse_list(udict, "grocery", GroceryItem)
                    self.users[clean_email] = udata
                except Exception:
                    pass

        # Tracked one-time migration for JSON store: purge legacy seeded demo accounts
        if "purge_legacy_seeded_accounts_v1" not in self.applied_migrations:
            candidates = LEGACY_SEEDED_EMAILS - admin_emails
            for email in list(self.users.keys()):
                if email in candidates:
                    user = self.users[email]
                    # Never delete an email listed in ADMIN_EMAILS or any user who has logged at least one meal
                    if len(user.meals.items) == 0:
                        del self.users[email]
            self.applied_migrations.add("purge_legacy_seeded_accounts_v1")
            self._save_file_unlocked()

    def _parse_list(self, raw: dict, key: str, model: type[T]) -> list[T]:
        try:
            return [model.model_validate(x) for x in raw.get(key, [])]
        except Exception:
            return []

    def _save_file_unlocked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "profile": self.profile.model_dump(mode="json", by_alias=True),
            "meals": [m.model_dump(mode="json", by_alias=True) for m in self.meals.items],
            "grocery": [g.model_dump(mode="json", by_alias=True) for g in self.grocery.items],
            "migrations": sorted(list(self.applied_migrations)),
            "photo_uploads": self.photo_uploads,
            "users": {
                email: {
                    "email": u.email,
                    "name": u.name,
                    "avatar_url": u.avatar_url,
                    "role": u.role,
                    "joined_date": u.joined_date,
                    "last_active": u.last_active,
                    "profile": u.profile.model_dump(mode="json", by_alias=True),
                    "meals": [m.model_dump(mode="json", by_alias=True) for m in u.meals.items],
                    "grocery": [g.model_dump(mode="json", by_alias=True) for g in u.grocery.items],
                }
                for email, u in self.users.items()
            },
        }
        temp_path = self.path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
        temp_path.replace(self.path)

    def _save_unlocked(self) -> None:
        if self.storage_type == "postgres":
            if not self.is_healthy or not self.postgres_store:
                log.error("PostgreSQL backend is unhealthy (%s); refusing file fallback.", self.init_error)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Database backend unavailable: {self.init_error}",
                )
            try:
                with self.postgres_store._get_conn() as conn:
                    with conn.cursor() as cur:
                        for u in self.users.values():
                            cur.execute("""
                                INSERT INTO nv_users (email, name, avatar_url, role, joined_date, last_active, profile_json)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (email) DO UPDATE SET
                                    name = EXCLUDED.name,
                                    avatar_url = EXCLUDED.avatar_url,
                                    role = EXCLUDED.role,
                                    last_active = EXCLUDED.last_active,
                                    profile_json = EXCLUDED.profile_json
                            """, (
                                u.email,
                                u.name,
                                u.avatar_url,
                                u.role,
                                u.joined_date,
                                u.last_active,
                                json.dumps(u.profile.model_dump(mode="json", by_alias=True)),
                            ))

                            for m in u.meals.items:
                                cur.execute("""
                                    INSERT INTO nv_meals (id, user_email, date, label, photo_url, review_status, active_goals, meal_json)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                                    ON CONFLICT (id) DO UPDATE SET
                                        label = EXCLUDED.label,
                                        review_status = EXCLUDED.review_status,
                                        meal_json = EXCLUDED.meal_json
                                """, (
                                    m.id,
                                    u.email,
                                    m.date,
                                    m.label,
                                    m.photo_url,
                                    m.review_status,
                                    json.dumps(m.active_goals.model_dump(mode="json", by_alias=True)),
                                    json.dumps(m.model_dump(mode="json", by_alias=True)),
                                ))

                            cur.execute("DELETE FROM nv_grocery WHERE user_email = %s", (u.email,))
                            for g in u.grocery.items:
                                cur.execute("""
                                    INSERT INTO nv_grocery (id, user_email, name, price, checked)
                                    VALUES (%s, %s, %s, %s, %s)
                                """, (g.id, u.email, g.name, g.price, g.checked))
                self._save_file_unlocked()
            except HTTPException:
                raise
            except Exception as exc:
                sanitized = sanitize_db_error(exc, self.postgres_store.dsn)
                self.is_healthy = False
                self.init_error = sanitized
                log.error("PostgreSQL sync mutation failed (%s); refusing file fallback.", sanitized)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Database mutation failed: {sanitized}",
                ) from None
        else:
            self._save_file_unlocked()

    def _mutate(self, mutate: Callable[[], object]) -> object:
        """Run `mutate` under the lock and persist afterwards."""
        if self.storage_type == "postgres" and not self.is_healthy:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"PostgreSQL storage unavailable: {self.init_error}",
            )
        with self._lock:
            result = mutate()
            self._save_unlocked()
            return result

    def reserve_photo_upload(
        self,
        email: str,
        upload_id: str,
        image_hash: str,
        *,
        now: datetime | None = None,
    ) -> tuple[bool, datetime, int]:
        """Atomically reserve one of a user's configured rolling-hour photo uploads."""
        upload_limit = get_photo_upload_limit()
        clean_email = email.lower().strip()
        current_time = now or datetime.now(UTC)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=UTC)
        current_time = current_time.astimezone(UTC)
        cutoff = current_time - PHOTO_UPLOAD_WINDOW

        with self._lock:
            if self.storage_type == "postgres":
                if not self.is_healthy or not self.postgres_store:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Photo upload quota storage is unavailable.",
                    )
                try:
                    with self.postgres_store._get_conn() as conn:
                        with conn.transaction():
                            with conn.cursor() as cur:
                                cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s));", (clean_email,))
                                cur.execute(
                                    "DELETE FROM nv_photo_uploads WHERE user_email = %s AND created_at <= %s;",
                                    (clean_email, cutoff),
                                )
                                cur.execute(
                                    "SELECT created_at, image_hash FROM nv_photo_uploads WHERE user_email = %s AND upload_id = %s;",
                                    (clean_email, upload_id),
                                )
                                existing = cur.fetchone()
                                cur.execute(
                                    "SELECT COUNT(*), MIN(created_at) FROM nv_photo_uploads WHERE user_email = %s;",
                                    (clean_email,),
                                )
                                count, oldest = cur.fetchone()
                                if existing:
                                    if existing[1] != image_hash:
                                        raise HTTPException(
                                            status_code=status.HTTP_409_CONFLICT,
                                            detail="This upload ID is already associated with a different photo.",
                                        )
                                    return True, oldest + PHOTO_UPLOAD_WINDOW, max(0, upload_limit - count)
                                if count >= upload_limit:
                                    return False, oldest + PHOTO_UPLOAD_WINDOW, 0
                                cur.execute(
                                    "INSERT INTO nv_photo_uploads (user_email, upload_id, image_hash, created_at) VALUES (%s, %s, %s, %s);",
                                    (clean_email, upload_id, image_hash, current_time),
                                )
                                count += 1
                                cur.execute(
                                    "SELECT MIN(created_at) FROM nv_photo_uploads WHERE user_email = %s;",
                                    (clean_email,),
                                )
                                oldest = cur.fetchone()[0]
                                return True, oldest + PHOTO_UPLOAD_WINDOW, max(0, upload_limit - count)
                except HTTPException:
                    raise
                except Exception as exc:
                    sanitized = sanitize_db_error(exc, self.postgres_store.dsn)
                    log.error("PostgreSQL photo quota reservation failed: %s", sanitized)
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Photo upload quota storage is unavailable.",
                    ) from exc

            active_uploads = []
            for entry in self.photo_uploads:
                try:
                    created_at = datetime.fromisoformat(entry["created_at"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=UTC)
                if entry["email"] == clean_email and created_at > cutoff:
                    active_uploads.append((entry, created_at.astimezone(UTC)))
            self.photo_uploads = [entry for entry, _ in active_uploads]

            existing_entry = next((entry for entry, _ in active_uploads if entry["upload_id"] == upload_id), None)
            if existing_entry is not None:
                if existing_entry.get("image_hash", "") != image_hash:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This upload ID is already associated with a different photo.",
                    )
                oldest = min(created_at for _, created_at in active_uploads)
                return True, oldest + PHOTO_UPLOAD_WINDOW, max(0, upload_limit - len(active_uploads))
            if len(active_uploads) >= upload_limit:
                oldest = min(created_at for _, created_at in active_uploads)
                self._save_file_unlocked()
                return False, oldest + PHOTO_UPLOAD_WINDOW, 0

            self.photo_uploads.append({
                "email": clean_email,
                "upload_id": upload_id,
                "image_hash": image_hash,
                "created_at": current_time.isoformat().replace("+00:00", "Z"),
            })
            oldest = min([created_at for _, created_at in active_uploads] + [current_time])
            self._save_file_unlocked()
            return True, oldest + PHOTO_UPLOAD_WINDOW, max(0, upload_limit - len(active_uploads) - 1)

    # ── User Account Partitioning ─────────────────────────────────────────

    def get_or_create_user(
        self,
        email: str,
        name: str | None = None,
        avatar_url: str | None = None,
        role: Role = "user",
    ) -> UserData:
        clean_email = email.lower().strip()
        effective_role: Role = "admin" if clean_email == "bikashtalukder040@gmail.com" or role == "admin" else "user"
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        def op() -> UserData:
            if clean_email not in self.users:
                self.users[clean_email] = UserData(
                    email=clean_email,
                    name=name,
                    avatar_url=avatar_url,
                    role=effective_role,
                    joined_date=now,
                    last_active=now,
                )
            else:
                user = self.users[clean_email]
                user.last_active = now
                if name and (not user.name or user.name == clean_email.split("@")[0]):
                    user.name = name
                    user.profile.name = name
                if avatar_url:
                    user.avatar_url = avatar_url
                if effective_role == "admin":
                    user.role = "admin"
            return self.users[clean_email]

        return self._mutate(op)  # type: ignore[return-value]

    def get_user_profile(self, email: str) -> UserProfile:
        with self._lock:
            user = self.users.get(email.lower().strip())
            if user:
                return user.profile.model_copy(deep=True)
            return make_clean_profile()

    def set_user_profile(self, email: str, profile: UserProfile) -> UserProfile:
        clean_email = email.lower().strip()

        def op() -> UserProfile:
            user = self.users.get(clean_email)
            if not user:
                user = UserData(email=clean_email, name=profile.name)
                self.users[clean_email] = user
            user.profile = profile.model_copy(deep=True)
            user.last_active = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            return user.profile.model_copy(deep=True)

        return self._mutate(op)  # type: ignore[return-value]

    def list_user_meals(self, email: str) -> list[MealEntry]:
        with self._lock:
            user = self.users.get(email.lower().strip())
            if user:
                return [m.model_copy(deep=True) for m in user.meals.items]
            return []

    def add_user_meal(
        self,
        email: str,
        *,
        label: str,
        items: list[DetectedItem],
        totals: MealTotals,
        photo_url: str | None,
        active_goals: HealthGoals,
    ) -> MealEntry:
        clean_email = email.lower().strip()
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        lowest_conf = min((it.confidence for it in items), default=100.0)
        review_status = "pending" if lowest_conf < 70.0 else None

        entry = MealEntry(
            id=f"meal-{uuid.uuid4().hex[:12]}",
            date=now,
            label=label,
            items=[i.model_copy(deep=True) for i in items],
            totals=totals.model_copy(deep=True),
            photo_url=photo_url,
            active_goals=active_goals.model_copy(deep=True),
            review_status=review_status,
        )

        def op() -> MealEntry:
            user = self.users.get(clean_email)
            if not user:
                user = UserData(email=clean_email)
                self.users[clean_email] = user
            user.meals.upsert(entry)
            user.last_active = now
            return entry.model_copy(deep=True)

        return self._mutate(op)  # type: ignore[return-value]

    def delete_user_meal(self, email: str, meal_id: str) -> None:
        clean_email = email.lower().strip()

        def op() -> None:
            user = self.users.get(clean_email)
            if user:
                user.meals.remove(meal_id)
            else:
                self.meals.remove(meal_id)

            if self.postgres_store:
                try:
                    with self.postgres_store._get_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute("DELETE FROM nv_meals WHERE id = %s", (meal_id,))
                except Exception as exc:
                    log.warning("PostgreSQL meal delete failed: %s", exc)

        self._mutate(op)

    def update_user_latest_meal(
        self,
        email: str,
        *,
        label: str | None = None,
        items: list[DetectedItem] | None = None,
        totals: MealTotals | None = None,
        review_status: str | None = None,
    ) -> MealEntry | None:
        clean_email = email.lower().strip()

        def op() -> MealEntry | None:
            user = self.users.get(clean_email)
            if not user or not user.meals.items:
                return None
            latest = user.meals.items[0]
            if label is not None:
                latest.label = label
            if items is not None:
                latest.items = [i.model_copy(deep=True) for i in items]
                lowest_conf = min((it.confidence for it in latest.items), default=100.0)
                latest.review_status = "pending" if lowest_conf < 70.0 else None
            if totals is not None:
                latest.totals = totals.model_copy(deep=True)
            if review_status is not None:
                latest.review_status = review_status
            return latest.model_copy(deep=True)

        return self._mutate(op)  # type: ignore[return-value]

    def list_user_grocery(self, email: str) -> list[GroceryItem]:
        with self._lock:
            user = self.users.get(email.lower().strip())
            if user:
                return [g.model_copy(deep=True) for g in user.grocery.items]
            return []

    def add_user_grocery(self, email: str, name: str, price: float) -> GroceryItem:
        clean_email = email.lower().strip()

        def op() -> GroceryItem:
            user = self.users.get(clean_email)
            if not user:
                user = UserData(email=clean_email)
                self.users[clean_email] = user
            max_n = max(
                (int("".join(c for c in g.id if c.isdigit()) or 0) for g in user.grocery.items),
                default=0,
            )
            item = GroceryItem(
                id=f"g-new-{max_n + 1}",
                name=name,
                price=max(0.0, price),
                checked=False,
            )
            user.grocery.upsert(item)
            return item.model_copy(deep=True)

        return self._mutate(op)  # type: ignore[return-value]

    def add_user_grocery_bulk(self, email: str, items: list[tuple[str, float]]) -> list[GroceryItem]:
        clean_email = email.lower().strip()

        def op() -> list[GroceryItem]:
            user = self.users.get(clean_email)
            if not user:
                user = UserData(email=clean_email)
                self.users[clean_email] = user
            created_items: list[GroceryItem] = []
            max_n = max(
                (int("".join(c for c in g.id if c.isdigit()) or 0) for g in user.grocery.items),
                default=0,
            )
            for name, price in items:
                max_n += 1
                item = GroceryItem(
                    id=f"g-new-{max_n}",
                    name=name,
                    price=max(0.0, price),
                    checked=False,
                )
                user.grocery.upsert(item)
                created_items.append(item.model_copy(deep=True))
            return created_items

        return self._mutate(op)  # type: ignore[return-value]

    def remove_user_grocery(self, email: str, item_id: str) -> None:
        clean_email = email.lower().strip()

        def op() -> None:
            user = self.users.get(clean_email)
            if user:
                user.grocery.remove(item_id)
            else:
                self.grocery.remove(item_id)

        self._mutate(op)

    def update_user_grocery_price(self, email: str, item_id: str, price: float) -> GroceryItem:
        clean_email = email.lower().strip()

        def op() -> GroceryItem:
            user = self.users.get(clean_email)
            target_list = user.grocery.items if user else self.grocery.items
            for g in target_list:
                if g.id == item_id:
                    g.price = max(0.0, min(9999.0, price))
                    return g.model_copy(deep=True)
            raise StateError(f"unknown grocery id: {item_id}")

        return self._mutate(op)  # type: ignore[return-value]

    def toggle_user_grocery(self, email: str, item_id: str) -> GroceryItem:
        clean_email = email.lower().strip()

        def op() -> GroceryItem:
            user = self.users.get(clean_email)
            target_list = user.grocery.items if user else self.grocery.items
            for g in target_list:
                if g.id == item_id:
                    g.checked = not g.checked
                    return g.model_copy(deep=True)
            raise StateError(f"unknown grocery id: {item_id}")

        return self._mutate(op)  # type: ignore[return-value]

    def clear_user_grocery(self, email: str) -> None:
        clean_email = email.lower().strip()

        def op() -> None:
            user = self.users.get(clean_email)
            if user:
                user.grocery.items.clear()
            else:
                self.grocery.items.clear()

        self._mutate(op)

    # ── Admin Telemetry & Analytics Aggregation ──────────────────────────

    def get_admin_metrics(self) -> AdminMetrics:
        with self._lock:
            self._sync_users_from_db_unlocked()
            all_users_list = list(self.users.values())
            all_meals: list[MealEntry] = []
            for u in all_users_list:
                all_meals.extend(u.meals.items)

            now = datetime.now(UTC)
            today_str = now.strftime("%Y-%m-%d")
            seven_days_ago_ts = now.timestamp() - (7 * 86400)

            meals_today = 0
            meals_this_week = 0
            flagged_meals_count = 0
            new_users_today = 0
            new_users_this_week = 0
            active_users7d = 0

            # Daily meal volume for the last 7 calendar days
            day_keys = [
                (now.date() - timedelta(days=i)).isoformat()
                for i in range(6, -1, -1)
            ]
            vol_counts = {dk: 0 for dk in day_keys}

            for m in all_meals:
                m_date_str = m.date[:10]
                if m_date_str in vol_counts:
                    vol_counts[m_date_str] += 1
                if m_date_str == today_str:
                    meals_today += 1
                try:
                    dt = datetime.fromisoformat(m.date.replace("Z", "+00:00"))
                    if dt.timestamp() >= seven_days_ago_ts:
                        meals_this_week += 1
                except Exception:
                    pass

                min_conf = min((it.confidence for it in m.items), default=100.0)
                is_flagged = m.review_status in ("flagged", "pending") or min_conf < 70.0
                if is_flagged:
                    flagged_meals_count += 1

            for u in all_users_list:
                if u.joined_date[:10] == today_str:
                    new_users_today += 1
                try:
                    jdt = datetime.fromisoformat(u.joined_date.replace("Z", "+00:00"))
                    if jdt.timestamp() >= seven_days_ago_ts:
                        new_users_this_week += 1
                except Exception:
                    pass

                try:
                    adt = datetime.fromisoformat(u.last_active.replace("Z", "+00:00"))
                    if adt.timestamp() >= seven_days_ago_ts:
                        active_users7d += 1
                except Exception:
                    pass

            total_users_count = len(self.users)
            total_meals_count = len(all_meals)
            avg_meals = round(meals_this_week / max(1, total_users_count), 1)
            flagged_pct = (
                round((flagged_meals_count / total_meals_count * 100), 1)
                if total_meals_count > 0
                else None
            )

            summaries: list[AdminUserSummary] = [
                AdminUserSummary(
                    email=u.email,
                    name=u.name,
                    avatar_url=u.avatar_url,
                    role=u.role,
                    meals_count=len(u.meals.items),
                    streak_days=_calculate_streak({m.date[:10] for m in u.meals.items}),
                    joined_date=u.joined_date,
                    last_active=u.last_active,
                )
                for u in all_users_list
            ]

            daily_volumes = [
                DailyMealVolume(date=dk, count=vol_counts[dk])
                for dk in day_keys
            ]

            return AdminMetrics(
                total_users=total_users_count,
                new_users_today=new_users_today,
                new_users_this_week=new_users_this_week,
                active_users7d=active_users7d,
                meals_today=meals_today,
                meals_this_week=meals_this_week,
                total_meals=total_meals_count,
                avg_meals_per_user=avg_meals,
                flagged_meals_count=flagged_meals_count,
                flagged_percentage=flagged_pct,
                daily_meal_volume=daily_volumes,
                users=summaries,
            )

    def list_admin_users(
        self,
        search: str | None = None,
        sort_by: str = "lastActive",
        order: str = "desc",
    ) -> list[AdminUserSummary]:
        with self._lock:
            self._sync_users_from_db_unlocked()
            all_users = list(self.users.values())
            if search:
                q = search.lower().strip()
                all_users = [
                    u for u in all_users
                    if q in u.email.lower() or (u.name and q in u.name.lower())
                ]

            summaries = [
                AdminUserSummary(
                    email=u.email,
                    name=u.name,
                    avatar_url=u.avatar_url,
                    role=u.role,
                    meals_count=len(u.meals.items),
                    streak_days=_calculate_streak({m.date[:10] for m in u.meals.items}),
                    joined_date=u.joined_date,
                    last_active=u.last_active,
                )
                for u in all_users
            ]

            reverse = (order.lower() == "desc")
            if sort_by == "email":
                summaries.sort(key=lambda x: x.email.lower(), reverse=reverse)
            elif sort_by == "name":
                summaries.sort(key=lambda x: (x.name or "").lower(), reverse=reverse)
            elif sort_by == "role":
                summaries.sort(key=lambda x: x.role, reverse=reverse)
            elif sort_by == "mealsCount":
                summaries.sort(key=lambda x: x.meals_count, reverse=reverse)
            elif sort_by == "streakDays":
                summaries.sort(key=lambda x: x.streak_days, reverse=reverse)
            elif sort_by == "joinedDate":
                summaries.sort(key=lambda x: x.joined_date, reverse=reverse)
            else:  # default lastActive
                summaries.sort(key=lambda x: x.last_active, reverse=reverse)

            return summaries

    def get_admin_user_detail(self, email: str) -> AdminUserDetail | None:
        clean = email.lower().strip()
        with self._lock:
            self._sync_users_from_db_unlocked()
            u = self.users.get(clean)
            if not u:
                return None
            summary = AdminUserSummary(
                email=u.email,
                name=u.name,
                avatar_url=u.avatar_url,
                role=u.role,
                meals_count=len(u.meals.items),
                streak_days=_calculate_streak({m.date[:10] for m in u.meals.items}),
                joined_date=u.joined_date,
                last_active=u.last_active,
            )
            return AdminUserDetail(
                user=summary,
                profile=u.profile.model_copy(deep=True),
                recent_meals=[m.model_copy(deep=True) for m in u.meals.items[:50]],
            )

    def get_popular_foods(self, date_range: str = "7d") -> list[PopularFoodItem]:
        with self._lock:
            self._sync_users_from_db_unlocked()
            now = datetime.now(UTC)
            cutoff_ts = 0.0
            today_str = now.strftime("%Y-%m-%d")
            if date_range == "today":
                cutoff_ts = datetime(now.year, now.month, now.day, tzinfo=UTC).timestamp()
            elif date_range == "7d":
                cutoff_ts = now.timestamp() - (7 * 86400)
            elif date_range == "30d":
                cutoff_ts = now.timestamp() - (30 * 86400)

            food_stats: dict[str, dict[str, Any]] = {}
            total_items = 0

            for u in self.users.values():
                for m in u.meals.items:
                    try:
                        m_ts = datetime.fromisoformat(m.date.replace("Z", "+00:00")).timestamp()
                    except Exception:
                        m_ts = 0.0

                    if date_range == "today" and not m.date.startswith(today_str):
                        continue
                    if date_range in ("7d", "30d") and m_ts < cutoff_ts:
                        continue

                    for item in m.items:
                        total_items += 1
                        canonical_name = item.name.strip()
                        if not canonical_name:
                            continue
                        key = canonical_name.title()
                        if key not in food_stats:
                            lower = key.lower()
                            cat = "produce" if any(w in lower for w in ("salad", "vegetable", "onion", "raita", "tomato", "spinach")) else "protein" if any(w in lower for w in ("chicken", "beef", "fish", "egg", "meat", "mutton", "lentil", "dal")) else "grains" if any(w in lower for w in ("rice", "biryani", "roti", "naan", "bread", "khichuri")) else "other"
                            food_stats[key] = {
                                "name": key,
                                "count": 0,
                                "confidence_sum": 0.0,
                                "category": cat,
                            }
                        food_stats[key]["count"] += 1
                        food_stats[key]["confidence_sum"] += float(item.confidence)

            result: list[PopularFoodItem] = []
            for item_data in food_stats.values():
                cnt = item_data["count"]
                share = round((cnt / total_items * 100), 1) if total_items > 0 else 0.0
                avg_conf = round(item_data["confidence_sum"] / cnt, 1) if cnt > 0 else 0.0
                result.append(
                    PopularFoodItem(
                        name=item_data["name"],
                        count=cnt,
                        share_percentage=share,
                        category=item_data["category"],
                        avg_confidence=avg_conf,
                    )
                )

            result.sort(key=lambda x: x.count, reverse=True)
            return result

    def get_review_queue(self, status: str = "all") -> list[ReviewQueueItem]:
        with self._lock:
            self._sync_users_from_db_unlocked()
            items: list[ReviewQueueItem] = []
            for u in self.users.values():
                for m in u.meals.items:
                    min_conf = min((it.confidence for it in m.items), default=100.0)
                    is_flagged = min_conf < 70.0 or m.review_status is not None

                    if not is_flagged:
                        continue

                    current_status = m.review_status or ("pending" if min_conf < 70.0 else "approved")

                    if status != "all" and current_status != status:
                        continue

                    items.append(
                        ReviewQueueItem(
                            meal_id=m.id,
                            user_email=u.email,
                            user_name=u.name,
                            timestamp=m.date,
                            label=m.label,
                            photo_url=m.photo_url,
                            items=[i.model_copy(deep=True) for i in m.items],
                            lowest_confidence=round(min_conf, 1),
                            review_status=current_status,
                        )
                    )

            items.sort(key=lambda x: x.timestamp, reverse=True)
            return items

    def update_review_queue(
        self,
        meal_id: str,
        action: ReviewQueueAction,
        corrected_label: str | None = None,
    ) -> ReviewQueueItem | None:
        def op() -> ReviewQueueItem | None:
            for u in self.users.values():
                for m in u.meals.items:
                    if m.id == meal_id:
                        if action == "approve":
                            m.review_status = "approved"
                        elif action == "dismiss":
                            m.review_status = "dismissed"
                        elif action == "correct":
                            m.review_status = "corrected"
                            if corrected_label:
                                m.label = corrected_label.strip()
                        min_conf = min((it.confidence for it in m.items), default=100.0)
                        return ReviewQueueItem(
                            meal_id=m.id,
                            user_email=u.email,
                            user_name=u.name,
                            timestamp=m.date,
                            label=m.label,
                            photo_url=m.photo_url,
                            items=[i.model_copy(deep=True) for i in m.items],
                            lowest_confidence=round(min_conf, 1),
                            review_status=m.review_status or "pending",
                        )
            return None

        return self._mutate(op)  # type: ignore[return-value]

    # ── Profile (Legacy Single-User fallback) ────────────────────────────

    def get_profile(self) -> UserProfile:
        with self._lock:
            return self.profile.model_copy(deep=True)

    def set_profile(self, profile: UserProfile) -> UserProfile:
        return self._mutate(
            lambda: setattr(self, "profile", profile.model_copy(deep=True))
            or self.profile.model_copy(deep=True)
        )

    # ── Meals (Legacy Single-User fallback) ──────────────────────────────

    def list_meals(self) -> list[MealEntry]:
        with self._lock:
            return [m.model_copy(deep=True) for m in self.meals.items]

    def add_meal(
        self,
        *,
        label: str,
        items: list[DetectedItem],
        totals: MealTotals,
        photo_url: str | None,
        active_goals: HealthGoals,
    ) -> MealEntry:
        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        lowest_conf = min((it.confidence for it in items), default=100.0)
        review_status = "pending" if lowest_conf < 70.0 else None

        entry = MealEntry(
            id=f"meal-{uuid.uuid4().hex[:12]}",
            date=now,
            label=label,
            items=[i.model_copy(deep=True) for i in items],
            totals=totals.model_copy(deep=True),
            photo_url=photo_url,
            active_goals=active_goals.model_copy(deep=True),
            review_status=review_status,
        )

        def add() -> MealEntry:
            self.meals.upsert(entry)
            return entry.model_copy(deep=True)

        return self._mutate(add)

    def delete_meal(self, meal_id: str) -> None:
        self._mutate(lambda: self.meals.remove(meal_id))

    # ── Grocery (Legacy Single-User fallback) ────────────────────────────

    def _next_grocery_id(self) -> str:
        max_n = max(
            (int("".join(c for c in g.id if c.isdigit()) or 0) for g in self.grocery.items),
            default=0,
        )
        return f"g-new-{max_n + 1}"

    def list_grocery(self) -> list[GroceryItem]:
        with self._lock:
            return [g.model_copy(deep=True) for g in self.grocery.items]

    def add_grocery(self, name: str, price: float) -> GroceryItem:
        item = GroceryItem(
            id=self._next_grocery_id(),
            name=name,
            price=max(0.0, price),
            checked=False,
        )
        return self._mutate(lambda: self.grocery.upsert(item) or item.model_copy(deep=True))

    def remove_grocery(self, item_id: str) -> None:
        self._mutate(lambda: self.grocery.remove(item_id))

    def update_grocery_price(self, item_id: str, price: float) -> GroceryItem:
        def update() -> GroceryItem:
            for g in self.grocery.items:
                if g.id == item_id:
                    g.price = max(0.0, min(9999.0, price))
                    return g.model_copy(deep=True)
            raise StateError(f"unknown grocery id: {item_id}")

        return self._mutate(update)

    def toggle_grocery(self, item_id: str) -> GroceryItem:
        def toggle() -> GroceryItem:
            for g in self.grocery.items:
                if g.id == item_id:
                    g.checked = not g.checked
                    return g.model_copy(deep=True)
            raise StateError(f"unknown grocery id: {item_id}")

        return self._mutate(toggle)

    def clear_grocery(self) -> None:
        self._mutate(lambda: self.grocery.items.clear())


# ── Process-wide singleton ──────────────────────────────────────────────

_state: State | None = None


def init_state(path: Path) -> State:
    """Create the singleton (or return the existing one). Called once
    at app startup with the path resolved from env."""
    global _state
    if _state is None:
        _state = State(path)
        _state.load()
    return _state


def get_state() -> State:
    """FastAPI dependency that hands the singleton to a route handler."""
    if _state is None:
        raise RuntimeError(
            "State singleton not initialized — call init_state(path) during FastAPI startup."
        )
    return _state


def get_state_optional() -> State | None:
    """FastAPI dependency that returns the state singleton if initialized, or None."""
    return _state
