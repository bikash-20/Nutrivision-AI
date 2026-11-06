"""Open Food Facts HTTP client.

Open Food Facts (world.openfoodfacts.org) is a free, crowd-sourced
nutrition database — no API key required. Per their guidelines, the
client must send a descriptive User-Agent on every request.

The client is intentionally narrow: a single `lookup(name)` method
that returns the top hit's per-100g macros as `NutritionFacts`, or
`None` when nothing matches. The cascade logic (OFF → USDA →
Fruityvice) lives in `app/api/nutrition.py` — this module is just
the OFF adapter.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.models.schemas import NutritionFacts
from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

# Required by OFF API ToS — they reject requests with a generic UA.
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo; contact: dev@nutrivision.ai)"
DEFAULT_BASE_URL = "https://world.openfoodfacts.org"

# OFF reports sodium in grams per 100g; the schema (and frontend) expects
# milligrams. 1 g = 1000 mg — pulled out as a constant so the conversion
# is greppable rather than a bare `* 1000.0` magic number.
SODIUM_G_TO_MG = 1000.0


class OFFClient:
    """Thin HTTP wrapper around Open Food Facts search.

    Uses a single shared `httpx.Client` for connection pooling. The
    client is created lazily on first use so import-time is cheap and
    tests can swap the base URL via env without monkeypatching.
    """

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.environ.get("OFF_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.base_url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=httpx.Timeout(8.0, connect=4.0),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def lookup(self, name: str) -> NutritionFacts | None:
        """Search OFF by `name` and return the top hit's per-100g
        macros, or `None` if no confident match is found.

        A hit is considered "confident" if it has at least kcal +
        protein — empty results return None.
        """
        try:
            resp = self._http().get(
                "/cgi/search.pl",
                params={
                    "search_terms": name,
                    "search_simple": 1,
                    "action": "process",
                    "json": 1,
                    "page_size": 1,
                    "fields": (
                        "nutriments,product_name,brands"
                    ),
                },
            )
            resp.raise_for_status()
        except (httpx.HTTPError, ValueError) as exc:
            log_http_failure("OFF", exc, image_ref=name)
            return None

        data: dict[str, Any] = resp.json()
        products = data.get("products") or []
        if not products:
            return None

        top = products[0]
        nutriments = top.get("nutriments") or {}
        try:
            kcal = float(nutriments.get("energy-kcal_100g") or nutriments.get("energy-kcal") or 0)
        except (TypeError, ValueError):
            kcal = 0.0
        if kcal <= 0:
            # OFF often records energy as kJ. Fall back to that.
            try:
                kj = float(nutriments.get("energy_100g") or 0)
            except (TypeError, ValueError):
                kj = 0.0
            if kj > 0:
                kcal = kj / 4.184
        if kcal <= 0:
            return None  # not enough data — treat as a miss

        facts = NutritionFacts(
            protein=_get_float(nutriments, "proteins_100g"),
            carbs=_get_float(nutriments, "carbohydrates_100g"),
            fat=_get_float(nutriments, "fat_100g"),
            kcal=kcal,
            fiber=_get_float(nutriments, "fiber_100g"),
            sodium=_get_float(nutriments, "sodium_100g"),  # grams on OFF
            sugar=_get_float(nutriments, "sugars_100g"),
            # OFF doesn't have a glycemic share field — estimate from carbs.
            glycemic=min(1.0, _get_float(nutriments, "carbohydrates_100g") / 100.0),
        )
        # OFF stores sodium in grams; the frontend expects milligrams.
        facts.sodium *= SODIUM_G_TO_MG
        return facts


def _get_float(nutriments: dict[str, Any], key: str) -> float:
    raw = nutriments.get(key)
    if raw is None:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0
