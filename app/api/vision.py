"""Vision pipeline route.

Mirrors `src/lib/api.ts#analyzeMeal`. The frontend passes `image_ref`
(a base64 data URL); the route:

  1. Looks up a SHA-256 digest of `image_ref` in the vector cache. On
     hit, returns cached detections + a `cache-hit` trace stage.
  2. Otherwise calls Gemini and HF sequentially (each only if its key is set)
     and merges via `reconcile.merge`.
  3. Applies `portion.estimate()` to each item.
  4. Persists the merged list to both caches using the digest, then
     returns it. The uploaded image data is not used as a cache key.
  5. If neither provider is configured, returns 503. No sample detections
     are substituted for an uploaded image.

The contract is locked: request shape is `AnalyzeRequest`, response
shape is `AnalyzeResult`. Only the internals change vs. cut (a).
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.auth import get_current_user_optional, require_current_user
from app.cache.sqlite_cache import TTLCache
from app.cache.vector_cache import VectorCache
from app.models.schemas import (
    AnalyzeResult,
    AuthSession,
    DetectedItem,
    PipelineTrace,
    VisionDetectionResult,
)
from app.services import portion as portion_svc
from app.services import reconcile as reconcile_svc
from app.services.gemini_client import GeminiClient
from app.services.groq_client import GroqClient
from app.services.hf_client import HFClient
from app.services.openrouter_client import OpenRouterVisionClient
from app.services.state import PHOTO_UPLOAD_LIMIT, State, get_state
from app.services.trace import make_trace

log = logging.getLogger(__name__)


router = APIRouter(prefix="/api/vision", tags=["vision"])

# Body size cap. A 6 MP JPEG at quality 0.92 base64-encoded is ~1 MB;
# 8 MB gives 8× headroom for larger phone cameras without leaving the
# door open to a 50 MB payload that OOMs the worker.
_MAX_REQUEST_BYTES = 8 * 1024 * 1024


# Process-wide clients. Lazy-instantiated so tests that never call the
# vision route can avoid pulling httpx + chromadb at import time.
_gemini: GeminiClient | None = None
_groq: GroqClient | None = None
_openrouter: OpenRouterVisionClient | None = None
_hf: HFClient | None = None
_vector_cache: VectorCache | None = None
_sqlite_cache: TTLCache | None = None


def _get_gemini() -> GeminiClient:
    global _gemini
    if _gemini is None:
        _gemini = GeminiClient()
    return _gemini


def _get_groq() -> GroqClient:
    global _groq
    if _groq is None:
        _groq = GroqClient()
    return _groq


def _get_openrouter() -> OpenRouterVisionClient:
    global _openrouter
    if _openrouter is None:
        _openrouter = OpenRouterVisionClient()
    return _openrouter


def _get_hf() -> HFClient:
    global _hf
    if _hf is None:
        _hf = HFClient()
    return _hf


def _get_vector_cache() -> VectorCache:
    global _vector_cache
    if _vector_cache is None:
        _vector_cache = VectorCache()
    return _vector_cache


def _get_sqlite_cache() -> TTLCache:
    global _sqlite_cache
    if _sqlite_cache is None:
        path = Path(os.environ.get("SQLITE_CACHE_PATH", "app/cache/cache.db"))
        _sqlite_cache = TTLCache(path)
    return _sqlite_cache


def _reset_for_tests() -> None:
    """Drop the cached clients so the next call recreates them with
    whatever env vars are in scope. Test-only — do not call from prod."""
    global _gemini, _groq, _openrouter, _hf, _vector_cache, _sqlite_cache
    if _gemini is not None:
        _gemini.close()
    if _groq is not None:
        _groq.close()
    if _openrouter is not None:
        _openrouter.close()
    if _hf is not None:
        _hf.close()
    _gemini = _groq = _openrouter = _hf = None
    _vector_cache = None
    _sqlite_cache = None


# Vision cache TTL (default 7d). Falls back to the canonical env var.
def _vision_ttl_s() -> int:
    raw = os.environ.get("VISION_CACHE_TTL", "")
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return 7 * 24 * 60 * 60


def _cache_key(image_ref: str) -> str:
    """Namespace live-analysis cache entries away from earlier demo fixtures."""
    return hashlib.sha256(f"live-vision-v1:{image_ref}".encode()).hexdigest()


class AnalyzeRequest(BaseModel):
    """Request body for `analyze_meal`."""

    image_ref: str
    upload_id: str | None = Field(default=None, min_length=8, max_length=100)
    image_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class PhotoUploadQuotaRequest(BaseModel):
    upload_id: str = Field(min_length=8, max_length=100)
    image_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


def _reserve_photo_upload(
    state: State,
    user: AuthSession,
    upload_id: str,
    image_hash: str,
) -> dict[str, object]:
    allowed, reset_at, remaining = state.reserve_photo_upload(user.email, upload_id, image_hash)
    reset_at_utc = reset_at.astimezone(UTC)
    reset_at_text = reset_at_utc.isoformat().replace("+00:00", "Z")
    if not allowed:
        retry_after = max(1, math.ceil((reset_at_utc - datetime.now(UTC)).total_seconds()))
        reset_message = "one hour" if retry_after >= 55 * 60 else f"{math.ceil(retry_after / 60)} minutes"
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "photo_upload_limit_reached",
                "limit": PHOTO_UPLOAD_LIMIT,
                "reset_at": reset_at_text,
                "message": (
                    f"You’ve reached the limit of {PHOTO_UPLOAD_LIMIT} photo uploads per hour. "
                    f"You can upload again when your limit resets in {reset_message}. "
                    "Paid plans are coming soon."
                ),
            },
            headers={"Retry-After": str(retry_after)},
        )
    return {
        "limit": PHOTO_UPLOAD_LIMIT,
        "remaining": remaining,
        "reset_at": reset_at_text,
    }


@router.post("/quota")
def reserve_photo_upload(
    body: PhotoUploadQuotaRequest,
    user: AuthSession = Depends(require_current_user),  # noqa: B008
    state: State = Depends(get_state),  # noqa: B008
) -> dict[str, object]:
    """Reserve a photo upload for the signed-in user before local or hosted AI runs."""
    return _reserve_photo_upload(state, user, body.upload_id, body.image_hash)


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze_meal(
    request: Request,
    body: AnalyzeRequest,
    user: AuthSession | None = Depends(get_current_user_optional),  # noqa: B008
    state: State = Depends(get_state),  # noqa: B008
) -> AnalyzeResult:
    """Vision pipeline — see module docstring for the full flow.

    A request-body size cap is enforced before we touch any cache or
    external client. A 50 MB data-URL payload can OOM the worker, so
    we reject with 413 long before the Gemini call goes out.
    """
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            length = 0
        if length > _MAX_REQUEST_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"Request body {length} bytes exceeds the {_MAX_REQUEST_BYTES}-byte cap. "
                    "Send a smaller image or switch to multipart upload."
                ),
            )

    if user is not None:
        actual_image_hash = hashlib.sha256(body.image_ref.encode()).hexdigest()
        if body.image_hash is not None and body.image_hash != actual_image_hash:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Photo upload hash does not match the submitted image.",
            )
        _reserve_photo_upload(
            state,
            user,
            body.upload_id or str(uuid.uuid4()),
            actual_image_hash,
        )

    pipeline: list[PipelineTrace] = [
        make_trace("cache-check", "Cache check", "running"),
    ]
    cache_key = _cache_key(body.image_ref)
    gemini = _get_gemini()
    groq = _get_groq()
    openrouter = _get_openrouter()
    hf = _get_hf()
    if (
        not gemini.is_configured()
        and not groq.is_configured()
        and not openrouter.is_configured()
        and not hf.is_configured()
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No vision provider is configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY.",
        )

    # 1. Vector cache (ChromaDB) — fast path, with SQLite TTL fallback
    vector_cache = _get_vector_cache()
    cached: list[DetectedItem] | None = None
    if vector_cache.has(cache_key):
        cached = vector_cache.get(cache_key)

    if not cached:
        try:
            raw_sqlite = _get_sqlite_cache().get(("vision", cache_key))
            if raw_sqlite:
                cached = [DetectedItem.model_validate(x) for x in raw_sqlite]
        except Exception:
            pass

    if cached:
        pipeline[0].status = "cache-hit"
        pipeline.extend(
            [
                make_trace("vision-id", "Vision ID (cached)", "cache-hit"),
                make_trace("hf-validate", "HF validator (cached)", "cache-hit"),
                make_trace("reconcile", "Reconcile (cached)", "cache-hit"),
            ]
        )
        return AnalyzeResult(detected=cached, pipeline=pipeline)
    pipeline[0].status = "done"

    # 2. Multi-Provider Cascade Pipeline: Groq (Fastest) -> Gemini (Primary) -> OpenRouter -> Gemini (Fallback) -> HF.
    detected_items: list[DetectedItem] = []
    primary_stage_label = "Vision ID (Groq)"
    vision_meta: VisionDetectionResult | None = None
    explicit_rejection: VisionDetectionResult | None = None

    def _eval_provider_result(
        res: VisionDetectionResult | None,
        label: str,
    ) -> bool:
        nonlocal vision_meta, detected_items, explicit_rejection, primary_stage_label
        if res is None:
            return False

        # Check explicit rejection (either non-food or blurry low-confidence photo)
        if (res.is_food is False and res.overall_confidence >= 0.60) or (
            res.overall_confidence < 0.45 and bool(res.rejection_reason_en)
        ):
            explicit_rejection = explicit_rejection or res
            return False

        # Check positive success (either detected food items or restaurant menu items)
        if res.is_food and res.overall_confidence >= 0.45:
            if res.detected or (res.input_mode == "restaurant_menu" and res.menu_analysis):
                vision_meta = res
                detected_items = res.detected
                explicit_rejection = None
                primary_stage_label = label
                return True

        return False

    # Tier 1: Groq Vision (Fastest LPU inference)
    if groq.is_configured():
        try:
            if hasattr(groq, "detect_vision"):
                res = groq.detect_vision(body.image_ref)
                _eval_provider_result(res, "Vision ID (Groq)")
            elif hasattr(groq, "detect"):
                items = groq.detect(body.image_ref)
                if items:
                    detected_items = items
                    vision_meta = VisionDetectionResult(detected=items, is_food=True, overall_confidence=0.85)
                    primary_stage_label = "Vision ID (Groq)"
        except Exception as exc:
            log.warning("Groq vision stage failed: %s; cascading...", exc)

    # Tier 2: Google Gemini (Primary 2.0 Flash)
    has_success = bool(detected_items or (vision_meta and vision_meta.input_mode == "restaurant_menu"))
    if not has_success and gemini.is_configured():
        try:
            if hasattr(gemini, "detect_vision"):
                res = gemini.detect_vision(body.image_ref)
                _eval_provider_result(res, "Vision ID (Gemini 2.0 Flash)")
            elif hasattr(gemini, "detect"):
                items = gemini.detect(body.image_ref)
                if items:
                    detected_items = items
                    vision_meta = VisionDetectionResult(detected=items, is_food=True, overall_confidence=0.85)
                    explicit_rejection = None
                    primary_stage_label = "Vision ID (Gemini 2.0 Flash)"
        except Exception as exc:
            log.warning("Gemini primary vision stage failed: %s; cascading...", exc)

    # Tier 3: OpenRouter Vision (Free Multimodal Cascade)
    has_success = bool(detected_items or (vision_meta and vision_meta.input_mode == "restaurant_menu"))
    if not has_success and openrouter.is_configured():
        try:
            if hasattr(openrouter, "detect_vision"):
                res = openrouter.detect_vision(body.image_ref)
                _eval_provider_result(res, "Vision ID (OpenRouter cascaded)")
            elif hasattr(openrouter, "detect"):
                items = openrouter.detect(body.image_ref)
                if items:
                    detected_items = items
                    vision_meta = VisionDetectionResult(detected=items, is_food=True, overall_confidence=0.85)
                    explicit_rejection = None
                    primary_stage_label = "Vision ID (OpenRouter cascaded)"
        except Exception as exc:
            log.warning("OpenRouter vision stage failed: %s; cascading...", exc)

    # Tier 4: Google Gemini Secondary Fallback (1.5 Flash / 1.5 Flash-8B with separate quota)
    has_success = bool(detected_items or (vision_meta and vision_meta.input_mode == "restaurant_menu"))
    if not has_success and gemini.is_configured():
        try:
            if hasattr(gemini, "detect_vision"):
                res = gemini.detect_vision(body.image_ref, model_override="gemini-1.5-flash-8b")
                if res is None:
                    res = gemini.detect_vision(body.image_ref, model_override="gemini-1.5-flash")
                _eval_provider_result(res, "Vision ID (Gemini 1.5 Fallback)")
        except Exception as exc:
            log.warning("Gemini secondary fallback failed: %s; cascading to HF...", exc)

    # 3. Explicit Non-Food / Blurry Safety Gate (Pre-Cache Filter)
    has_success = bool(detected_items or (vision_meta and vision_meta.input_mode == "restaurant_menu"))
    if not has_success and explicit_rejection is not None:
        is_non_food = not explicit_rejection.is_food
        pipeline.extend(
            [
                make_trace(
                    "vision-id",
                    "Safety Gate (Non-food item)" if is_non_food else "Safety Gate (Low confidence)",
                    "fallback",
                ),
                make_trace("hf-validate", "HF validator (bypassed)", "fallback"),
                make_trace("reconcile", "Reconcile (bypassed)", "fallback"),
            ]
        )
        return AnalyzeResult(
            detected=[],
            pipeline=pipeline,
            is_food=False,
            input_mode=explicit_rejection.input_mode,
            overall_confidence=explicit_rejection.overall_confidence,
            rejection_reason_en=explicit_rejection.rejection_reason_en
            or "No food detected in this photo. Please retake photo with food or ingredients.",
            rejection_reason_bn=explicit_rejection.rejection_reason_bn
            or "এই ছবিতে কোনো খাবার বা উপাদান শনাক্ত করা যায়নি। অনুগ্রহ করে কোনো খাবারের ছবি তুলুন।",
        )

    hf_labels = hf.classify(body.image_ref) if hf.is_configured() else []

    if detected_items or hf_labels or (vision_meta and vision_meta.input_mode == "restaurant_menu" and vision_meta.menu_analysis):
        merged = reconcile_svc.merge(detected_items, hf_labels)
        detected = [portion_svc.estimate(it) for it in merged]
        pipeline.extend(
            [
                make_trace(
                    "vision-id",
                    primary_stage_label,
                    "done" if (detected_items or (vision_meta and vision_meta.menu_analysis)) else "fallback",
                ),
                make_trace(
                    "hf-validate",
                    "HF validator",
                    "done" if hf_labels else "fallback",
                ),
                make_trace(
                    "reconcile",
                    "Confidence-weighted reconcile",
                    "done" if detected_items and hf_labels else "fallback",
                ),
            ]
        )
    else:
        # All providers failed or were unavailable (network error / API quota issue)
        pipeline.extend(
            [
                make_trace("vision-id", "Vision ID (Provider failure)", "fallback"),
                make_trace("hf-validate", "HF validator (bypassed)", "fallback"),
                make_trace("reconcile", "Reconcile (bypassed)", "fallback"),
            ]
        )
        return AnalyzeResult(
            detected=[],
            pipeline=pipeline,
            is_food=False,
            input_mode="cooked_meal",
            overall_confidence=0.0,
            rejection_reason_en="Vision analysis service is temporarily busy or connection failed. Please check your network and try again.",
            rejection_reason_bn="ভিশন এআই সার্ভিস এই মুহূর্তে ব্যস্ত বা সংযোগ বিচ্ছিন্ন। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।",
        )

    detected = [d.model_copy(deep=True) for d in detected]

    # 4. Persist so the next request for the same image_ref short-circuits.
    if detected:
        try:
            vector_cache.put(cache_key, detected)
        except Exception:  # noqa: BLE001 — cache writes must never 500 the route
            pass
        try:
            _get_sqlite_cache().put(
                ("vision", cache_key),
                [d.model_dump() for d in detected],
                ttl_s=_vision_ttl_s(),
            )
        except Exception:  # noqa: BLE001
            pass

    return AnalyzeResult(
        detected=detected,
        pipeline=pipeline,
        is_food=True,
        input_mode=vision_meta.input_mode if vision_meta else "cooked_meal",
        overall_confidence=vision_meta.overall_confidence if vision_meta else 0.85,
        rejection_reason_en=None,
        rejection_reason_bn=None,
        inferred_hidden_ingredients=vision_meta.inferred_hidden_ingredients if vision_meta else [],
        recipe_suggestions=vision_meta.recipe_suggestions if vision_meta else None,
        menu_analysis=vision_meta.menu_analysis if vision_meta else None,
    )


# Re-exported for test fixtures.
__all__ = ["router", "AnalyzeRequest", "AnalyzeResult", "_reset_for_tests", "_get_gemini", "_get_groq", "_get_openrouter", "_get_hf"]
