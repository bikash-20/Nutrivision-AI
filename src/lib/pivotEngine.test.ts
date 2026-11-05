import { describe, it, expect, vi } from 'vitest';
import { generateDietaryPivots, generateDietaryPivotsAsync } from './pivotEngine';
import { logout } from './auth';
import type { DetectedItem, UserProfile } from '../types/schemas';

const BASE_PROFILE: UserProfile = {
  name: 'Rafi',
  age: 32,
  sex: 'male',
  heightCm: 172,
  weightKg: 78,
  activityLevel: 'moderate',
  goals: { diabetic: true, protein: false, budget: true, mediter: false },
  preferences: ['Halal'],
  allergens: [],
  dietType: 'halal',
  medicalConditions: ['prediabetes'],
  mealsPerDay: 3,
  budget: 500,
  serving: 1,
  language: 'bn',
  dailyKcalTarget: 2200,
};

describe('Dietary Pivot Engine', () => {
  it('generates low-GI brown rice + sabzi pivot when high white rice portion is detected for prediabetic profile', () => {
    const detected: DetectedItem[] = [
      { name: 'White Rice', name_bn: 'সাদা ভাত', confidence: 95, grams: 260 },
      { name: 'Chicken Curry', name_bn: 'মুরগির ঝোল', confidence: 90, grams: 180 },
    ];
    const pivots = generateDietaryPivots(detected, BASE_PROFILE);
    const ricePivot = pivots.find((p) => p.id === 'pivot-rice-glycemic-optimization');

    expect(ricePivot).toBeDefined();
    expect(ricePivot?.delta.carbs).toBeLessThan(0); // Cuts carbs
    expect(ricePivot?.delta.fiber).toBeGreaterThan(0); // Boosts fiber
    expect(ricePivot?.glycemic_reduction_pct).toBeGreaterThan(30);
    expect(ricePivot?.grocery_items_to_add.length).toBeGreaterThan(0);
    expect(ricePivot?.grocery_items_to_add[0].name).toContain('Brown rice');
  });

  it('generates sodium reduction pivot when high-sodium item is detected', () => {
    const hyperProfile: UserProfile = {
      ...BASE_PROFILE,
      medicalConditions: ['hypertension'],
    };
    const factsMap = {
      'beef curry': {
        protein: 20,
        carbs: 6,
        fat: 16,
        kcal: 250,
        fiber: 1,
        sodium: 450, // per 100g -> 150g = 675mg sodium
        sugar: 1,
        glycemic: 0.1,
      },
    };
    const detected: DetectedItem[] = [
      { name: 'Beef Curry', name_bn: 'গরুর মাংসের ভুনা', confidence: 92, grams: 150 },
    ];
    const pivots = generateDietaryPivots(detected, hyperProfile, factsMap);
    const sodiumPivot = pivots.find((p) => p.id === 'pivot-sodium-hypertension-relief');

    expect(sodiumPivot).toBeDefined();
    expect(sodiumPivot?.delta.sodium).toBeLessThan(0); // Reduces sodium
    expect(sodiumPivot?.grocery_items_to_add.some((g) => g.name.includes('Cucumber'))).toBe(true);
    expect(typeof sodiumPivot?.is_live_price).toBe('boolean');
  });

  it('marks prices as live only when the price service returns live data', async () => {
    logout();
    vi.stubGlobal('navigator', { onLine: true });
    const detected: DetectedItem[] = [
      { name: 'White Rice', name_bn: 'সাদা ভাত', confidence: 95, grams: 260 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      item_name_en: 'test item',
      price_bdt: 123,
      unit: '1 kg',
      is_live_price: true,
      source: 'Test price service',
    })));
    try {
      const pivots = await generateDietaryPivotsAsync(detected, BASE_PROFILE);
      expect(pivots.length).toBeGreaterThan(0);
      expect(pivots[0].is_live_price).toBe(true);
      expect(pivots[0].price_source).toContain('Test price service');
    } finally {
      vi.unstubAllGlobals();
      logout();
    }
  });

  it('generates high-fiber veggie swap with grocery items when Penne Pasta is detected', () => {
    const detected: DetectedItem[] = [
      { name: 'Penne Pasta', confidence: 95, grams: 220 },
      { name: 'Tomato', confidence: 90, grams: 50 },
      { name: 'Parsley', confidence: 85, grams: 10 },
    ];
    const pivots = generateDietaryPivots(detected, BASE_PROFILE);
    expect(pivots.length).toBeGreaterThan(0);
    const pastaPivot = pivots.find((p) => p.id === 'pivot-pasta-veggie-swap');
    expect(pastaPivot).toBeDefined();
    expect(pastaPivot?.grocery_items_to_add.length).toBeGreaterThan(0);
    expect(pastaPivot?.grocery_items_to_add.some((g) => g.name.includes('Broccoli'))).toBe(true);
  });
});
