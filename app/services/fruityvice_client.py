"""Fruityvice fruit-nutrition client.

Fruityvice is a free, no-key fruit-only nutrition API. It returns one
hit per fruit name (no search; exact slug match required). The client
is best-effort — misses are normal (most meals aren't pure fruit) and
fall through to the next cascade step.

Reports kcal per 100g in `nutritions.calories`; sodium, fiber, sugar
fields aren't in the response, so we leave them at 0 (downstream code
handles the sparse nutrition gracefully).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.models.schemas import NutritionFacts
from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://www.fruityvice.com/api"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"


class FruityviceClient:
    """Thin HTTP wrapper around `GET /fruit/{name}`."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (
            base_url
            or os.environ.get("FRUITYVICE_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.base_url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=httpx.Timeout(6.0, connect=4.0),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def lookup(self, name: str) -> NutritionFacts | None:
        """Exact-name lookup. Returns `None` on miss / 404 / any error
        so the cascade can fall through."""
        import urllib.parse
        slug = urllib.parse.quote(name.strip().lower().replace(" ", "_"), safe="")
        try:
            resp = self._http().get(f"/fruit/{slug}")
        except (httpx.HTTPError, ValueError) as exc:
            log_http_failure("Fruityvice", exc, image_ref=name)
            return None
        if resp.status_code == 404:
            return None
        try:
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            log_http_failure("Fruityvice", exc, image_ref=name)
            return None
        try:
            data: dict[str, Any] = resp.json()
        except ValueError:
            return None
        nutritions = data.get("nutritions") or {}
        kcal = float(nutritions.get("calories") or 0)
        if kcal <= 0:
            return None
        return NutritionFacts(
            # Fruityvice doesn't split macros — leave at 0; downstream code
            # treats sparse facts as "unknown" rather than "zero".
            protein=0.0,
            carbs=float(nutritions.get("carbohydrates") or 0),
            fat=float(nutritions.get("fat") or 0),
            kcal=kcal,
            fiber=0.0,
            sodium=0.0,
            sugar=float(nutritions.get("sugar") or 0),
            glycemic=0.5,  # most fruit is mid-glycemic; cap falls to 1.0
        )
