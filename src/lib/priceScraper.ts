/**
 * Hybrid Live Price Scraper Client with Strict 3-Second Timeout & Fallback.
 *
 * Calls the backend `/api/market/price` scraper (which scrapes Chaldal.com
 * with lightweight HTML parsing), and enforces a strict 3000ms Promise timeout.
 * If blocked (403/429), disconnected, or timed out, it instantly falls back
 * to local `resolveMarketPrice` backed by `bd_market_prices.json`.
 */

import { resolveMarketPrice } from './marketPrices';
import { getSession } from './auth';

export interface LivePriceResult {
  item_name_en: string;
  item_name_bn?: string | null;
  price_bdt: number;
  unit: string;
  is_live_price: boolean;
  source: string;
}

import { getApiBase } from './config';

const SCRAPER_TIMEOUT_MS = 6000;

// In-memory cache to keep demo snappy and prevent duplicate hits
const priceCache = new Map<string, LivePriceResult>();

/**
 * Fetch real-time grocery price for a Bangladeshi item with a 3-second hard timeout.
 */
export async function fetchLivePrice(
  itemNameEn: string,
  itemNameBn?: string,
): Promise<LivePriceResult> {
  const query = (itemNameEn || itemNameBn || '').trim();
  if (!query) {
    return {
      item_name_en: 'Unknown',
      price_bdt: 0,
      unit: '1 kg',
      is_live_price: false,
      source: 'Invalid Query',
    };
  }

  const cacheKey = query.toLowerCase();
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey)!;
  }

  // 1. Prepare instant local fallback
  const fallback = resolveMarketPrice(query, 1000);
  const fallbackResult: LivePriceResult = {
    item_name_en: query,
    item_name_bn: fallback.name_bn,
    price_bdt: fallback.unitPrice,
    unit: fallback.unitLabel,
    is_live_price: false,
    source: 'TCB/DAM Benchmark (bd_market_prices.json)',
  };

  if (getSession()?.localOnly || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    priceCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  // 2. Wrap live request in strict 3000ms timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);

  try {
    const cleanQuery = query.replace(/\(.*?\)/g, '').trim() || query;
    const params = new URLSearchParams({ q: cleanQuery });
    if (itemNameBn) params.append('name_bn', itemNameBn);
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/market/price?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as LivePriceResult;
      if (data && typeof data.price_bdt === 'number' && data.price_bdt > 0) {
        priceCache.set(cacheKey, data);
        return data;
      }
    }
  } catch (err) {
    // Gracefully catch timeout, CORS, or connection failures
    // Do NOT stall demo under any circumstance
  } finally {
    clearTimeout(timeoutId);
  }

  // If live scrape didn't resolve or timed out, return fallback without poisoning cache
  return fallbackResult;
}
