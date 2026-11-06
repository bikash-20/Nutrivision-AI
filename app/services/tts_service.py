"""Text-to-Speech (TTS) Service using ElevenLabs with ultra-low latency & zero-crash fallback.

Features:
- Configurable model (ELEVENLABS_MODEL_ID), defaulting to `eleven_flash_v2_5` for ~75ms TTFA.
- In-memory LRU cache for frequent greetings and short phrases to conserve character quota.
- Clean text sanitizer ensuring speech output is stripped of Markdown, asterisks, emojis, and KaTeX.
- Graceful degradation: If ElevenLabs API key is absent, depleted, or fails, gracefully signals
  `use_browser_tts = True` without raising 500 errors.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
from typing import Any

import httpx

log = logging.getLogger(__name__)

ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech"

# Guaranteed Premade ElevenLabs Voice IDs (available on Free Tier API keys)
PREMADE_MALE_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"   # George (warm, authoritative, clinical / Dr. Susmit & Farhan)
PREMADE_FEMALE_VOICE_ID = "EXAVITQu4vr4xnSDxMaL" # Sarah (optional female override)
DEFAULT_VOICE_ID = PREMADE_MALE_VOICE_ID

# Known legacy library voice IDs blocked on Free Tier with HTTP 402 ("Free users cannot use library voices")
LEGACY_LIBRARY_VOICE_IDS = {
    "21m00Tcm4TlvDq8ikWAM",  # Rachel (legacy library voice)
    "AZnzlk1XvdvUeBnXmlld",  # Domi
    "EXAVITQu4vr4xnSDxMaK",
}

DEFAULT_MODEL_ID = "eleven_flash_v2_5"  # ~75ms TTFA, 50% cheaper character cost
MULTILINGUAL_MODEL_ID = "eleven_multilingual_v2"  # Full native Bengali script support

# Max items stored in memory
MAX_CACHE_SIZE = 128


def _is_library_voice_error(status_code: int, err_detail: str, voice_id: str) -> bool:
    """Check if ElevenLabs rejected the request due to Free tier library voice restrictions."""
    if voice_id in LEGACY_LIBRARY_VOICE_IDS:
        return True
    if status_code in (400, 402):
        lower = err_detail.lower()
        if any(term in lower for term in ("library voice", "library voices", "voice_not_found", "free user", "cannot use")):
            return True
        if status_code == 402:
            return True
    return False


def _run_async_in_thread(coro_fn: Any, timeout: float = 6.0) -> Any:
    """Run an async coroutine inside an isolated thread with its own event loop."""
    import asyncio
    import concurrent.futures

    def _worker():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(asyncio.wait_for(coro_fn(), timeout=timeout))
        finally:
            loop.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_worker)
        return future.result(timeout=timeout + 1.0)


def sanitize_for_speech(text: str) -> str:
    """Strip Markdown, asterisks, bullet points, emojis, URLs, and KaTeX notations for clean TTS audio."""
    if not text:
        return ""

    cleaned = text.strip()

    # If response includes dual-channel delimiter, extract the voice summary portion
    if "===VOICE_SUMMARY===" in cleaned:
        cleaned = cleaned.split("===VOICE_SUMMARY===", 1)[1].strip()

    # Remove URLs
    cleaned = re.sub(r"https?://\S+|www\.\S+", "", cleaned)

    # Remove Markdown links [Label](url) -> Label
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)

    # Remove KaTeX block math $$...$$ and inline $...$ or \(...\)
    cleaned = re.sub(r"\$\$[^\$]+\$\$", "", cleaned)
    cleaned = re.sub(r"\$[^\$]+\$", "", cleaned)
    cleaned = re.sub(r"\\\([^\)]+\\\)", "", cleaned)
    cleaned = re.sub(r"\\[a-zA-Z]+(\{[^}]*\})?", "", cleaned)

    # Remove markdown formatting characters: *, _, ~, `, #, >, |
    cleaned = re.sub(r"[*_~`#>|]", "", cleaned)

    # Replace bullet markers at start of lines
    cleaned = re.sub(r"^\s*[-•]\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s*", "", cleaned, flags=re.MULTILINE)

    # Strip common emojis (Unicode ranges)
    emoji_pattern = re.compile(
        "["
        "\U0001f600-\U0001f64f"  # emoticons
        "\U0001f300-\U0001f5ff"  # symbols & pictographs
        "\U0001f680-\U0001f6ff"  # transport & map
        "\U0001f1e0-\U0001f1ff"  # flags (iOS)
        "\U00002702-\U000027b0"
        "\U000024c2-\U0001f251"
        "\U0001f900-\U0001f9ff"  # supplemental symbols
        "\U0001fa70-\U0001faff"
        "]+",
        flags=re.UNICODE,
    )
    cleaned = emoji_pattern.sub("", cleaned)

    # Collapse multiple whitespaces and newlines
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Cap to ~350 characters (2 to 3 concise spoken sentences) to keep TTFA under 500ms
    if len(cleaned) > 400:
        sentences = re.split(r"(?<=[.!?।])\s+", cleaned)
        truncated = ""
        for s in sentences:
            if len(truncated) + len(s) < 350:
                truncated += (" " if truncated else "") + s
            else:
                break
        cleaned = truncated or cleaned[:350].rsplit(" ", 1)[0] + "."

    return cleaned


class TTSService:
    """Manages audio generation with ElevenLabs, local caching, and fallback logic."""

    def __init__(
        self,
        api_key: str | None = None,
        voice_id: str | None = None,
        model_id: str | None = None,
    ) -> None:
        self._initial_api_key = api_key
        self._initial_voice_id = voice_id
        self._initial_model_id = model_id
        self._cache: dict[str, bytes] = {}
        self._lock = threading.Lock()

    @property
    def api_key(self) -> str:
        """Dynamic resolution: constructor override -> os.environ -> empty string."""
        if self._initial_api_key is not None:
            return self._initial_api_key.strip()
        return (os.environ.get("ELEVENLABS_API_KEY") or "").strip()

    @api_key.setter
    def api_key(self, val: str | None) -> None:
        self._initial_api_key = val

    @property
    def male_voice_id(self) -> str:
        """Male premade voice for Dr. Susmit & Farhan (George). Can be overridden via ELEVENLABS_VOICE_ID_MALE."""
        return (os.environ.get("ELEVENLABS_VOICE_ID_MALE") or PREMADE_MALE_VOICE_ID).strip()

    @property
    def farhan_voice_id(self) -> str:
        """Voice for Farhan (Habit Coach). Can be overridden via ELEVENLABS_VOICE_ID_FARHAN or defaults to George."""
        return (os.environ.get("ELEVENLABS_VOICE_ID_FARHAN") or os.environ.get("ELEVENLABS_VOICE_ID_MALE") or PREMADE_MALE_VOICE_ID).strip()

    def resolve_voice_id(
        self,
        persona: str | None = None,
        requested_voice_id: str | None = None,
    ) -> str:
        """Resolve ElevenLabs voice ID based on persona, strictly ignoring legacy library voice IDs."""
        # 1. Explicitly requested custom voice ID (if not legacy library voice)
        if requested_voice_id and requested_voice_id not in LEGACY_LIBRARY_VOICE_IDS:
            return requested_voice_id

        p = (persona or "").strip().lower()
        # Farhan (Habit / Behavioral Coach)
        if any(k in p for k in ("farhan", "farhana", "habit", "behavioral", "coach")):
            env_farhan = (os.environ.get("ELEVENLABS_VOICE_ID_FARHAN") or os.environ.get("ELEVENLABS_VOICE_ID_FEMALE") or "").strip()
            if env_farhan and env_farhan not in LEGACY_LIBRARY_VOICE_IDS:
                return env_farhan
            return self.farhan_voice_id

        # Dr. Susmit (Scientist)
        env_voice = (self._initial_voice_id or os.environ.get("ELEVENLABS_VOICE_ID") or "").strip()
        if env_voice and env_voice not in LEGACY_LIBRARY_VOICE_IDS:
            return env_voice

        return self.male_voice_id

    @property
    def voice_id(self) -> str:
        """Default voice ID, falling back to male premade voice."""
        env_voice = (self._initial_voice_id or os.environ.get("ELEVENLABS_VOICE_ID") or "").strip()
        if env_voice and env_voice not in LEGACY_LIBRARY_VOICE_IDS:
            return env_voice
        return self.male_voice_id

    @voice_id.setter
    def voice_id(self, val: str | None) -> None:
        self._initial_voice_id = val

    @property
    def model_id(self) -> str:
        """Dynamic resolution: constructor override -> os.environ -> DEFAULT_MODEL_ID."""
        if self._initial_model_id is not None:
            return self._initial_model_id.strip()
        return (os.environ.get("ELEVENLABS_MODEL_ID") or DEFAULT_MODEL_ID).strip()

    @model_id.setter
    def model_id(self, val: str | None) -> None:
        self._initial_model_id = val

    def _cache_key(
        self,
        text: str,
        voice_id: str,
        model_id: str,
        persona: str | None = None,
    ) -> str:
        norm_persona = (persona or "scientist").strip().lower()
        norm_voice = (voice_id or "").strip()
        norm_model = (model_id or "").strip()
        text_hash = hashlib.md5(text.strip().encode("utf-8")).hexdigest()
        return f"{norm_persona}:{norm_voice}:{norm_model}:{text_hash}"

    def is_configured(self) -> bool:
        """Return True if an ElevenLabs API key is configured."""
        return bool(self.api_key)

    def _resolve_edge_voice(
        self,
        text: str,
        lang: str = "en",
        persona: str | None = None,
    ) -> str:
        """Resolve Microsoft edge-tts neural voice based on persona and script/language.

        - Dr. Susmit (Scientist): Andrew (EN) / Pradeep (BN)
        - Farhan (Habit Coach): Brian (EN) / Pradeep (BN)
        """
        p = (persona or "").strip().lower()
        is_habit = any(k in p for k in ("farhan", "farhana", "habit", "behavioral", "coach"))
        has_bengali_script = bool(re.search(r"[\u0980-\u09FF]", text))

        if has_bengali_script or lang == "bn":
            return "bn-BD-PradeepNeural"
        return "en-US-BrianNeural" if is_habit else "en-US-AndrewNeural"

    def _synthesize_edge_tts(
        self,
        text: str,
        lang: str = "en",
        persona: str | None = None,
        agent_type: str | None = None,
        timeout: float = 6.0,
        **kwargs: Any,
    ) -> bytes | None:
        """Synthesize neural speech using Microsoft Azure Edge voices (zero API key requirement).

        Persona and language matched:
        - Dr. Susmit (Scientist): Bengali: bn-BD-PradeepNeural, English: en-US-AndrewNeural
        - Farhan (Habit Coach): Bengali: bn-BD-PradeepNeural, English: en-US-BrianNeural
        """
        try:
            import edge_tts
        except ImportError:
            log.warning("edge-tts is not installed; cannot perform server-side neural TTS fallback.")
            return None

        effective_p = persona or agent_type or "scientist"
        voice = self._resolve_edge_voice(text, lang=lang, persona=effective_p)

        async def _generate() -> bytes:
            comm = edge_tts.Communicate(text, voice)
            chunks: list[bytes] = []
            async for chunk in comm.stream():
                if chunk.get("type") == "audio":
                    chunks.append(chunk["data"])
            return b"".join(chunks)

        try:
            audio = _run_async_in_thread(_generate, timeout=timeout)
            if audio and len(audio) > 0:
                return audio
        except Exception as exc:
            log.warning("edge-tts neural synthesis failed (%s). Gracefully degrading.", exc)
            return None

        return None

    def synthesize(
        self,
        text: str,
        lang: str = "en",
        voice_id: str | None = None,
        model_id: str | None = None,
        agent_type: str | None = None,
        persona: str | None = None,
        timeout: float = 6.0,
    ) -> tuple[bytes | None, str, bool, str]:
        """Synthesize text into MP3 audio with persona-aware dual-voice resilience.

        Tier 1: ElevenLabs (Male George for Dr. Susmit, Female Sarah for Farhana).
                Auto-retries on HTTP 402/400 using guaranteed premade voices.
        Tier 2: Server-side Neural TTS (edge-tts) matched to Persona gender and Language.
        Tier 3: Graceful browser speech synthesis fallback.

        Returns:
            (audio_bytes, mime_type, use_browser_tts, tts_diagnostic)
        """
        clean_text = sanitize_for_speech(text)
        if not clean_text:
            return None, "audio/mpeg", True, "empty_text"

        effective_persona = persona or agent_type or "scientist"
        elevenlabs_diag: str = ""

        # Check configuration dynamically at request time
        if not self.is_configured():
            log.debug("ElevenLabs API key not set; proceeding to server-side neural edge-tts fallback.")
            elevenlabs_diag = "missing_api_key"
        else:
            active_voice = self.resolve_voice_id(persona=effective_persona, requested_voice_id=voice_id)

            # Automatic language-aware model selection:
            # ElevenLabs Flash v2.5 delivers ultra-low ~75ms TTFA for English, but Bengali script
            # requires eleven_multilingual_v2 for authentic phonetics and pronunciation.
            has_bengali_script = bool(re.search(r"[\u0980-\u09FF]", clean_text))
            active_model = model_id or self.model_id
            if has_bengali_script or lang == "bn":
                if active_model not in (MULTILINGUAL_MODEL_ID, "eleven_v3"):
                    active_model = MULTILINGUAL_MODEL_ID

            ckey = self._cache_key(clean_text, active_voice, active_model, persona=effective_persona)
            with self._lock:
                if ckey in self._cache:
                    log.debug("TTS cache hit for prompt hash %s", ckey[:8])
                    return self._cache[ckey], "audio/mpeg", False, "ok (cache_hit)"

            url = f"{ELEVENLABS_API_URL}/{active_voice}?optimize_streaming_latency=3"
            headers = {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": self.api_key,
            }
            payload = {
                "text": clean_text,
                "model_id": active_model,
                "voice_settings": {
                    "stability": 0.50,
                    "similarity_boost": 0.75,
                    "style": 0.0,
                    "use_speaker_boost": True,
                },
            }

            try:
                with httpx.Client(timeout=timeout) as client:
                    res = client.post(url, headers=headers, json=payload)
                    if res.status_code == 200 and len(res.content) > 0:
                        audio_bytes = res.content
                        with self._lock:
                            if len(self._cache) >= MAX_CACHE_SIZE:
                                self._cache.pop(next(iter(self._cache)))
                            self._cache[ckey] = audio_bytes
                        return audio_bytes, "audio/mpeg", False, "ok"

                    err_detail = ""
                    try:
                        err_json = res.json()
                        detail_val = err_json.get("detail", {})
                        if isinstance(detail_val, dict):
                            err_detail = detail_val.get("message") or str(detail_val)
                        else:
                            err_detail = str(detail_val)
                    except Exception:
                        err_detail = res.text[:200]

                    # Auto-retry on HTTP 402/400 (e.g. Free users cannot use library voices)
                    fallback_premade = self.male_voice_id

                    if _is_library_voice_error(res.status_code, err_detail, active_voice) and active_voice != fallback_premade:
                        log.warning(
                            "ElevenLabs voice '%s' rejected with HTTP %d: %s. Auto-retrying with persona premade voice '%s'.",
                            active_voice,
                            res.status_code,
                            err_detail,
                            fallback_premade,
                        )
                        retry_url = f"{ELEVENLABS_API_URL}/{fallback_premade}?optimize_streaming_latency=3"
                        retry_res = client.post(retry_url, headers=headers, json=payload)
                        if retry_res.status_code == 200 and len(retry_res.content) > 0:
                            audio_bytes = retry_res.content
                            retry_ckey = self._cache_key(clean_text, fallback_premade, active_model, persona=effective_persona)
                            with self._lock:
                                if len(self._cache) >= MAX_CACHE_SIZE:
                                    self._cache.pop(next(iter(self._cache)))
                                self._cache[retry_ckey] = audio_bytes
                                self._cache[ckey] = audio_bytes
                            return audio_bytes, "audio/mpeg", False, "ok (premade_voice_retry)"

                        try:
                            r_json = retry_res.json()
                            d_val = r_json.get("detail", {})
                            err_detail = d_val.get("message") if isinstance(d_val, dict) else str(d_val)
                        except Exception:
                            err_detail = retry_res.text[:200]
                        res_status = retry_res.status_code
                    else:
                        res_status = res.status_code

                    elevenlabs_diag = f"elevenlabs_http_{res_status}: {err_detail}".strip()
                    log.warning(
                        "ElevenLabs TTS returned HTTP %d: %s. Proceeding to server edge-tts fallback.",
                        res_status,
                        err_detail,
                    )
            except Exception as exc:
                elevenlabs_diag = f"elevenlabs_exception: {type(exc).__name__}: {exc}"
                log.warning("ElevenLabs TTS request failed (%s). Proceeding to server edge-tts fallback.", exc)

        # ── Level 2: Server-side Neural TTS Fallback (edge-tts) ───────────────
        edge_voice = self._resolve_edge_voice(clean_text, lang=lang, persona=effective_persona)
        edge_ckey = self._cache_key(clean_text, edge_voice, "edge_tts", persona=effective_persona)
        with self._lock:
            if edge_ckey in self._cache:
                log.debug("TTS edge-tts cache hit for key %s", edge_ckey)
                return self._cache[edge_ckey], "audio/mpeg", False, "ok (cache_hit)"

        edge_audio = self._synthesize_edge_tts(clean_text, lang=lang, persona=effective_persona, timeout=timeout)
        if edge_audio and len(edge_audio) > 0:
            with self._lock:
                if len(self._cache) >= MAX_CACHE_SIZE:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[edge_ckey] = edge_audio
            return edge_audio, "audio/mpeg", False, f"ok (edge_neural_fallback: {elevenlabs_diag})"

        # ── Level 3: Graceful browser speech synthesis fallback ───────────────
        return None, "audio/mpeg", True, f"edge_failed: {elevenlabs_diag}"


# Global singleton instance
_tts_service: TTSService | None = None


def get_tts_service() -> TTSService:
    """Return the global TTSService singleton."""
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
