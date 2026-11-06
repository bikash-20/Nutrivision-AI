import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  addGroceryItem,
  addGroceryItemsBatch,
  getGroceryList,
  getProfile,
  resolveNutrition,
  DEFAULT_PROFILE,
} from './api';

describe('Grocery pipeline API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('adds items and dispatches update event in browser environment', async () => {
    let eventFired = false;
    const dummyWindow = {
      dispatchEvent: () => {
        eventFired = true;
        return true;
      },
    };
    (globalThis as unknown as { window?: unknown }).window = dummyWindow;

    const mockItem = {
      id: 'g-new-1',
      name: 'Cucumber (Shosha)',
      category: 'Produce',
      price: 50,
      checked: false,
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/grocery/items')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve(mockItem),
        });
      }
      if (url.includes('/api/grocery?budget=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              budget: 500,
              groups: [{ category: 'Produce', items: [mockItem] }],
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }) as unknown as typeof fetch;

    const item = await addGroceryItem('Produce', 'Cucumber (Shosha)', 50);
    expect(item.name).toBe('Cucumber (Shosha)');
    expect(item.category).toBe('Produce');
    expect(item.price).toBe(50);
    expect(eventFired).toBe(true);

    const list = await getGroceryList(DEFAULT_PROFILE);
    const produceGroup = list.groups.find((g) => g.category === 'Produce');
    expect(produceGroup).toBeDefined();
    const found = produceGroup?.items.find((i) => i.name === 'Cucumber (Shosha)');
    expect(found).toBeDefined();
    expect(found?.price).toBe(50);

    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('sends category and price to backend API', async () => {
    const mockItem = {
      id: 'g-new-2',
      name: 'Brown rice (Lal chal)',
      category: 'Grains & staples',
      price: 90,
      checked: false,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockItem),
    }) as unknown as typeof fetch;

    const item = await addGroceryItem('Grains & staples', 'Brown rice (Lal chal)', 90);
    expect(item.category).toBe('Grains & staples');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/grocery/items'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ category: 'Grains & staples', name: 'Brown rice (Lal chal)', price: 90 }),
      }),
    );
  });

  it('adds multiple items in a batch request', async () => {
    const mockBatch = [
      { id: 'g-new-3', name: 'Boiled Egg', category: 'Produce', price: 15, checked: false },
      { id: 'g-new-4', name: 'Tomato', category: 'Produce', price: 40, checked: false },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockBatch),
    }) as unknown as typeof fetch;

    const items = await addGroceryItemsBatch([
      { name: 'Boiled Egg', price: 15 },
      { name: 'Tomato', price: 40 },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('Boiled Egg');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/grocery/batch'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('surfaces server errors instead of claiming profile or nutrition fallbacks succeeded', async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
    const unavailableResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ detail: 'Backend unavailable' }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(unavailableResponse) as typeof fetch;

    try {
      await expect(getProfile()).rejects.toMatchObject({ status: 503 });

      globalThis.fetch = vi.fn().mockResolvedValue(unavailableResponse) as typeof fetch;
      await expect(
        resolveNutrition([{ name: 'Unknown meal', confidence: 90, grams: 100 }]),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
    }
  });

  it('keeps the nutrition fallback for genuine network failures', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Network request failed')) as typeof fetch;

    const result = await resolveNutrition([
      { name: 'Unknown meal', confidence: 90, grams: 100 },
    ]);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].partial).toBe(true);
  });
});
