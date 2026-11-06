"""Profile GET/PUT — mirrors `src/lib/api.ts#getProfile` / `updateProfile`.

The frontend's mock client persists to localStorage; the backend
skeleton persists to `state.json` via `app.services.state.State`.
Auth (login/logout/getSession) is **not** implemented here — that's
still mock-grade in the frontend for cut (a).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.auth import require_current_user
from app.models.schemas import AuthSession, UserProfile
from app.services.state import State, get_state

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("", response_model=UserProfile)
def get_profile(
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> UserProfile:
    """Return the profile for the authenticated user."""
    return state.get_user_profile(current_user.email)


@router.put("", response_model=UserProfile)
def update_profile(
    profile: UserProfile,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> UserProfile:
    """Replace the profile for the authenticated user."""
    return state.set_user_profile(current_user.email, profile)
