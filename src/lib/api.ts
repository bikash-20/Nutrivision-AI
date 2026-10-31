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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
    try {
      const body = await resp.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // Body wasn't JSON; fall back to statusText.
    }
    throw new ApiError(resp.status, `API ${resp.status}: ${detail}`);
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
export async function analyzeMeal(imageRef: string): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>('/api/vision/analyze', {
    method: 'POST',
    body: JSON.stringify({ image_ref: imageRef }),
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
  try {
    return await apiFetch<ResolveNutritionResult>('/api/nutrition/resolve', {
      method: 'POST',
      body: JSON.stringify({ items, profile: profile ?? null }),
    });
  } catch (err) {
    // If backend is unreachable in local dev, provide offline lookup fallback
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
  return apiFetch<UserProfile>('/api/profile');
}

export async function updateProfile(p: UserProfile): Promise<UserProfile> {
  return apiFetch<UserProfile>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(p),
  });
}

// ── Grocery list ────────────────────────────────────────────────────────

export async function getGroceryList(profile: UserProfile): Promise<GroceryList> {
  const budget = profile.budget ?? 500;
  return apiFetch<GroceryList>(`/api/grocery?budget=${encodeURIComponent(budget)}`);
}

export async function addGroceryItem(
  category: string,
  name: string,
  price: number,
): Promise<GroceryItem> {
  const item = await apiFetch<GroceryItem>('/api/grocery/items', {
    method: 'POST',
    body: JSON.stringify({ category, name, price }),
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
  } catch {
    const fallbackResults = await Promise.all(
      items.map((i) => addGroceryItem(i.category || 'Produce', i.name, i.price)),
    );
    return fallbackResults;
  }
}

export async function removeGroceryItem(itemId: string): Promise<void> {
  await apiFetch<void>(`/api/grocery/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

export async function updateGroceryPrice(itemId: string, price: number): Promise<void> {
  await apiFetch<void>(`/api/grocery/items/${encodeURIComponent(itemId)}/price`, {
    method: 'PUT',
    body: JSON.stringify({ price }),
  });
}

export async function toggleGroceryItem(itemId: string): Promise<GroceryItem> {
  return apiFetch<GroceryItem>(`/api/grocery/items/${encodeURIComponent(itemId)}/toggle`, {
    method: 'POST',
  });
}

export async function clearGroceryList(): Promise<void> {
  await apiFetch<void>('/api/grocery', {
    method: 'DELETE',
  });
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
  const saved = await apiFetch<MealEntry>('/api/meals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meal-history-updated', { detail: saved }));
  }
  return saved;
}

/** Update the most recent meal with updated items, totals, or label. */
export async function updateLatestMeal(updates: Partial<MealEntry>): Promise<MealEntry | null> {
  const updated = await apiFetch<MealEntry | null>('/api/meals/latest', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (updated && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meal-history-updated', { detail: updated }));
  }
  return updated;
}

/** Get full meal history for the authenticated user, most recent first. */
export async function getMealHistory(): Promise<MealEntry[]> {
  return apiFetch<MealEntry[]>('/api/meals');
}

/** Get meals logged today for the authenticated user. */
export async function getTodaySummary(): Promise<TodaySummary> {
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
    return {
      mealsLogged: 0,
      totalKcal: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      dailyKcalTarget: 2000,
    };
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
  try {
    const raw = await apiFetch<any>('/api/meals/stats');
    return {
      totalMeals: Number(raw?.totalMeals ?? raw?.total_meals ?? 0),
      totalDaysActive: Number(raw?.totalDaysActive ?? raw?.total_days_active ?? 0),
      avgDailyKcal: Number(raw?.avgDailyKcal ?? raw?.avg_daily_kcal ?? 0),
      streakDays: Number(raw?.streakDays ?? raw?.streak_days ?? 0),
    };
  } catch {
    return {
      totalMeals: 0,
      totalDaysActive: 0,
      avgDailyKcal: 0,
      streakDays: 0,
    };
  }
}

/** Delete a meal from history. */
export async function deleteMeal(mealId: string): Promise<void> {
  await apiFetch<void>(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: 'DELETE',
  });
}

// ── Multi-Agent AI Coach ────────────────────────────────────────────────

export async function sendCoachChat(req: CoachChatRequest): Promise<CoachChatResponse> {
  try {
    return await apiFetch<CoachChatResponse>('/api/coach/chat', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  } catch {
    // Offline local fallback
    const isScientist = req.agent_type === 'scientist';
    const lastMsg =
      req.message ||
      (req.messages && req.messages[req.messages.length - 1]?.content) ||
      '';
    const hasBnChars = /[\u0980-\u09FF]/.test(lastMsg);
    const isBn = req.lang === 'bn' || (hasBnChars && req.lang !== 'en');
    const cleanMsg = lastMsg.toLowerCase().replace(/[!.,?।]+/g, '').trim();
    const greetings = [
      'hello',
      'hi',
      'hey',
      'greetings',
      'good morning',
      'good evening',
      'how are you',
      'how are you doing',
      'whats up',
      "what's up",
      'হ্যালো',
      'হাই',
      'হে',
      'সালাম',
      'নমস্কার',
      'আদাব',
      'কেমন আছেন',
      'কেমন আছো',
      'kemon achen',
      'kemon acho',
    ];
    const isGreeting = greetings.some((g) => cleanMsg === g || cleanMsg.startsWith(g + ' '));

    if (isGreeting) {
      if (isScientist) {
        return {
          reply: isBn
            ? 'হ্যালো! আজকের খাবারে পুষ্টি বা ক্যালরি নিয়ে কী জানতে চান? 🔬'
            : 'Hello! What would you like to know about nutrition or calories today? 🔬',
          citations: ['BIRDEM ক্লিনিক্যাল গাইডলাইন'],
          suggested_prompts: isBn
            ? [
                'এই খাবারের গ্লাইসেমিক লোড কীভাবে কমাব?',
                'রান্নায় তেল শোষণ কমানোর বৈজ্ঞানিক পদ্ধতি কী?',
                'বাজেট ফ্রেন্ডলি প্রোটিন উৎস কী কী?',
              ]
            : [
                'How do I lower the glycemic load of this meal?',
                'How to reduce cooking oil absorption?',
                'What are budget-friendly protein sources?',
              ],
          agent_type: 'scientist',
        };
      }
      return {
        reply: isBn
          ? 'হ্যালো! আজকে আপনার ডায়েট ট্র্যাকিং কেমন চলছে? 💚'
          : 'Hello! How is your diet tracking and wellness journey going today? 💚',
        citations: ['CBT ও অভ্যাস বিজ্ঞান'],
        suggested_prompts: isBn
          ? [
              'দাওয়াতে অতিরিক্ত খাওয়ার পর কী করব?',
              'রাতের মিষ্টি বা চায়ের আড্ডার লোভ কীভাবে সামলাব?',
              'ব্যস্ত দিনে হেলদি ডায়েট ধরে রাখার সহজ রুটিন কী?',
            ]
          : [
              'How to bounce back after a heavy feast?',
              'How to manage evening sweet cravings?',
              'Easy routines for healthy habits on busy days?',
            ],
        agent_type: req.agent_type === 'behavioral' ? 'behavioral' : 'coach',
      };
    }

    if (isScientist) {
      return {
        reply: isBn
          ? '🔬 **বায়োকেমিক্যাল পুষ্টি বিশ্লেষণ (ড. সুস্মিত):**\n\nখাবারের গ্লাইসেমিক লোড নিয়ন্ত্রণে রাখতে পর্যাপ্ত ফাইবার ও প্রোটিন যুক্ত করুন।\n\n[উৎস: BIRDEM ক্লিনিক্যাল গাইডলাইন]'
          : '🔬 **Nutritional Biochemical Analysis:**\n\nTo optimize glycemic response, buffer carbs with soluble dietary fiber and lean protein.\n\n[Source: BIRDEM Clinical Protocols]',
        citations: ['BIRDEM ক্লিনিক্যাল গাইডলাইন'],
        suggested_prompts: isBn
          ? ['এই খাবারের গ্লাইসেমিক লোড কীভাবে কমাব?', 'বাজেট ফ্রেন্ডলি প্রোটিন উৎস কী কী?']
          : ['How do I lower the glycemic load of this meal?', 'What are budget-friendly protein sources?'],
        agent_type: 'scientist',
      };
    }

    return {
      reply: isBn
        ? '🧠 **আচরণ ও অভ্যাস কোচের বার্তা:**\n\nসুস্থ খাদ্যাভ্যাস গড়ে তোলা একটি ধারাবাহিক প্রক্রিয়া। প্রতিটি ছোট পদক্ষেপই গুরুত্বপূর্ণ! 💚'
        : '🧠 **Habit Coach Perspective:**\n\nBuilding sustainable nutrition is a daily journey. Every mindful choice counts! 💚',
      citations: ['CBT ও অভ্যাস বিজ্ঞান'],
      suggested_prompts: isBn
        ? ['দাওয়াতে অতিরিক্ত খাওয়ার পর কী করব?', 'ব্যস্ত দিনে হেলদি ডায়েট ধরে রাখার সহজ রুটিন কী?']
        : ['How to bounce back after a heavy feast?', 'Easy routines for healthy habits on busy days?'],
      agent_type: req.agent_type === 'behavioral' ? 'behavioral' : 'coach',
    };
  }
}

/**
 * Send voice chat query to the multi-agent AI Coach.
 * Includes audio generation (ElevenLabs ultra-low latency or browser fallback)
 * and auto-enriches context from PostgreSQL nv_users, nv_meals, and nv_grocery.
 */
export async function sendCoachVoiceChat(req: CoachChatRequest): Promise<CoachChatResponse> {
  try {
    return await apiFetch<CoachChatResponse>('/api/coach/voice-chat', {
      method: 'POST',
      body: JSON.stringify({ ...req, include_audio: true }),
    });
  } catch (err) {
    const diagMsg = err instanceof Error ? err.message : String(err);
    // Offline local fallback: run standard sendCoachChat and flag use_browser_tts
    const fallbackResp = await sendCoachChat(req);
    const plainText = fallbackResp.reply
      .replace(/\[(?:উৎস|Source):[^\]]+\]/g, '')
      .replace(/[*#_`>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      ...fallbackResp,
      voice_summary: plainText.slice(0, 180),
      audio_base64: null,
      use_browser_tts: true,
      tts_diagnostic: `client_network_fallback: ${diagMsg}`,
    };
  }
}

/**
 * Synthesize speech on-demand for a given text snippet.
 */
export async function generateCoachTTS(req: CoachTTSRequest): Promise<CoachTTSResponse> {
  try {
    return await apiFetch<CoachTTSResponse>('/api/coach/tts', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  } catch (err) {
    const diagMsg = err instanceof Error ? err.message : String(err);
    return {
      audio_base64: null,
      audio_mime_type: 'audio/mpeg',
      use_browser_tts: true,
      tts_diagnostic: `client_fetch_error: ${diagMsg}`,
    };
  }
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
