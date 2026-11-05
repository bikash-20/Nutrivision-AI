# NutriVision AI — Documentation Index

Welcome to the architectural and operational documentation for **NutriVision AI**.

---

## Quick Navigation

| If you want to… | Read |
|---|---|
| Understand the current hybrid local and hosted architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) and [Mermaid architecture diagrams](../.github/modernize/assessment/engines/facts/architecture-diagram.md) |
| Follow the complete master workflow & user journey | [WORKFLOW.md](./WORKFLOW.md) / [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) |
| Onboard as an AI agent or new core engineer | [AGENT_CONTEXT.md](./AGENT_CONTEXT.md) |
| Deep dive into ChromaDB RAG & Live Price Scraper | [RAG_AND_SCRAPING_GUIDE.md](./RAG_AND_SCRAPING_GUIDE.md) |
| Trace what happens when a user uploads a meal photo | [IMAGE_UPLOAD_FLOW.md](./IMAGE_UPLOAD_FLOW.md) |
| Deploy to Vercel (Frontend), Render (Backend), and Neon (PostgreSQL) | [deployment.md](./deployment.md) |
| Run local development environment and test suites | [development.md](./development.md) |
| Understand the wire-format contracts and schema drift guard | [schemas.md](./schemas.md) |
| Review recent architectural updates and releases | [CHANGELOG.md](./CHANGELOG.md) |

---

## Detailed Component & Subsystem Guides

### Frontend (`src/`)
- [frontend/README.md](./frontend/README.md) — App shell, Google Auth integration, pre-paint theme engine, and reactive store synchronization.
- [frontend/components.md](./frontend/components.md) — Complete component catalog (CaptureScreen, ResultsScreen, NutrientsScreen, ProfileScreen, GroceryScreen, CoachScreen, and Admin views).

### Backend (`app/`)
- [backend/README.md](./backend/README.md) — FastAPI application entrypoint, CORS configuration, routing architecture, and caches.
- [backend/services.md](./backend/services.md) — Multi-tier vision clients, clinical target resolution, and PostgreSQL persistence adapter.

### HTTP REST APIs
- [api/auth.md](./api/auth.md) — Google OAuth 2.0 Identity Services verification and session JWT management (`/api/auth/*`).
- [api/admin.md](./api/admin.md) — Platform telemetry, multi-user directory, food popularity analytics, and review queue (`/api/admin/*`).
- [api/coach.md](./api/coach.md) — Multi-agent voice AI coach, dual-channel voice chat, and ElevenLabs TTS synthesis (`/api/coach/*`).
- [api/health.md](./api/health.md) — Public storage backend and database connectivity health check (`/api/health`).
- [api/vision.md](./api/vision.md) — 5-tier vision cascade and portion estimation (`/api/vision/analyze`).
- [api/nutrition.md](./api/nutrition.md) — Dynamic BMR/TDEE targets, food database cascade, and clinical flags (`/api/nutrition/*`).
- [api/meals.md](./api/meals.md) — Meal logging, daily intake summaries, and user streak statistics (`/api/meals/*`).
- [api/profile.md](./api/profile.md) — User health profile, allergies, and daily grocery budget (`/api/profile`).
- [api/grocery.md](./api/grocery.md) — Weekly grocery list management and auto-generation (`/api/grocery/*`).

---

## System Invariants & Conventions

1. **Schema Lockstep:** `src/types/schemas.ts` and `app/models/schemas.py` are strictly validated by `app/tests/test_schema_drift.py` via TypeScript AST reflection.
2. **Real Authentication & Multi-Tenancy:** Authenticated sessions use verified Google OAuth 2.0 ID tokens and JWTs. User data is partitioned by email in PostgreSQL.
3. **Resilient Neon & PgBouncer Persistence:** Database connections via `psycopg 3` enforce `prepare_threshold=None` and `channel_binding=require` for 100% transaction-pooling reliability.
4. **Zero-Flash Theme Rendering:** Inline synchronous theme script in `<head>` ensures dark mode loads without white flashes. Default theme is explicitly light mode.
5. **Verified Test Coverage:**
   - **Frontend:** 74 Vitest tests across 14 test suites (`npm test -- --run`).
   - **TypeScript:** Strict typecheck passing with 0 errors (`npm run typecheck`).
   - **Backend:** 171 Pytest tests across 8 test suites (`python3 -m pytest app/tests/ -v`).
