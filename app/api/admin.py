"""Admin Telemetry & User Management API.

Provides system-wide aggregated metrics, active user activity, and detection
quality analytics for the NutriVision AI Admin Dashboard.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.auth import require_admin_user
from app.models.schemas import (
    AdminMetrics,
    AdminUserDetail,
    AdminUserSummary,
    AuthSession,
    PopularFoodItem,
    ReviewQueueAction,
    ReviewQueueItem,
    ReviewQueueUpdateRequest,
)
from app.services.state import State, get_state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/metrics", response_model=AdminMetrics)
def get_admin_metrics(
    response: Response,
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> AdminMetrics:
    """Return aggregated platform metrics. Requires admin privileges."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return state.get_admin_metrics()


@router.get("/users", response_model=list[AdminUserSummary])
def list_admin_users(
    response: Response,
    search: str | None = Query(None, description="Search by email or name"),
    sort_by: str = Query("lastActive", alias="sortBy", description="Field to sort by"),
    order: str = Query("desc", description="Sort direction ('asc' or 'desc')"),
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> list[AdminUserSummary]:
    """Return searchable, sortable list of all registered platform users."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return state.list_admin_users(search=search, sort_by=sort_by, order=order)


@router.get("/users/{email}", response_model=AdminUserDetail)
def get_admin_user_detail(
    email: str,
    response: Response,
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> AdminUserDetail:
    """Return comprehensive user detail including profile and recent logged meals."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    detail = state.get_admin_user_detail(email)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {email} not found",
        )
    return detail


@router.get("/popular-foods", response_model=list[PopularFoodItem])
def get_popular_foods(
    range: str = Query("7d", description="Date range: today, 7d, 30d, all"),
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> list[PopularFoodItem]:
    """Return ranked breakdown of the most frequently logged foods across all users."""
    return state.get_popular_foods(date_range=range)


@router.get("/review-queue", response_model=list[ReviewQueueItem])
def get_review_queue(
    status: str = Query("all", description="Filter by review status: all, pending, approved, corrected, dismissed"),
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> list[ReviewQueueItem]:
    """Return meals with low-confidence items (<70%) or active review status."""
    return state.get_review_queue(status=status)


@router.patch("/review-queue/{meal_id}", response_model=ReviewQueueItem)
def update_review_queue(
    meal_id: str,
    body: ReviewQueueUpdateRequest,
    current_user: AuthSession = Depends(require_admin_user),
    state: State = Depends(get_state),
) -> ReviewQueueItem:
    """Approve, correct, or dismiss a flagged meal from the review queue."""
    updated = state.update_review_queue(
        meal_id=meal_id,
        action=body.action,
        corrected_label=body.corrected_label,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meal {meal_id} not found in review queue",
        )
    return updated
