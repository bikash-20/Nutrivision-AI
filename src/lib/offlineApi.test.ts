import { beforeEach, describe, expect, it, vi } from 'vitest';
import { continueOffline } from './auth';
import {
  addGroceryItem,
  DEFAULT_PROFILE,
  getGroceryList,
  getProfile,
  getTodaySummary,
  updateProfile,
} from './api';
import { fetchLivePrice } from './priceScraper';

const values = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

describe('local-only API behavior', () => {
  beforeEach(() => {
    values.clear();
    vi.restoreAllMocks();
  });

  it('keeps profile, grocery, and daily summary operations on-device', async () => {
    continueOffline();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const profile = { ...DEFAULT_PROFILE, name: 'Offline user', budget: 1200 };
    await updateProfile(profile);
    await addGroceryItem('Produce', 'Apples', 200);

    expect(await getProfile()).toEqual(profile);
    expect((await getGroceryList(profile)).groups[0].items[0].name).toBe('Apples');
    expect((await getTodaySummary()).mealsLogged).toBe(0);
    expect((await fetchLivePrice('Offline market item')).is_live_price).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
