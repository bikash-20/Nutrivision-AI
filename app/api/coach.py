"""FastAPI router for Multi-Agent AI Coach — Text, Voice, & Database Grounding.

Routes requests to:
  - 🔬 Culinary & Nutrition Scientist (Dr. Susmit - পুষ্টি বিজ্ঞানী)
  - 🧠 Behavioral & Habit Coach (আচরণ ও অভ্যাস কোচ)
Features:
  - Full Postgres grounding (`nv_users`, `nv_meals`, `nv_grocery`, ChromaDB RAG).
  - Single-pass dual-channel output (Markdown UI reply + voice summary).
  - Ultra-low-latency TTS with ElevenLabs and browser speech fallback.
  - Dedicated endpoints:
      POST /api/coach/chat
      POST /api/coach/voice-chat
      POST /api/coach/tts
"""

from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.auth import get_current_user_optional
from app.models.schemas import (
    AuthSession,
    CoachChatRequest,
    CoachChatResponse,
    CoachTTSRequest,
    CoachTTSResponse,
)
from app.services.coach_service import get_coach_service
from app.services.state import State, get_state_optional
from app.services.tts_service import get_tts_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/coach", tags=["coach"])


def _enrich_request_from_db(
    req: CoachChatRequest,
    current_user: AuthSession | None,
    state: State | None,
) -> CoachChatRequest:
    """Null-safe enrichment: Pull real user biometrics, today's meals, and active grocery list from DB."""
    if not current_user or not state:
        return req

    email = current_user.email
    if req.user_profile is None:
        try:
            req.user_profile = state.get_user_profile(email)
        except Exception as exc:
            log.debug("Could not read profile for user %s: %s", email, exc)

    if req.recent_meals is None:
        try:
            req.recent_meals = state.list_user_meals(email)
        except Exception as exc:
            log.debug("Could not read meals for user %s: %s", email, exc)

    if req.grocery_items is None:
        try:
            req.grocery_items = state.list_user_grocery(email)
        except Exception as exc:
            log.debug("Could not read grocery for user %s: %s", email, exc)

    return req


@router.post("/chat", response_model=CoachChatResponse)
def coach_chat(
    req: CoachChatRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
    state: State | None = Depends(get_state_optional),
) -> CoachChatResponse:
    """Send conversation messages to the requested AI Coach persona."""
    if not req.messages and not req.message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Messages list cannot be empty.",
        )
    try:
        enriched_req = _enrich_request_from_db(req, current_user, state)
        service = get_coach_service()
        return service.chat(enriched_req)
    except Exception as exc:
        log.error("AI Coach chat encountered error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Coach error: {exc}",
        ) from exc


@router.post("/voice-chat", response_model=CoachChatResponse)
def coach_voice_chat(
    req: CoachChatRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
    state: State | None = Depends(get_state_optional),
) -> CoachChatResponse:
    """Dual-channel voice chat: Returns detailed UI Markdown + ElevenLabs MP3 voice summary.
    Gracefully degrades to browser speech synthesis if ElevenLabs is unavailable.
    """
    if not req.messages and not req.message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Messages list cannot be empty.",
        )
    try:
        enriched_req = _enrich_request_from_db(req, current_user, state)
        enriched_req.include_audio = True
        service = get_coach_service()
        return service.chat(enriched_req)
    except Exception as exc:
        log.error("AI Coach voice-chat encountered error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI Coach error: {exc}",
        ) from exc


@router.post("/tts", response_model=CoachTTSResponse)
def coach_tts(req: CoachTTSRequest) -> CoachTTSResponse:
    """Generate spoken audio for text via ElevenLabs. Zero-crash graceful fallback on error."""
    if not req.text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text cannot be empty.",
        )
    try:
        tts = get_tts_service()
        audio_bytes, mime, fallback, diag = tts.synthesize(
            text=req.text,
            lang=req.lang or "en",
            voice_id=req.voice_id,
            persona=req.persona,
        )
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else None
        return CoachTTSResponse(
            audio_base64=audio_b64,
            audio_mime_type=mime,
            use_browser_tts=fallback,
            tts_diagnostic=diag,
        )
    except Exception as exc:
        log.warning("TTS generation encountered error: %s. Falling back to browser TTS.", exc)
        return CoachTTSResponse(
            audio_base64=None,
            audio_mime_type="audio/mpeg",
            use_browser_tts=True,
            tts_diagnostic=f"exception: {exc}",
        )
