/**
 * NutriVision AI — Live /docs Access Control, Scheduling & Content Configuration.
 * 
 * Manages public visibility, date-time publishing windows, admin override modes,
 * team member information, and document content persistence.
 */

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  github?: string;
  linkedin?: string;
}

export type OverrideMode = 'auto' | 'force_public' | 'force_private';

export interface DocsConfig {
  /** Master toggle: true to allow public access (subject to schedule or override) */
  enabled: boolean;
  /** Whether date/time scheduling is enforced */
  scheduleEnabled: boolean;
  /** ISO datetime string for publishing window start (Default: June 10, 2026 00:00:00 UTC) */
  startDate: string;
  /** ISO datetime string for publishing window end (Default: June 14, 2026 23:59:59 UTC) */
  endDate: string;
  /** Admin override mode */
  overrideMode: OverrideMode;
  /** Passcode allowing judges/evaluators to view when access is restricted */
  accessPasscode: string;
  /** Team metadata */
  teamName: string;
  teamMembers: TeamMember[];
  /** Last updated timestamp */
  lastUpdated: string;
}

const STORAGE_KEY = 'nutrivision_docs_config_v1';
const PASSCODE_SESSION_KEY = 'nutrivision_docs_passcode_unlocked';

/**
 * Standard Hackathon / Judging Window Default Configuration:
 * Public availability: June 10 (00:00) → June 14 (23:59)
 */
export const DEFAULT_DOCS_CONFIG: DocsConfig = {
  enabled: true,
  scheduleEnabled: true,
  startDate: '2026-06-10T00:00:00',
  endDate: '2026-06-14T23:59:59',
  overrideMode: 'auto',
  accessPasscode: 'nutrivision2026',
  teamName: 'NutriVision Engineering & Research Core',
  teamMembers: [
    {
      id: 'bikash-talukder',
      name: 'Bikash Talukder',
      role: 'Lead Full-Stack & AI Systems Architect / Founder',
      email: 'bikashtalukder040@gmail.com',
      avatarUrl: 'https://avatars.githubusercontent.com/u/108343997?v=4',
      bio: 'Full-stack software engineer & AI researcher specialized in multimodal computer vision, offline SLMs, and distributed systems.',
      github: 'https://github.com/bikash-20',
      linkedin: 'https://linkedin.com/in/bikashtalukder',
    },
  ],
  lastUpdated: new Date().toISOString(),
};

/** Load the docs configuration from localStorage with default fallbacks. */
export function getDocsConfig(): DocsConfig {
  if (typeof window === 'undefined') return DEFAULT_DOCS_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DOCS_CONFIG;
    const parsed = JSON.parse(raw) as Partial<DocsConfig>;
    return {
      ...DEFAULT_DOCS_CONFIG,
      ...parsed,
      teamMembers: parsed.teamMembers && parsed.teamMembers.length > 0
        ? parsed.teamMembers
        : DEFAULT_DOCS_CONFIG.teamMembers,
    };
  } catch {
    return DEFAULT_DOCS_CONFIG;
  }
}

/** Save updated docs configuration. */
export function saveDocsConfig(config: DocsConfig): void {
  if (typeof window === 'undefined') return;
  try {
    const updated = { ...config, lastUpdated: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('nutrivision-docs-config-changed', { detail: updated }));
  } catch (err) {
    console.error('Failed to save docs configuration to localStorage:', err);
  }
}

let _memoryPasscodeUnlocked = false;

/** Check if current user has unlocked access via passcode in the current session. */
export function isPasscodeUnlocked(): boolean {
  if (_memoryPasscodeUnlocked) return true;
  if (typeof window === 'undefined') return false;
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(PASSCODE_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Record that access was unlocked via passcode for this session. */
export function setPasscodeUnlocked(unlocked: boolean): void {
  _memoryPasscodeUnlocked = unlocked;
  if (typeof window === 'undefined') return;
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (unlocked) {
        sessionStorage.setItem(PASSCODE_SESSION_KEY, 'true');
      } else {
        sessionStorage.removeItem(PASSCODE_SESSION_KEY);
      }
    }
  } catch {
    // Ignore storage issues
  }
}

export interface AccessEvaluation {
  isAccessible: boolean;
  reason: 'public_open' | 'force_public' | 'within_schedule' | 'admin_override' | 'passcode_unlocked' | 'force_private' | 'schedule_not_started' | 'schedule_expired' | 'disabled';
  activeWindowText: string;
  isWithinSchedule: boolean;
  secondsRemaining?: number;
}

/**
 * Rigorously evaluate whether /docs is currently accessible to the visitor.
 * Takes current admin status and optional explicit timestamp into account.
 */
export function evaluateDocsAccess(
  config: DocsConfig = getDocsConfig(),
  isAdmin: boolean = false,
  now: Date = new Date()
): AccessEvaluation {
  const windowText = `June 10 (00:00) → June 14 (23:59)`;

  // Admin or verified passcode session always has access
  if (isAdmin) {
    return {
      isAccessible: true,
      reason: 'admin_override',
      activeWindowText: windowText,
      isWithinSchedule: true,
    };
  }

  if (isPasscodeUnlocked()) {
    return {
      isAccessible: true,
      reason: 'passcode_unlocked',
      activeWindowText: windowText,
      isWithinSchedule: true,
    };
  }

  // Force public override
  if (config.overrideMode === 'force_public') {
    return {
      isAccessible: true,
      reason: 'force_public',
      activeWindowText: windowText,
      isWithinSchedule: true,
    };
  }

  // Force private override
  if (config.overrideMode === 'force_private') {
    return {
      isAccessible: false,
      reason: 'force_private',
      activeWindowText: windowText,
      isWithinSchedule: false,
    };
  }

  // Master switch disabled
  if (!config.enabled) {
    return {
      isAccessible: false,
      reason: 'disabled',
      activeWindowText: windowText,
      isWithinSchedule: false,
    };
  }

  // Schedule enforcement
  if (config.scheduleEnabled) {
    const start = new Date(config.startDate).getTime();
    const end = new Date(config.endDate).getTime();
    const current = now.getTime();

    if (current < start) {
      return {
        isAccessible: false,
        reason: 'schedule_not_started',
        activeWindowText: windowText,
        isWithinSchedule: false,
        secondsRemaining: Math.floor((start - current) / 1000),
      };
    }

    if (current > end) {
      return {
        isAccessible: false,
        reason: 'schedule_expired',
        activeWindowText: windowText,
        isWithinSchedule: false,
      };
    }

    return {
      isAccessible: true,
      reason: 'within_schedule',
      activeWindowText: windowText,
      isWithinSchedule: true,
      secondsRemaining: Math.floor((end - current) / 1000),
    };
  }

  // Schedule not enabled and master switch enabled -> public
  return {
    isAccessible: true,
    reason: 'public_open',
    activeWindowText: windowText,
    isWithinSchedule: true,
  };
}
