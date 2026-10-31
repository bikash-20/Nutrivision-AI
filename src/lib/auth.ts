/**
 * Authentication module supporting Google Identity Services (OAuth 2.0).
 *
 * All logins authenticate strictly through the FastAPI backend (`POST /api/auth/google`),
 * which validates the Google ID token and issues a secure JWT session.
 *
 * Persists session record under `auth`.
 */

import type { AuthSession, GoogleAuthResponse } from '../types/schemas';
import * as storage from './storage';
import { getApiBase } from './config';

const SESSION_KEY = 'auth';

/** Returns the persisted session, or null if not signed in. */
export function getSession(): AuthSession | null {
  return storage.load<AuthSession>(SESSION_KEY);
}

/**
 * Sign in using Google ID token from Google Identity Services.
 * Hits backend `/api/auth/google` to verify against Google and receive
 * an authorized session.
 *
 * Implements a 45-second timeout via AbortController so Render free-tier
 * cold starts are handled gracefully with a clear message.
 */
export async function loginWithGoogle(idToken: string): Promise<AuthSession> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    const apiBase = getApiBase();
    const resp = await fetch(`${apiBase}/api/auth/google`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      let detail = 'Google authentication verification failed.';
      try {
        const body = await resp.json();
        if (body?.detail) {
          detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        }
      } catch {
        // non-JSON response
      }
      throw new Error(`Authentication error (${resp.status}): ${detail}`);
    }

    const data: GoogleAuthResponse = await resp.json();
    storage.save(SESSION_KEY, data.session);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-changed', { detail: data.session }));
    }
    return data.session;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Server wake-up timed out (backend cold start took longer than 45 seconds). Please try again.',
      );
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Network error connecting to backend authentication server.');
  }
}

/** Clear the persisted session and trigger logout events. */
export function logout(): void {
  storage.remove(SESSION_KEY);
  if (typeof window !== 'undefined') {
    if (window.google?.accounts?.id?.disableAutoSelect) {
      try {
        window.google.accounts.id.disableAutoSelect();
      } catch {
        // ignore
      }
    }
    window.dispatchEvent(new CustomEvent('auth-changed', { detail: null }));
  }
}
