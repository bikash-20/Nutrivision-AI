import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coachHistoryStorageKey,
  loadCoachSessionHistory,
  saveCoachSessionHistory,
} from './coachSessionHistory';
import type { CoachAgentType, CoachMessage } from '../types/schemas';

const storage = new Map<string, string>();
const sessionStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => storage.delete(key),
  setItem: (key, value) => storage.set(key, value),
};

const conversation: Array<CoachMessage & { persona: CoachAgentType }> = [
  { role: 'assistant', content: 'Welcome', persona: 'scientist' },
  { role: 'user', content: 'First question', persona: 'scientist' },
  { role: 'assistant', content: 'First answer', persona: 'scientist' },
  { role: 'user', content: 'Second question', persona: 'scientist' },
  { role: 'assistant', content: 'Second answer', persona: 'scientist' },
];

describe('AI Coach session history', () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: sessionStorageMock,
    });
  });

  afterEach(() => {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    vi.restoreAllMocks();
  });

  it('stores and restores only the two most recent messages per user and persona', () => {
    saveCoachSessionHistory('user@example.com', 'scientist', conversation);

    expect(loadCoachSessionHistory('user@example.com', 'scientist')).toEqual(conversation.slice(-2));
    expect(loadCoachSessionHistory('other@example.com', 'scientist')).toEqual([]);
    expect(loadCoachSessionHistory('user@example.com', 'coach')).toEqual([]);
  });

  it('does not persist the welcome message before a conversation starts', () => {
    saveCoachSessionHistory('user@example.com', 'scientist', [
      { role: 'assistant', content: 'Welcome', persona: 'scientist' },
    ]);

    expect(loadCoachSessionHistory('user@example.com', 'scientist')).toEqual([]);
  });

  it('keeps message text but omits oversized image data', () => {
    const largeImage = `data:image/jpeg;base64,${'a'.repeat(512_001)}`;
    saveCoachSessionHistory('user@example.com', 'scientist', [
      { role: 'user', content: 'What is in this image?', image_ref: largeImage, persona: 'scientist' },
      { role: 'assistant', content: 'It looks like lunch.', persona: 'scientist' },
    ]);

    expect(loadCoachSessionHistory('user@example.com', 'scientist')).toEqual([
      { role: 'user', content: 'What is in this image?', persona: 'scientist' },
      { role: 'assistant', content: 'It looks like lunch.', persona: 'scientist' },
    ]);
  });

  it('recovers from invalid stored JSON and warns', () => {
    storage.set(coachHistoryStorageKey('user@example.com', 'scientist'), '{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(loadCoachSessionHistory('user@example.com', 'scientist')).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
