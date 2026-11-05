# NutriVision AI

> *Snap a meal. Know your body. Shop smart.*

A phone-first PWA that uses AI vision to identify foods, resolve nutrition data, personalize health flags, and generate budget-aware grocery lists.

Built for **Cloud Camp Hackathon** by [bikash-20](https://github.com/bikash-20).

## Live Demo

[https://cloud-camp-hackathon.vercel.app](https://cloud-camp-hackathon.vercel.app)

## Features

### Capture & Home
- Real camera integration via `getUserMedia` (rear camera preferred)
- File upload fallback for devices without camera access
- Live preview with viewfinder overlay, shutter animation, and retake
- **FinTech Spline Curve Chart (`RevenueCurveChart.tsx`):** Catmull-Rom smoothed area curve showing daily calorie intake ($0 \rightarrow \text{Current kcal}$) with dashed forecast projection toward the 2269 kcal daily goal
- Live reactive updates via `meal-history-updated` event

### Results & Review
- **Multi-Tier Vision Cascade:** Groq Vision (Tier 1 fast LPU) → Google Gemini 2.0 Flash (Tier 2 high accuracy) → OpenRouter (Tier 3 free cascade) → Gemini 1.5 Fallback (Tier 4) → Hugging Face (Tier 5)
- Direct 1-tap `[ 🛒 Add to Grocery / বাজারে যোগ ]` button next to Share button for instant grocery addition
- Confidence scores with color-coded badges (high/medium/low)
- Sortable food items (by confidence, calories, name, portion size)
- Portion editing with +/- 25g controls, renaming, replacing, or deleting
- Bulk actions: confirm all, review low-confidence, add custom
- "Frequently eaten with" suggestions
- Glycemic index chips for diabetic profiles
- Share detected items to clipboard

### Nutrients & Analysis
- **Revenue-Style Intake Curve (`RevenueCurveChart.tsx`):** Visual trajectory curve with real Bengali/English X/Y axes (`৮ AM` – `১১ PM`, `০` – `২৫০০` kcal), olive target line, and draw-in animation
- **Smart Dietary Pivot & Market Intelligence (`pivotEngine.ts`):** Tailored meal swaps with exact macro and BDT market price deltas (e.g. Low-Sodium Gravy Pivot, Pasta & Steamed Veggies Swap, Antioxidant Salad Booster)
- 1-click `[ 🛒 Add pivot items to Grocery List ]` button automatically adding swap ingredients with categories
- Animated macro donut charts (protein, carbs, fat) with deep ink (`#2E2522`) high-contrast numbers
- Modern 10px gradient pill meters (`Bar.tsx`) with benchmark notches and over-target badges
- SHAP-style explainability strip with per-item contributions
- Share nutrition summary to clipboard

### Multi-Agent Voice AI Assistant (`CoachScreen.tsx` & `/api/coach/*`)
- **Single-Pass Dual-Channel Response:** Delivers a complete, formatted clinical analysis alongside an ultra-concise spoken summary (`voice_summary`, <60 words, clean of Markdown, LaTeX, and emojis) generated in a single LLM pass.
- **Dual Personas & Voice Routing:**
  - **Dr. Susmit (পুষ্টি বিজ্ঞানী / Nutrition Biochemist):** Evidence-based biochemical analysis of glycemic load ($GL$), cooking oil absorption, and clinical macronutrient partitioning per BIRDEM/ADA guidelines. Voiced by ElevenLabs premade voice `JBFqnCBsd6RMkjVDRZzb` (George).
  - **Farhan Ahmed (আচরণ ও অভ্যাস কোচ / Habit Coach):** Empathetic behavioral coaching based on CBT habit science, lifestyle pacing, and guilt-free dawat/feast recovery. Voiced by ElevenLabs premade voice `JBFqnCBsd6RMkjVDRZzb` (George).
- **3-Tier Speech Synthesis Cascade (`tts_service.py`):**
  - **Tier 1 (ElevenLabs Premade Low-Latency TTS):** Auto-selects `eleven_flash_v2_5` (~75ms TTFA) for English and `eleven_multilingual_v2` for Bengali Unicode script (`\u0980-\u09FF`). Strictly ignores legacy library voice IDs (`21m00Tcm4TlvDq8ikWAM`) to eliminate Free Tier 402 errors, with automatic in-flight retry.
  - **Tier 2 (Server-Side Neural TTS via `edge-tts`):** Zero-key neural MP3 synthesis matching persona and language (`en-US-AndrewNeural`/`bn-BD-PradeepNeural` for Dr. Susmit; `en-US-BrianNeural`/`bn-BD-PradeepNeural` for Farhan) executed in a thread-isolated event loop.
  - **Tier 3 (Browser Client Fallback):** Seamless client-side `window.speechSynthesis`.
- **On-Demand `🔊 Listen` Button:** Generates or replays speech on demand with message-level caching and `tts_diagnostic` observability.
- **In-Memory LRU Cache:** Thread-safe 128-entry in-memory audio cache for zero-latency responses on frequent prompts.
- **Hands-Free Speech-to-Text (STT):** Live microphone input using browser Web Speech API with an instant `[বাং / EN]` language toggle pill directly beside the microphone.
- **Live Database Grounding:** Seamlessly compiles user's clinical profile, today's logged meals, and active grocery list from PostgreSQL into context.
- **Transparent Vercel Edge Proxy:** All `/api/*` requests proxied directly to Render backend via `vercel.json` rewrites. See [AI Coach API Guide](docs/api/coach.md) for full details.

### Nutrients & Analysis
- Editable health goals: prediabetic-friendly, high-protein, budget-aware, Mediterranean
- Dietary preferences: Vegetarian, Vegan, Pescatarian, Gluten-free, Dairy-free, Halal, Kosher
- Allergen tracking: Peanuts, Tree nuts, Shellfish, Soy, Eggs, Dairy, Gluten, Sesame
- Daily grocery budget stepper (scales to weekly cap)
- Serving size adjustment
- User statistics: total meals logged, days active, avg kcal/day

### Grocery
- Weekly grocery list with category grouping (Grains & staples, Produce, Protein)
- Check items as bought with strike-through
- Inline price editing (BDT currency)
- Add custom items with name + price + category
- 1-tap addition from ResultsScreen and NutrientsScreen pivot cards
- "Generate from Meals" — auto-adds pairings from meal history
- Clear all items with confirmation
- Budget tracking ring with remaining balance
- Share list to clipboard

### Data Persistence
- localStorage save/load for profile, meal history, and grocery data
- Meals auto-saved after each analysis
- Today's summary card on home screen
- Recent meals section (last 3 logged)

### UX Polish
- Skeleton loaders for async data (grocery, stats, home sections)
- Empty states with helpful messages
- Toast notifications for all actions (confirm, remove, add, share)
- Error boundary with styled fallback
- Loading skeleton while profile resolves
- Back navigation from Nutrients to Results

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | React 18 + Vite |
| Language | TypeScript (strict) |
| Animation | framer-motion 13 |
| Icons | lucide-react |
| PWA | Custom service worker + manifest |
| Hosting | Vercel (auto-deploy on push) |
| Styling | Inline styles + CSS tokens |

## Getting Started

### Prerequisites

- Node.js 18+
- npm (or yarn/pnpm)

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173) with hot reload.

### Type Check

```bash
npm run typecheck
```

### Production Build

```bash
npm run build
npm run preview
```

### App Icons

The browser, PWA, maskable, and iOS icons are generated from
`public/NutriVision AI Healthy Food App Icon.png`:

```bash
python3 scripts/generate-icons.py
```

## Project Structure

```
src/
├── main.tsx                  # React root + ErrorBoundary
├── App.tsx                   # Tab state, screen router, profile state
├── data.ts                   # Design tokens (T), greeting, re-exports
├── styles.css                # Earth-tone tokens, glass utilities, skeleton
├── types/
│   └── schemas.ts            # TypeScript contracts (mirrors backend Pydantic)
├── lib/
│   ├── api.ts                # Mock API client (drop-in swap target)
│   └── storage.ts            # Typed localStorage wrapper
├── mocks/
│   └── fixtures.ts           # Typed mock data
└── components/
    ├── PhoneFrame.tsx        # Mobile full-bleed / desktop phone mockup
    ├── BottomNav.tsx         # 5-tab dock
    ├── ErrorBoundary.tsx     # Top-level error catch
    ├── ExpandableRow.tsx     # Food item expansion with edit controls
    ├── SummaryCard.tsx       # Macro totals display
    ├── SortMenu.tsx          # Sort options dropdown
    ├── BulkActionBar.tsx     # Multi-select actions
    ├── SmartActionSheet.tsx  # Confirmation sheet
    ├── AddCustomModal.tsx    # Add custom food item
    ├── ConfidenceRing.tsx    # Animated progress ring
    ├── PhotoThumb.tsx        # Captured photo thumbnail
    ├── SectionLabel.tsx      # Section headers with actions
    ├── Chip.tsx / Pill.tsx   # Toggle components
    ├── Bar.tsx               # Progress bar
    ├── useCountUp.ts         # Animated number counter
    └── screens/
        ├── CaptureScreen.tsx     # Camera + file upload + home
        ├── ResultsScreen.tsx     # Detected items list
        ├── NutrientsScreen.tsx   # Macro donuts + explainability
        ├── ProfileScreen.tsx     # Goals, prefs, allergens, budget
        └── GroceryScreen.tsx     # Weekly grocery list
```

## Design System

- **Earth palette**: `#4A3A34` → `#F9F2E4` (warm browns to cream)
- **Glass morphism**: backdrop-filter cards with soft borders
- **Typography**: Inter (UI), Fraunces (display), IBM Plex Mono (data)
- **Motion**: spring physics via framer-motion, respects `prefers-reduced-motion`
- **Accessibility**: aria labels, focus-visible, sr-only, keyboard navigation
- **Theme Hydration**: Synchronous inline head script checks stored theme & OS preference to prevent theme flash; full WCAG AA contrast in dark mode

## Architecture & Backend

The system operates on an asynchronous, decoupled client-server architecture:

- **Frontend:** React 18 + TypeScript PWA deployed on Vercel, talking to the backend via a typed REST API client with JWT authentication (`Authorization: Bearer <token>`).
- **Backend:** FastAPI (Python 3.11+) service deployed on Render, exposing OpenAPI-documented endpoints with Pydantic v2 validation.
- **Authentication:** Real Google OAuth 2.0 (Google Identity Services). Client sends Google ID token to `POST /api/auth/google`; backend verifies token signatures via Google's public JWKS endpoints, extracts user identity, assigns role (admin checked against `ADMIN_EMAILS`), and signs a secure session JWT.
- **Multi-Tenant Persistence:** `app/services/state.py` dynamically activates PostgreSQL when `DATABASE_URL` is set, with connection pooling via `psycopg 3` (`psycopg[binary]`). Automatically runs DDL migrations for `nv_users`, `nv_meals`, and `nv_grocery`. Fully compatible with Neon pooled endpoints (`-pooler`) and `channel_binding=require` with server-side prepared statements disabled (`prepare_threshold=None`). Falls back to JSON storage if `DATABASE_URL` is unset.
- **Admin Intelligence Dashboard:** Real-time metrics aggregated directly from PostgreSQL:
  - **Overview:** Active user counts, meals today/this week, real flagged meals ratio, and a dynamic 7-day meal volume sparkline.
  - **Users Directory:** Searchable, sortable table with user avatars, emails, roles, streak tracking, and recent meal inspection drawer.
  - **Popular Foods:** Aggregated food frequency ranking with date-range filters (`Today`, `7 Days`, `30 Days`, `All Time`) and confidence ratings.
  - **Review Queue:** Flagged low-confidence (<70%) meal audit log with modal actions for approval, name correction, and dismissal.
- **Multi-Tier Vision Cascade:** **Groq Vision** (Tier 1 fast LPU) → **Google Gemini 2.0 Flash** (Tier 2 high accuracy) → **OpenRouter Vision** (Tier 3 free cascade) → **Gemini 1.5 Fallback** (Tier 4) → optional **Hugging Face** classifier (Tier 5 validator).
- **Nutrition Cascade:** Open Food Facts → USDA FoodData Central → Fruityvice + canonical Bangladeshi & global food composition databases.
- **Caching:** ChromaDB vector cache lookup + SQLite TTL exact-match cache.

### Required Environment Variables

#### Render Backend:
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URI (e.g., Neon connection string: `postgresql://user:pass@ep-pooler.neon.tech/neondb?sslmode=require&channel_binding=require`) |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 2.0 Web Client ID (matches frontend) |
| `JWT_SECRET` | 64-char random hex string used to sign backend session JWTs |
| `ADMIN_EMAILS` | Comma-separated list of admin Google emails (e.g., `bikashtalukder040@gmail.com,lead@domain.com`) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for AI Voice Assistant text-to-speech synthesis |
| `ELEVENLABS_VOICE_ID` | Voice ID preset (defaults to `"21m00Tcm4TlvDq8ikWAM"` — Rachel) |
| `ELEVENLABS_MODEL_ID` | Model preset (defaults to `eleven_flash_v2_5` ~75ms TTFA; auto-routes Bengali to `eleven_multilingual_v2`) |
| `CORS_ALLOW_ORIGINS` | `https://cloud-camp-hackathon.vercel.app` (or comma-separated allowed origins) |
| `GROQ_API_KEY` | Groq API key for Tier 1 ultra-fast vision inference |
| `GEMINI_API_KEY` | Google Gemini API key for Tier 2 vision cascade |
| `OPENROUTER_API_KEY` | OpenRouter API key for Tier 3 vision cascade |
| `USDA_API_KEY` | USDA FoodData Central key (defaults to `DEMO_KEY` if omitted) |

#### Vercel Frontend:
| Variable | Description |
|---|---|
| `VITE_API_BASE` | Render backend URL (e.g., `https://cloud-camp-hackathon.onrender.com` without trailing slash) |
| `VITE_GOOGLE_CLIENT_ID` | Same Google Cloud OAuth 2.0 Web Client ID |

## Clinical Formulas & Dynamic Target Standards

NutriVision AI calculates targets dynamically rather than using static constants:

1. **Basal Metabolic Rate (BMR):** Mifflin-St Jeor Equation
   $$\text{BMR}_{\text{male}} = 10 \times \text{weight (kg)} + 6.25 \times \text{height (cm)} - 5 \times \text{age} + 5$$
   $$\text{BMR}_{\text{female}} = 10 \times \text{weight (kg)} + 6.25 \times \text{height (cm)} - 5 \times \text{age} - 161$$
   *(Citation: Mifflin MD, St Jeor ST, et al. Am J Clin Nutr 1990; 51:241-247)*
2. **Total Daily Energy Expenditure (TDEE):** $\text{TDEE} = \text{BMR} \times \text{Activity Multiplier}$
   - Sedentary: $1.20$, Light: $1.375$, Moderate: $1.55$, Active: $1.725$, Very Active: $1.90$
3. **Calorie Deficit / Surplus Limits:**
   - Capped at maximum $\pm 1000\text{ kcal/day}$ with clinical safety floors enforced ($1500\text{ kcal}$ for adult men, $1200\text{ kcal}$ for adult women, $1000\text{ kcal}$ for children).
4. **Macronutrient Split (AMDR):**
   - Standard: 50% Carbs, 20% Protein, 30% Fat
   - Diabetic / Prediabetic: 38% Carbs, 25% Protein, 37% Fat
   - High Protein: 40% Carbs, 32% Protein, 28% Fat
   - Renal / Kidney Condition: Protein capped at $0.8\text{ g/kg}$ of body weight
5. **Micronutrient Rules:**
   - Fiber: Children (age $<14$) $\rightarrow \text{age} + 5\text{g}$; Adults $\rightarrow 14\text{g} / 1000\text{ kcal}$ (min $30\text{g}$ for diabetic profiles).
   - Sodium: $\le 1500\text{ mg/day}$ for hypertension or renal conditions; $\le 2300\text{ mg/day}$ for standard adults; $\le 1200\text{ mg/day}$ for children $<8$ yo.
   - Sugar: Max $5\%$ of total calories for diabetic profiles; max $10\%$ for general health (WHO 2015 guideline).

---

## How to Extend & Customize

### Adding a Vision Provider
Define the provider entry in [`app/data/vision_providers.json`](./app/data/vision_providers.json):
```json
{
  "name": "my_new_provider",
  "model": "model-identifier",
  "base_url": "https://api.provider.com/v1",
  "timeout_seconds": 15.0,
  "max_retries": 2,
  "enabled": true
}
```

### Adding a Local / Regional Food Item
Add the food entry to [`app/data/bd_food_composition.json`](./app/data/bd_food_composition.json):
```json
"ilish macher jhol": {
  "name_en": "Ilish Macher Jhol",
  "name_bn": "ইলিশ মাছের ঝোল",
  "protein": 18.2, "carbs": 2.0, "fat": 14.5, "kcal": 212.0,
  "fiber": 0.8, "sodium": 310.0, "sugar": 0.4, "glycemic": 0.10,
  "emoji": "🐟", "category": "protein",
  "alternatives": ["Rui Macher Jhol"],
  "pairings": ["White Rice", "Green Chili"]
}
```

### Adding a Language or Localization
1. Register translations in [`src/i18n/LanguageContext.tsx`](./src/i18n/LanguageContext.tsx).
2. Set the `language` field on the user profile (`'en'` or `'bn'`).

---

## License

MIT

## Documentation

Comprehensive docs live in [`docs/`](./docs/README.md):

- [Master Workflow & System Guide](./docs/WORKFLOW.md) — complete step-by-step user journey, vision cascade, and Voice AI Coach
- [Architecture overview](./docs/ARCHITECTURE.md) — the 5-minute orientation
- [What happens when you upload a picture](./docs/IMAGE_UPLOAD_FLOW.md) — frame-by-frame trace from camera to saved meal
- [Agent context](./docs/AGENT_CONTEXT.md) — for AI agents or new developers picking up the project
- [Schema lockstep rules](./docs/schemas.md) — how `src/types/schemas.ts` ↔ `app/models/schemas.py` stay in sync
- [Development guide](./docs/development.md) — setup, tests, smoke-testing the real backend
- [Changelog](./docs/CHANGELOG.md) — what changed in the recent cleanup pass

Per-area deep dives:
- [Frontend](./docs/frontend/README.md) · [Components](./docs/frontend/components.md)
- [Backend](./docs/backend/README.md) · [Services](./docs/backend/services.md)
- [API reference](./docs/api/vision.md) (vision, nutrition, profile, grocery, meals)
