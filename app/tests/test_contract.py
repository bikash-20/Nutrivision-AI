"""Contract tests — one happy-path round-trip per endpoint, plus the
seams and negative paths that catch schema drift early.

The point of these tests is the **wire format**, not CRUD permutation.
Each test asserts:
  1. The endpoint returns 2xx (or the expected 4xx on negative paths).
  2. The response body validates against the matching Pydantic model.
  3. Where a side-effect matters, the next request reflects it.

If anyone changes a field name in `app/models/schemas.py` without
updating `src/types/schemas.ts`, one of these will fail.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models.schemas import HealthGoals, UserProfile
from app.seed.fixtures import DEFAULT_PROFILE, TARGETS

# ── Cut (b): fixtures ────────────────────────────────────────────────────


class _FakeStage:
    """Universal stub for HF / Gemini / OFF / USDA / Fruityvice clients.

    Methods return what the caller hands via `set_return`. Keeps each
    test self-contained — no global monkeypatches leaking between tests.
    """

    def __init__(self) -> None:
        self._next_return = None
        self.calls: list[str] = []

    def is_configured(self) -> bool:
        return True

    def detect(self, image_ref: str):  # noqa: D401
        self.calls.append(image_ref)
        return self._next_return

    def classify(self, image_ref: str):
        self.calls.append(image_ref)
        return self._next_return

    def lookup(self, name: str):
        self.calls.append(name)
        return self._next_return

    def set_return(self, value) -> None:
        self._next_return = value

    def close(self) -> None:
        pass


@pytest.fixture
def vision_clients(monkeypatch: pytest.MonkeyPatch):
    """Wire Gemini + HF with controllable returns for contract tests."""
    import app.api.vision as vision_mod

    gemini = _FakeStage()
    hf = _FakeStage()
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: gemini)
    monkeypatch.setattr(vision_mod, "_get_hf", lambda: hf)
    return gemini, hf


# ── Vision ──────────────────────────────────────────────────────────────


def test_health_endpoint_returns_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_api_health_endpoint_storage_json(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["storage_backend"] == "json"
    assert data["db_connected"] is True


def test_database_url_loud_failure_returns_503(tmp_path, monkeypatch) -> None:
    import app.services.state as state_mod
    state_mod._state = None
    secret_pass = "super_secret_neon_password_123"
    fake_url = f"postgresql://neondb_owner:{secret_pass}@ep-fake-pooler-99999.us-east-2.aws.neon.tech/neondb"
    monkeypatch.setenv("DATABASE_URL", fake_url)
    monkeypatch.setenv("STATE_PATH", str(tmp_path / "fail_state.json"))

    from app.main import create_app
    from app.services.state import init_state
    st = init_state(tmp_path / "fail_state.json")
    assert st.storage_type == "postgres"
    assert not st.is_healthy
    assert secret_pass not in str(st.init_error)

    with TestClient(create_app()) as test_client:
        # /api/health should return 503 and not expose password
        resp = test_client.get("/api/health")
        assert resp.status_code == 503
        payload = resp.json()
        assert payload["storage_backend"] == "postgres"
        assert payload["db_connected"] is False
        assert secret_pass not in str(payload)
        assert "ep-fake-pooler-99999.us-east-2.aws.neon.tech" in str(payload.get("host", ""))
    state_mod._state = None


# ── Nutrition ───────────────────────────────────────────────────────────


def test_nutrition_targets_match_seed(client: TestClient) -> None:
    """The targets endpoint must serve the same numbers as the
    frontend's `MOCK_TARGETS` so the NutrientsScreen math is identical."""
    resp = client.get("/api/nutrition/targets")
    assert resp.status_code == 200
    assert resp.json() == TARGETS.model_dump()


def test_nutrition_resolve_seeded_items_use_cache(client: TestClient) -> None:
    """Items in the seeded DB resolve via `cache` source with full nutrition."""
    resp = client.post(
        "/api/nutrition/resolve",
        json={"items": [{"name": "Chicken biryani", "confidence": 92, "grams": 310}]},
    )
    assert resp.status_code == 200
    item = resp.json()["resolved"][0]
    assert item["source"] == "cache"
    assert item["partial"] is False
    assert item["nutrition"]["kcal"] == 165


def test_nutrition_resolve_unknown_item_uses_off(client: TestClient, stub_off) -> None:
    """Unknown item → resolved via OFF stub, not partial."""
    resp = client.post(
        "/api/nutrition/resolve",
        json={"items": [{"name": "Mystery food", "confidence": 80, "grams": 100}]},
    )
    assert resp.status_code == 200
    item = resp.json()["resolved"][0]
    assert item["source"] == "open-food-facts"
    assert item["partial"] is False


def test_nutrition_resolve_emits_contributions(client: TestClient, stub_off) -> None:
    """One dominant high-sodium item + non-diabetic profile → at least one
    flagged sodium contribution that names the dominant item.

    Mirrors `src/lib/api.ts#flagRules` — exercises the personalize layer
    (which is real logic, not just a CRUD seam)."""
    # 1000g of "Heavy salt" (200mg/100g) + 4× 50g "Light salt" (200mg/100g).
    # Total = 2400mg, well over the 1200mg cap. Heavy item owns ~83%.
    items = [{"name": "Heavy salt", "confidence": 90, "grams": 1000}] + [
        {"name": f"Light salt {i}", "confidence": 90, "grams": 50} for i in range(4)
    ]
    profile = DEFAULT_PROFILE.model_copy(
        update={"goals": HealthGoals(diabetic=False, protein=False, budget=True, mediter=False)}
    )
    resp = client.post(
        "/api/nutrition/resolve",
        json={"items": items, "profile": profile.model_dump(mode="json", by_alias=True)},
    )
    assert resp.status_code == 200
    sodium_flagged = [
        c for c in resp.json()["contributions"]
        if c["nutrient"] == "sodium" and c["flagged"] is True
    ]
    assert sodium_flagged
    assert any(c["item_name"] == "Heavy salt" for c in sodium_flagged)


# ── Profile ─────────────────────────────────────────────────────────────


def test_unauthenticated_requests_return_401(client: TestClient) -> None:
    """Security contract: unauthenticated requests to protected endpoints return 401."""
    assert client.get("/api/profile").status_code == 401
    assert client.get("/api/grocery", params={"budget": 500}).status_code == 401
    assert client.get("/api/meals").status_code == 401
    assert client.get("/api/meals/today").status_code == 401
    assert client.get("/api/meals/stats").status_code == 401


def test_profile_round_trip(client: TestClient, auth_headers: dict[str, str]) -> None:
    """GET → clean profile, PUT → replacement, GET reflects the PUT."""
    initial = client.get("/api/profile", headers=auth_headers).json()
    assert "name" in initial

    updated = UserProfile.model_validate(initial).model_copy(update={"name": "Updated"})
    put = client.put("/api/profile", json=updated.model_dump(mode="json", by_alias=True), headers=auth_headers)
    assert put.status_code == 200
    assert put.json()["name"] == "Updated"

    again = client.get("/api/profile", headers=auth_headers).json()
    assert again["name"] == "Updated"


# ── Grocery ─────────────────────────────────────────────────────────────


def test_grocery_list_seeded_in_seed_order(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Adding an item and fetching grocery returns 200 with matching budget."""
    add = client.post(
        "/api/grocery/items",
        json={"name": "Apples", "price": 120.0, "category": "Produce"},
        headers=auth_headers,
    )
    assert add.status_code == 201

    resp = client.get("/api/grocery", params={"budget": 500}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["budget"] == 500


def test_grocery_remove_unknown_returns_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Negative path: missing grocery id → 404, not 500."""
    assert client.delete("/api/grocery/items/g-does-not-exist", headers=auth_headers).status_code == 404


def test_grocery_batch_add(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Batch add inserts multiple items atomically in a single request."""
    resp = client.post(
        "/api/grocery/batch",
        json=[
            {"name": "Boiled Egg", "price": 15.0, "category": "Dairy & eggs"},
            {"name": "Tomato", "price": 40.0, "category": "Produce"},
        ],
        headers=auth_headers,
    )
    assert resp.status_code == 201
    items = resp.json()
    assert len(items) == 2
    assert items[0]["name"] == "Boiled Egg"
    assert items[1]["name"] == "Tomato"


# ── Meals ───────────────────────────────────────────────────────────────


def test_meal_save_and_list_round_trip(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Save a meal → list includes it with server-assigned id + date."""
    save = client.post(
        "/api/meals",
        json={
            "label": "Test meal",
            "items": [{"name": "Chicken biryani", "confidence": 92, "grams": 310}],
            "totals": {
                "kcal": 511.5, "protein": 18.6, "carbs": 68.2,
                "fat": 13.95, "fiber": 1.86, "sodium": 1178.0, "sugar": 2.79,
            },
            "photo_url": None,
            "active_goals": {"diabetic": True, "protein": False, "budget": True, "mediter": False},
        },
        headers=auth_headers,
    )
    assert save.status_code == 201
    saved = save.json()
    assert saved["id"] and saved["date"] and saved["label"] == "Test meal"

    meals = client.get("/api/meals", headers=auth_headers).json()
    assert any(m["id"] == saved["id"] for m in meals)


def test_meal_today_summary_reflects_saved_meals(client: TestClient, auth_headers: dict[str, str]) -> None:
    """A meal saved now appears in today's summary with the right total."""
    client.post(
        "/api/meals",
        json={
            "label": "Lunch",
            "items": [{"name": "Chicken biryani", "confidence": 90, "grams": 300}],
            "totals": {
                "kcal": 500.0, "protein": 18.0, "carbs": 66.0,
                "fat": 14.0, "fiber": 2.0, "sodium": 1100.0, "sugar": 3.0,
            },
            "photo_url": None,
            "active_goals": {"diabetic": True, "protein": False, "budget": True, "mediter": False},
        },
        headers=auth_headers,
    )
    today = client.get("/api/meals/today", headers=auth_headers).json()
    assert today["meals_logged"] == 1
    assert today["total_kcal"] == 500.0


def test_meal_stats_aggregate(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Two meals → stats reflect count + active day count."""
    payload = {
        "items": [{"name": "X", "confidence": 90, "grams": 100}],
        "totals": {
            "kcal": 100.0, "protein": 10.0, "carbs": 10.0,
            "fat": 5.0, "fiber": 1.0, "sodium": 100.0, "sugar": 1.0,
        },
        "photo_url": None,
        "active_goals": {"diabetic": False, "protein": False, "budget": False, "mediter": False},
    }
    for label in ("M0", "M1"):
        client.post("/api/meals", json={"label": label, **payload}, headers=auth_headers)
    stats = client.get("/api/meals/stats", headers=auth_headers).json()
    assert stats["total_meals"] == 2
    assert stats["total_days_active"] == 1


def test_meal_delete_unknown_returns_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    """Negative path: missing meal id → 404, not 500."""
    assert client.delete("/api/meals/meal-does-not-exist", headers=auth_headers).status_code == 404


# ── Cut (b): real vision pipeline with mocked Gemini/HF clients ────────


def test_vision_pipeline_uses_gemini_when_configured(
    client: TestClient, vision_clients
) -> None:
    """With Gemini + HF stubbed and Gemini returning one item, the
    pipeline trace shows vision-id/hf-validate/reconcile as `done`
    (because the fake stub reports `is_configured() == True`)."""
    from app.models.schemas import DetectedItem

    gemini, hf = vision_clients
    gemini.set_return([DetectedItem(name="Dal", confidence=88, grams=200)])
    hf.set_return([])  # HF configured but no labels

    # Unique image_ref so the persistent vector cache doesn't shadow
    # this test with a cache-hit.
    resp = client.post("/api/vision/analyze", json={"image_ref": "fresh-gemini-001.jpg"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["detected"][0]["name"] == "Dal"
    trace = {t["stage"]: t["status"] for t in body["pipeline"]}
    assert trace["vision-id"] == "done"
    assert trace["hf-validate"] == "fallback"  # HF returned []
    assert trace["reconcile"] == "fallback"


def test_vision_cache_does_not_persist_uploaded_image_data_url(
    client: TestClient,
    vision_clients,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Uploaded image bytes are represented by a digest in persistent caches."""
    import hashlib

    import app.api.vision as vision_mod
    from app.models.schemas import DetectedItem

    image_ref = "data:image/jpeg;base64,c2Vuc2l0aXZlLWltYWdl"
    expected_key = hashlib.sha256(f"live-vision-v1:{image_ref}".encode()).hexdigest()
    vector_keys: list[str] = []
    sqlite_keys: list[tuple[str, str]] = []

    class _VectorCache:
        def has(self, key: str) -> bool:
            vector_keys.append(key)
            return False

        def put(self, key: str, _detected: list[DetectedItem]) -> None:
            vector_keys.append(key)

    class _SQLiteCache:
        def put(
            self,
            key: tuple[str, str],
            _value: list[dict[str, object]],
            *,
            ttl_s: int,
        ) -> None:
            sqlite_keys.append(key)

    gemini, hf = vision_clients
    gemini.set_return([DetectedItem(name="Khichuri", confidence=94, grams=250)])
    hf.set_return([])
    monkeypatch.setattr(vision_mod, "_get_vector_cache", lambda: _VectorCache())
    monkeypatch.setattr(vision_mod, "_get_sqlite_cache", lambda: _SQLiteCache())

    response = client.post("/api/vision/analyze", json={"image_ref": image_ref})

    assert response.status_code == 200
    assert vector_keys == [expected_key, expected_key]
    assert sqlite_keys == [("vision", expected_key)]
    assert image_ref not in vector_keys
    assert all(image_ref not in key for _, key in sqlite_keys)


def test_vision_pipeline_rejects_requests_when_no_provider_is_configured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without a real provider, the API must not return sample detections."""

    class _NotConfigured:
        def is_configured(self) -> bool:
            return False

        def detect(self, *a, **k):
            return []

        def classify(self, *a, **k):
            return []

        def close(self):
            pass

    import app.api.vision as vision_mod
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: _NotConfigured())
    monkeypatch.setattr(vision_mod, "_get_groq", lambda: _NotConfigured())
    monkeypatch.setattr(vision_mod, "_get_openrouter", lambda: _NotConfigured())
    monkeypatch.setattr(vision_mod, "_get_hf", lambda: _NotConfigured())

    resp = client.post(
        "/api/vision/analyze", json={"image_ref": "chicken_biryani.jpg"}
    )
    assert resp.status_code == 503
    assert "No vision provider is configured" in resp.json()["detail"]


# ── Cut (b): nutrition cascade end-to-end ──────────────────────────────


def test_nutrition_cascade_falls_through_off_to_usda(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OFF misses → USDA hits → ResolvedItem.source == 'usda'."""
    import app.api.nutrition as nutrition_mod
    from app.models.schemas import NutritionFacts

    class _Off:
        def lookup(self, name: str):
            return None  # miss

        def close(self):
            pass

    usda_facts = NutritionFacts(
        protein=10, carbs=20, fat=5, kcal=150,
        fiber=2, sodium=200, sugar=3, glycemic=0.5,
    )

    class _Usda:
        def lookup(self, name: str):
            return usda_facts

        def close(self):
            pass

    monkeypatch.setattr(nutrition_mod, "_get_off", lambda: _Off())
    monkeypatch.setattr(nutrition_mod, "_get_usda", lambda: _Usda())

    resp = client.post(
        "/api/nutrition/resolve",
        json={"items": [{"name": "Mystery food", "confidence": 80, "grams": 100}]},
    )
    assert resp.status_code == 200
    item = resp.json()["resolved"][0]
    assert item["source"] == "usda"
    assert item["partial"] is False
    assert item["nutrition"]["kcal"] == 150


def test_nutrition_cascade_all_miss_returns_estimated(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OFF + USDA + Fruityvice all miss → ResolvedItem.source == 'estimated'."""
    import app.api.nutrition as nutrition_mod

    class _Miss:
        def lookup(self, name: str):
            return None

        def close(self):
            pass

    monkeypatch.setattr(nutrition_mod, "_get_off", lambda: _Miss())
    monkeypatch.setattr(nutrition_mod, "_get_usda", lambda: _Miss())
    monkeypatch.setattr(nutrition_mod, "_get_fruityvice", lambda: _Miss())

    resp = client.post(
        "/api/nutrition/resolve",
        json={"items": [{"name": "Unknown", "confidence": 80, "grams": 100}]},
    )
    assert resp.status_code == 200
    item = resp.json()["resolved"][0]
    assert item["source"] == "estimated"
    assert item["partial"] is True