"""Personalize / explainability layer.

Mirrors the `flagRules` block in `src/lib/api.ts#resolveNutrition`
exactly so the NutrientsScreen verdict chips render identical
contributions when wired to the backend. The math is the same;
only the language is Python — and now, the rule table is data.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.schemas import (
    DetectedItem,
    NutrientContribution,
    ResolvedItem,
    UserProfile,
)
from app.services.targets import calculate_targets

# A flagged nutrient is one the user's profile cares about.
# Diabetic profiles care about sugar + fiber; everyone else sodium + fiber.
_PROFILE_FOCUS: dict[bool, frozenset[str]] = {
    True: frozenset({"sugar", "fiber"}),
    False: frozenset({"sodium", "fiber"}),
}


@dataclass(frozen=True)
class _Rule:
    nutrient: str
    threshold: float
    low_threshold: float | None  # below this → "good" tone with low-reason
    warn_share: float  # meal-over + share ≥ this → "warn" tone with high-reason
    unit: str  # "g" or "mg" — formats the interpolation
    high_reason: str  # template; rendered with {name}, {amount}, {pct}
    low_reason: str | None  # template; None means "no low-reason comment"


def _get_dynamic_rules(profile: UserProfile | None) -> list[_Rule]:
    calc = calculate_targets(profile)
    daily = calc["daily"]
    return [
        _Rule(
            nutrient="sodium",
            threshold=daily.sodium,
            low_threshold=None,
            warn_share=0.30,
            unit="mg",
            high_reason="{name} adds {amount}mg sodium — that's {pct}% of your daily cap in one item.",
            low_reason=None,
        ),
        _Rule(
            nutrient="sugar",
            threshold=daily.sugar,
            low_threshold=daily.sugar * 0.6,
            warn_share=0.30,
            unit="g",
            high_reason="{name} brings {amount}g of sugar — a notable spike for your target.",
            low_reason="{name} contributes only ~{amount}g of sugar — well within your target.",
        ),
        _Rule(
            nutrient="fiber",
            threshold=daily.fiber,
            low_threshold=12.0,
            warn_share=0.30,
            unit="g",
            high_reason="{name} is a solid fiber source at {amount}g — pulls the meal toward target.",
            low_reason="{name} contributes only ~{amount}g fiber — the meal falls short of your daily target. Add whole grains or legumes.",
        ),
        _Rule(
            nutrient="protein",
            threshold=daily.protein,
            low_threshold=None,
            warn_share=0.30,
            unit="g",
            high_reason="{name} delivers {amount}g of protein — strong for a single dish.",
            low_reason="{name} is light on protein (~{amount}g) — consider adding dal, eggs, or paneer.",
        ),
    ]


def compute_contributions(
    resolved: list[ResolvedItem],
    profile: UserProfile | None,
) -> list[NutrientContribution]:
    """Per-item, per-nutrient contributions for the explainability panel.

    A nutrient is "in play" iff the profile cares about it. Within those,
    we flag two cases:
      • Meal exceeds the nutrient's high threshold AND one item owns
        ≥30% of the meal's share → "warn" tone with the high-reason.
      • Meal falls below the low threshold → "good" tone with the
        low-reason for each non-trivial item (share ≥ 10%).
    """
    if profile is None:
        return []
    focus = _PROFILE_FOCUS[profile.goals.diabetic]

    rules = _get_dynamic_rules(profile)
    # Per-nutrient meal totals — exclude items whose nutrition we
    # couldn't resolve (they'd just add noise to the share calc).
    totals: dict[str, float] = {
        r.nutrient: sum(_amount(it, r.nutrient) for it in resolved)
        for r in rules
        if r.nutrient in focus
    }

    contributions: list[NutrientContribution] = []
    for rule in rules:
        if rule.nutrient not in focus:
            continue
        total = totals[rule.nutrient]
        over = total > rule.threshold
        under = rule.low_threshold is not None and total < rule.low_threshold
        if not (over or under):
            continue
        for item in resolved:
            if item.nutrition is None:
                continue
            amount = _amount(item, rule.nutrient)
            share = amount / total if total > 0 else 0.0
            if share < 0.10:
                continue
            if over and share >= rule.warn_share:
                contributions.append(_build(
                    rule, item, amount, share, flagged=True, tone="warn",
                ))
            elif not over and rule.low_reason is not None:
                contributions.append(_build(
                    rule, item, amount, share, flagged=False, tone="good",
                ))
    return contributions


def _amount(item: ResolvedItem, nutrient: str) -> float:
    """Grams-scaled contribution of one resolved item to one nutrient."""
    return getattr(item.nutrition, nutrient) * (item.grams / 100.0)


def _build(
    rule: _Rule,
    item: ResolvedItem,
    amount: float,
    share: float,
    *,
    flagged: bool,
    tone: str,
) -> NutrientContribution:
    template = rule.high_reason if tone == "warn" else rule.low_reason
    amount_str = (
        str(round(amount)) if rule.unit == "mg" else str(round(amount, 1))
    )
    kwargs: dict[str, object] = {"name": item.name, "amount": amount_str}
    if tone == "warn":
        kwargs["pct"] = (
            round((amount / rule.threshold) * 100) if rule.threshold > 0 else 0
        )
    return NutrientContribution(
        nutrient=rule.nutrient,  # type: ignore[arg-type]
        item_name=item.name,
        amount=amount,
        share=share,
        flagged=flagged,
        reason=template.format(**kwargs),  # type: ignore[misc]
        tone=tone,  # type: ignore[arg-type]
    )


def resolve_detected_item(item: DetectedItem, off_facts) -> ResolvedItem:
    """Convert a `DetectedItem` into a `ResolvedItem` by joining against
    the seeded `NUTRITION_DB` first, then falling back to Open Food Facts.

    `off_facts` is a callable `(name: str) -> NutritionFacts | None` —
    injected so this layer doesn't depend on the OFF client directly
    (testable in isolation).
    """
    # Imported here to avoid a circular import at module load.
    from app.seed.fixtures import NUTRITION_DB

    if (descriptor := NUTRITION_DB.get(item.name)) is not None:
        return ResolvedItem(
            **item.model_dump(), nutrition=descriptor, descriptor=descriptor,
            source="cache", partial=False,
        )
    if (facts := off_facts(item.name)) is not None:
        return ResolvedItem(
            **item.model_dump(), nutrition=facts, descriptor=None,
            source="open-food-facts", partial=False,
        )
    return ResolvedItem(
        **item.model_dump(), nutrition=None, descriptor=None,
        source="estimated", partial=True,
    )