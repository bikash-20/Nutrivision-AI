"""Dietary Pivot & Nutrient-Delta Engine (Backend).

Calculates clinically relevant dietary pivots and nutrient deltas
grounded in authentic Bangladeshi food culture and local market prices.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.models.schemas import DetectedItem, UserProfile


def _load_market_prices() -> dict[str, dict[str, Any]]:
    path = Path(__file__).resolve().parents[1] / "data" / "bd_market_prices.json"
    if not path.is_file():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    lookup: dict[str, dict[str, Any]] = {}
    for item in data:
        lookup[item["name"].lower().strip()] = item
        for a in item.get("aliases", []):
            lookup[a.lower().strip()] = item
    return lookup


_MARKET_LOOKUP = _load_market_prices()


def resolve_market_price(name: str, quantity_g: float = 1000.0) -> dict[str, Any]:
    clean = name.lower().strip()
    item = _MARKET_LOOKUP.get(clean)
    if not item:
        for k, v in _MARKET_LOOKUP.items():
            if k in clean or clean in k:
                item = v
                break
    if not item:
        return {
            "name": name,
            "unit_price_bdt": 120.0,
            "estimated_cost_bdt": max(20.0, round((quantity_g / 1000.0) * 120.0)),
            "unit": "kg",
        }
    pack_g = float(item.get("default_pack_g", 1000.0))
    cost = max(5.0, round(item["price_bdt"] * (quantity_g / pack_g)))
    return {
        "name": item["name"],
        "name_bn": item["name_bn"],
        "unit_price_bdt": item["price_bdt"],
        "estimated_cost_bdt": cost,
        "unit": item["unit"],
    }


def evaluate_dietary_pivots(
    detected: list[DetectedItem], profile: UserProfile | None = None
) -> list[dict[str, Any]]:
    """Generate structured meal pivots with nutrient deltas and market costs."""
    if not detected:
        return []

    pivots: list[dict[str, Any]] = []

    if profile:
        bool(
            profile.goals.diabetic
            or "diabetes_t2" in profile.medical_conditions
            or "prediabetes" in profile.medical_conditions
        )

    # 1. White rice glycemic reduction pivot
    for it in detected:
        lower = it.name.lower()
        if ("rice" in lower or "ভাত" in lower) and "brown" not in lower and it.grams >= 180:
            orig_cost = resolve_market_price("White rice (Miniket)", it.grams)["estimated_cost_bdt"]
            brown_rice_cost = resolve_market_price("Brown rice (Lal chal)", it.grams * 0.45)["estimated_cost_bdt"]
            sabzi_cost = resolve_market_price("Palong shak (Spinach)", 120)["estimated_cost_bdt"]
            new_cost = brown_rice_cost + sabzi_cost

            # 250g white rice: ~325 kcal, 70g carbs, 1g fiber
            # 110g brown rice + 120g sabzi: ~205 kcal, 38g carbs, 5.5g fiber
            pivots.append(
                {
                    "id": "pivot-rice-glycemic-optimization",
                    "title_en": "Low-GI Brown Rice & Sabzi Pivot",
                    "title_bn": "কম গ্লাইসেমিক লাল চাল ও সবজির সমন্বয়",
                    "trigger_item": it.name,
                    "delta": {
                        "kcal": -120,
                        "carbs_g": -32.0,
                        "fiber_g": +4.5,
                        "cost_bdt": round(new_cost - orig_cost),
                    },
                    "glycemic_reduction_pct": 46,
                    "grocery_items_to_add": [
                        {"name": "Brown rice (Lal chal)", "name_bn": "লাল চাল", "price_bdt": 90.0},
                        {"name": "Palong shak (Spinach)", "name_bn": "পালং শাক", "price_bdt": 25.0},
                    ],
                    "is_live_price": False,
                    "price_source": "TCB/DAM Benchmark",
                }
            )
            break

    return pivots

