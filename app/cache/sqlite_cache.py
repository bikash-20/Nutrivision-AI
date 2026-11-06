"""TTL cache backed by stdlib `sqlite3`.

No external dependencies. Keys are (namespace, key_str) tuples — the
namespace lets one DB carry vision / nutrition / profile caches.
Values are JSON-encoded; TTLs are stored as absolute Unix-ms.

Schema:
    CREATE TABLE cache (
        namespace  TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at INTEGER NOT NULL,   -- Unix ms; 0 = never
        PRIMARY KEY (namespace, key)
    );

Thread-safety: `sqlite3` connections serialize by default; we keep one
connection per cache instance and let sqlite3 handle the locking. For
the demo this is plenty.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

DEFAULT_TTL_S = 24 * 60 * 60  # 1 day


class TTLCache:
    """Tiny TTL cache keyed by `(namespace, key_str)`."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    def _ensure(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.path)
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cache (
                    namespace  TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    value      TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    PRIMARY KEY (namespace, key)
                )
                """
            )
            self._conn.commit()
        return self._conn

    def get(self, key: tuple[str, str]) -> Any | None:
        """Return the cached value, or `None` on miss / expiry / I/O error."""
        namespace, key_str = key
        try:
            conn = self._ensure()
            row = conn.execute(
                "SELECT value, expires_at FROM cache "
                "WHERE namespace = ? AND key = ?",
                (namespace, key_str),
            ).fetchone()
        except sqlite3.Error as exc:
            log.warning("TTLCache.get failed: %s", exc)
            return None
        if row is None:
            return None
        value_json, expires_at = row
        if expires_at > 0 and expires_at < _now_ms():
            # Lazy delete of expired row.
            try:
                conn.execute(
                    "DELETE FROM cache WHERE namespace = ? AND key = ?",
                    (namespace, key_str),
                )
                conn.commit()
            except sqlite3.Error:
                pass
            return None
        try:
            return json.loads(value_json)
        except json.JSONDecodeError:
            return None

    def put(
        self,
        key: tuple[str, str],
        value: Any,
        ttl_s: int = DEFAULT_TTL_S,
    ) -> None:
        """Insert or replace `value` at `key`. `ttl_s=0` means never expire."""
        namespace, key_str = key
        expires_at = (_now_ms() + ttl_s * 1000) if ttl_s > 0 else 0
        try:
            conn = self._ensure()
            conn.execute(
                "INSERT OR REPLACE INTO cache "
                "(namespace, key, value, expires_at) VALUES (?, ?, ?, ?)",
                (namespace, key_str, json.dumps(value), expires_at),
            )
            conn.commit()
        except sqlite3.Error as exc:
            log.warning("TTLCache.put failed: %s", exc)

    def clear(self) -> None:
        try:
            conn = self._ensure()
            conn.execute("DELETE FROM cache")
            conn.commit()
        except sqlite3.Error as exc:
            log.warning("TTLCache.clear failed: %s", exc)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None


def _now_ms() -> int:
    return int(time.time() * 1000)
