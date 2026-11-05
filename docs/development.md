# Development

How to set up the project locally, run tests, run lint, run the dev
servers, and smoke-test the real backend.

## Prerequisites

- **Node.js 20+** (LTS recommended). Tested on 20 and 22.
- **Python 3.11 or 3.12** (CI matrix). 3.14 also works in dev but
  ChromaDB has known warnings on 3.14.
- **npm** (or pnpm/yarn — the lockfile is npm).
- A modern browser. The PWA uses `getUserMedia`, so Chrome/Edge/Safari
  with HTTPS or `localhost` is required for the camera.

## Repo setup

```bash
git clone https://github.com/bikash-20/cloud-camp-hackathon
cd cloud-camp-hackathon
```

## Frontend

### Install

```bash
npm install
```

### Dev server

```bash
npm run dev
# Opens at http://localhost:5173 with HMR
```

### Test commands

```bash
npm test              # vitest run (one-shot, exits after)
npm run test:watch    # vitest in watch mode
npm run typecheck     # tsc --noEmit
npm run build         # production build → dist/
npm run preview       # serve the production build locally
```

### Project structure

```
src/
├── App.tsx                       # App shell, auth gate, tab router
├── main.tsx                      # React root + ErrorBoundary
├── data.ts                       # Re-export shim (don't add new imports)
├── styles.css                    # Earth-tone tokens, glass utilities
├── types/
│   ├── schemas.ts                # TS wire-format source of truth
│   └── css.d.ts
├── lib/
│   ├── api.ts                    # Typed REST client with local-first fallbacks
│   ├── auth.ts                   # Hosted and local-only session management
│   ├── localAI.ts                # Ollama, Whisper, Piper, and Qwen3 adapters
│   ├── format.ts                 # formatRelative, hashStr, pickThumbnailStyle
│   ├── format.test.ts
│   ├── personalize.ts            # Flag rules + meal totals
│   ├── personalize.test.ts
│   └── storage.ts                # Typed localStorage wrapper
├── mocks/
│   └── fixtures.ts               # All MOCK_* constants
├── theme/
│   ├── ThemeContext.tsx          # Light/dark mode provider
│   ├── tokens.ts                 # Earth-tone design tokens
│   └── useTokens.ts
└── components/
    ├── PhoneFrame.tsx            # Mobile full-bleed / desktop phone mockup
    ├── BottomNav.tsx             # 5-tab dock
    ├── ErrorBoundary.tsx         # Top-level error catch
    ├── ExpandableRow.tsx         # Food item expansion with edit controls
    ├── SummaryCard.tsx           # Macro totals display
    ├── SortMenu.tsx              # Sort options dropdown
    ├── BulkActionBar.tsx         # Multi-select actions
    ├── SmartActionSheet.tsx      # Confirmation sheet
    ├── AddCustomModal.tsx        # Add custom food item
    ├── ConfidenceRing.tsx        # Animated progress ring
    ├── PhotoThumb.tsx            # Captured photo thumbnail
    ├── PwaInstallBanner.tsx      # PWA install prompt
    ├── SectionLabel.tsx          # Section headers
    ├── Bar.tsx                   # Labeled progress bar
    ├── Meter.tsx                 # MiniBar + MacroMeter
    ├── Chip.tsx, Pill.tsx        # Toggle components
    ├── StepDots.tsx, StepIndicator.tsx
    ├── ThemeToggle.tsx
    ├── useCountUp.ts             # Animated number counter
    ├── auth/
    │   └── LoginScreen.tsx       # Google Identity Services (GIS) OAuth login
    ├── admin/
    │   ├── AdminLayout.tsx
    │   ├── AdminOverview.tsx
    │   ├── KpiCard.tsx
    │   └── Sparkline.tsx
    └── screens/
        ├── CaptureScreen.tsx     # Camera + home + meal history + revenue curve
        ├── ResultsScreen.tsx     # Detected items list & portion editing
        ├── NutrientsScreen.tsx   # Macro donuts, trajectory, & dietary pivots
        ├── ProfileScreen.tsx     # Goals, prefs, allergens, budget stepper
        ├── GroceryScreen.tsx     # Weekly organized grocery list
        └── CoachScreen.tsx       # Multi-agent AI Coach with ElevenLabs Voice & STT
```

## Backend

### Install

```bash
cd app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Dev server

```bash
# from the app/ directory
uvicorn app.main:app --reload --port 8000
# Swagger UI: http://localhost:8000/docs
# ReDoc:      http://localhost:8000/redoc
# Root:       http://localhost:8000/
```

Or from the repo root:

```bash
uvicorn app.main:app --reload --port 8000 --app-dir app
```

### Test commands

```bash
cd app

# All tests
python -m pytest tests/ -q

# Just the schema-drift guard (23 parametrized cases)
python -m pytest tests/test_schema_drift.py -v

# Single test file
python -m pytest tests/test_cascade.py -v

# Lint
ruff check .
ruff check . --fix    # auto-fix what's safe
```

### Configuration

Copy `app/.env.example` to `app/.env` and fill in keys as needed:

```bash
cp app/.env.example app/.env
```

| Var | Default | Effect when set |
|---|---|---|
| `STATE_PATH` | `app/state.json` | JSON file backing the state singleton |
| `CORS_ALLOW_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated CORS allow-list |
| `GEMINI_API_KEY` | (unset) | Enables Gemini vision. If both vision provider keys are unset, analysis returns HTTP 503. |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Model name |
| `GEMINI_BASE_URL` | (unset) | Override for testing against a mock Gemini |
| `HF_API_TOKEN` | (unset) | Enables HF validator |
| `OFF_BASE_URL` | (unset) | Open Food Facts override |
| `USDA_BASE_URL` | (unset) | USDA FDC override |
| `USDA_API_KEY` | `DEMO_KEY` | USDA key (DEMO_KEY works without signup) |
| `FRUITYVICE_BASE_URL` | (unset) | Fruityvice override |
| `SQLITE_CACHE_PATH` | `app/cache/cache.db` | SQLite TTL cache path |
| `VISION_CACHE_TTL` | `604800` (7 days) | Vector cache TTL in seconds |

## Smoke-testing the real backend

To exercise the real backend locally, set `VITE_API_BASE=http://localhost:8000`
for the Vite dev server and start the backend from the repository root:

```bash
# Terminal 1 (repository root; set GEMINI_API_KEY in this shell)
uvicorn app.main:app --reload --port 8000

# Terminal 2 (repository root)
npm run dev

curl http://localhost:8000/api/nutrition/targets

curl http://localhost:8000/api/profile

curl http://localhost:8000/api/meals/today
```

Upload an actual photo in the frontend. The API expects a valid image
data URL and at least one configured provider; with no provider it
returns HTTP 503 rather than sample detections.

### CORS env var

To confirm the env-driven CORS allow-list works:

```bash
CORS_ALLOW_ORIGINS="https://example.com" uvicorn app.main:app --port 8000

# In another terminal:
curl -H "Origin: https://example.com" -i http://localhost:8000/api/profile
# Response should include: Access-Control-Allow-Origin: https://example.com
```

## Schema-drift guard

The most important test in the suite. It enforces that
`src/types/schemas.ts` and `app/models/schemas.py` stay in lockstep.

```bash
cd app
python -m pytest tests/test_schema_drift.py -v
```

How it works:
1. Runs `node scripts/dump-schemas.mjs src/types/schemas.ts` to
   extract `{InterfaceName: {field: tsTypeString}}` JSON.
2. Walks every Pydantic `BaseModel` in `app.models.schemas` and emits
   the same shape.
3. Normalizes: camelCase ↔ snake_case, optional/nullable collapse,
   inline `__literal` blocks vs alias names.
4. Asserts the two maps match.

If you intentionally add a new type to one side, you must:
1. Add the matching type to the other side.
2. Add the type name to `MUST_MATCH` in `app/tests/test_schema_drift.py`.
3. If the type exists in only one file, add it to `allowed_ts_only`
   or `allowed_py_only`.

See [schemas.md](./schemas.md) for the full contract.

## CI

`.github/workflows/ci.yml` runs on every push and PR to `main`.

**Frontend job** (Node 20):
- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`

**Backend job** (Python 3.11 + 3.12 matrix):
- `pip install -r requirements.txt` (in `app/`)
- `ruff check .` (in `app/`)
- `python -m pytest tests/ -q`
- `python -m pytest tests/test_schema_drift.py -v`

Both jobs must pass for the PR to merge.

## Troubleshooting

### "Cannot find module 'typescript'" in the schema-drift test

The test shells out to `node`. Make sure `node` and `npm` are on
`PATH` and that `npm install` has been run (it pulls `typescript` as
a devDependency of the Node script).

### ChromaDB warnings on Python 3.14

ChromaDB has known compatibility issues on Python 3.14. The cache
silently no-ops (the route catches and ignores the error). To enable
the vector cache, use Python 3.11 or 3.12.

### CORS preflight fails

Check that the frontend origin (default `http://localhost:5173`) is
in `CORS_ALLOW_ORIGINS`. If you deploy the frontend to Vercel, add
the Vercel URL to the env var.

### "Schema drift detected" CI failure

Read the test output carefully. It tells you:
- Which type drifted (`UserProfile has field-type mismatches: ...`)
- Which field is missing on which side (`fields only in TS — [...]`)
- Which kind strings differ

Common causes:
- Forgot to add a field to one side
- Added a `List[X]` on one side and a bare `X` on the other
- Inline literal union on one side, alias name on the other (the
  drift test handles this — if it fails, the values actually differ)

### localStorage quota

`src/lib/storage.ts` catches `QuotaExceededError` and warns to the
console. The user sees no error in the UI; old data is preserved.