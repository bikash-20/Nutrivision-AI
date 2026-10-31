import { describe, it, expect, afterEach } from 'vitest';
import { getApiBase } from './config';

describe('getApiBase configuration helper', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it('returns relative empty string when running on non-localhost domain (Vercel rewrite)', () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { hostname: 'cloud-camp-hackathon.vercel.app' },
    };
    expect(getApiBase()).toBe('');
  });

  it('returns relative empty string on custom domain for external users', () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { hostname: 'nutrivision.ai' },
    };
    expect(getApiBase()).toBe('');
  });

  it('returns localhost:8000 when running locally on localhost', () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { hostname: 'localhost' },
    };
    expect(getApiBase()).toBe('http://localhost:8000');
  });

  it('returns localhost:8000 when running locally on 127.0.0.1', () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { hostname: '127.0.0.1' },
    };
    expect(getApiBase()).toBe('http://localhost:8000');
  });

  it('returns localhost:8000 in Node / SSR environment without window', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(getApiBase()).toBe('http://localhost:8000');
  });
});
