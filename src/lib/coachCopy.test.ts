import { describe, expect, it } from 'vitest';
import { getScientistDisplayName } from './coachCopy';

describe('scientist coach identity', () => {
  it('uses Dr. Susmit in English and Bengali', () => {
    expect(getScientistDisplayName('en')).toBe('Dr. Susmit');
    expect(getScientistDisplayName('bn')).toBe('ড. সুস্মিত');
  });
});
