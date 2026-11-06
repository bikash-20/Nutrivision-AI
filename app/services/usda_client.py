"""USDA FoodData Central client.

USDA FDC is a free, US-government nutrition database. The default key
`DEMO_KEY` works without signup (rate-limited to ~30 req/hour/IP);
get a personal key at https://api.nal.usda.gov/ui/key.html for higher
quotas — same shape, just more headroom.

The client mirrors `OFFClient`:
  - Single shared `httpx.Client` for connection pooling
  - Lazy-instantiated so import is cheap and tests can swap base URL
  - `lookup(name) -> NutritionFacts | None` returning `None` on miss

USDA reports sodium in milligrams (we keep mg to match the schema),
sugar in grams, and kcal directly — no conversions needed.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.models.schemas import NutritionFacts
from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
# `DEMO_KEY` is the public key USDA publishes for no-signup use.
DEFAULT_API_KEY = "DEMO_KEY"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"


class USDAClient:
    """Thin HTTP wrapper around the USDA FoodData Central search API."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.environ.get("USDA_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("USDA_API_KEY")
            or DEFAULT_API_KEY
        )
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
        """Search USDA FDC by `name`. Returns the top hit's per-100g
        nutrition, or `None` on miss / error / no-confident-match.

        USDA's nutrient ids: protein=1003, carbs=1005, fat=1004, kcal=1008,
        fiber=1079, sodium=1093, sugar=200, sugar (total) is nutrient 210
        but 200 (sucrose-equivalent) is a fair fallback.
        """
        try:
            resp = self._http().get(
                "/foods/search",
                params={
                    "api_key": self.api_key,
                    "query": name,
                    "pageSize": 1,
                    "dataType": "Foundation,SR Legacy,Survey (FNDDS)",
                },
            )
            resp.raise_for_status()
        except (httpx.HTTPError, ValueError) as exc:
            log_http_failure("USDA", exc, image_ref=name)
            return None

        data: dict[str, Any] = resp.json()
        foods = data.get("foods") or []
        if not foods:
            return None
        top = foods[0]
        nutrients = _nutrient_map(top.get("foodNutrients") or [])
        # USDA's "energy" nutrient is kcal (1008). Fall back to 0 if absent.
        kcal = nutrients.get(1008, 0.0)
        if kcal <= 0:
            return None  # no kcal → not a confident match

        return NutritionFacts(
            protein=nutrients.get(1003, 0.0),
            carbs=nutrients.get(1005, 0.0),
            fat=nutrients.get(1004, 0.0),
            kcal=kcal,
            fiber=nutrients.get(1079, 0.0),
            # USDA sodium is already in mg.
            sodium=nutrients.get(1093, 0.0),
            sugar=nutrients.get(210, nutrients.get(200, 0.0)),
            # USDA has no glycemic share; estimate from carbs (cap at 1.0).
            glycemic=min(1.0, nutrients.get(1005, 0.0) / 100.0),
        )


def _nutrient_map(food_nutrients: list[dict[str, Any]]) -> dict[int, float]:
    """Index the foodNutrients list by nutrientId for O(1) lookups."""
    out: dict[int, float] = {}
    for entry in food_nutrients:
        nid = entry.get("nutrientId")
        try:
            amount = float(entry.get("value") or 0)
        except (TypeError, ValueError):
            continue
        if isinstance(nid, int):
            out[nid] = amount
    return out
