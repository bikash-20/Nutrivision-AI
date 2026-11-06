"""Portion estimator tests — verify the density-table lookup logic."""

from __future__ import annotations

from app.models.schemas import DetectedItem
from app.services.portion import MIN_GRAMS, estimate


def _item(name: str, grams: float, bbox=None) -> DetectedItem:
    return DetectedItem(name=name, confidence=90, grams=grams, bbox=bbox)


def test_no_bbox_returns_unchanged() -> None:
    """Without a bbox we have no signal — return the item as-is."""
    item = _item("Chicken biryani", 310)
    out = estimate(item)
    assert out.grams == 310
    assert out.name == "Chicken biryani"


def test_bbox_with_matching_hint_scales_grams() -> None:
    """An item whose name contains 'biryani' picks the biryani row
    (g_per_ml=0.80) — but `portion.estimate` clamps to [0.7, 1.3],
    so a biryani (0.80) scales by 0.95 ≈ 1.0-ish."""
    item = _item("Chicken biryani", 300, bbox=(0, 0, 0.5, 0.5))
    out = estimate(item)
    # Clamp rule: factor is min(1.3, max(0.7, 0.80)) = 0.80 → 240g.
    assert out.grams == round(300 * 0.80)


def test_min_grams_floor_applied() -> None:
    """A very small seed × tiny factor must not collapse below MIN_GRAMS."""
    item = _item("Salad leaves", 5, bbox=(0, 0, 0.5, 0.5))
    out = estimate(item)
    assert out.grams >= MIN_GRAMS


def test_unknown_category_returns_unchanged_factor() -> None:
    """An item with no hint-match falls back to factor=1.0x (no change
    at the clamped range)."""
    item = _item("Totally novel dish", 100, bbox=(0, 0, 0.5, 0.5))
    out = estimate(item)
    assert out.grams == 100  # 100 * 1.0 = 100


def test_factor_clamp_upper_bound() -> None:
    """Even a high-density category can't double the canned grams."""
    # The chicken row is g_per_ml=1.05; clamp(0.7, 1.3) keeps it at 1.05.
    item = _item("Chicken breast", 200, bbox=(0, 0, 0.5, 0.5))
    out = estimate(item)
    assert out.grams <= round(200 * 1.3)


def test_factor_clamp_lower_bound() -> None:
    """Even a low-density category must not halve the canned grams."""
    # salad row is g_per_ml=0.25; clamp(0.7, 1.3) keeps it at 0.7.
    item = _item("Mixed salad", 200, bbox=(0, 0, 0.5, 0.5))
    out = estimate(item)
    assert out.grams >= round(200 * 0.7)
