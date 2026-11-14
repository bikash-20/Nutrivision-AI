/**
 * Canonical bilingual food alias dictionary and fuzzy resolver.
 * Single source of truth for 170+ South Asian / Bangladeshi & global food items.
 *
 * Generated from app/data/food_aliases.json.
 */

export interface CanonicalFood {
  id: string;
  name_en: string;
  name_bn: string;
  category: 'grains' | 'protein' | 'produce' | 'dairy' | 'beverages' | 'other';
  aliases: string[];
  emoji: string;
  defaultGrams: number;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  sodiumMgPer100g: number;
  sugarPer100g: number;
  glycemicIndex: number;
  pairings: string[];
}

import canonicalFoodsData from "./canonicalFoods.json";

export const CANONICAL_FOODS: CanonicalFood[] = canonicalFoodsData as CanonicalFood[];

// Fast lookup indexes
const BY_ID = new Map<string, CanonicalFood>();
const BY_EXACT_LOWER = new Map<string, CanonicalFood>();

for (const food of CANONICAL_FOODS) {
  BY_ID.set(food.id, food);
  BY_EXACT_LOWER.set(food.name_en.toLowerCase().trim(), food);
  BY_EXACT_LOWER.set(food.name_bn.trim(), food);
  for (const alias of food.aliases) {
    BY_EXACT_LOWER.set(alias.toLowerCase().trim(), food);
  }
}

/** Clean and normalize a food name string for search. */
function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/[^a-zA-Z0-9ঀ-৿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute simple Levenshtein edit distance for typo tolerance. */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Fuzzy match any raw food string from vision/USDA/OpenFoodFacts/LLMs
 * to our canonical food database.
 */
export function findCanonicalFood(rawName: string): CanonicalFood | null {
  if (!rawName || typeof rawName !== 'string') return null;
  const cleaned = normalizeStr(rawName);
  if (!cleaned) return null;

  // 1. Direct O(1) map match
  const direct = BY_EXACT_LOWER.get(cleaned);
  if (direct) return direct;

  // 2. Substring or token overlap match
  const tokens = new Set(cleaned.split(' ').filter((t) => t.length > 2));
  let bestMatch: CanonicalFood | null = null;
  let maxScore = 0;

  for (const food of CANONICAL_FOODS) {
    const foodEnNorm = normalizeStr(food.name_en);
    const foodBnNorm = food.name_bn.trim();

    // Check direct substring
    if (cleaned.includes(foodEnNorm) || foodEnNorm.includes(cleaned)) {
      const score = Math.min(cleaned.length, foodEnNorm.length);
      if (score > maxScore) {
        maxScore = score;
        bestMatch = food;
      }
    }

    if (rawName.includes(foodBnNorm) || foodBnNorm.includes(rawName)) {
      const score = 100;
      if (score > maxScore) {
        maxScore = score;
        bestMatch = food;
      }
    }

    // Check aliases
    for (const alias of food.aliases) {
      const aliasNorm = normalizeStr(alias);
      if (cleaned.includes(aliasNorm) || aliasNorm.includes(cleaned)) {
        const score = Math.min(cleaned.length, aliasNorm.length);
        if (score > maxScore) {
          maxScore = score;
          bestMatch = food;
        }
      }
    }

    // Token set overlap
    if (tokens.size > 0) {
      const foodTokens = foodEnNorm.split(' ').filter((t) => t.length > 2);
      let matchCount = 0;
      for (const ft of foodTokens) {
        if (tokens.has(ft)) matchCount++;
      }
      if (matchCount > 0 && matchCount >= foodTokens.length) {
        const score = matchCount * 10;
        if (score > maxScore) {
          maxScore = score;
          bestMatch = food;
        }
      }
    }
  }

  if (bestMatch && maxScore > 2) return bestMatch;

  // 3. Levenshtein edit distance for minor typos (only on short tokens)
  if (cleaned.length >= 4 && cleaned.length <= 15) {
    for (const food of CANONICAL_FOODS) {
      const foodEnNorm = normalizeStr(food.name_en);
      if (Math.abs(foodEnNorm.length - cleaned.length) <= 2) {
        if (levenshteinDistance(foodEnNorm, cleaned) <= 2) {
          return food;
        }
      }
      for (const alias of food.aliases) {
        const aliasNorm = normalizeStr(alias);
        if (Math.abs(aliasNorm.length - cleaned.length) <= 2) {
          if (levenshteinDistance(aliasNorm, cleaned) <= 2) {
            return food;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Resolves any food name dynamically into English or Bengali.
 * Never fails or crashes; falls back smoothly to cleaned rawName.
 */
export function resolveFoodName(rawName: string, lang: 'en' | 'bn' = 'en'): string {
  if (!rawName || typeof rawName !== 'string') return '';
  const match = findCanonicalFood(rawName);
  if (match) {
    return lang === 'bn' ? match.name_bn : match.name_en;
  }
  return rawName.trim();
}

export interface FoodPairingSuggestion {
  name: string;
  name_bn: string;
  emoji: string;
  category: 'protein' | 'produce' | 'grains' | 'other';
  confidence: number;
  grams: number;
}

/**
 * Generates context-aware "Frequently Eaten With This" pairings
 * based on the dishes actually detected on the plate.
 */
export function getContextAwarePairings(
  detectedItems: Array<{ name: string } | string>,
  count: number = 4,
): FoodPairingSuggestion[] {
  const detectedNames = detectedItems.map((d) => (typeof d === 'string' ? d : d.name).toLowerCase());
  const suggestions: FoodPairingSuggestion[] = [];
  const addedIds = new Set<string>();

  // Collect pairings from each detected dish
  for (const item of detectedItems) {
    const raw = typeof item === 'string' ? item : item.name;
    const food = findCanonicalFood(raw);
    if (!food) continue;

    for (const pairingName of food.pairings) {
      const pairedFood = findCanonicalFood(pairingName);
      if (!pairedFood) continue;
      if (addedIds.has(pairedFood.id)) continue;

      // Avoid suggesting something already on the plate
      const pairedLower = pairedFood.name_en.toLowerCase();
      if (detectedNames.some((d) => d.includes(pairedLower) || pairedLower.includes(d))) {
        continue;
      }

      addedIds.add(pairedFood.id);
      suggestions.push({
        name: pairedFood.name_en,
        name_bn: pairedFood.name_bn,
        emoji: pairedFood.emoji,
        category: (pairedFood.category === 'beverages' || pairedFood.category === 'dairy' ? 'other' : pairedFood.category) as any,
        confidence: 100,
        grams: pairedFood.defaultGrams,
      });

      if (suggestions.length >= count) return suggestions;
    }
  }

  // Fallbacks if fewer than count found
  const fallbacks = ['masoor-dal', 'alu-bhorta', 'cucumber-salad', 'boiled-egg', 'lemon-slice'];
  for (const fbId of fallbacks) {
    if (suggestions.length >= count) break;
    const fbFood = BY_ID.get(fbId);
    if (!fbFood || addedIds.has(fbFood.id)) continue;
    const pairedLower = fbFood.name_en.toLowerCase();
    if (detectedNames.some((d) => d.includes(pairedLower) || pairedLower.includes(d))) continue;

    addedIds.add(fbFood.id);
    suggestions.push({
      name: fbFood.name_en,
      name_bn: fbFood.name_bn,
      emoji: fbFood.emoji,
      category: (fbFood.category === 'beverages' || fbFood.category === 'dairy' ? 'other' : fbFood.category) as any,
      confidence: 100,
      grams: fbFood.defaultGrams,
    });
  }

  return suggestions;
}
