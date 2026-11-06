"""Nutrition resolver + macro targets endpoint.

Mirrors `src/lib/api.ts#resolveNutrition` and
`src/lib/api.ts#getMacroTargets`.

Cascade (cut b):
    1. seeded `NUTRITION_DB` (matches frontend `MOCK_NUTRITION_DB`)
    2. Open Food Facts (already wired in cut a) via `OFFClient`
    3. USDA FoodData Central via `USDAClient` (DEMO_KEY default)
    4. Fruityvice via `FruityviceClient` (no key, fruit-only)
    5. → `ResolvedItem(nutrition=None, source='estimated', partial=True)`
       on miss

The cascade is exposed via `resolve_with_cascade()` — a pure function
that takes name → facts callables for OFF / USDA / Fruityvice so tests
can stub each layer without monkeypatching the live clients.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import get_current_user_optional
from app.api.personalize import compute_contributions
from app.models.schemas import (
    AuthSession,
    DetectedItem,
    FoodDescriptor,
    MacroTargets,
    NutritionFacts,
    ResolvedItem,
    ResolveNutritionResult,
    UserProfile,
)
from app.seed.fixtures import NUTRITION_DB
from app.seed.fixtures import TARGETS as DEFAULT_TARGETS
from app.services import fruityvice_client as fruityvice_client_mod
from app.services import off_client as off_client_mod
from app.services import usda_client as usda_client_mod
from app.services.fruityvice_client import FruityviceClient
from app.services.off_client import OFFClient
from app.services.state import State, get_state
from app.services.targets import calculate_targets
from app.services.usda_client import USDAClient

_BD_FOODS_PATH = Path(__file__).resolve().parents[1] / "data" / "bd_food_composition.json"
_ALIASES_PATH = Path(__file__).resolve().parents[1] / "data" / "food_aliases.json"
_BD_FOODS_CACHE: dict[str, Any] | None = None
_ALIASES_CACHE: list[dict[str, Any]] | None = None


def _get_bd_foods() -> dict[str, Any]:
    global _BD_FOODS_CACHE
    if _BD_FOODS_CACHE is None:
        if _BD_FOODS_PATH.is_file():
            try:
                _BD_FOODS_CACHE = json.loads(_BD_FOODS_PATH.read_text(encoding="utf-8"))
            except Exception:
                _BD_FOODS_CACHE = {}
        else:
            _BD_FOODS_CACHE = {}
    return _BD_FOODS_CACHE


def _get_aliases() -> list[dict[str, Any]]:
    global _ALIASES_CACHE
    if _ALIASES_CACHE is None:
        if _ALIASES_PATH.is_file():
            try:
                _ALIASES_CACHE = json.loads(_ALIASES_PATH.read_text(encoding="utf-8"))
            except Exception:
                _ALIASES_CACHE = []
        else:
            _ALIASES_CACHE = []
    return _ALIASES_CACHE


def _lookup_bd_food(name: str, name_bn: str | None = None) -> FoodDescriptor | None:
    db = _get_bd_foods()
    if not db:
        return None
    name_l = name.lower().strip()
    bn_l = (name_bn or "").strip()

    for k, item in db.items():
        if k in name_l or name_l in k:
            return FoodDescriptor(**item)
        if bn_l and (bn_l in item.get("name_bn", "") or item.get("name_bn", "") in bn_l):
            return FoodDescriptor(**item)
    return None


def _lookup_alias_food(name: str, name_bn: str | None = None) -> FoodDescriptor | None:
    aliases = _get_aliases()
    if not aliases:
        return None
    name_l = name.lower().strip()
    bn_l = (name_bn or "").strip()

    for item in aliases:
        en = item.get("name_en", "").lower()
        bn = item.get("name_bn", "")
        item_aliases = [a.lower() for a in item.get("aliases", [])]

        if name_l == en or name_l in item_aliases:
            cat = item.get("category", "other")
            if cat in ("dairy", "beverages"):
                cat = "other"
            return FoodDescriptor(
                protein=item.get("proteinPer100g", 0.0),
                carbs=item.get("carbsPer100g", 0.0),
                fat=item.get("fatPer100g", 0.0),
                kcal=item.get("kcalPer100g", 0.0),
                fiber=item.get("fiberPer100g", 0.0),
                sodium=item.get("sodiumMgPer100g", 0.0),
                sugar=item.get("sugarPer100g", 0.0),
                glycemic=item.get("glycemicIndex", 0.0),
                emoji=item.get("emoji", "🍽"),
                category=cat,
                alternatives=item.get("alternatives", ["Healthy Alternative"]),
                pairings=item.get("pairings", []),
            )
        if bn_l and (bn_l == bn or bn in bn_l):
            cat = item.get("category", "other")
            if cat in ("dairy", "beverages"):
                cat = "other"
            return FoodDescriptor(
                protein=item.get("proteinPer100g", 0.0),
                carbs=item.get("carbsPer100g", 0.0),
                fat=item.get("fatPer100g", 0.0),
                kcal=item.get("kcalPer100g", 0.0),
                fiber=item.get("fiberPer100g", 0.0),
                sodium=item.get("sodiumMgPer100g", 0.0),
                sugar=item.get("sugarPer100g", 0.0),
                glycemic=item.get("glycemicIndex", 0.0),
                emoji=item.get("emoji", "🍽"),
                category=cat,
                alternatives=item.get("alternatives", ["Healthy Alternative"]),
                pairings=item.get("pairings", []),
            )
    return None


router = APIRouter(prefix="/api/nutrition", tags=["nutrition"])


# Process-wide clients. Lazy-instantiated so tests that never hit
# nutrition can avoid pulling httpx at import time.
_off: OFFClient | None = None
_usda: USDAClient | None = None
_fruityvice: FruityviceClient | None = None


def _get_off() -> OFFClient:
    global _off
    if _off is None:
        _off = OFFClient()
    return _off


def _get_usda() -> USDAClient:
    global _usda
    if _usda is None:
        _usda = USDAClient()
    return _usda


def _get_fruityvice() -> FruityviceClient:
    global _fruityvice
    if _fruityvice is None:
        _fruityvice = FruityviceClient()
    return _fruityvice


def _reset_clients_for_tests() -> None:
    """Drop the cached clients so the next call recreates them with
    whatever env vars are in scope. Test-only — do not call from prod."""
    global _off, _usda, _fruityvice
    if _off is not None:
        _off.close()
    if _usda is not None:
        _usda.close()
    if _fruityvice is not None:
        _fruityvice.close()
    _off = _usda = _fruityvice = None


# Back-compat alias so existing test fixtures keep working.
_reset_off_for_tests = _reset_clients_for_tests


class ResolveRequest(BaseModel):
    """Request body for `POST /api/nutrition/resolve`.

    Wrapped in an object (rather than a bare array) so the optional
    `profile` field has a stable position. FastAPI would otherwise
    require both fields as top-level keys when the second parameter
    is annotated, leading to a confusing 422 on valid inputs.
    """

    items: list[DetectedItem]
    profile: UserProfile | None = None


@router.post("/resolve", response_model=ResolveNutritionResult)
def resolve_nutrition(body: ResolveRequest) -> ResolveNutritionResult:
    """Run the OFF → USDA → Fruityvice cascade for `body.items`, then
    compute per-nutrient contributions for the explainability panel.

    `profile` is optional — when omitted, no contributions are emitted
    (the frontend uses a default profile for the demo path anyway).
    """
    resolved = [
        resolve_with_cascade(
            it,
            off_facts=_get_off().lookup,
            usda_facts=_get_usda().lookup,
            fruityvice_facts=_get_fruityvice().lookup,
        )
        for it in body.items
    ]
    contributions = compute_contributions(resolved, body.profile)
    return ResolveNutritionResult(resolved=resolved, contributions=contributions)


class MacroTargetsRequest(BaseModel):
    profile: UserProfile | None = None


@router.get("/targets", response_model=MacroTargets)
def macro_targets(
    current_user: AuthSession | None = Depends(get_current_user_optional),
    state: State = Depends(get_state),
) -> MacroTargets:
    """Daily macro targets personalized to the active user profile, or standard targets when unauthenticated."""
    if current_user and current_user.email:
        profile = state.get_user_profile(current_user.email)
        if profile:
            targets = calculate_targets(profile)
            return targets["daily"]
    return DEFAULT_TARGETS


@router.post("/targets", response_model=MacroTargets)
def calculate_macro_targets(body: MacroTargetsRequest) -> MacroTargets:
    """Calculate daily macro targets dynamically for the provided user profile."""
    if body.profile:
        targets = calculate_targets(body.profile)
        return targets["daily"]
    return DEFAULT_TARGETS


def resolve_with_cascade(
    item: DetectedItem,
    *,
    off_facts,
    usda_facts,
    fruityvice_facts,
) -> ResolvedItem:
    """Cascade resolver — try each source in order, fall through on miss.

    Pure function w.r.t. its lookup callbacks (they're injectable so
    tests can stub each layer). The live clients are passed in by the
    route handler via `_get_*()` accessors.
    """
    # 1. Seeded cache (matches frontend's MOCK_NUTRITION_DB, case-insensitive).
    descriptor = NUTRITION_DB.get(item.name)
    if descriptor is None:
        item_lower = item.name.lower().strip()
        for k, v in NUTRITION_DB.items():
            if k.lower().strip() == item_lower:
                descriptor = v
                break
    if descriptor is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=descriptor,
            descriptor=descriptor,
            source="cache",
            partial=False,
        )

    # 1b. Local Bangladeshi Food Composition database
    bd_desc = _lookup_bd_food(item.name, item.name_bn)
    if bd_desc is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=bd_desc,
            descriptor=bd_desc,
            source="cache",
            partial=False,
        )
    # 2. OFF live.
    if (facts := _safe_lookup(off_facts, item.name)) is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=facts,
            descriptor=None,
            source="open-food-facts",
            partial=False,
        )
    # 3. USDA live (DEMO_KEY works without signup).
    if (facts := _safe_lookup(usda_facts, item.name)) is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=facts,
            descriptor=None,
            source="usda",
            partial=False,
        )
    # 4. Fruityvice (fruit-only; cheap no-key API).
    if (facts := _safe_lookup(fruityvice_facts, item.name)) is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=facts,
            descriptor=None,
            source="fruityvice",
            partial=False,
        )
    # 4b. Canonical food aliases fallback.
    alias_desc = _lookup_alias_food(item.name, item.name_bn)
    if alias_desc is not None:
        return ResolvedItem(
            **item.model_dump(),
            nutrition=alias_desc,
            descriptor=alias_desc,
            source="cache",
            partial=False,
        )
    # 5. Estimated fallback — partial=True signals to the UI that the
    #    nutrition is best-effort and flagging shouldn't fire.
    return ResolvedItem(
        **item.model_dump(),
        nutrition=None,
        descriptor=None,
        source="estimated",
        partial=True,
    )


def _safe_lookup(lookup, name: str) -> NutritionFacts | None:
    """Call a cascade lookup and swallow any exception — the cascade
    must always fall through to the next step rather than 500."""
    try:
        return lookup(name)
    except Exception:
        return None


# Re-exported so tests can stub the live clients without reaching into
# private state.
__all__ = [
    "router",
    "resolve_nutrition",
    "macro_targets",
    "resolve_with_cascade",
    "_get_off",
    "_get_usda",
    "_get_fruityvice",
    "_reset_clients_for_tests",
    "off_client_mod",
    "usda_client_mod",
    "fruityvice_client_mod",
]
