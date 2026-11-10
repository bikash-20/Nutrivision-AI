/**
 * API client for NutriVision AI.
 *
 * All operations (profile, grocery, meals, vision, nutrition, coach, admin)
 * communicate with the live FastAPI backend via `apiFetch`.
 * Requests include `Authorization: Bearer <token>` when a session exists.
 * Any 401 Unauthorized response clears the session and returns the user to Login.
 */

import type {
  AdminMetrics,
  AdminUserDetail,
  AdminUserSummary,
  AnalyzeResult,
  AuthSession,
  CoachChatRequest,
  CoachChatResponse,
  CoachTTSRequest,
  CoachTTSResponse,
  DetectedItem,
  GroceryItem,
  GroceryList,
  MealEntry,
  PopularFoodItem,
  ResolveNutritionResult,
  ResolvedItem,
  ReviewQueueItem,
  ReviewQueueUpdateRequest,
  RoomJoinResponse,
  RoomMessage,
  RoomPollResponse,
  RoomSendMessageRequest,
  TodaySummary,
  UserStats,
  UserProfile,
} from '../types/schemas';
import * as storage from './storage';
import { MOCK_NUTRITION_DB } from '../mocks/fixtures';
import { buildContributions, mealTotals, getDynamicTargets } from './personalize';
import { getApiBase } from './config';

// ── Backend wiring ──────────────────────────────────────────────────────

/**
 * Base URL of the FastAPI backend. Resolved dynamically using `getApiBase()`.
 */
export const API_BASE: string = getApiBase();

function isLocalOnlySession(): boolean {
  return Boolean(storage.load<AuthSession>('auth')?.localOnly);
}

function deviceKey(key: string): string {
  const email = storage.load<AuthSession>('auth')?.email ?? 'anonymous';
  return `${key}:${email.toLowerCase()}`;
}

function useLocalFallback(error: unknown): boolean {
  if (
    isLocalOnlySession() ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return true;
  }
  return error instanceof TypeError;
}

function localMeals(): MealEntry[] {
  return storage.load<MealEntry[]>(deviceKey('meals')) ?? [];
}

function saveLocalMeals(meals: MealEntry[]): void {
  storage.save(deviceKey('meals'), meals);
}

function localGroceryList(budget = 500): GroceryList {
  return storage.load<GroceryList>(deviceKey('grocery')) ?? { budget, groups: [] };
}

function saveLocalGroceryList(list: GroceryList): void {
  storage.save(deviceKey('grocery'), list);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('grocery-updated'));
}

function localGroceryItem(category: string, name: string, price: number): GroceryItem {
  const list = localGroceryList();
  const group = list.groups.find((item) => item.category === category);
  const item: GroceryItem = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    category,
    price,
    checked: false,
  };
  if (group) group.items.push(item);
  else list.groups.push({ category, items: [item] });
  saveLocalGroceryList(list);
  return item;
}

function localTodaySummary(): TodaySummary {
  const today = new Date();
  const profile = storage.load<UserProfile>(deviceKey('profile'));
  const meals = localMeals().filter((meal) => new Date(meal.date).toDateString() === today.toDateString());
  return meals.reduce<TodaySummary>((summary, meal) => ({
    mealsLogged: summary.mealsLogged + 1,
    totalKcal: summary.totalKcal + meal.totals.kcal,
    totalProtein: summary.totalProtein + meal.totals.protein,
    totalCarbs: summary.totalCarbs + meal.totals.carbs,
    totalFat: summary.totalFat + meal.totals.fat,
    dailyKcalTarget: summary.dailyKcalTarget,
  }), {
    mealsLogged: 0,
    totalKcal: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    dailyKcalTarget: profile?.dailyKcalTarget ?? 2000,
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public resetAt?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** POST/GET/DELETE JSON helper. Throws `ApiError` on non-2xx. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = storage.load<{ token?: string | null }>('auth');
  const authHeaders: Record<string, string> = session?.token
    ? { Authorization: `Bearer ${session.token}` }
    : {};

  const apiBase = getApiBase();
  const resp = await fetch(`${apiBase}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      storage.remove('auth');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-changed', { detail: null }));
      }
    }
    let detail = resp.statusText;
    let code: string | undefined;
    let resetAt: string | undefined;
    try {
      const body = await resp.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        const apiDetail = (body as { detail: unknown }).detail;
        if (typeof apiDetail === 'string') {
          detail = apiDetail;
        } else if (apiDetail && typeof apiDetail === 'object') {
          const structuredDetail = apiDetail as { message?: unknown; code?: unknown; reset_at?: unknown };
          if (typeof structuredDetail.message === 'string') detail = structuredDetail.message;
          if (typeof structuredDetail.code === 'string') code = structuredDetail.code;
          if (typeof structuredDetail.reset_at === 'string') resetAt = structuredDetail.reset_at;
        }
      }
    } catch {
      // Body wasn't JSON; fall back to statusText.
    }
    throw new ApiError(resp.status, detail, code, resetAt);
  }

  // 204 No Content → return undefined cast.
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

/**
 * Pristine, empty profile for a fresh authenticated user.
 */
export const DEFAULT_PROFILE: UserProfile = {
  name: '',
  age: null,
  sex: null,
  heightCm: null,
  weightKg: null,
  heightUnit: 'cm',
  weightUnit: 'kg',
  activityLevel: null,
  goal: null,
  targetRateKgPerWeek: null,
  dietType: null,
  medicalConditions: [],
  mealsPerDay: 3,
  consentAnonymizedData: true,
  language: 'en',
  goals: {
    diabetic: false,
    protein: false,
    budget: false,
    mediter: false,
  },
  preferences: [],
  allergens: [],
  budget: null,
  serving: 1,
  dailyKcalTarget: null,
};

// ── Vision pipeline ─────────────────────────────────────────────────────

/**
 * POST /api/vision/analyze  →  { detected, pipeline }
 */
export async function analyzeMeal(imageRef: string, uploadId?: string, imageHash?: string): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>('/api/vision/analyze', {
    method: 'POST',
    body: JSON.stringify({ image_ref: imageRef, upload_id: uploadId, image_hash: imageHash }),
  });
}

const LOCAL_ONLY_PHOTO_UPLOAD_LIMIT = 2;
const PHOTO_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export async function getPhotoUploadHash(imageRef: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ApiError(503, 'Secure photo verification is unavailable in this browser. Use HTTPS or localhost.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(imageRef));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getPhotoUploadHashFromBytes(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ApiError(503, 'Secure photo verification is unavailable in this browser. Use HTTPS or localhost.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reserveLocalPhotoUpload(uploadId: string, imageHash: string): void {
  const email = storage.load<AuthSession>('auth')?.email?.toLowerCase() ?? 'anonymous';
  const key = `nv_photo_uploads:${email}`;
  let uploads: Array<{ id: string; imageHash: string; createdAt: number }> = [];
  try {
    const raw = localStorage.getItem(key);
    uploads = raw ? (JSON.parse(raw) as Array<{ id: string; imageHash: string; createdAt: number }>) : [];
  } catch {
    throw new ApiError(503, 'Unable to read this device’s photo upload limit. Check browser storage settings.');
  }
  const cutoff = Date.now() - PHOTO_UPLOAD_WINDOW_MS;
  uploads = uploads.filter(
    (entry) => entry && typeof entry.id === 'string' && typeof entry.imageHash === 'string'
      && Number.isFinite(entry.createdAt) && entry.createdAt > cutoff,
  );
  const existing = uploads.find((entry) => entry.id === uploadId);
  if (existing) {
    if (existing.imageHash !== imageHash) {
      throw new ApiError(409, 'This upload ID is already associated with a different photo.');
    }
    return;
  }
  if (uploads.length >= LOCAL_ONLY_PHOTO_UPLOAD_LIMIT) {
    const resetAt = Math.min(...uploads.map((entry) => entry.createdAt)) + PHOTO_UPLOAD_WINDOW_MS;
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
    const resetMessage = minutes >= 55 ? 'one hour' : `${minutes} minutes`;
    throw new ApiError(
      429,
      `You’ve reached the limit of ${LOCAL_ONLY_PHOTO_UPLOAD_LIMIT} photo uploads per hour. You can upload again when your limit resets in ${resetMessage}. Paid plans are coming soon.`,
      'photo_upload_limit_reached',
      new Date(resetAt).toISOString(),
    );
  }
  uploads.push({ id: uploadId, imageHash, createdAt: Date.now() });
  try {
    localStorage.setItem(key, JSON.stringify(uploads));
  } catch {
    throw new ApiError(503, 'Unable to save this device’s photo upload limit. Check browser storage settings.');
  }
}

/** Reserve the hourly photo allowance before running local or hosted image analysis. */
export async function reservePhotoUpload(uploadId: string, imageHash: string): Promise<void> {
  const session = storage.load<AuthSession>('auth');
  if (
    session?.localOnly
    || !session?.token
    || (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    reserveLocalPhotoUpload(uploadId, imageHash);
    return;
  }
  await apiFetch<{ limit: number; remaining: number; reset_at: string }>('/api/vision/quota', {
    method: 'POST',
    body: JSON.stringify({ upload_id: uploadId, image_hash: imageHash }),
  });
}

// ── Nutrition resolution ────────────────────────────────────────────────

/**
 * POST /api/nutrition/resolve  →  { resolved, contributions }
 */
export async function resolveNutrition(
  items: DetectedItem[],
  profile?: UserProfile,
): Promise<ResolveNutritionResult> {
  if (isLocalOnlySession()) {
    const resolved: ResolvedItem[] = items.map((item) => {
      const descriptor = MOCK_NUTRITION_DB[item.name] ?? null;
      return {
        ...item,
        descriptor,
        nutrition: descriptor ? { ...descriptor } : null,
        source: descriptor ? 'cache' : 'estimated',
        partial: descriptor == null,
      };
    });
    const totals = mealTotals(resolved);
    return { resolved, contributions: buildContributions(resolved, totals, profile) };
  }
  try {
    return await apiFetch<ResolveNutritionResult>('/api/nutrition/resolve', {
      method: 'POST',
      body: JSON.stringify({ items, profile: profile ?? null }),
    });
  } catch (err) {
    if (!useLocalFallback(err)) throw err;
    const resolved: ResolvedItem[] = items.map((it) => {
      const descriptor = MOCK_NUTRITION_DB[it.name] ?? null;
      return {
        ...it,
        descriptor,
        nutrition: descriptor ? { ...descriptor } : null,
        source: descriptor ? 'cache' : 'estimated',
        partial: descriptor == null,
      };
    });
    const totals = mealTotals(resolved);
    const contributions = buildContributions(resolved, totals, profile);
    return { resolved, contributions };
  }
}

// ── Profile ─────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile> {
  const key = deviceKey('profile');
  if (isLocalOnlySession()) return storage.load<UserProfile>(key) ?? DEFAULT_PROFILE;
  try {
    const profile = await apiFetch<UserProfile>('/api/profile');
    storage.save(key, profile);
    return profile;
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    const profile = storage.load<UserProfile>(key) ?? DEFAULT_PROFILE;
    storage.save(key, profile);
    return profile;
  }
}

export async function updateProfile(p: UserProfile): Promise<UserProfile> {
  if (isLocalOnlySession()) {
    storage.save(deviceKey('profile'), p);
    return p;
  }
  try {
    const updated = await apiFetch<UserProfile>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(p),
    });
    storage.save(deviceKey('profile'), updated);
    return updated;
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    storage.save(deviceKey('profile'), p);
    return p;
  }
}

// ── Grocery list ────────────────────────────────────────────────────────

export async function getGroceryList(profile: UserProfile): Promise<GroceryList> {
  const budget = profile.budget ?? 500;
  if (isLocalOnlySession()) {
    const list = localGroceryList(budget);
    list.budget = budget;
    return list;
  }
  try {
    const list = await apiFetch<GroceryList>(`/api/grocery?budget=${encodeURIComponent(budget)}`);
    storage.save(deviceKey('grocery'), list);
    return list;
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    return localGroceryList(budget);
  }
}

export async function addGroceryItem(
  category: string,
  name: string,
  price: number,
): Promise<GroceryItem> {
  const item = isLocalOnlySession()
    ? localGroceryItem(category, name, price)
    : await apiFetch<GroceryItem>('/api/grocery/items', {
        method: 'POST',
        body: JSON.stringify({ category, name, price }),
      }).catch((error: unknown) => {
        if (!useLocalFallback(error)) throw error;
        return localGroceryItem(category, name, price);
      });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('grocery-updated', { detail: item }));
  }
  return item;
}

/**
 * Add multiple grocery items in a single atomic batch request.
 * Falls back to parallel individual additions if the batch endpoint is unreachable.
 */
export async function addGroceryItemsBatch(
  items: Array<{ category?: string; name: string; price: number }>,
): Promise<GroceryItem[]> {
  if (items.length === 0) return [];

  try {
    if (isLocalOnlySession()) return items.map((item) => localGroceryItem(item.category || 'Produce', item.name, item.price));
    const payload = items.map((i) => ({
      category: i.category || 'Produce',
      name: i.name,
      price: i.price,
    }));
    const created = await apiFetch<GroceryItem[]>('/api/grocery/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('grocery-updated', { detail: created }));
    }
    return created;
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    return items.map((item) => localGroceryItem(item.category || 'Produce', item.name, item.price));
  }
}

export async function removeGroceryItem(itemId: string): Promise<void> {
  if (isLocalOnlySession()) {
    saveLocalGroceryList(removeLocalGroceryItem(itemId));
    return;
  }
  try {
    await apiFetch<void>(`/api/grocery/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    saveLocalGroceryList(removeLocalGroceryItem(itemId));
  }
}

export async function updateGroceryPrice(itemId: string, price: number): Promise<void> {
  if (!isLocalOnlySession()) {
    try {
      await apiFetch<void>(`/api/grocery/items/${encodeURIComponent(itemId)}/price`, {
        method: 'PUT',
        body: JSON.stringify({ price }),
      });
      return;
    } catch (error) {
      if (!useLocalFallback(error)) throw error;
    }
  }
  const list = localGroceryList();
  for (const group of list.groups) {
    const item = group.items.find((entry) => entry.id === itemId);
    if (item) item.price = price;
  }
  saveLocalGroceryList(list);
}

export async function toggleGroceryItem(itemId: string): Promise<GroceryItem> {
  if (!isLocalOnlySession()) {
    try {
      return await apiFetch<GroceryItem>(`/api/grocery/items/${encodeURIComponent(itemId)}/toggle`, { method: 'POST' });
    } catch (error) {
      if (!useLocalFallback(error)) throw error;
    }
  }
  const list = localGroceryList();
  for (const group of list.groups) {
    const item = group.items.find((entry) => entry.id === itemId);
    if (item) {
      item.checked = !item.checked;
      saveLocalGroceryList(list);
      return item;
    }
  }
  throw new ApiError(404, 'Grocery item not found on this device.');
}

export async function clearGroceryList(): Promise<void> {
  if (!isLocalOnlySession()) {
    try {
      await apiFetch<void>('/api/grocery', { method: 'DELETE' });
    } catch (error) {
      if (!useLocalFallback(error)) throw error;
    }
  }
  saveLocalGroceryList({ ...localGroceryList(), groups: [] });
}

function removeLocalGroceryItem(itemId: string): GroceryList {
  const list = localGroceryList();
  list.groups = list.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.id !== itemId) }))
    .filter((group) => group.items.length > 0);
  return list;
}

// ── Meal history ────────────────────────────────────────────────────────

/** Save a completed meal to history. */
export async function saveMeal(entry: Omit<MealEntry, 'id' | 'date'>): Promise<MealEntry> {
  const e = entry as any;
  const payload = {
    ...entry,
    photo_url: e.photoUrl ?? e.photo_url ?? null,
    photoUrl: e.photoUrl ?? e.photo_url ?? null,
    active_goals: e.activeGoals ?? e.active_goals ?? {
      diabetic: false,
      protein: false,
      budget: false,
      mediter: false,
    },
    activeGoals: e.activeGoals ?? e.active_goals ?? {
      diabetic: false,
      protein: false,
      budget: false,
      mediter: false,
    },
  };
  const saveLocal = () => {
    const saved: MealEntry = {
      ...entry,
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
    };
    saveLocalMeals([saved, ...localMeals()]);
    return saved;
  };
  const saved = isLocalOnlySession()
    ? saveLocal()
    : await apiFetch<MealEntry>('/api/meals', {
        method: 'POST',
        body: JSON.stringify(payload),
      }).then((result) => {
        saveLocalMeals([result, ...localMeals().filter((meal) => meal.id !== result.id)]);
        return result;
      }).catch((error: unknown) => {
        if (!useLocalFallback(error)) throw error;
        return saveLocal();
      });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meal-history-updated', { detail: saved }));
  }
  return saved;
}

/** Update the most recent meal with updated items, totals, or label. */
export async function updateLatestMeal(updates: Partial<MealEntry>): Promise<MealEntry | null> {
  const updateLocal = () => {
    const meals = localMeals();
    if (!meals.length) return null;
    const updated = { ...meals[0], ...updates };
    saveLocalMeals([updated, ...meals.slice(1)]);
    return updated;
  };
  const updated = isLocalOnlySession()
    ? updateLocal()
    : await apiFetch<MealEntry | null>('/api/meals/latest', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }).then((result) => {
        if (result) saveLocalMeals([result, ...localMeals().filter((meal) => meal.id !== result.id)]);
        return result;
      }).catch((error: unknown) => {
        if (!useLocalFallback(error)) throw error;
        return updateLocal();
      });
  if (updated && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meal-history-updated', { detail: updated }));
  }
  return updated;
}

/** Get full meal history for the authenticated user, most recent first. */
export async function getMealHistory(): Promise<MealEntry[]> {
  if (isLocalOnlySession()) return localMeals();
  try {
    const remote = await apiFetch<MealEntry[]>('/api/meals');
    const merged = [...remote, ...localMeals().filter((local) => !remote.some((meal) => meal.id === local.id))]
      .sort((a, b) => b.date.localeCompare(a.date));
    saveLocalMeals(merged);
    return merged;
  } catch (error) {
    if (!useLocalFallback(error)) throw error;
    return localMeals();
  }
}

/** Get meals logged today for the authenticated user. */
export async function getTodaySummary(): Promise<TodaySummary> {
  if (isLocalOnlySession()) return localTodaySummary();
  try {
    const raw = await apiFetch<any>('/api/meals/today');
    return {
      mealsLogged: Number(raw?.mealsLogged ?? raw?.meals_logged ?? 0),
      totalKcal: Number(raw?.totalKcal ?? raw?.total_kcal ?? 0),
      totalProtein: Number(raw?.totalProtein ?? raw?.total_protein ?? 0),
      totalCarbs: Number(raw?.totalCarbs ?? raw?.total_carbs ?? 0),
      totalFat: Number(raw?.totalFat ?? raw?.total_fat ?? 0),
      dailyKcalTarget: Number(raw?.dailyKcalTarget ?? raw?.daily_kcal_target ?? 2000),
    };
  } catch {
    return localTodaySummary();
  }
}

export function calculateStreak(days: Set<string>): number {
  if (days.size === 0) return 0;
  const sortedDays = Array.from(days).sort().reverse();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const todayStr = toDateStr(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  let checkDate: Date;
  if (days.has(todayStr)) {
    checkDate = now;
  } else if (days.has(yesterdayStr)) {
    checkDate = yesterday;
  } else {
    const mostRecentStr = sortedDays[0];
    const parts = mostRecentStr.split('-').map(Number);
    checkDate = new Date(parts[0], parts[1] - 1, parts[2]);
  }

  let streak = 0;
  while (true) {
    const s = toDateStr(checkDate);
    if (days.has(s)) {
      streak += 1;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/** Get aggregated user statistics for the profile screen. */
export async function getUserStats(): Promise<UserStats> {
  if (isLocalOnlySession()) {
    const meals = localMeals();
    const dates = new Set(meals.map((meal) => meal.date.slice(0, 10)));
    return {
      totalMeals: meals.length,
      totalDaysActive: dates.size,
      avgDailyKcal: dates.size
        ? meals.reduce((total, meal) => total + meal.totals.kcal, 0) / dates.size
        : 0,
      streakDays: calculateStreak(dates),
    };
  }
  try {
    const raw = await apiFetch<any>('/api/meals/stats');
    return {
      totalMeals: Number(raw?.totalMeals ?? raw?.total_meals ?? 0),
      totalDaysActive: Number(raw?.totalDaysActive ?? raw?.total_days_active ?? 0),
      avgDailyKcal: Number(raw?.avgDailyKcal ?? raw?.avg_daily_kcal ?? 0),
      streakDays: Number(raw?.streakDays ?? raw?.streak_days ?? 0),
    };
  } catch {
    const meals = localMeals();
    const dates = new Set(meals.map((meal) => meal.date.slice(0, 10)));
    return {
      totalMeals: meals.length,
      totalDaysActive: dates.size,
      avgDailyKcal: dates.size
        ? meals.reduce((total, meal) => total + meal.totals.kcal, 0) / dates.size
        : 0,
      streakDays: calculateStreak(dates),
    };
  }
}

/** Delete a meal from history. */
export async function deleteMeal(mealId: string): Promise<void> {
  if (!isLocalOnlySession()) {
    try {
      await apiFetch<void>(`/api/meals/${encodeURIComponent(mealId)}`, { method: 'DELETE' });
    } catch (error) {
      if (!useLocalFallback(error)) throw error;
    }
  }
  saveLocalMeals(localMeals().filter((meal) => meal.id !== mealId));
}

// ── Multi-Agent AI Coach ────────────────────────────────────────────────

export async function sendCoachChat(req: CoachChatRequest): Promise<CoachChatResponse> {
  if (isLocalOnlySession()) {
    throw new Error('This is a local-only session. Use an installed local model for AI chat.');
  }
  return apiFetch<CoachChatResponse>('/api/coach/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/**
 * Send voice chat query to the multi-agent AI Coach.
 * Includes audio generation (ElevenLabs ultra-low latency or browser fallback)
 * and auto-enriches context from PostgreSQL nv_users, nv_meals, and nv_grocery.
 */
export async function sendCoachVoiceChat(req: CoachChatRequest): Promise<CoachChatResponse> {
  if (isLocalOnlySession()) {
    throw new Error('This is a local-only session. Use the configured local model and voice services.');
  }
  return apiFetch<CoachChatResponse>('/api/coach/voice-chat', {
    method: 'POST',
    body: JSON.stringify({ ...req, include_audio: true }),
  });
}

/** Remote-only AI chat. Local-only sessions must use the configured local model. */
export async function sendCoachRemote(req: CoachChatRequest): Promise<CoachChatResponse> {
  if (isLocalOnlySession()) {
    throw new Error('This is a local-only session. Use an installed local model for AI chat.');
  }
  return apiFetch<CoachChatResponse>('/api/coach/voice-chat', {
    method: 'POST',
    body: JSON.stringify({ ...req, include_audio: false }),
  });
}

/**
 * Synthesize speech on-demand for a given text snippet.
 */
export async function generateCoachTTS(req: CoachTTSRequest): Promise<CoachTTSResponse> {
  if (isLocalOnlySession()) {
    throw new Error('This is a local-only session. Use the configured local Qwen3-TTS service.');
  }
  return apiFetch<CoachTTSResponse>('/api/coach/tts', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Aggregate targets (for NutrientsScreen) ─────────────────────────────

export function getMacroTargets(profile?: UserProfile | null) {
  return getDynamicTargets(profile);
}

/** Fetch live telemetry metrics from backend for the admin dashboard. */
export async function getAdminMetrics(): Promise<AdminMetrics | null> {
  try {
    return await apiFetch<AdminMetrics>('/api/admin/metrics');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch admin metrics:', err);
    return null;
  }
}

/** Get searchable and sortable list of all registered platform users. */
export async function getAdminUsers(
  search?: string,
  sortBy?: string,
  order?: string,
): Promise<AdminUserSummary[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (sortBy) params.set('sortBy', sortBy);
  if (order) params.set('order', order);
  const q = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<AdminUserSummary[]>(`/api/admin/users${q}`);
}

/** Get comprehensive admin details for a specific user. */
export async function getAdminUserDetail(email: string): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(email)}`);
}

/** Get popular food breakdown across all users. */
export async function getPopularFoods(range: string = '7d'): Promise<PopularFoodItem[]> {
  return apiFetch<PopularFoodItem[]>(`/api/admin/popular-foods?range=${encodeURIComponent(range)}`);
}

/** Get review queue items (flagged meals with confidence <70%). */
export async function getReviewQueue(status: string = 'all'): Promise<ReviewQueueItem[]> {
  return apiFetch<ReviewQueueItem[]>(`/api/admin/review-queue?status=${encodeURIComponent(status)}`);
}

/** Approve, correct, or dismiss a flagged meal from the review queue. */
export async function updateReviewQueue(
  mealId: string,
  req: ReviewQueueUpdateRequest,
): Promise<ReviewQueueItem> {
  return apiFetch<ReviewQueueItem>(`/api/admin/review-queue/${encodeURIComponent(mealId)}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
}

export interface StorageHealthInfo {
  status: string;
  storage_backend: 'postgres' | 'json';
  db_connected: boolean;
  host: string | null;
  error?: string | null;
}

/** Get storage backend type & DB connection status for health visibility. */
export async function getStorageHealth(): Promise<StorageHealthInfo> {
  try {
    return await apiFetch<StorageHealthInfo>('/api/health');
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      try {
        const resp = await fetch(`${getApiBase()}/api/health`, { cache: 'no-store' });
        return await resp.json();
      } catch {
        // Fallback
      }
    }
    return {
      status: 'error',
      storage_backend: 'json',
      db_connected: false,
      host: null,
      error: err instanceof Error ? err.message : 'Storage check failed',
    };
  }
}

// ── Ephemeral Room Chat ─────────────────────────────────────────────────

export async function createRoom(
  displayName: string,
  options?: { accountId?: string | null; clientId?: string | null },
): Promise<RoomJoinResponse> {
  return apiFetch<RoomJoinResponse>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      display_name: displayName,
      account_id: options?.accountId ?? null,
      client_id: options?.clientId ?? null,
    }),
  });
}

export async function joinRoom(
  code: string,
  displayName: string,
  participantId?: string | null,
  options?: { accountId?: string | null; clientId?: string | null },
): Promise<RoomJoinResponse> {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return apiFetch<RoomJoinResponse>(`/api/rooms/${encodeURIComponent(cleanCode)}/join`, {
    method: 'POST',
    body: JSON.stringify({
      display_name: displayName,
      participant_id: participantId ?? null,
      account_id: options?.accountId ?? null,
      client_id: options?.clientId ?? null,
    }),
  });
}

export async function leaveRoom(
  code: string,
  participantId: string,
  options?: { clientId?: string | null; force?: boolean },
): Promise<void> {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    await apiFetch<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(cleanCode)}/leave`, {
      method: 'POST',
      body: JSON.stringify({
        participant_id: participantId,
        client_id: options?.clientId ?? null,
        force: options?.force ?? true,
      }),
    });
  } catch {
    // Best-effort leave notification.
  }
}

export async function clearRoomHistoryRemote(code: string): Promise<void> {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  try {
    await apiFetch<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(cleanCode)}/clear`, {
      method: 'POST',
    });
  } catch {
    // Best-effort clear.
  }
}

export async function sendRoomMessage(
  code: string,
  req: RoomSendMessageRequest,
): Promise<RoomMessage> {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return apiFetch<RoomMessage>(`/api/rooms/${encodeURIComponent(cleanCode)}/messages`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function pollRoom(
  code: string,
  participantId: string,
  afterSeq: number,
  clientId?: string | null,
): Promise<RoomPollResponse> {
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const params = new URLSearchParams({
    participant_id: participantId,
    after_seq: String(Math.max(0, afterSeq)),
  });
  if (clientId) params.set('client_id', clientId);
  return apiFetch<RoomPollResponse>(`/api/rooms/${encodeURIComponent(cleanCode)}/poll?${params.toString()}`);
}

export function getRoomWsUrl(
  code: string,
  participantId: string,
  displayName: string,
  options?: { accountId?: string | null; clientId?: string | null },
): string | null {
  const base = getApiBase();
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    return null;
  }
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const params = new URLSearchParams({
    participant_id: participantId,
    display_name: displayName,
  });
  const token = storage.load<AuthSession>('auth')?.token;
  if (token) params.set('token', token);
  if (options?.accountId) params.set('account_id', options.accountId);
  if (options?.clientId) params.set('client_id', options.clientId);
  return `${wsBase}/api/rooms/ws/${encodeURIComponent(cleanCode)}?${params.toString()}`;
}
