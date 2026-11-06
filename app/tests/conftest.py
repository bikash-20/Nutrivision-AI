"""Shared test fixtures.

Two big things to set up:
  1. An isolated state.json per test (no leakage between tests, no
     clobbering of the user's real `app/state.json`).
  2. A stub OFF client so the nutrition resolver can be exercised
     without hitting the public network.

The FastAPI `TestClient` runs the app's `lifespan` hook, which calls
`init_state(path)` — so pointing `STATE_PATH` at a temp file is enough
to get a clean state per test.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Pin state to a temp file before app modules import — so the singleton
# picks up the path at first instantiation. (Each test below re-runs the
# `lifespan` hook, which calls `init_state()` again — idempotent.)
os.environ.setdefault("STATE_PATH", "/tmp/nv-test-state.json")
os.environ.setdefault("JWT_SECRET", "test-only-signing-secret-for-nutrivision-tests-32chars")


@pytest.fixture
def state_path(tmp_path: Path) -> Path:
    """A per-test JSON file backing the state singleton. Deleted
    automatically when the fixture tears down."""
    return tmp_path / "state.json"


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """A valid Bearer token header for test requests."""
    import time
    from app.api.auth import create_jwt

    token = create_jwt(
        {
            "sub": "test-user-123",
            "email": "test@nutrivision.ai",
            "name": "Test User",
            "role": "user",
            "exp": int(time.time()) + 3600,
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client(tmp_path: Path, state_path: Path) -> Generator[TestClient, None, None]:
    """A FastAPI TestClient with an isolated state.json and isolated caches."""
    # Re-init the singleton for each test — `STATE_PATH` is read by
    # `_state_path()` at lifespan time.
    os.environ["STATE_PATH"] = str(state_path)
    os.environ["SQLITE_CACHE_PATH"] = str(tmp_path / "test_cache.db")
    os.environ["CHROMA_CACHE_PATH"] = str(tmp_path / "test_chroma")
    os.environ["RAG_CHROMA_PATH"] = str(tmp_path / "test_rag_chroma")

    # Drop the cached singletons between tests so each one starts clean.
    import app.services.state as state_mod
    import app.api.nutrition as nutrition_mod
    import app.api.vision as vision_mod

    state_mod._state = None
    nutrition_mod._reset_clients_for_tests()
    vision_mod._reset_for_tests()

    from app.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c

    # Tear-down: drop singletons so the next test gets a fresh state.
    state_mod._state = None
    nutrition_mod._reset_clients_for_tests()
    vision_mod._reset_for_tests()
    vision_mod._reset_for_tests()


@pytest.fixture
def stub_off(monkeypatch: pytest.MonkeyPatch):
    """Replace the Open Food Facts client with a deterministic stub.

    The stub returns a fixed `NutritionFacts` for any query — enough
    to exercise the resolve cascade without network calls.
    """
    from app.models.schemas import NutritionFacts
    from app.api import nutrition as nutrition_mod

    def fake_lookup(name: str) -> NutritionFacts:
        return NutritionFacts(
            protein=10.0,
            carbs=20.0,
            fat=5.0,
            kcal=150.0,
            fiber=2.0,
            sodium=200.0,
            sugar=3.0,
            glycemic=0.5,
        )

    class _Stub:
        def lookup(self, name: str) -> NutritionFacts:
            return fake_lookup(name)

        def close(self) -> None:
            pass

    monkeypatch.setattr(nutrition_mod, "_get_off", lambda: _Stub())
    return _Stub