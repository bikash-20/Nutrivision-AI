# NutriVision AI Backend

High-performance FastAPI backend service powering NutriVision AI's vision-to-market loop, clinical nutrition engine, and administration intelligence.

Built with Python 3.11+, Pydantic v2, PostgreSQL (`psycopg 3`), ChromaDB vector caching, and multi-tier vision cascades.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │  FastAPI Application (app.main:app)          │
                      └──────────────────────┬───────────────────────┘
                                             │
      ┌────────────────┬─────────────────────┼─────────────────────┬─────────────────┐
      │                │                     │                     │                 │
      ▼                ▼                     ▼                     ▼                 ▼
 ┌──────────┐   ┌──────────────┐      ┌──────────────┐      ┌─────────────┐    ┌──────────┐
 │ /api/auth│   │ /api/vision  │      │/api/nutrition│      │ /api/admin  │    │/api/meals│
 │  (Google │   │ (Groq/Gemini/│      │ (BMR/TDEE/   │      │(Telemetry/  │    │  (CRUD/  │
 │   OAuth) │   │  OpenRouter) │      │  AMDR/USDA)  │      │ Audit/Queue)│    │  Stats)  │
 └────┬─────┘   └──────┬───────┘      └──────┬───────┘      └──────┬──────┘    └────┬─────┘
      │                │                     │                     │                │
      └────────────────┴─────────────────────┼─────────────────────┴────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │ State & Persistence (app/services/state.py)  │
                      ├──────────────────────────────────────────────┤
                      │ • Neon / PostgreSQL (`psycopg 3` pool)       │
                      │   - DDL Auto-migration (nv_users, nv_meals,  │
                      │     nv_grocery)                              │
                      │   - Channel binding (`SCRAM-SHA-256-PLUS`)   │
                      │   - Transaction pooler (`prepare_threshold`) │
                      │ • Multi-user isolated tenant partitions     │
                      │ • Local JSON state fallback (`state.json`)   │
                      └──────────────────────────────────────────────┘
```

---

## Core Capabilities

1. **Google OAuth 2.0 & Session Management (`/api/auth/*`)**
   - Direct verification of Google Identity Services ID tokens via Google public JWKS.
   - Signs and verifies secure session JWTs (`Authorization: Bearer <token>`).
   - Role evaluation based on `ADMIN_EMAILS` environment configuration.
   - Clean empty state for new user onboarding (0 fake meals, 0 fake stats).

2. **Multi-Tier Vision Cascade (`/api/vision/analyze`)**
   - Tier 1: **Groq Vision** (LPU ultra-fast inference ~400ms).
   - Tier 2: **Google Gemini 2.0 Flash** (Primary high-accuracy multimodal engine).
   - Tier 3: **OpenRouter Vision** (Free cascade fallback).
   - Tier 4: **Gemini 1.5 Flash** (Resilience fallback).
   - Tier 5: **Hugging Face** (Optional label verification).
   - Semantic exact-digest caching via ChromaDB and SQLite TTL.

3. **Clinical Nutrition & Target Engine (`/api/nutrition/*`)**
   - Dynamic BMR/TDEE calculation via Mifflin-St Jeor equation.
   - AMDR splits for standard, diabetic, high-protein, and renal conditions.
   - Multi-source resolution: Local Bangladeshi Composition DB $\rightarrow$ Open Food Facts $\rightarrow$ USDA FoodData Central $\rightarrow$ Fruityvice.

4. **Dynamic Admin Intelligence (`/api/admin/*`)**
   - `GET /api/admin/metrics`: Real-time system telemetry, active users, 7-day meal volume sparkline, and real-denominator flagged ratios.
   - `GET /api/admin/users`: Searchable and sortable multi-user directory with streak and recent meal inspection.
   - `GET /api/admin/popular-foods`: Ranked food frequency with date-range filters (`today`, `7d`, `30d`, `all`).
   - `GET /api/admin/review-queue` & `PATCH`: Low-confidence (<70%) audit queue with Approve, Correct, and Dismiss workflows.

5. **Dual-Mode Multi-Tenant Persistence (`app/services/state.py`)**
   - When `DATABASE_URL` is set, connects to PostgreSQL using `psycopg 3` (`psycopg[binary]`).
   - Full support for Neon pooled endpoints (`-pooler`) and `channel_binding=require`.
   - Disables server-side prepared statements (`prepare_threshold=None`) for 100% PgBouncer transaction-pooling compatibility.
   - Automatically migrates database tables on boot: `nv_users`, `nv_meals`, and `nv_grocery`.
   - Automatic startup purge ensures legacy synthetic/demo accounts are eliminated.

6. **Multi-Agent AI Voice Assistant & 3-Tier TTS Engine (`/api/coach/*`)**
   - `POST /api/coach/voice-chat`: Single-pass dual-channel endpoint delivering formatted markdown UI advice alongside a concise spoken summary (`voice_summary`, <60 words) and synthesized MP3 audio.
   - `POST /api/coach/tts`: On-demand text-to-speech audio synthesis for the `🔊 Listen` button.
   - **Live Database Grounding:** Automatically compiles active user biometrics (`nv_users`), today's meal calorie/macro trajectory (`nv_meals`), and active pantry items (`nv_grocery`) from PostgreSQL.
   - **Persona-Aware Dual-Voice Routing:** Dr. Susmit (`scientist` / male) uses `JBFqnCBsd6RMkjVDRZzb` (George), and Farhan (`habit` / male) uses `JBFqnCBsd6RMkjVDRZzb` (George) with persona-isolated caching.
   - **Tiered Speech Cascade:**
     - **Tier 1 (ElevenLabs Premade Voices):** High-speed streaming (`eleven_flash_v2_5` ~75ms for English; auto-switches to `eleven_multilingual_v2` for Bengali). Safely ignores legacy library voice IDs (`21m00Tcm4TlvDq8ikWAM`) and auto-retries on HTTP 400/402.
     - **Tier 2 (Server-Side Neural TTS via `edge-tts`):** Zero-key neural MP3 audio matched to persona and language (`en-US-AndrewNeural`/`bn-BD-PradeepNeural` for Dr. Susmit; `en-US-BrianNeural`/`bn-BD-PradeepNeural` for Farhan).
     - **Tier 3 (Browser Speech Synthesis Fallback):** Returns `use_browser_tts = True` and `audio_base64 = null`.
   - **In-Memory LRU Cache:** Thread-safe 128-entry cache eliminates latency and character quota for repeated phrases.
   - **Observability:** Returns structured `tts_diagnostic` tags in API responses.

7. **Storage Fail-Loud Guarantees & Health Monitoring (`/api/health`)**
   - `GET /api/health`: Public probe returning storage backend type (`"postgres"` or `"json"`) and live database connectivity status without exposing connection strings.
   - **Fail-Loud Guarantee:** If `DATABASE_URL` is set but the connection or migrations fail, the service refuses to start or returns 503, eliminating silent JSON fallbacks.

---

## Quick Start (Local Development)

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure Local Environment
Create `.env` in the repository root or export variables:
```bash
export DATABASE_URL="postgresql://user:pass@ep-pooler.neon.tech/neondb?sslmode=require&channel_binding=require"
export GOOGLE_CLIENT_ID="<your-oauth-client-id>.apps.googleusercontent.com"
export JWT_SECRET="<random-64-character-hex-string>"
export ADMIN_EMAILS="bikashtalukder040@gmail.com,lead@domain.com"
export GROQ_API_KEY="gsk_..."
export GEMINI_API_KEY="AIzaSy..."
```

### 3. Start the Server
```bash
uvicorn app.main:app --reload --port 8000
```
Interactive API docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

### 4. Run Test Suite
```bash
# Run all 178 backend contract, service, coach, and TTS tests
python3 -m pytest app/tests/ -v
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Recommended | _None_ | PostgreSQL connection URI (Neon, Supabase, Render). Fails loudly if misconfigured. |
| `GOOGLE_CLIENT_ID` | Yes (for Auth)| _None_ | Google Cloud OAuth 2.0 Web Client ID; the backend rejects tokens issued to a different client. |
| `JWT_SECRET` | Yes (for Auth)| _None_ | Unique random value with at least 32 characters for HS256 JWT signatures. The backend refuses to start without it. |
| `ADMIN_EMAILS` | No | Project owner account | Comma-separated additional Google account emails granted administrative privileges. |
| `CORS_ALLOW_ORIGINS` | No | Local Vite origins and the production Vercel app | Comma-separated additional frontend origins allowed by the backend. Vercel preview URLs must be explicitly listed. |
| `ELEVENLABS_API_KEY` | Optional | _None_ | ElevenLabs API key for ultra-low latency voice synthesis. |
| `ELEVENLABS_VOICE_ID_MALE` | Optional | `JBFqnCBsd6RMkjVDRZzb` | Premade Male voice for Dr. Susmit (George). |
| `ELEVENLABS_VOICE_ID_FEMALE` | Optional | `EXAVITQu4vr4xnSDxMaL` | Premade Female voice for Farhana (Sarah). |
| `ELEVENLABS_VOICE_ID` | Optional | `JBFqnCBsd6RMkjVDRZzb` | Global fallback voice preset (legacy library voice `21m00Tcm4TlvDq8ikWAM` is ignored). |
| `ELEVENLABS_MODEL_ID` | Optional | `eleven_flash_v2_5` | Default English model (~75ms TTFA). Auto-switches to `eleven_multilingual_v2` for Bengali. |
| `CORS_ALLOW_ORIGINS` | No | `localhost:5173` | Comma-separated allowed frontend origins (e.g. `https://cloud-camp-hackathon.vercel.app`). |
| `GROQ_API_KEY` | Recommended | _None_ | Tier 1 LPU vision inference. |
| `GEMINI_API_KEY` | Recommended | _None_ | Tier 2 Google Gemini vision inference. |
| `OPENROUTER_API_KEY` | Optional | _None_ | Tier 3 vision cascade fallback. |
| `USDA_API_KEY` | Optional | `DEMO_KEY` | USDA FoodData Central nutrition lookup. |
| `STATE_PATH` | Optional | `app/state.json` | Path to fallback JSON file when PostgreSQL is not configured. |

---

## Deployment on Render

1. Create a **Web Service** pointing to this repository.
2. **Runtime:** Python 3.
3. **Build Command:** `pip install -r requirements.txt`
4. **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Health Check Path:** `/api/health`
6. Add the environment variables listed above under **Environment Variables**.
