import type { CoachAgentType, CoachMessage } from '../types/schemas';

export type StoredCoachMessage = CoachMessage & {
  persona?: string;
};

const HISTORY_LIMIT = 2;
const MAX_STORED_IMAGE_LENGTH = 512_000;

function isStoredCoachMessage(message: unknown): message is StoredCoachMessage {
  if (message === null || typeof message !== 'object') return false;
  const candidate = message as Record<string, unknown>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    (candidate.persona === undefined || typeof candidate.persona === 'string') &&
    (candidate.image_ref === undefined ||
      candidate.image_ref === null ||
      typeof candidate.image_ref === 'string')
  );
}

export function coachHistoryStorageKey(sessionKey: string, persona: CoachAgentType): string {
  return `nv_coach_history:${encodeURIComponent(sessionKey)}:${persona}`;
}

export function loadCoachSessionHistory(
  sessionKey: string,
  persona: CoachAgentType,
): StoredCoachMessage[] {
  if (typeof sessionStorage === 'undefined') return [];

  const key = coachHistoryStorageKey(sessionKey, persona);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new TypeError('Coach history must be an array.');

    const validMessages = parsed.filter(isStoredCoachMessage);
    if (validMessages.length !== parsed.length) {
      console.warn('Invalid AI Coach history entries were ignored.');
    }

    return validMessages.slice(-HISTORY_LIMIT);
  } catch (error) {
    console.warn('Could not restore AI Coach session history:', error);
    return [];
  }
}

export function saveCoachSessionHistory(
  sessionKey: string,
  persona: CoachAgentType,
  messages: StoredCoachMessage[],
): void {
  if (typeof sessionStorage === 'undefined') return;

  const conversation = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.content,
      persona: message.persona,
      ...(message.image_ref && message.image_ref.length <= MAX_STORED_IMAGE_LENGTH
        ? { image_ref: message.image_ref }
        : {}),
    }));

  if (!conversation.some((message) => message.role === 'user')) return;

  try {
    sessionStorage.setItem(coachHistoryStorageKey(sessionKey, persona), JSON.stringify(conversation));
  } catch (error) {
    console.warn('Could not save AI Coach session history:', error);
  }
}
