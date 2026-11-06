"""Market & Grocery Pricing API router — `GET /api/market/price`."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from app.services.price_scraper import LivePriceResult, get_price_scraper

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/price", response_model=LivePriceResult)
def get_market_price(
    q: str = Query(..., description="Item name in English or Bengali"),
    name_bn: str | None = Query(default=None, description="Bengali name hint"),
    live_demo: bool = Query(default=False, description="Simulate live demo update if blocked"),
) -> LivePriceResult:
    """Fetch live market price from Chaldal with strict 3s timeout and TCB/DAM fallback."""
    scraper = get_price_scraper()
    return scraper.fetch_live_price(
        item_name_en=q,
        item_name_bn=name_bn or "",
        force_mock_live=live_demo,
    )

