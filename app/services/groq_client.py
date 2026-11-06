"""Groq vision client for fast multimodal inference and cascade fallback.

Groq exposes an OpenAI-compatible endpoint:
  POST {base_url}/chat/completions
with:
  Authorization: Bearer {api_key}
and messages containing text instructions and image_url payload with base64 data.

Models supported include `llama-3.2-11b-vision-preview`,
`llama-3.2-90b-vision-preview`, and `qwen/qwen3.8-27b`.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.models.schemas import DetectedItem, VisionDetectionResult
from app.services._http_logging import log_http_failure
from app.services.gemini_client import (
    _DETECTION_PROMPT,
    _parse_vision_result,
    _read_image,
)

log = logging.getLogger(__name__)

DEFAULT_MODEL = "qwen/qwen3.8-27b"
DEFAULT_GROQ_VISION_MODELS = [
    "qwen/qwen3.8-27b",
]
DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
USER_AGENT = "NutriVisionDemo/0.1 (hackathon demo)"


class GroqClient:
    """HTTP client for Groq's multimodal / vision models."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_key = (
            api_key if api_key is not None else os.environ.get("GROQ_API_KEY") or ""
        ).strip()
        self.model = (
            model
            or os.environ.get("GROQ_MODEL")
            or os.environ.get("GROQ_VISION_MODEL")
            or DEFAULT_MODEL
        )
        self.base_url = (
            base_url or os.environ.get("GROQ_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                headers={
                    "User-Agent": USER_AGENT,
                    "Authorization": f"Bearer {self.api_key}",
                },
                timeout=httpx.Timeout(6.0, connect=3.0),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def is_configured(self) -> bool:
        """True iff a key is set."""
        return bool(self.api_key)

    def detect_vision(self, image_ref: str) -> VisionDetectionResult | None:
        """Run multimodal vision analysis against Groq vision API."""
        if not self.is_configured():
            return None

        try:
            image_b64, mime = _read_image(image_ref)
        except (OSError, ValueError) as exc:
            log.warning("Groq: cannot read image (%s)", type(exc).__name__)
            return None

        data_url = f"data:{mime};base64,{image_b64}"
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _DETECTION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ],
            "temperature": 0.1,
            "max_tokens": 480,
        }

        url = f"{self.base_url}/chat/completions"
        headers = {
            "User-Agent": USER_AGENT,
            "Authorization": f"Bearer {self.api_key}",
        }

        candidate_models = [self.model]
        for m in DEFAULT_GROQ_VISION_MODELS:
            if m not in candidate_models:
                candidate_models.append(m)

        payload = None
        for model_name in candidate_models:
            body["model"] = model_name
            try:
                resp = self._http().post(url, headers=headers, json=body)
                resp.raise_for_status()
                payload = resp.json()
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in (400, 404, 422, 429) and model_name != candidate_models[-1]:
                    log.info(
                        "Groq vision model %s failed (%d); attempting fallback candidate",
                        model_name,
                        exc.response.status_code,
                    )
                    continue
                log_http_failure("Groq", exc, image_ref=image_ref)
                return None
            except (httpx.HTTPError, ValueError) as exc:
                log_http_failure("Groq", exc, image_ref=image_ref)
                return None

        if not payload:
            return None

        choices = payload.get("choices") or []
        if not choices:
            return None
        message = choices[0].get("message") or {}
        text = message.get("content") or ""
        if not isinstance(text, str) or not text.strip():
            return None
        return _parse_vision_result(text)

    def detect(self, image_ref: str) -> list[DetectedItem]:
        """Run food detection against Groq vision API.

        Accepts either a base64 data URL (`data:image/jpeg;base64,...`) or a
        local file path. Returns `[]` on any failure so callers can gracefully
        continue the pipeline cascade.
        """
        res = self.detect_vision(image_ref)
        return res.detected if res is not None else []


def _parse_groq_response(payload: dict[str, Any]) -> list[DetectedItem]:
    """Tolerantly extract the DetectedItem array from a Groq chat completion."""
    choices = payload.get("choices") or []
    if not choices:
        return []
    message = choices[0].get("message") or {}
    text = message.get("content") or ""
    if not isinstance(text, str) or not text.strip():
        return []
    return _parse_vision_result(text).detected
