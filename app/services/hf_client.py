"""HuggingFace Inference Router client.

`nateraw/food` is a 101-class food classifier hosted on HuggingFace.
The Inference Router accepts base64 images and returns top-K
`(label, score)` pairs. Scores are 0–1; the reconciler scales them
to 0–100 so they sit on the same scale as Gemini's confidence.

`is_configured()` is the gate — no `HF_API_TOKEN` means no real
classifier call, and the reconcile stage will report `fallback`.
"""

from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

DEFAULT_MODEL = "nateraw/food"
DEFAULT_BASE_URL = "https://router.huggingface.co/hf-inference/models"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"

# How many top labels to keep — used by the reconciler as the candidate
# pool to match against Gemini names.
DEFAULT_TOP_K = 5


class HFClient:
    """Thin wrapper around `POST /models/{model}` (image-classification)."""

    def __init__(
        self,
        api_token: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_token = (
            api_token or os.environ.get("HF_API_TOKEN") or ""
        )
        self.model = model or os.environ.get("HF_FOOD_MODEL") or DEFAULT_MODEL
        self.base_url = (
            base_url or os.environ.get("HF_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            headers = {"User-Agent": USER_AGENT}
            if self.api_token:
                headers["Authorization"] = f"Bearer {self.api_token}"
            self._client = httpx.Client(
                headers=headers,
                timeout=httpx.Timeout(20.0, connect=5.0),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def is_configured(self) -> bool:
        return bool(self.api_token)

    def classify(self, image_ref: str) -> list[tuple[str, float]]:
        """Return top-K `(label, score)` pairs for the image.

        Scores are 0–1, NOT 0–100 (HF classifier convention). Returns
        `[]` on any error so the reconciler can fall back to Gemini-only.
        """
        if not self.is_configured():
            return []
        try:
            image_b64, mime = _read_image(image_ref)
        except (OSError, ValueError) as exc:
            log.warning("HF: cannot read image (%s)", type(exc).__name__)
            return []
        url = f"{self.base_url}/{self.model}"
        try:
            resp = self._http().post(
                url,
                json={"inputs": {"image": f"data:{mime};base64,{image_b64}"}},
            )
            resp.raise_for_status()
        except (httpx.HTTPError, ValueError) as exc:
            log_http_failure("HF", exc, image_ref=image_ref)
            return []

        try:
            data = resp.json()
        except ValueError:
            return []
        # The router may wrap the result in a list; HF also returns
        # nested arrays for some models. Normalize.
        items: list[Any] = []
        if isinstance(data, list) and data and isinstance(data[0], list):
            items = data[0]
        elif isinstance(data, list):
            items = data
        else:
            return []
        out: list[tuple[str, float]] = []
        for entry in items[:DEFAULT_TOP_K]:
            if not isinstance(entry, dict):
                continue
            label = entry.get("label")
            score = entry.get("score")
            if not isinstance(label, str) or not isinstance(score, (int, float)):
                continue
            out.append((label, float(score)))
        return out


def _read_image(image_ref: str) -> tuple[str, str]:
    if image_ref.startswith("data:"):
        head, _, payload = image_ref.partition(",")
        mime = head.split(":", 1)[1].split(";", 1)[0] or "image/jpeg"
        return payload, mime

    # Security check: Block path traversal and absolute system paths
    path = Path(image_ref)
    if path.is_absolute() or ".." in image_ref or not path.is_file():
        raise ValueError(f"Invalid image_ref format or inaccessible path: {image_ref}")
    suffix = path.suffix.lower()
    mime = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(suffix, "image/jpeg")
    return base64.b64encode(path.read_bytes()).decode("ascii"), mime
