"""Nutrition cascade tests — verify OFF → USDA → Fruityvice ordering."""

from __future__ import annotations

from app.api.nutrition import resolve_with_cascade
from app.models.schemas import DetectedItem, NutritionFacts


def _item(name: str) -> DetectedItem:
    return DetectedItem(name=name, confidence=90, grams=100)


def _facts(kcal: float) -> NutritionFacts:
    return NutritionFacts(
        protein=10,
        carbs=20,
        fat=5,
        kcal=kcal,
        fiber=2,
        sodium=200,
        sugar=3,
        glycemic=0.5,
    )


def test_seeded_db_wins_over_live_callables() -> None:
    """An item in the seeded NUTRITION_DB resolves via `cache` even
    when the OFF callable would return facts — the seeded path is
    first because it's free and matches the frontend's MOCK_NUTRITION_DB."""
    sentinel = _facts(999)
    seen = {"off": False, "usda": False, "fv": False}

    def off(n):
        seen["off"] = True
        return sentinel

    def usda(n):
        seen["usda"] = True
        return sentinel

    def fv(n):
        seen["fv"] = True
        return sentinel

    out = resolve_with_cascade(
        _item("Chicken biryani"), off_facts=off, usda_facts=usda, fruityvice_facts=fv
    )
    assert out.source == "cache"
    assert out.partial is False
    assert seen == {"off": False, "usda": False, "fv": False}


def test_off_hit_skips_usda_and_fruityvice() -> None:
    """If OFF returns facts, USDA/Fruityvice must never be called."""
    seen = {"off": 1, "usda": 0, "fv": 0}
    sentinel = _facts(150)

    def off(n):
        assert n == "Mystery food"
        seen["off"] += 1
        return sentinel

    def usda(n):
        seen["usda"] += 1
        return None  # type: ignore[arg-type]

    def fv(n):
        seen["fv"] += 1
        return None  # type: ignore[arg-type]

    out = resolve_with_cascade(
        _item("Mystery food"), off_facts=off, usda_facts=usda, fruityvice_facts=fv
    )
    assert out.source == "open-food-facts"
    assert out.nutrition is not None
    assert out.partial is False
    assert seen["usda"] == 0 and seen["fv"] == 0


def test_off_miss_falls_through_to_usda() -> None:
    """OFF returns None → USDA is consulted → source becomes 'usda'."""
    sentinel = _facts(150)

    def off(n):
        return None  # type: ignore[arg-type]

    def usda(n):
        return sentinel

    def fv(n):
        return None  # type: ignore[arg-type]

    out = resolve_with_cascade(
        _item("USDA item"), off_facts=off, usda_facts=usda, fruityvice_facts=fv
    )
    assert out.source == "usda"
    assert out.partial is False


def test_usda_miss_falls_through_to_fruityvice() -> None:
    """OFF + USDA both miss → Fruityvice is consulted last."""
    sentinel = _facts(80)

    def off(n):
        return None  # type: ignore[arg-type]

    def usda(n):
        return None  # type: ignore[arg-type]

    def fv(n):
        return sentinel

    out = resolve_with_cascade(_item("Apple"), off_facts=off, usda_facts=usda, fruityvice_facts=fv)
    assert out.source == "fruityvice"
    assert out.partial is False


def test_all_miss_returns_partial_estimated() -> None:
    """Three misses → ResolvedItem(source='estimated', partial=True)."""

    def off(n):
        return None  # type: ignore[arg-type]

    def usda(n):
        return None  # type: ignore[arg-type]

    def fv(n):
        return None  # type: ignore[arg-type]

    out = resolve_with_cascade(
        _item("Unknown"), off_facts=off, usda_facts=usda, fruityvice_facts=fv
    )
    assert out.source == "estimated"
    assert out.partial is True
    assert out.nutrition is None


def test_exception_in_callback_swallowed() -> None:
    """An exception from one cascade step must not 500 the route —
    the next step is consulted."""

    def off(n):
        raise RuntimeError("off exploded")

    def usda(n):
        return _facts(150)

    def fv(n):
        return None  # type: ignore[arg-type]

    out = resolve_with_cascade(
        _item("Mystery food"), off_facts=off, usda_facts=usda, fruityvice_facts=fv
    )
    assert out.source == "usda"
    assert out.partial is False


def test_bangladeshi_food_composition_hit() -> None:
    """Authentic local dishes (Khichuri, Begun Bhorta, Ilish Macher Jhol) resolve via local BD composition."""
    out = resolve_with_cascade(
        _item("Khichuri"),
        off_facts=lambda n: None,
        usda_facts=lambda n: None,
        fruityvice_facts=lambda n: None,
    )
    assert out.source == "cache"
    assert out.nutrition is not None
    assert out.nutrition.kcal > 100.0
    assert out.partial is False
