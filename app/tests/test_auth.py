"""Unit tests for Google authentication, JWT session verification, and multi-user isolation."""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.auth import create_jwt, verify_jwt
from app.main import create_app
from app.services.state import init_state


@pytest.fixture
def client(tmp_path, monkeypatch):
    import app.services.state as state_mod
    state_mod._state = None
    monkeypatch.setenv("STATE_PATH", str(tmp_path / "test_state.json"))
    monkeypatch.setenv("ADMIN_EMAILS", "superadmin@example.com,boss@domain.com")
    monkeypatch.setenv("JWT_SECRET", "test-only-signing-secret-for-auth-suite")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client.apps.googleusercontent.com")
    init_state(tmp_path / "test_state.json")
    app = create_app()
    with TestClient(app) as c:
        yield c
    state_mod._state = None


def test_jwt_create_and_verify_roundtrip():
    payload = {"sub": "123", "email": "test@example.com", "role": "user", "exp": int(time.time()) + 3600}
    secret = b"my-custom-test-secret"
    token = create_jwt(payload, secret)
    assert isinstance(token, str)
    decoded = verify_jwt(token, secret)
    assert decoded is not None
    assert decoded["email"] == "test@example.com"
    assert decoded["sub"] == "123"


def test_jwt_expired_returns_none():
    payload = {"sub": "123", "email": "test@example.com", "exp": int(time.time()) - 100}
    secret = b"my-custom-test-secret"
    token = create_jwt(payload, secret)
    assert verify_jwt(token, secret) is None


def test_jwt_tampered_returns_none():
    payload = {"sub": "123", "email": "test@example.com", "exp": int(time.time()) + 3600}
    secret = b"my-custom-test-secret"
    token = create_jwt(payload, secret)
    tampered = token[:-4] + "abcd"
    assert verify_jwt(tampered, secret) is None


def test_demo_login_route_is_removed_and_returns_404(client):
    res_user = client.post("/api/auth/demo?role=user")
    assert res_user.status_code == 404

    res_admin = client.post("/api/auth/demo?role=admin")
    assert res_admin.status_code == 404


def test_google_sign_in_regular_user(client):
    mock_google_info = {
        "iss": "https://accounts.google.com",
        "sub": "google-user-999",
        "email": "fresh.user@gmail.com",
        "email_verified": "true",
        "name": "Fresh User",
        "picture": "https://lh3.googleusercontent.com/photo.jpg",
        "aud": "test-google-client.apps.googleusercontent.com",
        "exp": str(int(time.time()) + 3600),
    }

    with patch("httpx.Client.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_google_info
        mock_get.return_value = mock_resp

        res = client.post("/api/auth/google", json={"idToken": "fake-google-id-token"})
        assert res.status_code == 200
        data = res.json()
        assert data["session"]["email"] == "fresh.user@gmail.com"
        assert data["session"]["name"] == "Fresh User"
        assert data["session"]["role"] == "user"
        assert data["session"]["avatarUrl"] == "https://lh3.googleusercontent.com/photo.jpg"
        assert data["token"] is not None


def test_google_sign_in_admin_user_via_whitelist(client):
    mock_google_info = {
        "iss": "https://accounts.google.com",
        "sub": "google-admin-001",
        "email": "boss@domain.com",
        "email_verified": "true",
        "name": "Big Boss",
        "picture": "https://lh3.googleusercontent.com/admin.jpg",
        "aud": "test-google-client.apps.googleusercontent.com",
        "exp": str(int(time.time()) + 3600),
    }

    with patch("httpx.Client.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_google_info
        mock_get.return_value = mock_resp

        res = client.post("/api/auth/google", json={"idToken": "fake-admin-token"})
        assert res.status_code == 200
        data = res.json()
        assert data["session"]["email"] == "boss@domain.com"
        assert data["session"]["role"] == "admin"


def test_google_sign_in_rejects_token_for_another_client(client):
    mock_google_info = {
        "email": "fresh.user@gmail.com",
        "email_verified": "true",
        "aud": "another-google-client.apps.googleusercontent.com",
        "exp": str(int(time.time()) + 3600),
    }

    with patch("httpx.Client.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_google_info
        mock_get.return_value = mock_resp

        response = client.post("/api/auth/google", json={"idToken": "token-for-another-client"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Google token audience mismatch."


@pytest.mark.parametrize(
    "secret",
    [None, "short", "nutrivision-secure-jwt-secret-key-prod-v1"],
)
def test_app_requires_a_unique_jwt_secret(monkeypatch, secret):
    if secret is None:
        monkeypatch.delenv("JWT_SECRET", raising=False)
    else:
        monkeypatch.setenv("JWT_SECRET", secret)

    with pytest.raises(RuntimeError, match="JWT_SECRET must be a unique value"):
        create_app()


def test_cors_allows_configured_origin_without_credentials(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in response.headers


def test_cors_rejects_unconfigured_vercel_preview(client):
    response = client.get("/health", headers={"Origin": "https://untrusted.vercel.app"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_multi_user_data_isolation(client):
    # User 1 token
    tok1 = create_jwt({"sub": "u1", "email": "user1@gmail.com", "role": "user", "exp": int(time.time()) + 3600})
    headers1 = {"Authorization": f"Bearer {tok1}"}

    # User 2 token
    tok2 = create_jwt({"sub": "u2", "email": "user2@gmail.com", "role": "user", "exp": int(time.time()) + 3600})
    headers2 = {"Authorization": f"Bearer {tok2}"}

    # User 1 posts a meal
    m1 = {
        "label": "User 1 Salad",
        "items": [{"name": "Salad", "confidence": 95.0, "grams": 150.0}],
        "totals": {"kcal": 150, "protein": 5, "carbs": 10, "fat": 2, "fiber": 4, "sodium": 80, "sugar": 3},
        "active_goals": {"diabetic": False, "protein": False, "budget": False, "mediter": False},
    }
    r1 = client.post("/api/meals", json=m1, headers=headers1)
    assert r1.status_code == 201

    # User 2 gets meals — should be empty (isolated from User 1!)
    r2_meals = client.get("/api/meals", headers=headers2)
    assert r2_meals.status_code == 200
    assert len(r2_meals.json()) == 0

    # User 1 gets meals — should have 1 meal
    r1_meals = client.get("/api/meals", headers=headers1)
    assert r1_meals.status_code == 200
    assert len(r1_meals.json()) == 1
    assert r1_meals.json()[0]["label"] == "User 1 Salad"


def test_jwt_bearer_auto_recreates_missing_user(client):
    from app.services.state import get_state
    st = get_state()
    email = "restored@example.com"
    assert not st.has_user(email)

    tok = create_jwt({
        "sub": "restored-999",
        "email": email,
        "name": "Restored User",
        "role": "user",
        "exp": int(time.time()) + 3600,
    })
    headers = {"Authorization": f"Bearer {tok}"}

    # Request with valid JWT whose user was wiped from state
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["email"] == email

    # User must now exist in store
    assert st.has_user(email)
    user_data = st.get_user(email)
    assert user_data is not None
    assert user_data.name == "Restored User"


def test_admin_user_assigned_role_at_login(client):
    from app.services.state import get_state
    st = get_state()
    # Unauthenticated emails in ADMIN_EMAILS must NOT be seeded as users on startup
    assert not st.has_user("superadmin@example.com")
    assert not st.has_user("boss@domain.com")

    # When an admin user accesses with a valid token, they are created with admin role
    tok = create_jwt({
        "sub": "adm-001",
        "email": "boss@domain.com",
        "name": "Boss Admin",
        "role": "admin",
        "exp": int(time.time()) + 3600,
    })
    headers = {"Authorization": f"Bearer {tok}"}
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["role"] == "admin"

    # Now they exist in users store
    assert st.has_user("boss@domain.com")
    admin_user = st.get_user("boss@domain.com")
    assert admin_user is not None
    assert admin_user.role == "admin"


def test_is_legacy_seeded_email_protects_real_users():
    from app.services.state import is_legacy_seeded_email

    # Real users with substrings 'rafi', 'demo', 'judge' must NEVER be flagged
    assert not is_legacy_seeded_email("rafi.ahmed@gmail.com")
    assert not is_legacy_seeded_email("demo.user@gmail.com")
    assert not is_legacy_seeded_email("judge.clark@yahoo.com")
    assert not is_legacy_seeded_email("mohammad.rafi@outlook.com")
    assert not is_legacy_seeded_email("demonstrator@university.edu")
    assert not is_legacy_seeded_email("judgmental@lawfirm.com")
    assert not is_legacy_seeded_email("user@gmail.com")

    # Strictly known legacy seeded emails ARE flagged
    assert is_legacy_seeded_email("judge.google.user@nutrivision.ai")
    assert is_legacy_seeded_email("admin@nutrivision.ai")
    assert is_legacy_seeded_email("user@nutrivision.ai")
    assert is_legacy_seeded_email("demo@nutrivision.ai")
    assert is_legacy_seeded_email("rafi@nutrivision.ai")

    # If an email is listed in ADMIN_EMAILS, it is never flagged
    assert not is_legacy_seeded_email("admin@nutrivision.ai", {"admin@nutrivision.ai"})


def test_real_users_with_substring_names_are_not_deleted(tmp_path, monkeypatch):
    import json

    from app.services.state import State

    monkeypatch.setenv("ADMIN_EMAILS", "admin@nutrivision.ai")

    state_file = tmp_path / "seeded_state.json"
    now_iso = "2026-10-31T12:00:00Z"

    # Pre-populate state JSON simulating existing data before migration
    pre_data = {
        "profile": {"name": "Guest"},
        "meals": [],
        "grocery": [],
        "users": {
            "rafi.ahmed@gmail.com": {
                "email": "rafi.ahmed@gmail.com",
                "name": "Rafi Ahmed",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Rafi Ahmed"},
                "meals": [],
                "grocery": [],
            },
            "demo.user@gmail.com": {
                "email": "demo.user@gmail.com",
                "name": "Demo User",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Demo User"},
                "meals": [],
                "grocery": [],
            },
            "judge.watson@gmail.com": {
                "email": "judge.watson@gmail.com",
                "name": "Judge Watson",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Judge Watson"},
                "meals": [],
                "grocery": [],
            },
            # Known legacy account WITH a meal (MUST NOT BE DELETED)
            "user@nutrivision.ai": {
                "email": "user@nutrivision.ai",
                "name": "Legacy User With Meals",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Legacy"},
                "meals": [
                    {
                        "id": "meal-01",
                        "date": "2026-10-31",
                        "label": "Rice & Fish",
                        "items": [{"name": "Rice", "confidence": 90.0, "grams": 150}],
                        "totals": {"kcal": 300, "protein": 10, "carbs": 50, "fat": 2, "fiber": 1, "sodium": 100, "sugar": 0},
                        "active_goals": {"diabetic": False, "protein": False, "budget": False, "mediter": False},
                    }
                ],
                "grocery": [],
            },
            # Known legacy account in ADMIN_EMAILS (MUST NOT BE DELETED)
            "admin@nutrivision.ai": {
                "email": "admin@nutrivision.ai",
                "name": "Admin",
                "role": "admin",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Admin"},
                "meals": [],
                "grocery": [],
            },
            # Known legacy accounts with 0 meals (MUST BE DELETED)
            "judge.google.user@nutrivision.ai": {
                "email": "judge.google.user@nutrivision.ai",
                "name": "Old Judge Demo",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Old Judge Demo"},
                "meals": [],
                "grocery": [],
            },
            "rafi@nutrivision.ai": {
                "email": "rafi@nutrivision.ai",
                "name": "Old Rafi Demo",
                "role": "user",
                "joined_date": now_iso,
                "last_active": now_iso,
                "profile": {"name": "Old Rafi Demo"},
                "meals": [],
                "grocery": [],
            },
        },
    }
    state_file.write_text(json.dumps(pre_data))

    # Initialize State and load (triggers tracked migration once)
    st = State(state_file)
    st.load()

    # Real users with substring keywords MUST NOT BE DELETED
    assert st.has_user("rafi.ahmed@gmail.com")
    assert st.has_user("demo.user@gmail.com")
    assert st.has_user("judge.watson@gmail.com")

    # Legacy user with at least one meal MUST NOT BE DELETED
    assert st.has_user("user@nutrivision.ai")
    assert len(st.get_user("user@nutrivision.ai").meals.items) == 1

    # Legacy user in ADMIN_EMAILS MUST NOT BE DELETED
    assert st.has_user("admin@nutrivision.ai")

    # Empty legacy seeded accounts MUST BE DELETED
    assert not st.has_user("judge.google.user@nutrivision.ai")
    assert not st.has_user("rafi@nutrivision.ai")

    # Migration must be recorded
    assert "purge_legacy_seeded_accounts_v1" in st.applied_migrations

    # Subsequent loads MUST NOT re-run deletion
    st2 = State(state_file)
    st2.load()
    assert "purge_legacy_seeded_accounts_v1" in st2.applied_migrations
    assert st2.has_user("rafi.ahmed@gmail.com")
    assert st2.has_user("demo.user@gmail.com")
