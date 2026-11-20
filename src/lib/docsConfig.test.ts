import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateDocsAccess,
  DEFAULT_DOCS_CONFIG,
  type DocsConfig,
  setPasscodeUnlocked,
} from './docsConfig';

describe('docsConfig - evaluateDocsAccess', () => {
  beforeEach(() => {
    setPasscodeUnlocked(false);
  });

  it('allows access when user is admin regardless of override or schedule', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: false,
      overrideMode: 'force_private',
    };
    const result = evaluateDocsAccess(config, true);
    expect(result.isAccessible).toBe(true);
    expect(result.reason).toBe('admin_override');
  });

  it('allows access when overrideMode is force_public', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: false,
      overrideMode: 'force_public',
    };
    const result = evaluateDocsAccess(config, false);
    expect(result.isAccessible).toBe(true);
    expect(result.reason).toBe('force_public');
  });

  it('denies access when overrideMode is force_private and user is not admin', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: true,
      overrideMode: 'force_private',
    };
    const result = evaluateDocsAccess(config, false);
    expect(result.isAccessible).toBe(false);
    expect(result.reason).toBe('force_private');
  });

  it('denies access when enabled is false and mode is auto', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: false,
      overrideMode: 'auto',
    };
    const result = evaluateDocsAccess(config, false);
    expect(result.isAccessible).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('correctly validates the default schedule window (June 10 to June 14, 2026)', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: true,
      scheduleEnabled: true,
      overrideMode: 'auto',
      startDate: '2026-06-10T00:00:00Z',
      endDate: '2026-06-14T23:59:59Z',
    };

    // Before schedule
    const beforeDate = new Date('2026-06-09T12:00:00Z');
    const beforeResult = evaluateDocsAccess(config, false, beforeDate);
    expect(beforeResult.isAccessible).toBe(false);
    expect(beforeResult.reason).toBe('schedule_not_started');

    // Within schedule
    const duringDate = new Date('2026-06-12T12:00:00Z');
    const duringResult = evaluateDocsAccess(config, false, duringDate);
    expect(duringResult.isAccessible).toBe(true);
    expect(duringResult.reason).toBe('within_schedule');

    // After schedule
    const afterDate = new Date('2026-06-15T01:00:00Z');
    const afterResult = evaluateDocsAccess(config, false, afterDate);
    expect(afterResult.isAccessible).toBe(false);
    expect(afterResult.reason).toBe('schedule_expired');
  });

  it('allows access when passcode is unlocked in current session', () => {
    const config: DocsConfig = {
      ...DEFAULT_DOCS_CONFIG,
      enabled: true,
      overrideMode: 'force_private',
    };
    setPasscodeUnlocked(true);
    const result = evaluateDocsAccess(config, false);
    expect(result.isAccessible).toBe(true);
    expect(result.reason).toBe('passcode_unlocked');
  });
});
