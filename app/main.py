"""FastAPI entrypoint — `uvicorn app.main:app --reload`.

Wires the routers, sets CORS for the local frontend (Vite dev server),
and resolves the state-file path from `STATE_PATH` (default
`app/state.json`).

Run locally:
    cd nutrivision-demo/app
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

Open http://localhost:8000/docs for the auto-generated Swagger UI.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, coach, grocery, market, meals, nutrition, profile, rag, vision
from app.services.state import get_photo_upload_limit, get_state, init_state


def _load_env() -> None:
    """Best-effort loader for local .env files (app/.env or root .env)."""
    cwd = Path.cwd().resolve()
    candidates = [
        cwd / "app" / ".env",
        cwd / ".env",
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]
    for p in candidates:
        if p.is_file():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
            except Exception:
                pass


os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
_load_env()
# Ensure ChromaDB telemetry is disabled even if loaded after .env
os.environ["ANONYMIZED_TELEMETRY"] = "False"


def _state_path() -> Path:
    """Resolve the JSON-file path backing the in-memory state store.

    `STATE_PATH` is resolved relative to CWD when it isn't absolute —
    so `STATE_PATH=app/state.json` (the default in `.env.example`)
    works whether the user runs uvicorn from the repo root or from
    inside the `app/` directory.
    """
    raw = os.environ.get("STATE_PATH", "app/state.json")
    p = Path(raw)
    if not p.is_absolute():
        # Walk upward until we find a directory that already contains
        # `app/` — that's the repo root when running from `app/`.
        cwd = Path.cwd().resolve()
        for candidate in (cwd, *cwd.parents):
            if (candidate / "app").is_dir():
                p = (candidate / raw).resolve()
                break
        else:
            p = (cwd / raw).resolve()
    return p


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize the state singleton and ensure RAG collections on startup."""
    path = _state_path()
    init_state(path)

    # Warmup RAG lazily in a background task after yield so uvicorn binds $PORT immediately
    async def _lazy_rag_warmup() -> None:
        try:
            import asyncio
            await asyncio.sleep(0.1)
            from app.services.rag_service import get_rag_service

            await asyncio.to_thread(get_rag_service().ensure_collections)
        except Exception as exc:
            import logging
            logging.getLogger("app.main").warning("Async RAG warmup encountered error: %s", exc)

    import asyncio
    warmup_task = asyncio.create_task(_lazy_rag_warmup())
    try:
        yield
    finally:
        if not warmup_task.done():
            warmup_task.cancel()


def _cors_origins() -> list[str]:
    """Read CORS allow-list from `CORS_ALLOW_ORIGINS` (comma-separated).
    Default keeps local Vite dev and production Vercel frontend working."""
    raw = os.environ.get("CORS_ALLOW_ORIGINS", "").strip()
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "https://cloud-camp-hackathon.vercel.app",
    ]
    if raw:
        for o in raw.split(","):
            cleaned = o.strip()
            if cleaned and cleaned not in origins:
                origins.append(cleaned)
    return origins


def create_app() -> FastAPI:
    """Build the FastAPI app. Factored out so tests can instantiate
    it with a fresh state file via `app.dependency_overrides`."""
    get_photo_upload_limit()
    from app.api.auth import _jwt_secret

    _jwt_secret()
    app = FastAPI(
        title="NutriVision AI backend",
        version="0.1.0",
        description=(
            "FastAPI backend for meal vision, nutrition, profile, grocery, "
            "and meal APIs. Gemini and Hugging Face vision providers are "
            "used when their server-side credentials are configured."
        ),
        lifespan=lifespan,
    )

    # CORS — env-driven so a production deploy can add additional origins
    # without a code change. Default includes local Vite dev and Vercel domains.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(vision.router)
    app.include_router(nutrition.router)
    app.include_router(profile.router)
    app.include_router(grocery.router)
    app.include_router(meals.router)
    app.include_router(rag.router)
    app.include_router(coach.router)
    app.include_router(market.router)

    @app.get("/", tags=["meta"])
    def root() -> dict[str, str]:
        """Tiny index — the real value is at /docs."""
        return {
            "service": "nutrivision-backend",
            "docs": "/docs",
        }

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        """Liveness endpoint used by the hosting platform."""
        from fastapi.responses import JSONResponse

        state = get_state()
        if not state.is_healthy:
            return JSONResponse(status_code=503, content={"status": "degraded"})
        return {"status": "ok"}

    @app.get("/api/health", tags=["meta"])
    def api_health():
        """Public health endpoint reporting storage backend and DB connection health."""
        from fastapi.responses import JSONResponse

        state = get_state()
        info = state.get_health_status()
        if info.get("status") != "ok":
            return JSONResponse(status_code=503, content=info)
        return info

    return app


app = create_app()