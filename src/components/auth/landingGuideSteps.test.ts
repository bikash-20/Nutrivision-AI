import { describe, expect, it } from 'vitest';
import { GUIDE_STEPS } from './landingGuideSteps';

describe('landingGuideSteps', () => {
  it('covers steps 0 through 10 with exact public image paths', () => {
    expect(GUIDE_STEPS.map((s) => s.stepNumber)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(GUIDE_STEPS.map((s) => s.image)).toEqual([
      '/step-0.png',
      '/step1.png',
      '/step-2.png',
      '/step-3.png',
      '/step-4.png',
      '/step-5.png',
      '/step-6.png',
      '/step-7.png',
      '/step-8.png',
      '/ollama-2.png',
      '/ollama-1.png',
    ]);
    for (const step of GUIDE_STEPS) {
      expect(step.titleEn.trim().length).toBeGreaterThan(4);
      expect(step.titleBn.trim().length).toBeGreaterThan(4);
      expect(step.summaryEn.trim().length).toBeGreaterThan(10);
      expect(step.summaryBn.trim().length).toBeGreaterThan(10);
      expect(step.pointsEn.length).toBeGreaterThanOrEqual(2);
      expect(step.pointsBn.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never uses the word "mock" in user-facing landing copy', () => {
    const serialized = JSON.stringify(GUIDE_STEPS).toLowerCase();
    expect(serialized).not.toContain('mock');
  });
});
