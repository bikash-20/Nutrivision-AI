# Production Deployment Guide

This guide covers deploying the **NutriVision AI** frontend (Vercel), backend (Render), PostgreSQL database (Neon / Supabase / Render), and Google OAuth credentials.

---

## Architecture Topology

```
┌──────────────────────────────────────┐
│  Google Cloud Console                │
│  • OAuth 2.0 Web Client              │
│  • Authorized JS Origins:            │
│    https://cloud-camp-hackathon.     │
│    vercel.app                        │
└──────────────────┬───────────────────┘
                   │ Client ID
         ┌─────────┴─────────┐
         ▼                   ▼
┌──────────────────┐   ┌──────────────────────────────────┐
│  Vercel          │   │  Render                          │
│  Frontend (PWA)  │──▶│  FastAPI Backend Service         │
│  • React 18      │   │  • Uvicorn async worker          │
│  • Static Build  │   │  • JWT Auth & Vision Cascade     │
└──────────────────┘   └─────────────────┬────────────────┘
                                         │
                                         ▼
                       ┌──────────────────────────────────┐
                       │  Neon / Managed PostgreSQL       │
                       │  • Transaction Pooler (-pooler)  │
                       │  • SSL & Channel Binding         │
                       │  • Auto-migrated schema          │
                       └──────────────────────────────────┘
```

---

## 1. Google Cloud Console (OAuth 2.0)

1. Open [Google Cloud Console](https://console.cloud.google.com/) $\rightarrow$ **APIs & Services** $\rightarrow$ **Credentials**.
2. Click **Create Credentials** $\rightarrow$ **OAuth Client ID**.
3. Select **Application type:** `Web application`.
4. Name: `NutriVision AI Web Client`.
5. Under **Authorized JavaScript origins**, add:
   - `https://cloud-camp-hackathon.vercel.app` (Production)
   - `http://localhost:5173` (Local development)
   - `http://localhost:4173` (Vite preview)
6. Under **Authorized redirect URIs**: Leave empty (NutriVision AI utilizes Google Identity Services ID-token flow; no server redirect URI is required).
7. Copy the generated **Client ID** (e.g. `xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`).

---

## 2. Managed PostgreSQL (Neon / Supabase / Render)

NutriVision AI uses `psycopg 3` with automatic DDL table migrations on startup.

### Recommended Provider: Neon Serverless Postgres
1. Create a project in [Neon Console](https://console.neon.tech/).
2. On the **Dashboard**, locate your connection details and select the **Pooled connection** checkbox (`-pooler`).
3. Construct the connection URI:
   ```text
   postgresql://[user]:[password]@[endpoint]-pooler.[region].neon.tech/neondb?sslmode=require&channel_binding=require
   ```
4. **Key Compatibility Features:**
   - **Transaction Pooling:** Handled automatically via `prepare_threshold=None` in `app/services/state.py`.
   - **Channel Binding:** `channel_binding=require` validates the `SCRAM-SHA-256-PLUS` token against the TLS certificate.
   - **Auto-migrations:** Automatically creates `nv_users`, `nv_meals`, and `nv_grocery` on boot.

---

## 3. Backend Deployment (Render)

1. Create a **New Web Service** connected to your GitHub repository.
2. Configure service settings:
   - **Environment:** `Python 3`
   - **Branch:** `main`
   - **Root Directory:** `.`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path:** `/api/health`
3. Configure **Environment Variables** in Render:

| Variable | Recommended Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@ep-pooler.neon.tech/neondb?sslmode=require&channel_binding=require` | Persistent PostgreSQL store |
| `GOOGLE_CLIENT_ID` | `xxxxxxxx.apps.googleusercontent.com` | Matches Google Console |
| `JWT_SECRET` | `openssl rand -hex 32` | 64-char random hex string |
| `ADMIN_EMAILS` | `bikashtalukder040@gmail.com,lead@domain.com` | Admin permissions grant (comma-separated Google emails) |
| `PHOTO_UPLOAD_LIMIT` | `2` | Positive integer; per-user rolling-hour photo quota. Change this Render environment variable to adjust the hosted limit. |
| `ELEVENLABS_API_KEY` | `xi-...` | Optional ElevenLabs text-to-speech API key |
| `ELEVENLABS_VOICE_ID_MALE` | `JBFqnCBsd6RMkjVDRZzb` | Premade Male voice preset for Dr. Susmit & Farhan (defaults to George) |
| `ELEVENLABS_VOICE_ID_FARHAN` | `JBFqnCBsd6RMkjVDRZzb` | Optional voice preset override for Farhan (defaults to George) |
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | Global fallback voice preset. Note: legacy library ID `21m00Tcm4TlvDq8ikWAM` is safely ignored to prevent Free Tier 402 errors |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` | Default English model (~75ms TTFA; auto-switches to `eleven_multilingual_v2` for Bengali) |
| `CORS_ALLOW_ORIGINS` | `https://cloud-camp-hackathon.vercel.app` | Allow frontend origin |
| `GROQ_API_KEY` | `gsk_...` | Tier 1 Fast Vision |
| `GEMINI_API_KEY` | `AIzaSy...` | Tier 2 High-Accuracy Vision |
| `OPENROUTER_API_KEY` | `sk-or-...` | Tier 3 Vision Cascade |
| `USDA_API_KEY` | `DEMO_KEY` (or custom key) | USDA FoodData Central |

> [!NOTE]
> **Server-Side Neural Fallback (`edge-tts`):** If `ELEVENLABS_API_KEY` is not set or ElevenLabs quota is exceeded, the server automatically synthesizes neural MP3 audio via Microsoft Azure Speech (`edge-tts`) with **zero API key configuration required**.

4. Deploy the service and record the assigned HTTPS domain:
   `https://cloud-camp-hackathon.onrender.com`

The hosted photo quota reads `PHOTO_UPLOAD_LIMIT` from the backend environment
and defaults to `2`. Set it to any positive integer in Render's environment
settings; the service applies the change after restart/redeploy. Browser-only
offline sessions retain their separate local limit of `2`.

The curated RAG index uses `RAG_CHROMA_PATH` (default
`app/cache/rag_chroma`), separate from the vision detection cache. It is
re-seeded from the bundled knowledge documents when the service starts; attach
a persistent disk and point this variable at its mount path if retaining the
index across instance restarts is important.

---

## 4. Frontend Deployment (Vercel)

1. Connect the GitHub repository to [Vercel](https://vercel.com/).
2. Root configuration is handled automatically by `vercel.json`:
   - Framework: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - **Edge API Rewrite Proxy:**
     ```json
     {
       "source": "/api/:path*",
       "destination": "https://cloud-camp-hackathon.onrender.com/api/:path*"
     }
     ```
     This proxies all relative `/api/*` browser calls directly to the Render backend, preventing SPA 404 router traps and eliminating unnecessary CORS preflight roundtrips.
3. In **Project Settings** $\rightarrow$ **Environment Variables**, configure:

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE` | `https://cloud-camp-hackathon.onrender.com` | **No trailing slash**, no `/api` suffix |
| `VITE_GOOGLE_CLIENT_ID` | `xxxxxxxx.apps.googleusercontent.com` | Same Client ID as backend |

4. Click **Redeploy** (with "Use existing build cache" unchecked) to bake the new environment variables into the Vite client bundle.

---

## 5. Verification Checklist

1. **Storage & Health Check:**
   ```bash
   curl -s https://cloud-camp-hackathon.onrender.com/api/health | jq .
   # Expected: {"status": "ok", "storage_backend": "postgres", "db_connected": true}
   ```
2. **Google Sign-In Flow:**
   - Open `https://cloud-camp-hackathon.vercel.app`.
   - Click **"Continue with Google"**.
   - Verify that your real Google email and name appear on the Profile screen.
   - Verify that new accounts start with clean 0 stats (0 meals, 0 active days, 0 streak).
3. **Multi-Agent Voice AI Assistant:**
   - Navigate to the **AI Coach** tab.
   - Switch between **Dr. Susmit** (Scientist) and **Farhana** (Habit Coach).
   - Use the mic button to speak a query; test switching the voice language pill between `বাং` and `EN`.
   - Confirm audio response plays automatically (via ElevenLabs or graceful browser speech synthesis).
   - Check the **Live DB Grounded** badge verifying that biometrics and today's meal records are incorporated into the advice.
4. **Admin Dashboard Flow:**
   - Sign in using an email configured in `ADMIN_EMAILS`.
   - Verify the 4 active tabs: **Overview** (with real 7-day sparkline), **Users**, **Popular Foods**, and **Review Queue**.
   - Verify that non-admin accounts receive `403 Forbidden` if attempting to access admin APIs.
5. **Theme Rendering:**
   - Switch between Light and Dark mode.
   - Confirm that Light mode is the default and that dark mode preserves high contrast without glaring white cards on the Nutrients chart.
