"""Grocery list CRUD — mirrors `src/lib/api.ts#getGroceryList`,
`addGroceryItem`, `removeGroceryItem`, `updateGroceryPrice`,
`toggleGroceryItem`, `clearGroceryList`.

The frontend bucket-by-category logic lives in
`bucketGroceryByCategory`; here it's a sibling helper that preserves
the same behavior so the Grocery screen renders identically.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.auth import require_current_user
from app.models.schemas import AuthSession, GroceryGroup, GroceryItem, GroceryList
from app.seed.fixtures import DEFAULT_GROCERY_GROUPS
from app.services.state import State, get_state

router = APIRouter(prefix="/api/grocery", tags=["grocery"])


# ── Helpers ──────────────────────────────────────────────────────────────


# Seeded ids (`g-0-0`, `g-1-2`, …) keep their original category from
# `DEFAULT_GROCERY_GROUPS`; custom items (`g-new-*`) land in `Other`.
# Built once at import — the seed data is immutable, so there's no
# reason to rebuild the lookup on every request.
_SEEDED_ID_TO_CATEGORY: dict[str, str] = {
    item.id: group.category
    for group in DEFAULT_GROCERY_GROUPS
    for item in group.items
}
_EMPTY_BUCKETS: list[GroceryGroup] = [
    GroceryGroup(category=g.category, items=[]) for g in DEFAULT_GROCERY_GROUPS
]


def _bucket_grocery_by_category(items: list[GroceryItem]) -> list[GroceryGroup]:
    """Mirror of the frontend's `bucketGroceryByCategory`."""
    by_cat: dict[str, list[GroceryItem]] = {g.category: [] for g in DEFAULT_GROCERY_GROUPS}
    other: list[GroceryItem] = []
    for item in items:
        cat = _SEEDED_ID_TO_CATEGORY.get(item.id)
        bucket = by_cat.get(cat) if cat is not None else None
        (bucket if bucket is not None else other).append(item)
    out = [GroceryGroup(category=g.category, items=by_cat[g.category]) for g in DEFAULT_GROCERY_GROUPS]
    if other:
        out.append(GroceryGroup(category="Other", items=other))
    return out


# ── Request/response bodies ──────────────────────────────────────────────


class AddGroceryRequest(BaseModel):
    name: str
    price: float = Field(ge=0)
    # Category is informational only — backend doesn't bucket new items
    # by it; they always land in `Other` until re-categorized. Kept on
    # the request so the frontend's existing call shape works without
    # any frontend edits.
    category: str = "Other"


class UpdatePriceRequest(BaseModel):
    price: float = Field(ge=0, le=9999)


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=GroceryList)
def get_grocery_list(
    budget: float = Query(..., ge=0),
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> GroceryList:
    """Return the grocery list bucketed by category for the authenticated user."""
    items = state.list_user_grocery(current_user.email)
    return GroceryList(budget=budget, groups=_bucket_grocery_by_category(items))


@router.post(
    "/items",
    response_model=GroceryItem,
    status_code=status.HTTP_201_CREATED,
)
def add_grocery_item(
    body: AddGroceryRequest,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> GroceryItem:
    """Add a new custom item for the authenticated user."""
    return state.add_user_grocery(current_user.email, body.name, body.price)


@router.post(
    "/batch",
    response_model=list[GroceryItem],
    status_code=status.HTTP_201_CREATED,
)
def add_grocery_items_batch(
    items: list[AddGroceryRequest],
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> list[GroceryItem]:
    """Add multiple grocery items in a single atomic transaction for the authenticated user."""
    items_to_add = [(i.name, i.price) for i in items]
    return state.add_user_grocery_bulk(current_user.email, items_to_add)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_grocery_item(
    item_id: str,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> None:
    try:
        state.remove_user_grocery(current_user.email, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put(
    "/items/{item_id}/price",
    status_code=status.HTTP_204_NO_CONTENT,
)
def update_grocery_price(
    item_id: str,
    body: UpdatePriceRequest,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> None:
    try:
        state.update_user_grocery_price(current_user.email, item_id, body.price)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/items/{item_id}/toggle", response_model=GroceryItem)
def toggle_grocery_item(
    item_id: str,
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> GroceryItem:
    """Flip the `checked` flag for an item."""
    try:
        return state.toggle_user_grocery(current_user.email, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_grocery_list(
    current_user: AuthSession = Depends(require_current_user),
    state: State = Depends(get_state),
) -> None:
    """Empty the grocery list for the authenticated user."""
    state.clear_user_grocery(current_user.email)
