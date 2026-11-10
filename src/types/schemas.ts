/**
 * NutriVision AI — TypeScript schema contracts
 *
 * Mirrors the planned `app/models/schemas.py` (FastAPI/Pydantic) on the
 * backend. This file is the **source of truth** for the frontend.
 *
 * Per the blueprint's Section 8 directive, any backend schema change
 * requires this file to update in lockstep to avoid integration drift.
 *
 * Naming convention:
 *   - PascalCase types
 *   - snake_case fields (matches what a Python backend would emit)
 *   - All numeric nutrient values are per-100g servings unless suffixed
 */

// ─────────────────────────────────────────────────────────────────────────
//  Core nutrition primitives
// ─────────────────────────────────────────────────────────────────────────

/** Per-100g macro/micro nutrient facts for a single food item. */
export interface NutritionFacts {
  /** grams of protein */
  protein: number;
  /** grams of carbohydrates */
  carbs: number;
  /** grams of fat */
  fat: number;
  /** kilocalories */
  kcal: number;
  /** grams of fiber */
  fiber: number;
  /** milligrams of sodium */
  sodium: number;
  /** grams of sugar */
  sugar: number;
  /** glycemic share, 0–1 (used by personalize filter) */
  glycemic: number;
}

/** Food category used to pick tile gradients and grocery group routing. */
export type FoodCategory = 'protein' | 'produce' | 'grains' | 'other';

/** A single food with display metadata + per-100g nutrition. */
export interface FoodDescriptor extends NutritionFacts {
  emoji: string;
  category: FoodCategory;
  /** Alternative names the vision model may also emit. */
  alternatives: string[];
  /** Pairings the grocery list may suggest. */
  pairings: string[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Vision pipeline outputs
// ─────────────────────────────────────────────────────────────────────────

/**
 * One food item detected by the dual vision pipeline (Gemini + HF validator)
 * before nutrition is resolved.
 */
export interface DetectedItem {
  /** Canonical food name; should match a key in NUTRITION_DB */
  name: string;
  /** Optional Bengali display name; `name` remains canonical for data lookups. */
  name_bn?: string | null;
  /** Confidence 0–100; <70 is flagged low-confidence */
  confidence: number;
  /** Estimated portion size in grams */
  grams: number;
  /** Optional user-facing note (e.g. "Low confidence — tap to confirm") */
  note?: string | null;
  /** Optional bounding box from the vision model [x, y, w, h] in 0–1 space */
  bbox?: [number, number, number, number];
}

/**
 * A DetectedItem after passing through the nutrition DB cascade (OFF →
 * USDA → Fruityvice). Used by personalize to re-rank flagged items.
 */
export interface ResolvedItem extends DetectedItem {
  /** Resolved per-100g facts; null if no DB had a confident match */
  nutrition: NutritionFacts | null;
  /** Display metadata resolved along with nutrition */
  descriptor: FoodDescriptor | null;
  /** Which DB resolved this item (for explainability) */
  source: 'open-food-facts' | 'usda' | 'fruityvice' | 'cache' | 'estimated';
  /** True if the resolver only matched an "estimated" entry */
  partial?: boolean;
}

/**
 * Per-nutrient, per-item contribution. Powers the SHAP-style explainability
 * panel on NutrientsScreen.
 */
export interface NutrientContribution {
  /** Which nutrient is being explained */
  nutrient: 'sodium' | 'sugar' | 'fiber' | 'protein' | 'carbs' | 'fat' | 'kcal';
  /** Food item contributing */
  itemName: string;
  /** Absolute amount in the same unit as NutritionFacts */
  amount: number;
  /** Share of total in this nutrient (0–1) */
  share: number;
  /** True if this contribution crosses a flag threshold for the user */
  flagged: boolean;
  /** Human-readable reason this was flagged (item-specific, used by verdict chips) */
  reason?: string;
  /** Visual tone for the verdict chip — 'warn' for over-target, 'good' for under-target supportive */
  tone?: 'good' | 'warn';
}

/**
 * A pipeline trace entry surfaced in a tiny toast during analysis. Proves
 * the multi-stage architecture is real, not just a stub.
 */
export interface PipelineTrace {
  stage: 'capture' | 'cache-check' | 'vision-id' | 'hf-validate' | 'reconcile' | 'nutrition' | 'portion' | 'personalize' | 'explain';
  status: 'pending' | 'running' | 'done' | 'cache-hit' | 'fallback';
  startedAt: number;
  finishedAt?: number;
  label: string;
}

export type AnalysisSource =
  | 'hosted_vision'
  | 'vision_cache'
  | 'on_device_vision'
  | 'precomputed_reference';

export type InputMode = 'cooked_meal' | 'raw_ingredients' | 'restaurant_menu';

export interface RecipeSuggestion {
  title_en: string;
  title_bn: string;
  description_en: string;
  description_bn: string;
  matched_ingredients: string[];
  missing_ingredients: string[];
}

export interface MenuItemAnalysis {
  dish_name_en: string;
  dish_name_bn: string;
  is_healthy_pick: boolean;
  is_ultra_processed: boolean;
  notes_en: string;
  notes_bn: string;
}

export interface AnalyzeResult {
  detected: DetectedItem[];
  pipeline: PipelineTrace[];
  source: AnalysisSource;
  is_food?: boolean;
  input_mode?: InputMode;
  overall_confidence?: number;
  rejection_reason_en?: string | null;
  rejection_reason_bn?: string | null;
  inferred_hidden_ingredients?: string[];
  recipe_suggestions?: RecipeSuggestion[] | null;
  menu_analysis?: MenuItemAnalysis[] | null;
}

export interface ResolveNutritionResult {
  resolved: ResolvedItem[];
  contributions: NutrientContribution[];
}

// ─────────────────────────────────────────────────────────────────────────
//  User profile / personalization
// ─────────────────────────────────────────────────────────────────────────

/** Coarse metabolic goal the user can toggle. */
export interface HealthGoals {
  diabetic: boolean;
  protein: boolean;
  budget: boolean;
  mediter: boolean;
}

/** Dietary preferences (vegetarian, vegan, etc.). */
export type DietaryPreference =
  | 'Vegetarian'
  | 'Vegan'
  | 'Pescatarian'
  | 'Gluten-free'
  | 'Dairy-free'
  | 'Halal'
  | 'Kosher';

/** Common allergens tracked in the profile. */
export type Allergen =
  | 'Peanuts'
  | 'Tree nuts'
  | 'Shellfish'
  | 'Shell shellfish'
  | 'Soy'
  | 'Eggs'
  | 'Dairy'
  | 'Gluten'
  | 'Sesame';

export type Sex = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain';
export type DietType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal' | 'kosher';
export type MedicalCondition =
  | 'none'
  | 'diabetes_t1'
  | 'diabetes_t2'
  | 'prediabetes'
  | 'hypertension'
  | 'high_cholesterol'
  | 'kidney';
export type HeightUnit = 'cm' | 'ft_in';
export type WeightUnit = 'kg' | 'lb';

export interface UserProfile {
  name: string;
  age?: number | null;
  sex?: Sex | null;
  heightCm?: number | null;
  weightKg?: number | null;
  heightUnit?: HeightUnit;
  weightUnit?: WeightUnit;
  activityLevel?: ActivityLevel | null;
  goal?: GoalType | null;
  targetRateKgPerWeek?: number | null;
  dietType?: DietType | null;
  medicalConditions?: MedicalCondition[];
  mealsPerDay?: number;
  consentAnonymizedData?: boolean;
  language?: string;
  goals: HealthGoals;
  preferences: DietaryPreference[];
  allergens: Allergen[];
  /** Daily grocery budget ceiling, in local currency (BDT).
   *  The Grocery screen applies a 7× multiplier to get the weekly cap. */
  budget?: number | null;
  /** Number of people the meal serves */
  serving: number;
  /** Daily kcal target for the Home progress bar. Optional for backward
   *  compatibility — older profiles stored before this shipped will fall
   *  back to `DAILY_KCAL_TARGET_DEFAULT` (2000) at read time. */
  dailyKcalTarget?: number | null;
}

/** Universal fallback daily kcal target. Roughly the adult average used by
 *  US dietary guidelines (2000 kcal/day). Profiles that opt-in can override
 *  via the Profile screen; until then we use this so the Home progress bar
 *  always renders a meaningful percentage. */
export const DAILY_KCAL_TARGET_DEFAULT = 2000;

/** Per-meal macro/micro ceilings used by the NutrientsScreen verdict UI.
 *  Mirrors `app/models/schemas.py#MacroTargets`. NutrientsScreen
 *  consumes the mock values (`MOCK_TARGETS`) at runtime; this interface
 *  exists so the schema-drift guard has something to compare against. */
export interface MacroTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;
  sugar: number;
}

/** Resolve a profile's effective daily kcal target. Tolerates older stored
 *  profiles that pre-date the `dailyKcalTarget` field by falling back to the
 *  universal default. Always returns a positive finite number. */
export function resolveDailyKcalTarget(profile: UserProfile | null | undefined): number {
  const v = profile?.dailyKcalTarget;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return DAILY_KCAL_TARGET_DEFAULT;
}

/** Per-meal nutrition snapshot — mirrors backend `MealTotals`. */
export interface MealTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  /** milligrams of sodium */
  sodium: number;
  sugar: number;
}

/**
 * Today's logged-meals summary — the shape the Home progress bar consumes.
 * Mirrors backend `TodaySummary`.
 */
export interface TodaySummary {
  mealsLogged: number;
  totalKcal: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  dailyKcalTarget: number;
}

// ─────────────────────────────────────────────────────────────────────────
//  Grocery list
// ─────────────────────────────────────────────────────────────────────────

export interface GroceryItem {
  id: string;
  name: string;
  category?: string;
  /** Per-unit price in BDT */
  price: number;
  checked: boolean;
}

export interface GroceryGroup {
  category: string;
  items: GroceryItem[];
}

export interface GroceryList {
  budget: number;
  groups: GroceryGroup[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Multi-Agent AI Coach (Groq / Gemini)
// ─────────────────────────────────────────────────────────────────────────

export type CoachRole = 'user' | 'assistant' | 'system';
export type CoachAgentType = 'scientist' | 'behavioral' | 'coach';

export interface CoachMessage {
  role: CoachRole;
  content: string;
  image_ref?: string | null;
}

export interface CoachChatRequest {
  messages?: CoachMessage[];
  message?: string | null;
  history?: CoachMessage[] | null;
  agent_type: CoachAgentType;
  persona?: string | null;
  user_profile?: UserProfile | null;
  recent_meals?: MealEntry[] | null;
  grocery_items?: GroceryItem[] | null;
  lang?: string | null;
  include_audio?: boolean;
}

export interface CoachChatResponse {
  reply: string;
  voice_summary?: string | null;
  citations: string[];
  suggested_prompts: string[];
  agent_type: CoachAgentType;
  audio_base64?: string | null;
  audio_mime_type?: string;
  use_browser_tts?: boolean;
  tts_diagnostic?: string | null;
}

export interface CoachTTSRequest {
  text: string;
  lang?: string | null;
  voice_id?: string | null;
  persona?: string | null;
}

export interface CoachTTSResponse {
  audio_base64?: string | null;
  audio_mime_type: string;
  use_browser_tts: boolean;
  tts_diagnostic?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Tabs (client-side)
// ─────────────────────────────────────────────────────────────────────────

export type TabId = 'capture' | 'results' | 'nutrients' | 'profile' | 'grocery' | 'coach';

export interface TabDescriptor {
  id: TabId;
  label: string;
  icon: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  Auth & Multi-User Support
// ─────────────────────────────────────────────────────────────────────────

/** Role determines which app surface the session lands on. Supports `user`
 *  (regular PWA) and `admin` (telemetry dashboard). */
export type Role = 'user' | 'admin';

/** Session record persisted to localStorage under `nv_auth`. */
export interface AuthSession {
  email: string;
  role: Role;
  /** True when this browser session is local-only and never uses account APIs. */
  localOnly?: boolean;
  /** ISO timestamp when the session was created. */
  loginAt: string;
  name?: string | null;
  avatarUrl?: string | null;
  token?: string | null;
  sub?: string | null;
}

export interface GoogleAuthRequest {
  idToken: string;
}

export interface GoogleAuthResponse {
  session: AuthSession;
  token: string;
  profile: UserProfile;
}

export interface AdminUserSummary {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  role: Role;
  mealsCount: number;
  streakDays: number;
  joinedDate: string;
  lastActive: string;
}

export interface DailyMealVolume {
  date: string;
  count: number;
}

export interface AdminMetrics {
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  activeUsers7d: number;
  mealsToday: number;
  mealsThisWeek: number;
  totalMeals: number;
  avgMealsPerUser: number;
  flaggedMealsCount: number;
  flaggedPercentage?: number | null;
  dailyMealVolume: DailyMealVolume[];
  users: AdminUserSummary[];
}

export interface AdminUserDetail {
  user: AdminUserSummary;
  profile: UserProfile;
  recentMeals: MealEntry[];
}

export interface PopularFoodItem {
  name: string;
  count: number;
  sharePercentage: number;
  category: string;
  avgConfidence: number;
}

export type ReviewQueueAction = 'approve' | 'correct' | 'dismiss';

export interface ReviewQueueItem {
  mealId: string;
  userEmail: string;
  userName?: string | null;
  timestamp: string;
  label: string;
  photoUrl?: string | null;
  items: DetectedItem[];
  lowestConfidence: number;
  reviewStatus: string;
}

export interface ReviewQueueUpdateRequest {
  action: ReviewQueueAction;
  correctedLabel?: string | null;
}

/** Synthetic account the admin dashboard sees in its directory. Admins do
 *  not see user passwords — only the public profile + a generated meal
 *  history. The real signed-in user is also surfaced as one of these. */
export interface DemoUser {
  email: string;
  displayName: string;
  /** Days since "joining" the platform — informs the joined-on chip. */
  joinedDaysAgo: number;
  meals: MealEntry[];
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Rough confidence bucket used for badge styling on ResultsScreen. */
export type ConfidenceBucket = 'high' | 'medium' | 'low';

export function bucketizeConfidence(c: number): ConfidenceBucket {
  if (c >= 80) return 'high';
  if (c >= 60) return 'medium';
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────
//  Meal history
// ─────────────────────────────────────────────────────────────────────────

/** A single logged meal stored in localStorage history. */
export interface MealEntry {
  /** Unique ID (timestamp-based) */
  id: string;
  /** ISO 8601 timestamp */
  date: string;
  /** Meal label (auto-generated from items) */
  label: string;
  /** Detected food items at the time of logging */
  items: DetectedItem[];
  /** Snapshot of nutrition totals (kcal, protein, carbs, fat, fiber, sodium, sugar) */
  totals: MealTotals;
  /** Optional captured photo data URL */
  photoUrl?: string | null;
  /** Which profile goals were active when this meal was logged */
  activeGoals: HealthGoals;
  reviewStatus?: string | null;
}

/** Aggregated stats for the profile screen. */
export interface UserStats {
  totalMeals: number;
  totalDaysActive: number;
  avgDailyKcal: number;
  streakDays: number;
}

// ─────────────────────────────────────────────────────────────────────────
//  Ephemeral Room Chat (relay only, no DB persistence)
// ─────────────────────────────────────────────────────────────────────────

export type RoomMessageKind = 'text' | 'meal_card' | 'system';
export type RoomDishKind = 'meal' | 'dish';

export interface RoomDishItem {
  name: string;
  name_bn?: string | null;
  grams: number;
}

export interface RoomSharedDish {
  title: string;
  kind: RoomDishKind;
  items: RoomDishItem[];
  totals: MealTotals;
  photo_url?: string | null;
}

export interface RoomMessage {
  id: string;
  seq: number;
  room_code: string;
  sender_id: string;
  sender_name: string;
  kind: RoomMessageKind;
  text: string;
  dish_card?: RoomSharedDish | null;
  created_at: string;
}

export interface RoomMember {
  id: string;
  name: string;
}

export interface RoomCreateRequest {
  display_name: string;
  account_id?: string | null;
  client_id?: string | null;
  force_new?: boolean;
}

export interface RoomJoinRequest {
  display_name: string;
  participant_id?: string | null;
  account_id?: string | null;
  client_id?: string | null;
}

export interface RoomLeaveRequest {
  participant_id: string;
  client_id?: string | null;
  force?: boolean;
}

export interface RoomSendMessageRequest {
  participant_id: string;
  sender_name: string;
  kind: RoomMessageKind;
  text?: string | null;
  dish_card?: RoomSharedDish | null;
}

export interface RoomJoinResponse {
  room_code: string;
  participant_id: string;
  display_name: string;
  members: RoomMember[];
  latest_seq: number;
  expires_at?: string | null;
}

export interface RoomPollResponse {
  room_code: string;
  members: RoomMember[];
  messages: RoomMessage[];
  latest_seq: number;
}
