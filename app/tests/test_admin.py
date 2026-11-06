"""Unit tests for Admin Telemetry & Metrics API."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.api.auth import create_jwt
from app.main import create_app
from app.models.schemas import DetectedItem, HealthGoals, MealTotals
from app.services.state import get_state, init_state


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_PATH", str(tmp_path / "test_admin_state.json"))
    monkeypatch.setenv("ADMIN_EMAILS", "superadmin@domain.com")
    monkeypatch.setenv("JWT_SECRET", "admin-test-signing-secret-for-nutrivision")
    init_state(tmp_path / "test_admin_state.json")
    app = create_app()
    return TestClient(app)


def _admin_headers() -> dict[str, str]:
    jwt = create_jwt(
        {"sub": "adm-1", "email": "superadmin@domain.com", "role": "admin", "exp": int(time.time()) + 3600},
        secret=b"admin-test-signing-secret-for-nutrivision",
    )
    return {"Authorization": f"Bearer {jwt}"}


def test_admin_metrics_endpoint_unauthenticated_returns_401(client):
    res = client.get("/api/admin/metrics")
    assert res.status_code == 401


def test_admin_metrics_forbidden_for_regular_user(client):
    user_jwt = create_jwt(
        {"sub": "regular-1", "email": "regular@domain.com", "role": "user", "exp": int(time.time()) + 3600},
        secret=b"admin-test-signing-secret-for-nutrivision",
    )
    res = client.get("/api/admin/metrics", headers={"Authorization": f"Bearer {user_jwt}"})
    assert res.status_code == 403


def test_admin_metrics_allowed_for_admin_user(client):
    headers = _admin_headers()
    res = client.get("/api/admin/metrics", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["users"], list)
    assert "dailyMealVolume" in data
    assert "flaggedMealsCount" in data


def test_admin_users_and_detail(client):
    headers = _admin_headers()
    state = get_state()
    # Add a user with a meal
    state.get_or_create_user(email="athlete@domain.com", name="Athlete User", role="user")
    state.add_user_meal(
        email="athlete@domain.com",
        label="Grilled Salmon Salad",
        items=[
            DetectedItem(name="Salmon", confidence=95.0, grams=150),
            DetectedItem(name="Spinach Salad", confidence=62.0, grams=100),
        ],
        totals=MealTotals(kcal=450, protein=38, carbs=8, fat=20, fiber=4, sodium=320, sugar=2),
        photo_url=None,
        active_goals=HealthGoals(diabetic=False, protein=True, budget=False, mediter=True),
    )

    res = client.get("/api/admin/users", headers=headers)
    assert res.status_code == 200
    users = res.json()
    assert len(users) >= 1
    found = next((u for u in users if u["email"] == "athlete@domain.com"), None)
    assert found is not None
    assert found["name"] == "Athlete User"
    assert found["mealsCount"] == 1

    # Detail
    res_detail = client.get("/api/admin/users/athlete@domain.com", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["user"]["email"] == "athlete@domain.com"
    assert len(detail["recentMeals"]) == 1
    assert detail["recentMeals"][0]["label"] == "Grilled Salmon Salad"


def test_admin_popular_foods(client):
    headers = _admin_headers()
    res = client.get("/api/admin/popular-foods?range=all", headers=headers)
    assert res.status_code == 200
    foods = res.json()
    assert isinstance(foods, list)
    if foods:
        assert "name" in foods[0]
        assert "sharePercentage" in foods[0]
        assert "avgConfidence" in foods[0]


def test_admin_review_queue_and_actions(client):
    headers = _admin_headers()
    res = client.get("/api/admin/review-queue?status=all", headers=headers)
    assert res.status_code == 200
    queue = res.json()
    assert isinstance(queue, list)
    assert len(queue) >= 1
    flagged_meal = queue[0]
    meal_id = flagged_meal["mealId"]
    assert flagged_meal["lowestConfidence"] < 70.0

    # Correct action
    patch_res = client.patch(
        f"/api/admin/review-queue/{meal_id}",
        json={"action": "correct", "correctedLabel": "Corrected Healthy Salad"},
        headers=headers,
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["reviewStatus"] == "corrected"
    assert updated["label"] == "Corrected Healthy Salad"
