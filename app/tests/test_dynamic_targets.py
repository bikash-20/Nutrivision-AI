"""Unit tests for the dynamic clinical target engine."""

from __future__ import annotations

from app.models.schemas import HealthGoals, UserProfile
from app.services.targets import (
    calculate_bmr,
    calculate_daily_calories,
    calculate_targets,
    calculate_tdee,
)


def test_child_vs_adult_fiber_and_calories() -> None:
    """A 5-year-old boy must NOT receive an adult 30g fiber target or 2000 kcal target."""
    child_profile = UserProfile(
        name="Little Aayan",
        age=5,
        sex="male",
        height_cm=110.0,
        weight_kg=18.0,
        activity_level="moderate",
        goal="maintain",
        goals=HealthGoals(),
        preferences=[],
        allergens=[],
        budget=300.0,
        serving=1,
    )

    adult_profile = UserProfile(
        name="Rahim",
        age=45,
        sex="male",
        height_cm=175.0,
        weight_kg=80.0,
        activity_level="moderate",
        goal="maintain",
        goals=HealthGoals(),
        preferences=[],
        allergens=[],
        budget=800.0,
        serving=1,
    )

    child_targets = calculate_targets(child_profile)
    adult_targets = calculate_targets(adult_profile)

    # 5-year-old child target checks
    child_daily = child_targets["daily"]
    assert child_daily.kcal < 1500.0
    # Pediatric fiber rule: age + 5 = 10g (safe and appropriate, NOT 30g!)
    assert child_daily.fiber < 15.0
    assert child_daily.fiber == 10.0
    # Child sodium cap is lower (1200mg)
    assert child_daily.sodium <= 1200.0

    # 45-year-old adult checks
    adult_daily = adult_targets["daily"]
    assert adult_daily.kcal > 2200.0
    assert adult_daily.fiber >= 28.0
    assert adult_daily.protein > 80.0
    assert adult_daily.sodium == 2300.0


def test_bmr_mifflin_st_jeor_male_and_female() -> None:
    # 70kg, 175cm, 30yo
    # Male: 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75 -> 1648.8
    male_bmr = calculate_bmr(70.0, 175.0, 30, "male")
    assert 1645.0 <= male_bmr <= 1655.0

    # Female: 10*70 + 6.25*175 - 5*30 - 161 = 700 + 1093.75 - 150 - 161 = 1482.75 -> 1482.8
    female_bmr = calculate_bmr(70.0, 175.0, 30, "female")
    assert 1480.0 <= female_bmr <= 1490.0


def test_tdee_activity_factors() -> None:
    bmr = 1500.0
    assert calculate_tdee(bmr, "sedentary") == 1800.0  # 1500 * 1.2
    assert calculate_tdee(bmr, "moderate") == 2325.0   # 1500 * 1.55
    assert calculate_tdee(bmr, "very_active") == 2850.0 # 1500 * 1.9


def test_safe_calorie_floor_prevents_crash_diet() -> None:
    # A woman with 1400 kcal TDEE asks for 1kg/week weight loss (1100 kcal deficit).
    # 1400 - 1100 = 300 kcal (dangerous starvation!).
    # Must be clamped to the female clinical floor of 1200 kcal.
    target_kcal, explanations = calculate_daily_calories(
        tdee=1400.0,
        goal="lose",
        target_rate_kg_per_week=1.0,
        sex="female",
        age=28,
    )
    assert target_kcal == 1200.0
    assert any("Safety limit" in exp for exp in explanations)


def test_hypertension_sodium_restriction() -> None:
    profile = UserProfile(
        name="Patient A",
        age=50,
        sex="female",
        height_cm=160.0,
        weight_kg=70.0,
        activity_level="light",
        goal="maintain",
        goals=HealthGoals(),
        medical_conditions=["hypertension"],
        preferences=[],
        allergens=[],
        budget=500.0,
        serving=1,
    )
    targets = calculate_targets(profile)
    # AHA guideline ceiling
    assert targets["daily"].sodium == 1500.0


def test_kidney_condition_caps_protein() -> None:
    profile = UserProfile(
        name="Patient B",
        age=55,
        sex="male",
        height_cm=170.0,
        weight_kg=100.0,  # 100 kg * 0.8g/kg = 80g max
        activity_level="moderate",
        goal="maintain",
        goals=HealthGoals(),
        medical_conditions=["kidney"],
        preferences=[],
        allergens=[],
        budget=500.0,
        serving=1,
    )
    targets = calculate_targets(profile)
    assert targets["daily"].protein <= 80.0
    assert any("Renal precaution" in exp for exp in targets["explanations"])

