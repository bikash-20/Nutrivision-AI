"""Seed fixtures — server-side mirror of `src/mocks/fixtures.ts`.

Every value here is a 1:1 port of the corresponding TS constant:

    MOCK_DETECTED          → DETECTED
    MOCK_NUTRITION_DB      → NUTRITION_DB
    MOCK_TARGETS           → TARGETS
    MOCK_PROFILE           → DEFAULT_PROFILE
    MOCK_GROCERY_GROUPS    → DEFAULT_GROCERY_GROUPS

If the frontend seed changes, this file must update in lockstep — see
`NutriVision_AI_Blueprint.md` §8. The frontend stays the visible
source of truth for demo users; this module exists so the backend
can answer round-trip requests without the frontend being attached.
"""

from __future__ import annotations

from app.models.schemas import (
    DetectedItem,
    FoodDescriptor,
    GroceryGroup,
    GroceryItem,
    MacroTargets,
    UserProfile,
)

# ── Vision pipeline initial output ──────────────────────────────────────

DETECTED: list[DetectedItem] = [
    DetectedItem(name="Chicken biryani", confidence=92, grams=310, note=None),
    DetectedItem(name="Cucumber raita", confidence=88, grams=90, note=None),
    DetectedItem(
        name="Mixed salad",
        confidence=61,
        grams=70,
        note="Low confidence — tap to confirm",
    ),
    DetectedItem(name="Pickled onion", confidence=74, grams=25, note=None),
]


# ── Nutrition database ──────────────────────────────────────────────────

NUTRITION_DB: dict[str, FoodDescriptor] = {
    "Chicken biryani": FoodDescriptor(
        protein=6.0, carbs=22.0, fat=4.5, kcal=165,
        fiber=0.6, sodium=380, sugar=0.9, glycemic=0.71,
        emoji="🍗", category="protein",
        alternatives=["Chicken Tikka", "Chicken Korma"],
        pairings=["Naan", "Mint chutney"],
    ),
    "Cucumber raita": FoodDescriptor(
        protein=2.4, carbs=4.0, fat=2.8, kcal=56,
        fiber=0.3, sodium=60, sugar=2.6, glycemic=0.05,
        emoji="🥒", category="produce",
        alternatives=["Yogurt dip", "Tzatziki"],
        pairings=["Papad", "Boiled egg"],
    ),
    "Mixed salad": FoodDescriptor(
        protein=1.2, carbs=3.6, fat=0.3, kcal=22,
        fiber=1.4, sodium=18, sugar=1.8, glycemic=0.02,
        emoji="🥗", category="produce",
        alternatives=["Greek Salad", "Garden Salad"],
        pairings=["Olive oil", "Feta cheese"],
    ),
    "Pickled onion": FoodDescriptor(
        protein=1.0, carbs=9.0, fat=0.1, kcal=42,
        fiber=1.7, sodium=250, sugar=4.0, glycemic=0.03,
        emoji="🧅", category="produce",
        alternatives=["Red onion", "Shallots"],
        pairings=["Lemon juice", "Sumac"],
    ),
}


# ── Daily macro targets (used by NutrientsScreen) ───────────────────────

TARGETS: MacroTargets = MacroTargets(
    kcal=720,
    protein=50,
    carbs=40,
    fat=65,
    fiber=30,
    sodium=1200,
    sugar=25,
)


# ── Profile defaults ────────────────────────────────────────────────────

DEFAULT_PROFILE: UserProfile = UserProfile(
    name="Rafi",
    goals={"diabetic": True, "protein": False, "budget": True, "mediter": False},
    preferences=[],
    allergens=["Peanuts"],
    budget=500,
    serving=1,
)


# ── Grocery list ────────────────────────────────────────────────────────

DEFAULT_GROCERY_GROUPS: list[GroceryGroup] = [
    GroceryGroup(
        category="Grains & staples",
        items=[
            GroceryItem(id="g-0-0", name="Brown rice", price=90, checked=True),
            GroceryItem(id="g-0-1", name="Whole wheat atta", price=60, checked=False),
        ],
    ),
    GroceryGroup(
        category="Produce",
        items=[
            GroceryItem(id="g-1-0", name="Cucumber", price=20, checked=False),
            GroceryItem(id="g-1-1", name="Spinach", price=25, checked=False),
            GroceryItem(id="g-1-2", name="Tomato", price=30, checked=False),
        ],
    ),
    GroceryGroup(
        category="Protein",
        items=[
            GroceryItem(id="g-2-0", name="Eggs (6)", price=75, checked=False),
            GroceryItem(id="g-2-1", name="Chicken breast", price=140, checked=False),
        ],
    ),
]


# Convenience: flat list of default grocery items, used to seed the
# in-memory state store on first boot.
def default_grocery_items() -> list[GroceryItem]:
    return [item for group in DEFAULT_GROCERY_GROUPS for item in group.items]
