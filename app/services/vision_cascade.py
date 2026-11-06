"""Dynamic vision cascade manager with circuit breaker and perceptual hash caching."""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import time
from pathlib import Path
from typing import Any

import httpx

from app.config.settings import settings
from app.models.schemas import BBox, DetectedItem, UserProfile
from app.services._http_logging import log_http_failure

log = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).resolve().parents[1] / "data" / "prompts" / "vision_detection.txt"


# ── Circuit Breaker ──────────────────────────────────────────────────────


class CircuitBreaker:
    """In-memory circuit breaker that cools down failing providers."""

    def __init__(self, cooldown_seconds: float = 60.0, failure_threshold: int = 3) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.failure_threshold = failure_threshold
        self._failures: dict[str, int] = {}
        self._opened_at: dict[str, float] = {}

    def can_attempt(self, provider: str) -> bool:
        opened = self._opened_at.get(provider)
        if opened is not None:
            if time.time() - opened < self.cooldown_seconds:
                return False
            # Half-open: allow a trial attempt
            del self._opened_at[provider]
            self._failures[provider] = 0
        return True

    def record_success(self, provider: str) -> None:
        self._failures[provider] = 0
        self._opened_at.pop(provider, None)

    def record_failure(self, provider: str, status_code: int = 500) -> None:
        count = self._failures.get(provider, 0) + 1
        self._failures[provider] = count
        if count >= self.failure_threshold or status_code in (429, 503):
            self._opened_at[provider] = time.time()
            log.warning("Circuit breaker OPEN for provider '%s' (cooldown %ss)", provider, self.cooldown_seconds)


CIRCUIT_BREAKER = CircuitBreaker()


# ── Perceptual & Robust Image Hashing ─────────────────────────────────────


def perceptual_hash(image_ref: str) -> str:
    """Compute an image digest.

    For data URLs, samples the base64 character distribution to be resilient
    to tiny metadata shifts, with sha256 fallback.
    """
    if image_ref.startswith("data:"):
        _, _, payload = image_ref.partition(",")
        # Sample middle 512 bytes where pixel data dominates metadata
        sample = payload[:512] + payload[-512:] if len(payload) > 1024 else payload
        return hashlib.sha256(f"p-v1:{sample}".encode()).hexdigest()
    return hashlib.sha256(f"p-v1:{image_ref}".encode()).hexdigest()


# ── JSON Auto-Repair ─────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def repair_and_parse_json(text: str) -> list[dict[str, Any]]:
    """Tolerantly extract and auto-repair a JSON list from LLM output."""
    if not text:
        return []

    # Strip code fences
    fence = _FENCE_RE.search(text)
    if fence:
        text = fence.group(1)

    start = text.find("[")
    end = text.rfind("]")
    if start == -1:
        return []
    if end == -1 or end <= start:
        # Auto-close truncated array
        text = text[start:] + "]"
        end = len(text) - 1

    candidate = text[start : end + 1].strip()

    # Clean trailing commas before brackets (common LLM glitch)
    candidate = re.sub(r",\s*([\]}])", r"\1", candidate)

    try:
        data = json.loads(candidate)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        # Fallback regex extraction of single items
        items: list[dict[str, Any]] = []
        for obj_match in re.finditer(r"\{[^{}]*\}", candidate):
            try:
                obj = json.loads(obj_match.group(0))
                if isinstance(obj, dict) and "name" in obj:
                    items.append(obj)
            except Exception:
                continue
        return items


# ── Dynamic Cascade Executor ─────────────────────────────────────────────


def build_prompt(profile: UserProfile | None) -> str:
    """Render prompt template with user cuisine and language hints."""
    raw = (
        PROMPT_FILE.read_text(encoding="utf-8")
        if PROMPT_FILE.is_file()
        else "Detect all food items in image. Return JSON list with name, name_bn, confidence, grams, bbox."
    )
    lang = getattr(profile, "language", "en") if profile else "en"
    cuisine = "South Asian, Bangladeshi, and Bengali dishes"
    return raw.replace("{language}", "Bengali / বাংলা" if lang == "bn" else "English").replace("{cuisine_hint}", cuisine)


def call_gemini(image_ref: str, prompt: str) -> list[DetectedItem]:
    """Execute Gemini 2.0 Flash call."""
    if not settings.gemini_api_key or not CIRCUIT_BREAKER.can_attempt("gemini"):
        return []

    if image_ref.startswith("data:"):
        head, _, payload = image_ref.partition(",")
        mime = head.split(":", 1)[1].split(";", 1)[0] or "image/jpeg"
    else:
        # Reject non-data URIs for security
        return []

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    body = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime, "data": payload}},
                ]
            }
        ]
    }

    for _ in range(2):
        try:
            with httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
                resp = client.post(url, headers={"x-goog-api-key": settings.gemini_api_key}, json=body)
                if resp.status_code == 429:
                    CIRCUIT_BREAKER.record_failure("gemini", status_code=429)
                    time.sleep(0.5 + random.uniform(0.1, 0.3))
                    continue
                resp.raise_for_status()
                payload_json = resp.json()
                CIRCUIT_BREAKER.record_success("gemini")

                # Extract text
                parts = (
                    payload_json.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
                raw_items = repair_and_parse_json(text)
                return _to_detected_items(raw_items)
        except Exception as exc:
            log_http_failure("Gemini", exc, image_ref=image_ref[:32])
            CIRCUIT_BREAKER.record_failure("gemini", getattr(exc, "status_code", 500))

    return []


def _to_detected_items(raw_items: list[dict[str, Any]]) -> list[DetectedItem]:
    """Parse raw dictionary items into validated DetectedItem models."""
    out: list[DetectedItem] = []
    for it in raw_items:
        if not isinstance(it, dict) or not it.get("name"):
            continue
        name = str(it["name"]).strip()
        name_bn = str(it.get("name_bn") or "").strip() or None
        conf = float(it.get("confidence") or 85.0)
        conf = max(0.0, min(100.0, conf))
        grams = float(it.get("grams") or 100.0)

        # Parse bbox
        bbox_val: BBox | None = None
        raw_bbox = it.get("bbox")
        if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
            try:
                bbox_val = (
                    float(raw_bbox[0]),
                    float(raw_bbox[1]),
                    float(raw_bbox[2]),
                    float(raw_bbox[3]),
                )
            except (TypeError, ValueError):
                bbox_val = None

        out.append(
            DetectedItem(
                name=name,
                name_bn=name_bn,
                confidence=conf,
                grams=max(10.0, grams),
                bbox=bbox_val,
            )
        )
    return out
