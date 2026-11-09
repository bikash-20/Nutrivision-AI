/**
 * Typed mock fixtures — single source of truth for all demo data.
 * Replaces the legacy unstructured `data.js` exports.
 */

import type {
  DetectedItem,
  DemoUser,
  FoodDescriptor,
  GroceryGroup,
  MealEntry,
  TabDescriptor,
  UserProfile,
} from '../types/schemas';

// ── Vision pipeline initial output ──────────────────────────────────────

export const MOCK_DETECTED: DetectedItem[] = [
  { name: 'Chicken biryani', confidence: 92, grams: 310, note: null },
  { name: 'Cucumber raita', confidence: 88, grams: 90, note: null },
  { name: 'Mixed salad',    confidence: 61, grams: 70, note: 'Low confidence — tap to confirm' },
  { name: 'Pickled onion',  confidence: 74, grams: 25, note: null },
];

// ── Nutrition database ──────────────────────────────────────────────────

export const MOCK_NUTRITION_DB: Record<string, FoodDescriptor> = {
  'Chicken biryani': {
    protein: 6.0, carbs: 22.0, fat: 4.5, kcal: 165,
    fiber: 0.6, sodium: 380, sugar: 0.9, glycemic: 0.71,
    emoji: '🍗', category: 'protein',
    alternatives: ['Chicken Tikka', 'Chicken Korma'],
    pairings: ['Naan', 'Mint chutney'],
  },
  'Cucumber raita': {
    protein: 2.4, carbs: 4.0, fat: 2.8, kcal: 56,
    fiber: 0.3, sodium: 60, sugar: 2.6, glycemic: 0.05,
    emoji: '🥒', category: 'produce',
    alternatives: ['Yogurt dip', 'Tzatziki'],
    pairings: ['Papad', 'Boiled egg'],
  },
  'Mixed salad': {
    protein: 1.2, carbs: 3.6, fat: 0.3, kcal: 22,
    fiber: 1.4, sodium: 18, sugar: 1.8, glycemic: 0.02,
    emoji: '🥗', category: 'produce',
    alternatives: ['Greek Salad', 'Garden Salad'],
    pairings: ['Olive oil', 'Feta cheese'],
  },
  'Pickled onion': {
    protein: 1.0, carbs: 9.0, fat: 0.1, kcal: 42,
    fiber: 1.7, sodium: 250, sugar: 4.0, glycemic: 0.03,
    emoji: '🧅', category: 'produce',
    alternatives: ['Red onion', 'Shallots'],
    pairings: ['Lemon juice', 'Sumac'],
  },
};

export const MOCK_HISTORY_SUGGESTIONS: Array<{
  name: string; emoji: string; category: 'protein' | 'produce' | 'grains' | 'other';
  confidence: number; grams: number;
}> = [
  { name: 'Naan',          emoji: '🫓', category: 'grains',  confidence: 100, grams: 60  },
  { name: 'Mint chutney',  emoji: '🌿', category: 'other',   confidence: 100, grams: 20  },
  { name: 'Boiled egg',    emoji: '🥚', category: 'protein', confidence: 100, grams: 50  },
  { name: 'Lassi',         emoji: '🥛', category: 'other',   confidence: 100, grams: 200 },
];

// ── Daily macro targets (used by NutrientsScreen) ───────────────────────

export const MOCK_TARGETS = {
  kcal: 720,
  protein: 50,
  carbs: 40,
  fat: 65,
  fiber: 30,
  sodium: 1200,
  sugar: 25,
};

// ── Profile defaults ────────────────────────────────────────────────────

export const MOCK_PROFILE: UserProfile = {
  name: '',
  age: 28,
  sex: 'male',
  heightCm: 172,
  weightKg: 70,
  heightUnit: 'cm',
  weightUnit: 'kg',
  activityLevel: 'moderate',
  goal: 'maintain',
  targetRateKgPerWeek: 0,
  dietType: 'halal',
  medicalConditions: ['prediabetes'],
  mealsPerDay: 3,
  goals: { diabetic: true, protein: false, budget: true, mediter: false },
  preferences: [],
  allergens: ['Peanuts'],
  budget: 500,
  serving: 1,
  dailyKcalTarget: 2000,
};

// ── Grocery list ────────────────────────────────────────────────────────

export const MOCK_GROCERY_GROUPS: GroceryGroup[] = [
  {
    category: 'Grains & staples',
    items: [
      { id: 'g-0-0', name: 'Brown rice',     price: 90,  checked: true  },
      { id: 'g-0-1', name: 'Whole wheat atta', price: 60, checked: false },
    ],
  },
  {
    category: 'Produce',
    items: [
      { id: 'g-1-0', name: 'Cucumber',     price: 39, checked: false },
      { id: 'g-1-1', name: 'Spinach',      price: 25, checked: false },
      { id: 'g-1-2', name: 'Tomato',       price: 99, checked: false },
    ],
  },
  {
    category: 'Protein',
    items: [
      { id: 'g-2-0', name: 'Eggs (6)',         price: 75,  checked: false },
      { id: 'g-2-1', name: 'Chicken breast',   price: 140, checked: false },
    ],
  },
];

// ── Tabs (visual config only — not API-shared) ──────────────────────────

export const MOCK_TABS: TabDescriptor[] = [
  { id: 'capture',   label: 'Capture',   icon: 'Camera' },
  { id: 'results',   label: 'Results',   icon: 'ScanLine' },
  { id: 'nutrients', label: 'Nutrients', icon: 'Activity' },
  { id: 'profile',   label: 'Profile',   icon: 'User' },
  { id: 'grocery',   label: 'Grocery',   icon: 'ShoppingBag' },
  { id: 'coach',     label: 'AI Coach',  icon: 'Bot' },
];

// ── Demo users (admin dashboard only) ────────────────────────────────
//
// Synthetic accounts the admin overview inspects. Each user has a small
// generated meal history so the admin KPIs and 7-day sparkline have real
// volume to render. Meals are spread across the last 14 days with a few
// items each, so the per-day counts form a believable pattern (not flat).
//
// Deterministic: we use a tiny seeded PRNG keyed off the user's email so
// the dashboard numbers don't change between renders. Real users would
// come from a backend; this is just demo data.

function seededRand(seedStr: string): () => number {
  // djb2 hash → small PRNG. Doesn't need to be cryptographic.
  let h = 5381;
  for (let i = 0; i < seedStr.length; i++) h = ((h << 5) + h + seedStr.charCodeAt(i)) | 0;
  return () => {
    h = (h * 1664525 + 1013904223) | 0;
    return ((h >>> 0) % 1000) / 1000;
  };
}

const DEMO_FOODS: Array<{ name: string; protein: number; carbs: number; fat: number; kcal: number; confidence: number }> = [
  { name: 'Chicken biryani',  protein: 6.0,  carbs: 22.0, fat: 4.5, kcal: 165, confidence: 92 },
  { name: 'Cucumber raita',   protein: 2.4,  carbs: 4.0,  fat: 2.8, kcal: 56,  confidence: 88 },
  { name: 'Mixed salad',      protein: 1.2,  carbs: 3.6,  fat: 0.3, kcal: 22,  confidence: 61 },
  { name: 'Pickled onion',    protein: 1.0,  carbs: 9.0,  fat: 0.1, kcal: 42,  confidence: 74 },
  { name: 'Brown rice',       protein: 2.6,  carbs: 23.0, fat: 0.9, kcal: 112, confidence: 90 },
  { name: 'Grilled chicken',  protein: 31.0, carbs: 0.0,  fat: 3.6, kcal: 165, confidence: 89 },
  { name: 'Steamed broccoli', protein: 2.8,  carbs: 7.0,  fat: 0.4, kcal: 35,  confidence: 95 },
  { name: 'Whole wheat roti', protein: 3.7,  carbs: 18.0, fat: 1.2, kcal: 100, confidence: 87 },
  { name: 'Dal (lentils)',    protein: 9.0,  carbs: 20.0, fat: 0.4, kcal: 120, confidence: 84 },
  { name: 'Paneer tikka',     protein: 18.0, carbs: 3.0,  fat: 22.0, kcal: 280, confidence: 81 },
  { name: 'Greek yogurt',     protein: 10.0, carbs: 4.0,  fat: 0.7, kcal: 60,  confidence: 93 },
  { name: 'Avocado toast',    protein: 4.0,  carbs: 16.0, fat: 14.0, kcal: 210, confidence: 64 },
];

function genMealsForUser(email: string): MealEntry[] {
  const rng = seededRand(email);
  const meals: MealEntry[] = [];
  // 4–8 meals, mostly inside the last 7 days so the sparkline has volume.
  const total = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < total; i++) {
    // Bias day offset toward recent (0–6 = last week, 7–13 = older).
    const dayOffset = rng() < 0.7 ? Math.floor(rng() * 7) : 7 + Math.floor(rng() * 7);
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    d.setHours(7 + Math.floor(rng() * 14), Math.floor(rng() * 60), 0, 0);
    const itemCount = 1 + Math.floor(rng() * 3);
    const items: DetectedItem[] = [];
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 };
    for (let j = 0; j < itemCount; j++) {
      const food = DEMO_FOODS[Math.floor(rng() * DEMO_FOODS.length)];
      const grams = 60 + Math.floor(rng() * 240);
      const factor = grams / 100;
      items.push({ name: food.name, confidence: food.confidence, grams, note: null });
      totals.kcal    += food.kcal    * factor;
      totals.protein += food.protein * factor;
      totals.carbs   += food.carbs   * factor;
      totals.fat     += food.fat     * factor;
    }
    meals.push({
      id: `${email}-meal-${i}`,
      date: d.toISOString(),
      label: items.map((it) => it.name).join(', '),
      items,
      totals,
      photoUrl: null,
      activeGoals: { diabetic: false, protein: false, budget: false, mediter: false },
    });
  }
  // Newest first.
  return meals.sort((a, b) => b.date.localeCompare(a.date));
}

export const SEED_DEMO_USERS: DemoUser[] = [
  { email: 'aisha@nutrivision.ai', displayName: 'Aisha Rahman',  joinedDaysAgo: 42, meals: genMealsForUser('aisha@nutrivision.ai') },
  { email: 'karim@nutrivision.ai', displayName: 'Karim Hossain', joinedDaysAgo: 28, meals: genMealsForUser('karim@nutrivision.ai') },
  { email: 'rafi@nutrivision.ai',   displayName: 'Rafi Ahmed',    joinedDaysAgo: 14, meals: genMealsForUser('rafi@nutrivision.ai') },
  { email: 'priya@nutrivision.ai',  displayName: 'Priya Das',     joinedDaysAgo: 7,  meals: genMealsForUser('priya@nutrivision.ai') },
  { email: 'tanvir@nutrivision.ai', displayName: 'Tanvir Iqbal',  joinedDaysAgo: 3,  meals: genMealsForUser('tanvir@nutrivision.ai') },
];

export const STEP_LABELS = ['Review', 'Adjust', 'Confirm'] as const;
