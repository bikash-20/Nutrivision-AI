/**
 * Shared runtime configuration for NutriVision AI.
 *
 * Resolves the backend API base URL dynamically:
 * - If `VITE_API_BASE` is set, use it.
 * - In browser on non-localhost (e.g. Vercel deployment), default to relative `''`
 *   so Vercel's rewrite rules in `vercel.json` proxy `/api/*` directly to Render backend.
 * - In local dev (localhost / 127.0.0.1) or Node test runner, default to `http://localhost:8000`.
 */

export function getApiBase(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE.replace(/\/+$/, '');
  }
  if (
    typeof window !== 'undefined' &&
    window.location?.hostname &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    return '';
  }
  return 'http://localhost:8000';
}

export const API_BASE: string = getApiBase();
