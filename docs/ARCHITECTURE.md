# NutriVision AI Architecture

NutriVision AI is a hybrid PWA: device-local data and AI provide offline workflows, while an optional hosted API provides account-backed features and online integrations. The detailed, source-aligned diagrams are in the [application architecture and component relationships](../.github/modernize/assessment/engines/facts/architecture-diagram.md).

## Runtime Boundaries

| Runtime | Main responsibilities | Local endpoint or deployment |
|---|---|---|
| React PWA | Capture and review meals, nutrition, profile, grocery list, AI Coach, and Settings | Vercel in production; Vite on port 5173 in development |
| Browser persistence | Local-only session, offline profile and activity, AI preferences, and cached app shell | `localStorage` and Service Worker Cache API |
| Ollama | Installed text and vision models for local chat and meal image analysis | `http://localhost:11434` by default |
| Local voice service | Whisper transcription and selected Piper or Qwen3-TTS synthesis | Optional FastAPI service on `http://localhost:5005` |
| Hosted API | Auth, profile, meals, nutrition, grocery, coach, vision, market, and admin endpoints | FastAPI on Render; proxied by Vercel under `/api/*` |
| Backend state and caches | Account records, RAG, vision cache, and TTL cache | PostgreSQL when configured; JSON state otherwise; ChromaDB and SQLite caches |

The local model and voice services are independent of the hosted API. The browser calls Ollama and the loopback voice API directly; model files are installed separately and are not shipped with the PWA. The optional voice server loads configured files at startup and does not download weights when processing a request.

## Main Data Flows

### Offline and Local AI

1. The user starts an explicit local-only session. The session, profile, meals, grocery changes, and AI settings are stored in the browser.
2. The PWA discovers installed Ollama models through its local model API. Settings can select a specific model or Automatic; vision actions require a compatible vision model.
3. Coach chat and uploaded images are sent directly to the chosen local model. Follow-up chat retains the image context in the local conversation.
4. Microphone audio is recorded in the browser and sent to the local Whisper service. The transcript enters chat like typed text.
5. After a reply is complete, the selected local TTS engine synthesizes speech. Settings provides Piper and Qwen3-TTS choices and reports their availability independently.

Local-only changes are not queued for upload and do not synchronize across devices.

### Hosted API

1. The typed client sends API requests to the configured API base. In production, Vercel rewrites `/api/*` to the Render FastAPI service.
2. FastAPI routers validate requests and delegate to domain services for authentication, vision, nutrition, meals, profile, grocery, coach, market, and administration.
3. Backend state uses PostgreSQL when `DATABASE_URL` is configured. Without that setting, it uses the JSON file store. A configured database failure is reported as unhealthy rather than silently switching stores.
4. Online domain services may call configured AI providers, Google token verification, nutrition data sources, and live market sources. These integrations require network access and any applicable credentials.

Signed-in online flows may use hosted features; local inference remains the preferred path for local chat and image analysis. The explicit local-only session does not send its chat, profile, or meal photos to hosted AI endpoints.

## Components and Ownership

### Frontend

- `src/App.tsx` owns authentication gating, user/admin routing, screen state, and the meal-analysis flow.
- `src/components/screens/` contains the user screens, including `CoachScreen` and `SettingsScreen`.
- `src/lib/api.ts` implements typed backend requests and browser-local fallbacks for supported data operations.
- `src/lib/localAI.ts` discovers and invokes Ollama models, transcribes local audio, and requests local speech synthesis.
- `src/lib/auth.ts` persists hosted or local-only sessions; `src/lib/storage.ts` wraps namespaced browser storage.
- `public/sw.js` caches the production shell and static assets for repeat offline launches after installation.

### Backend

- `app/main.py` configures FastAPI, CORS, lifespan initialization, health checks, and route registration.
- `app/api/` contains route groups for auth, admin, vision, nutrition, profile, grocery, meals, coach, market, and retrieval.
- `app/services/` implements provider adapters and domain work such as vision reconciliation, nutrition resolution, coaching, pricing, and RAG.
- `app/services/state.py` owns account data and selects PostgreSQL or JSON persistence based on configuration.
- `app/cache/` contains the ChromaDB vector cache and SQLite TTL cache.
- `app/local_voice.py` is a separate optional loopback service; it is not mounted into the hosted application.

## Deployment and Configuration

- **Frontend:** `vercel.json` builds the Vite app into `dist/` and proxies `/api/*` requests to the configured Render backend.
- **Backend:** Run `uvicorn app.main:app`; set `DATABASE_URL` for PostgreSQL, otherwise the backend uses its JSON state file.
- **Local chat and vision:** Install Ollama, download compatible models, then configure the server URL and preferred model in Settings.
- **Local voice:** Install the optional dependencies from `requirements-voice.txt`, set `WHISPER_MODEL_PATH`, `PIPER_VOICE_PATH` and/or `QWEN3_TTS_MODEL_PATH`, and run `uvicorn app.local_voice:app --host 127.0.0.1 --port 5005`. See the [offline setup](../README.md#offline-and-local-ai-setup) for optional Piper configuration and CORS.

Voice models are not bundled. English and Bengali transcription are selected through Whisper configuration. Qwen3-TTS in this adapter accepts only its configured supported languages; Piper language support depends on the installed voice model. Missing or incompatible local services surface as explicit errors rather than browser or hosted success-shaped fallbacks.
