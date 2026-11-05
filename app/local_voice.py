"""Optional, loopback-only Whisper and local TTS service for the PWA."""

from __future__ import annotations

import asyncio
import base64
import io
import os
import threading
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

MAX_AUDIO_BYTES = 25 * 1024 * 1024
SUPPORTED_TTS_LANGUAGES = {
    "English", "Chinese", "Japanese", "Korean", "German",
    "French", "Russian", "Portuguese", "Spanish", "Italian",
}
_whisper: Any = None
_qwen3_tts: Any = None
_piper: Any = None
_whisper_error: str | None = None
_qwen3_tts_error: str | None = None
_piper_error: str | None = None
_whisper_lock = threading.Lock()
_qwen3_tts_lock = threading.Lock()
_piper_lock = threading.Lock()


def _configured_model_path(name: str) -> Path | None:
    configured = os.environ.get(name)
    if not configured:
        return None
    path = Path(configured).expanduser().resolve()
    if not path.is_dir():
        raise RuntimeError(f"{name} must point to an existing local model directory.")
    return path


def _load_whisper() -> None:
    global _whisper, _whisper_error
    try:
        model_path = _configured_model_path("WHISPER_MODEL_PATH")
        if model_path is None:
            return
        from faster_whisper import WhisperModel

        _whisper = WhisperModel(
            str(model_path),
            device=os.environ.get("WHISPER_DEVICE", "cpu"),
            compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        )
    except Exception as error:
        _whisper_error = f"Whisper could not be loaded: {error}"


def _load_tts() -> None:
    global _qwen3_tts, _qwen3_tts_error
    try:
        model_path = _configured_model_path("QWEN3_TTS_MODEL_PATH")
        if model_path is None:
            return
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import torch
        from qwen_tts import Qwen3TTSModel

        _qwen3_tts = Qwen3TTSModel.from_pretrained(
            str(model_path),
            device_map=os.environ.get("QWEN3_TTS_DEVICE", "cpu"),
            dtype=torch.float32,
            local_files_only=True,
        )
    except Exception as error:
        _qwen3_tts_error = f"Qwen3-TTS could not be loaded: {error}"


def _load_piper() -> None:
    global _piper, _piper_error
    try:
        configured = os.environ.get("PIPER_VOICE_PATH")
        if not configured:
            return
        model_path = Path(configured).expanduser().resolve()
        if not model_path.is_file():
            raise RuntimeError("PIPER_VOICE_PATH must point to a local Piper .onnx voice file.")
        config_value = os.environ.get("PIPER_CONFIG_PATH")
        config_path = Path(config_value).expanduser().resolve() if config_value else None
        if config_path and not config_path.is_file():
            raise RuntimeError("PIPER_CONFIG_PATH must point to an existing local voice .onnx.json file.")
        from piper import PiperVoice

        _piper = PiperVoice.load(
            str(model_path),
            config_path=str(config_path) if config_path else None,
        )
    except Exception as error:
        _piper_error = f"Piper could not be loaded: {error}"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.gather(
        asyncio.to_thread(_load_whisper),
        asyncio.to_thread(_load_tts),
        asyncio.to_thread(_load_piper),
    )
    yield


app = FastAPI(title="NutriVision Local Voice", lifespan=lifespan)
allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "NUTRIVISION_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _status() -> dict[str, Any]:
    whisper_ready = _whisper is not None
    qwen3_ready = _qwen3_tts is not None
    piper_ready = _piper is not None
    tts_ready = qwen3_ready or piper_ready
    errors = [error for error in (_whisper_error, _qwen3_tts_error, _piper_error) if error]
    return {
        "available": whisper_ready and tts_ready,
        "whisper": whisper_ready,
        "tts": tts_ready,
        "whisperModel": whisper_ready,
        "ttsModel": tts_ready,
        "piper": piper_ready,
        "piperModel": piper_ready,
        "qwen3Tts": qwen3_ready,
        "qwen3TtsModel": qwen3_ready,
        "error": "; ".join(errors) if errors else None,
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return _status()


class SpeakRequest(BaseModel):
    text: str
    language: str
    provider: str = "qwen3"


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
) -> dict[str, str]:
    if _whisper is None:
        raise HTTPException(
            status_code=503,
            detail=_whisper_error or "Whisper is unavailable. Configure WHISPER_MODEL_PATH and restart the service.",
        )
    if language not in {"en", "bn"}:
        raise HTTPException(status_code=422, detail="Only English (en) and Bengali (bn) transcription are configured.")

    content = await audio.read(MAX_AUDIO_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded audio is empty.")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio recordings must be 25 MB or smaller.")

    temp_path: str | None = None
    try:
        with NamedTemporaryFile(suffix=".webm", delete=False) as temp_audio:
            temp_audio.write(content)
            temp_path = temp_audio.name

        def run_transcription() -> str:
            with _whisper_lock:
                segments, _ = _whisper.transcribe(
                    temp_path,
                    language=language,
                    vad_filter=True,
                )
                return " ".join(segment.text.strip() for segment in segments).strip()

        text = await run_in_threadpool(run_transcription)
        return {"text": text}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Local Whisper transcription failed: {error}") from error
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


@app.post("/speak")
async def speak(request: SpeakRequest) -> dict[str, str]:
    if request.provider not in {"piper", "qwen3"}:
        raise HTTPException(status_code=422, detail="Choose either 'piper' or 'qwen3' as the speech provider.")
    language = request.language.strip()
    if request.provider == "qwen3" and language not in SUPPORTED_TTS_LANGUAGES:
        choices = ", ".join(sorted(SUPPORTED_TTS_LANGUAGES))
        raise HTTPException(
            status_code=422,
            detail=f"Qwen3-TTS does not support {language!r} in this runtime. Supported languages: {choices}.",
        )
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text to speak must not be empty.")
    if len(text) > 4000:
        raise HTTPException(status_code=413, detail="Text to speak must be 4,000 characters or fewer.")

    if request.provider == "piper" and _piper is None:
        raise HTTPException(
            status_code=503,
            detail=_piper_error or "Piper is unavailable. Configure PIPER_VOICE_PATH and restart the service.",
        )
    if request.provider == "qwen3" and _qwen3_tts is None:
        raise HTTPException(
            status_code=503,
            detail=_qwen3_tts_error or "Qwen3-TTS is unavailable. Configure QWEN3_TTS_MODEL_PATH and restart the service.",
        )

    try:
        def synthesize_qwen3() -> bytes:
            with _qwen3_tts_lock:
                waveforms, sample_rate = _qwen3_tts.generate_voice_design(
                    text=text,
                    language=language,
                    instruct="Speak clearly and naturally.",
                )
                import soundfile

                audio_buffer = io.BytesIO()
                soundfile.write(audio_buffer, waveforms[0], sample_rate, format="WAV")
                return audio_buffer.getvalue()

        def synthesize_piper() -> bytes:
            with _piper_lock:
                audio_buffer = io.BytesIO()
                with wave.open(audio_buffer, "wb") as wav_file:
                    _piper.synthesize(text, wav_file)
                return audio_buffer.getvalue()

        audio_bytes = await run_in_threadpool(
            synthesize_piper if request.provider == "piper" else synthesize_qwen3
        )
    except Exception as error:
        provider_name = "Piper" if request.provider == "piper" else "Qwen3-TTS"
        raise HTTPException(status_code=500, detail=f"Local {provider_name} synthesis failed: {error}") from error

    return {
        "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
        "mime_type": "audio/wav",
    }
