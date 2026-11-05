import { describe, expect, it } from 'vitest';
import { fetchLivePrice } from './priceScraper';

describe('fetchLivePrice', () => {
  it('falls back to local benchmark when offline or with empty query', async () => {
    const res = await fetchLivePrice('Brown rice (Lal chal)');
    expect(res.price_bdt).toBeGreaterThan(0);
    expect(typeof res.is_live_price).toBe('boolean');
    expect(res.unit).toBeDefined();
  });

  it('handles invalid queries gracefully without crashing', async () => {
    const res = await fetchLivePrice('');
    expect(res.is_live_price).toBe(false);
    expect(res.price_bdt).toBe(0);
  });

});
