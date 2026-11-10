import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllDailyRoomKeys,
  clearAllRoomSessionsFromStorage,
  clearDailyRoomKey,
  clearRoomSession,
  loadDailyRoomKey,
  loadRoomSession,
  saveDailyRoomKey,
  saveRoomSession,
  type StoredRoomSession,
} from './roomSession';
import { getRoomWsUrl } from './api';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('roomSession (sessionStorage lifecycle & vanish on reload/delete)', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sampleSession: StoredRoomSession = {
    roomCode: 'K8M4P2',
    participantId: 'user-1',
    displayName: 'Bikash',
    members: [{ id: 'user-1', name: 'Bikash' }],
    lastSeq: 2,
    messages: [
      {
        id: 'm1',
        seq: 1,
        room_code: 'K8M4P2',
        sender_id: 'user-1',
        sender_name: 'Bikash',
        kind: 'text',
        text: 'Hello room!',
        dish_card: null,
        created_at: '2026-11-10T12:00:00Z',
      },
      {
        id: 'm2',
        seq: 2,
        room_code: 'K8M4P2',
        sender_id: 'user-1',
        sender_name: 'Bikash',
        kind: 'meal_card',
        text: 'Steamed Rice & Dal',
        dish_card: {
          title: 'Steamed Rice & Dal',
          kind: 'meal',
          items: [{ name: 'Rice', name_bn: 'ভাত', grams: 150 }],
          totals: {
            kcal: 260,
            protein: 8,
            carbs: 52,
            fat: 2,
            fiber: 3,
            sodium: 120,
            sugar: 1,
          },
          photo_url: null,
        },
        created_at: '2026-11-10T12:01:00Z',
      },
    ],
  };

  it('stores and restores text and meal/dish card messages in sessionStorage', () => {
    saveRoomSession('bikash@example.com', sampleSession);
    const restored = loadRoomSession('bikash@example.com');
    expect(restored).not.toBeNull();
    expect(restored?.roomCode).toBe('K8M4P2');
    expect(restored?.messages).toHaveLength(2);
    expect(restored?.messages[1].dish_card?.title).toBe('Steamed Rice & Dal');
  });

  it('vanishes completely when delete history / clearRoomSession is invoked', () => {
    saveRoomSession('bikash@example.com', sampleSession);
    clearRoomSession('bikash@example.com');
    expect(loadRoomSession('bikash@example.com')).toBeNull();
  });

  it('vanishes when page reload is detected', () => {
    saveRoomSession('bikash@example.com', sampleSession);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([{ type: 'reload' }]),
    });

    const restored = loadRoomSession('bikash@example.com', { clearOnReload: true });
    expect(restored).toBeNull();
    expect(loadRoomSession('bikash@example.com')).toBeNull();
  });

  it('clearAllRoomSessionsFromStorage clears all room sessions on beforeunload', () => {
    saveRoomSession('a@example.com', sampleSession);
    saveRoomSession('b@example.com', sampleSession);
    clearAllRoomSessionsFromStorage();
    expect(loadRoomSession('a@example.com')).toBeNull();
    expect(loadRoomSession('b@example.com')).toBeNull();
  });

  it('builds ws:// URL for explicit backend base', () => {
    const url = getRoomWsUrl('k8-m4 p2', 'pid-1', 'Alex');
    expect(url).toContain('ws://localhost:8000/api/rooms/ws/K8M4P2');
    expect(url).toContain('participant_id=pid-1');
  });

  it('persists 24h daily room key in localStorage and clears on cancel/expiry/logout', () => {
    saveDailyRoomKey('bikash@example.com', '2c56yu');
    const saved = loadDailyRoomKey('bikash@example.com');
    expect(saved?.roomCode).toBe('2C56YU');

    // Expired key returns null and self-cleans
    saveDailyRoomKey('expired@example.com', 'OLD123', new Date(Date.now() - 1000).toISOString());
    expect(loadDailyRoomKey('expired@example.com')).toBeNull();

    // Explicit clear / logout wipes keys
    clearDailyRoomKey('bikash@example.com');
    expect(loadDailyRoomKey('bikash@example.com')).toBeNull();

    saveDailyRoomKey('bikash@example.com', 'NEW789');
    clearAllDailyRoomKeys();
    expect(loadDailyRoomKey('bikash@example.com')).toBeNull();
  });
});
