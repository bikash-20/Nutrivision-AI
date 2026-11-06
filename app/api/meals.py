"""Meal history CRUD + aggregates — mirrors `src/lib/api.ts#saveMeal`,
`getMealHistory`, `getTodaySummary`, `getUserStats`, `deleteMeal`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.auth import require_current_user
from app.models.schemas import (
    AuthSession,
    DetectedItem,
    HealthGoals,
    MealEntry,
    MealTotals,
    TodaySummary,
    UserStats,
)
from app.services.state import State, get_state
from app.services.targets import resolve_daily_kcal_target

router = APIRouter(prefix="/api/meals", tags=["meals"])


# ── Request bodies ──────────────────────────────────────────────────────


class SaveMealRequest(BaseModel):
    """Body for `POST /api/meals`. Supports both camelCase and snake_case."""

    model_config = ConfigDict(populate_by_name=True)

    label: str
    items: list[DetectedItem]
    totals: MealTotals
    photo_url: str | None = Field(default=None, alias="photoUrl")
    active_goals: HealthGoals = Field(
        default_factory=lambda: HealthGoals(),
        alias="activeGoals",
    )


class UpdateLatestMealRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    label: str | None = None
    items: list[DetectedItem] | None = None
    totals: MealTotals | None = None
    review_status: str | None = Field(default=None, alias="reviewStatus")


# ── Endpoints ────────────────────────────────────────────────────────────


@router.patch("/latest", response_model=MealEntry | None)
def update_latest_meal(
    body: UpdateLatestMealRequest,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> MealEntry | None:
    """Update items, totals, label, or review_status on the authenticated user's latest meal."""
    return state.update_user_latest_meal(
        current_user.email,
        label=body.label,
        items=body.items,
        totals=body.totals,
        review_status=body.review_status,
    )


@router.post("", response_model=MealEntry, status_code=status.HTTP_201_CREATED)
def save_meal(
    body: SaveMealRequest,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> MealEntry:
    """Append a new meal entry for the authenticated user."""
    return state.add_user_meal(
        current_user.email,
        label=body.label,
        items=body.items,
        totals=body.totals,
        photo_url=body.photo_url,
        active_goals=body.active_goals,
    )


@router.get("", response_model=list[MealEntry])
def get_meal_history(
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> list[MealEntry]:
    """Return the authenticated user's meal history, newest first."""
    return state.list_user_meals(current_user.email)


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: str,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> None:
    try:
        state.delete_user_meal(current_user.email, meal_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/today", response_model=TodaySummary)
def get_today_summary(
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> TodaySummary:
    """Aggregate today's meals for the authenticated user."""
    meals = state.list_user_meals(current_user.email)
    today_prefix = datetime.now(UTC).date().isoformat()
    today = [m for m in meals if m.date.startswith(today_prefix)]
    user_profile = state.get_user_profile(current_user.email)
    return TodaySummary(
        meals_logged=len(today),
        total_kcal=sum(m.totals.kcal for m in today),
        total_protein=sum(m.totals.protein for m in today),
        total_carbs=sum(m.totals.carbs for m in today),
        total_fat=sum(m.totals.fat for m in today),
        daily_kcal_target=resolve_daily_kcal_target(user_profile),
    )




def _calculate_streak(days: set[str]) -> int:
    if not days:
        return 0
    sorted_days = sorted(days, reverse=True)
    today = date.today()
    yesterday = today - timedelta(days=1)

    if today.isoformat() in days:
        cur = today
    elif yesterday.isoformat() in days:
        cur = yesterday
    else:
        parts = [int(p) for p in sorted_days[0].split("-")]
        cur = date(parts[0], parts[1], parts[2])

    streak = 0
    while cur.isoformat() in days:
        streak += 1
        cur -= timedelta(days=1)
    return streak


@router.get("/stats", response_model=UserStats)
def get_user_stats(
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> UserStats:
    """Aggregate authenticated user stats for the Profile screen."""
    meals = state.list_user_meals(current_user.email)
    if not meals:
        return UserStats(
            total_meals=0, total_days_active=0, avg_daily_kcal=0, streak_days=0
        )
    days = {m.date[:10] for m in meals}
    total_kcal = sum(m.totals.kcal for m in meals)
    return UserStats(
        total_meals=len(meals),
        total_days_active=len(days),
        avg_daily_kcal=round(total_kcal / len(days)),
        streak_days=_calculate_streak(days),
    )