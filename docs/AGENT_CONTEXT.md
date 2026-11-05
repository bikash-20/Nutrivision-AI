# Agent Context & Engineering Guide

> **Orientation for AI agents and incoming engineers picking up the NutriVision AI codebase.**
> Read this document first for the 5-minute mental model, critical constraints, and architectural invariants.
> Current local and hosted runtime boundaries: [Architecture guide](./ARCHITECTURE.md) and [Mermaid architecture diagrams](../.github/modernize/assessment/engines/facts/architecture-diagram.md).

---

## 1. What is NutriVision AI?

NutriVision AI is a phone-first Progressive Web App (PWA) with local-first workflows and an optional hosted API, demonstrating a **Vision-to-Market** loop:
- **Visual Ingestion:** Installed Ollama vision models handle local image analysis first. Eligible signed-in online flows can use the configured hosted provider cascade.
- **Clinical Nutrition:** Dynamic BMR/TDEE calculation (Mifflin-St Jeor), clinical AMDR macronutrient splits, and localized Bangladeshi composition databases combined with Open Food Facts and USDA FoodData Central.
- **Market Intelligence & Dietary Pivots:** Macro- and BDT price-delta calculations for meals, tied directly to a 1-tap localized weekly grocery list.
- **AI Health Coach & Voice Assistant:** Local Ollama chat, browser-recorded audio transcribed by local Whisper, and speech from the selected Piper or Qwen3-TTS engine. Hosted coach and speech endpoints remain available for online API sessions.
- **Admin Intelligence:** 4-view admin portal (live metrics, user directory, popular food analytics, low-confidence review queue).
- **Storage Resilience:** Fail-loud PostgreSQL startup with `psycopg[binary]`, tracked migrations (`nv_migrations`), and public health monitoring (`/api/health`).

---

## 2. Core Architecture & Tech Stack

| Layer | Technology | Primary Files / Roles |
|---|---|---|
| **Frontend PWA** | React 18, TypeScript, Vite, framer-motion | `src/App.tsx`, `src/components/*` |
| **Authentication** | Google Identity Services (GIS), JWT (HS256) | `src/lib/auth.ts`, `app/api/auth.py` |
| **Local Voice & Speech** | faster-whisper, Piper, Qwen3-TTS, browser MediaRecorder | `app/local_voice.py`, `src/lib/localAI.ts`, `src/components/screens/CoachScreen.tsx` |
| **Hosted Voice** | ElevenLabs REST API, edge-tts (Neural) | `app/services/tts_service.py`, hosted coach API |
| **Backend API** | FastAPI, Python 3.11+, Pydantic v2 | `app/main.py`, `app/api/*` |
| **Persistence** | PostgreSQL (`psycopg 3`), JSON fallback | `app/services/state.py` |
| **Vector & Cache** | ChromaDB, SQLite TTL | `app/cache/vector_cache.py`, `app/cache/sqlite_cache.py` |
| **Hosting** | Vercel (Frontend), Render (Backend) | `vercel.json`, root `requirements.txt` |

---

## 3. The Number One Rule: Schema Lockstep

`src/types/schemas.ts` and `app/models/schemas.py` are the unified wire-format source of truth for the entire platform.

**They must always move together in lockstep.** Any change to a model in TypeScript without a corresponding change in Pydantic (or vice-versa) is an integration break.

- **Automated Verification:** `app/tests/test_schema_drift.py` automatically parses the TypeScript AST via `scripts/dump-schemas.mjs` and compares all models against Python Pydantic models.
- **Running the drift check:**
  ```bash
  python3 -m pytest app/tests/test_schema_drift.py -v
  ```

---

## 4. Key Architectural Patterns & Constraints

### A. Authentication & User Partitions
- **Google Sign-In:** `POST /api/auth/google` accepts Google ID tokens (`credential`), verifies them through Google's tokeninfo endpoint, and returns signed session JWTs. `continueOffline()` creates a separate local-only session without contacting the backend.
- **Bearer Token Authorization:** The frontend attaches `Authorization: Bearer <jwt>` to API requests.
- **Zero Mock Personas:** All legacy synthetic accounts (`judge`, `rafi`, `@nutrivision.ai`) have been eliminated. New authenticated users start with a clean zero-state profile (0 meals, 0 streak, 0 stats).
- **Role Control:** Admin privileges are assigned only if the verified email appears in `ADMIN_EMAILS`.

### B. PostgreSQL & Neon Transaction Pooling
- `app/services/state.py` implements `PostgresStore` with automatic DDL migrations for `nv_users`, `nv_meals`, and `nv_grocery`.
- **PgBouncer / Neon Compatibility:** To prevent prepared statement collisions in transaction pooling mode (`ep-*-pooler.neon.tech`), `PostgresStore` connects with:
  ```python
  psycopg.connect(self.dsn, autocommit=True, prepare_threshold=None)
  ```
- **Channel Binding:** Natively supports `channel_binding=require` (`SCRAM-SHA-256-PLUS`) for strict TLS protection.

### C. Zero-Flash Theme Hydration
- Dark/light mode theme selection is initialized via a synchronous inline `<script>` in `<head>` of `index.html`.
- This sets the `data-theme` attribute before any CSS or React hydration occurs, preventing light theme flashes.

---

## 5. Repository Map

### Frontend (`src/`)

```
src/
├── App.tsx                           # Root app shell, auth gate, 6 user tabs + admin portal
├── main.tsx                          # React entrypoint with global ErrorBoundary
├── index.html                        # PWA entry with pre-paint theme hydration script
├── types/schemas.ts                  # TypeScript wire contracts (mirrors Pydantic)
├── lib/
│   ├── api.ts                        # Typed REST API client with JWT Authorization headers
│   ├── auth.ts                       # Google OAuth credential exchange & session storage
│   ├── personalize.ts                # Flag rules, meal totals, and macro calculations
│   ├── pivotEngine.ts                # Dietary pivot calculations with BDT price impact
│   └── storage.ts                    # Typed localStorage wrapper
├── theme/
│   ├── ThemeContext.tsx              # React theme provider (light/dark sync)
│   └── tokens.ts                     # Earth-tone color palette & spacing tokens
├── components/
│   ├── admin/
│   │   ├── AdminLayout.tsx           # 4-tab admin navigation shell
│   │   ├── AdminOverview.tsx         # Real-time metrics & 7-day sparkline
│   │   ├── AdminUsersView.tsx        # Searchable/sortable user directory & detail drawer
│   │   ├── AdminPopularFoodsView.tsx # Ranked food items with date-range filters
│   │   ├── AdminReviewQueueView.tsx  # Low-confidence meal audit & label correction
│   │   └── Sparkline.tsx             # Responsive flexbox weekly volume chart
│   └── screens/
│       ├── CaptureScreen.tsx         # Camera viewfinder, revenue curve, and meal history
│       ├── ResultsScreen.tsx         # Detected food items, portions, and grocery sync
│       ├── NutrientsScreen.tsx       # Macro donut charts & dietary pivot cards
│       ├── ProfileScreen.tsx         # Health goals, allergies, and daily grocery budget
│       ├── GroceryScreen.tsx         # Weekly organized shopping list
│       └── CoachScreen.tsx           # Multi-agent AI coach (Dr. Susmit / Farhana) & voice assistant
```

### Backend (`app/`)

```
app/
├── main.py                           # FastAPI lifespan, router mounting, CORS
├── models/schemas.py                 # Pydantic v2 schemas (mirrors TypeScript)
├── services/
│   ├── state.py                      # Multi-tenant state store (PostgreSQL + JSON fallback)
│   ├── coach_service.py              # Coach service: DB grounding, RAG, dual-channel parsing
│   ├── tts_service.py                # 3-tier TTS engine (ElevenLabs, edge-tts, browser)
│   ├── groq_client.py                # Tier 1 Groq LPU Vision client
│   ├── gemini_client.py              # Tier 2 Google Gemini 2.0 Flash client
│   ├── openrouter_client.py          # Tier 3 OpenRouter Vision cascade
│   ├── hf_client.py                  # Tier 5 Hugging Face classifier
│   ├── off_client.py                 # Open Food Facts client
│   ├── usda_client.py                # USDA FoodData Central client
│   └── fruityvice_client.py          # Fruityvice fruit nutrition client
├── api/
│   ├── auth.py                       # Google OAuth verification & JWT generation
│   ├── coach.py                      # Voice chat and on-demand TTS synthesis
│   ├── admin.py                      # Metrics, user directory, popular foods, review queue
│   ├── vision.py                     # Multi-tier meal image analysis
│   ├── nutrition.py                  # Dynamic BMR/TDEE & nutrition resolution
│   ├── meals.py                      # Meal logging, summaries, and history
│   ├── profile.py                    # User profile management
│   └── grocery.py                    # Weekly grocery list management
└── tests/
    ├── test_contract.py              # Schema contract tests
    ├── test_schema_drift.py          # Lockstep AST drift verification
    ├── test_coach.py                 # Multi-agent coach, RAG, and TTS unit/regression tests
    ├── test_admin.py                 # Admin dashboard endpoint tests
    └── test_caches.py                # Vector and TTL cache validation
```

---

## 6. Testing & Quality Verification

Before committing changes, execute the full test and verification pipeline:

```bash
# 1. Frontend Unit Tests (74 Vitest tests)
npm test -- --run

# 2. Frontend Strict Typecheck (0 errors)
npm run typecheck

# 3. Frontend Production Build
npm run build

# 4. Backend Unit & Contract Tests (178 Pytest tests)
python3 -m pytest app/tests/ -v
```
