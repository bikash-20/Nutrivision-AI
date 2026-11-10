import type { RoomMember, RoomMessage } from '../types/schemas';

export interface StoredRoomSession {
  roomCode: string;
  participantId: string;
  displayName: string;
  members: RoomMember[];
  lastSeq: number;
  messages: RoomMessage[];
}

const MAX_SESSION_IMAGE_LENGTH = 300_000;

export function roomSessionStorageKey(sessionKey: string): string {
  return `nv_room_session:${encodeURIComponent(sessionKey || 'guest')}`;
}

export function clearAllRoomSessionsFromStorage(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('nv_room_session:')) {
        keys.push(key);
      }
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Ignore storage access errors in restricted contexts.
  }
}

export function wasPageReloaded(): boolean {
  if (typeof performance === 'undefined') return false;
  try {
    const entries = performance.getEntriesByType?.('navigation');
    if (entries && entries.length > 0) {
      const nav = entries[0] as PerformanceNavigationTiming;
      if (nav.type === 'reload') return true;
    }
    const legacyNav = (performance as unknown as { navigation?: { type?: number } }).navigation;
    if (legacyNav && legacyNav.type === 1) return true;
  } catch {
    return false;
  }
  return false;
}

export function loadRoomSession(
  sessionKey: string,
  options?: { clearOnReload?: boolean },
): StoredRoomSession | null {
  if (typeof sessionStorage === 'undefined') return null;

  if (options?.clearOnReload && wasPageReloaded()) {
    clearRoomSession(sessionKey);
    return null;
  }

  try {
    const raw = sessionStorage.getItem(roomSessionStorageKey(sessionKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRoomSession> | null;
    if (
      !parsed ||
      typeof parsed.roomCode !== 'string' ||
      typeof parsed.participantId !== 'string' ||
      typeof parsed.displayName !== 'string' ||
      !Array.isArray(parsed.messages)
    ) {
      return null;
    }
    return {
      roomCode: parsed.roomCode,
      participantId: parsed.participantId,
      displayName: parsed.displayName,
      members: Array.isArray(parsed.members) ? parsed.members : [],
      lastSeq: typeof parsed.lastSeq === 'number' ? parsed.lastSeq : 0,
      messages: parsed.messages,
    };
  } catch {
    return null;
  }
}

export function saveRoomSession(sessionKey: string, state: StoredRoomSession): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const sanitizedMessages = state.messages.map((msg) => {
      if (
        msg.dish_card?.photo_url &&
        msg.dish_card.photo_url.length > MAX_SESSION_IMAGE_LENGTH
      ) {
        return {
          ...msg,
          dish_card: { ...msg.dish_card, photo_url: null },
        };
      }
      return msg;
    });
    const payload: StoredRoomSession = {
      ...state,
      messages: sanitizedMessages,
    };
    sessionStorage.setItem(roomSessionStorageKey(sessionKey), JSON.stringify(payload));
  } catch {
    // If sessionStorage quota fills (e.g. too many dish images), retry without thumbnails.
    try {
      const compact: StoredRoomSession = {
        ...state,
        messages: state.messages.map((msg) =>
          msg.dish_card
            ? { ...msg, dish_card: { ...msg.dish_card, photo_url: null } }
            : msg,
        ),
      };
      sessionStorage.setItem(roomSessionStorageKey(sessionKey), JSON.stringify(compact));
    } catch {
      // Ignore storage write failure.
    }
  }
}

export function clearRoomSession(sessionKey: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(roomSessionStorageKey(sessionKey));
  } catch {
    // Ignore storage removal errors.
  }
}

// ── 24-hour Saved Room Key (localStorage per account, cleared on logout/cancel) ──

export interface SavedDailyRoomKey {
  roomCode: string;
  expiresAt: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function dailyRoomKeyStorageKey(sessionKey: string): string {
  return `nv_room_key:${encodeURIComponent(sessionKey || 'guest')}`;
}

export function saveDailyRoomKey(
  sessionKey: string,
  roomCode: string,
  expiresAt?: string | null,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) return;
    const expiryIso =
      expiresAt && !Number.isNaN(Date.parse(expiresAt))
        ? expiresAt
        : new Date(Date.now() + ONE_DAY_MS).toISOString();
    const payload: SavedDailyRoomKey = {
      roomCode: cleanCode,
      expiresAt: expiryIso,
    };
    localStorage.setItem(dailyRoomKeyStorageKey(sessionKey), JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors.
  }
}

export function loadDailyRoomKey(sessionKey: string): SavedDailyRoomKey | null {
  if (typeof localStorage === 'undefined') return null;
  const key = dailyRoomKeyStorageKey(sessionKey);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDailyRoomKey> | null;
    if (!parsed || typeof parsed.roomCode !== 'string' || typeof parsed.expiresAt !== 'string') {
      localStorage.removeItem(key);
      return null;
    }
    const expMs = Date.parse(parsed.expiresAt);
    if (Number.isNaN(expMs) || expMs <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      roomCode: parsed.roomCode,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function clearDailyRoomKey(sessionKey: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(dailyRoomKeyStorageKey(sessionKey));
  } catch {
    // Ignore.
  }
}

export function clearAllDailyRoomKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nv_room_key:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore.
  }
}
