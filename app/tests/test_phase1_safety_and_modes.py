"""Tests for Phase 1: Non-Food Safety Gate, 3-Way Vision Mode, and Pre-Cache Guard."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.api.vision as vision_mod
from app.main import app
from app.models.schemas import (
    DetectedItem,
    MenuItemAnalysis,
    RecipeSuggestion,
    VisionDetectionResult,
)


class _MockVisionWithResult:
    def __init__(self, result: VisionDetectionResult) -> None:
        self.result = result
        self.call_count = 0

    def is_configured(self) -> bool:
        return True

    def detect_vision(self, image_ref: str) -> VisionDetectionResult:
        self.call_count += 1
        return self.result

    def detect(self, image_ref: str) -> list[DetectedItem]:
        self.call_count += 1
        return self.result.detected

    def close(self) -> None:
        pass


@pytest.fixture
def test_client(tmp_path: Path):
    import os
    os.environ["SQLITE_CACHE_PATH"] = str(tmp_path / "test_p1_cache.db")
    os.environ["CHROMA_CACHE_PATH"] = str(tmp_path / "test_p1_chroma")
    vision_mod._reset_for_tests()
    with TestClient(app) as c:
        yield c
    vision_mod._reset_for_tests()


def test_non_food_safety_gate_rejects_and_bypasses_cache(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Non-food items (shoes/car/electronics) must be rejected with is_food=False and never cached."""
    cache_writes = []

    class _MockCache:
        def has(self, key):
            return False

        def get(self, key):
            return None

        def put(self, *args, **kwargs):
            cache_writes.append(args)

    monkeypatch.setattr(vision_mod, "_get_vector_cache", lambda: _MockCache())
    monkeypatch.setattr(vision_mod, "_get_sqlite_cache", lambda: _MockCache())

    rejection_result = VisionDetectionResult(
        is_food=False,
        input_mode="cooked_meal",
        overall_confidence=0.98,
        rejection_reason_en="Photo appears to be a pair of running shoes, not food.",
        rejection_reason_bn="ছবিতে জুতো দেখা যাচ্ছে, এটি কোনো খাবার নয়।",
        detected=[],
    )
    provider = _MockVisionWithResult(rejection_result)
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: provider)

    resp = test_client.post("/api/vision/analyze", json={"image_ref": "non-food-shoes.jpg"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["is_food"] is False
    assert len(data["detected"]) == 0
    assert "running shoes" in data["rejection_reason_en"]
    assert "জুতো" in data["rejection_reason_bn"]
    assert len(cache_writes) == 0  # CRITICAL: Pre-cache filter bypassed caching!


def test_low_confidence_safety_gate_rejects(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Confidence below 0.45 must trigger the safety gate and reject."""
    low_conf_result = VisionDetectionResult(
        is_food=True,
        input_mode="cooked_meal",
        overall_confidence=0.35,  # < 0.45
        rejection_reason_en="Blurry image; cannot reliably identify food.",
        rejection_reason_bn="ছবিটি অস্পষ্ট; খাবার নিশ্চিতভাবে শনাক্ত করা সম্ভব নয়।",
        detected=[DetectedItem(name="Unknown mush", confidence=35, grams=100)],
    )
    provider = _MockVisionWithResult(low_conf_result)
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: provider)

    resp = test_client.post("/api/vision/analyze", json={"image_ref": "blurry-photo.jpg"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["is_food"] is False
    assert len(data["detected"]) == 0
    assert "Blurry" in data["rejection_reason_en"]


def test_raw_ingredients_mode_returns_recipes_and_missing_items(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Raw ingredients mode returns detected items plus 2 recipe suggestions with missing items."""
    raw_result = VisionDetectionResult(
        is_food=True,
        input_mode="raw_ingredients",
        overall_confidence=0.92,
        detected=[
            DetectedItem(name="Raw Chicken Breast", name_bn="কাঁচা মুরগির মাংস", confidence=95, grams=400),
            DetectedItem(name="Potatoes", name_bn="আলু", confidence=90, grams=200),
        ],
        recipe_suggestions=[
            RecipeSuggestion(
                title_en="Bengali Chicken Curry (Murgir Jhol)",
                title_bn="মুরগির পাতলা ঝোল",
                description_en="Light, comforting cumin and ginger spiced chicken stew with potatoes.",
                description_bn="আলু দিয়ে জিরে ও আদার হালকা মশলায় তৈরি উপাদেয় ঝোল।",
                matched_ingredients=["Raw Chicken Breast", "Potatoes"],
                missing_ingredients=["Mustard Oil", "Ginger Garlic Paste", "Cumin Powder"],
            ),
            RecipeSuggestion(
                title_en="Chicken Bhorta",
                title_bn="চিকেন ভর্তা",
                description_en="Shredded spiced chicken mash with mustard oil and fried onions.",
                description_bn="সরিষার তেল ও পেঁয়াজ বেরেস্তা দিয়ে মাখানো মুরগির ভর্তা।",
                matched_ingredients=["Raw Chicken Breast"],
                missing_ingredients=["Mustard Oil", "Green Chili", "Onions"],
            ),
        ],
    )
    provider = _MockVisionWithResult(raw_result)
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: provider)

    resp = test_client.post("/api/vision/analyze", json={"image_ref": "fresh-chicken-potatoes.jpg"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["is_food"] is True
    assert data["input_mode"] == "raw_ingredients"
    assert len(data["detected"]) == 2
    assert len(data["recipe_suggestions"]) == 2
    assert data["recipe_suggestions"][0]["title_en"] == "Bengali Chicken Curry (Murgir Jhol)"
    assert data["recipe_suggestions"][0]["missing_ingredients"] == [
        "Mustard Oil",
        "Ginger Garlic Paste",
        "Cumin Powder",
    ]


def test_restaurant_menu_mode_returns_health_analysis(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Restaurant menu mode extracts menu items with healthy picks and ultra-processed flags."""
    menu_result = VisionDetectionResult(
        is_food=True,
        input_mode="restaurant_menu",
        overall_confidence=0.94,
        detected=[],
        menu_analysis=[
            MenuItemAnalysis(
                dish_name_en="Grilled Salmon with Steamed Asparagus",
                dish_name_bn="গ্রিল্ড স্যামন ও অ্যাসপ্যারাগাস",
                is_healthy_pick=True,
                is_ultra_processed=False,
                notes_en="Low sodium, high omega-3 fatty acids, excellent for prediabetes and heart health.",
                notes_bn="কম সোডিয়াম এবং ওমেগা-৩ ফ্যাটি এসিড সমৃদ্ধ, হার্ট ও ডায়াবেটিসের জন্য উত্তম।",
            ),
            MenuItemAnalysis(
                dish_name_en="Deep Fried Crispy Chicken Wings with Sweet Glaze",
                dish_name_bn="ডিপ ফ্রাইড ক্রিস্পি চিকেন উইংস",
                is_healthy_pick=False,
                is_ultra_processed=True,
                notes_en="Deep-fried in trans fat with high added sugar glaze (28g sugar).",
                notes_bn="ডিপ ফ্রাইড ও অতিরিক্ত চিনিযুক্ত সস (২৮ গ্রাম চিনি)।",
            ),
        ],
    )
    provider = _MockVisionWithResult(menu_result)
    monkeypatch.setattr(vision_mod, "_get_gemini", lambda: provider)

    resp = test_client.post("/api/vision/analyze", json={"image_ref": "restaurant-menu-board.jpg"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["is_food"] is True
    assert data["input_mode"] == "restaurant_menu"
    assert len(data["menu_analysis"]) == 2
    assert data["menu_analysis"][0]["is_healthy_pick"] is True
    assert data["menu_analysis"][1]["is_ultra_processed"] is True
