import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendCoachChat, sendCoachVoiceChat, generateCoachTTS } from '../../lib/api';
import type { CoachChatRequest } from '../../types/schemas';

describe('coach API fallback behavior', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline')) as typeof fetch;
  });

  it('does not turn a failed chat request into canned AI output', async () => {
    const req: CoachChatRequest = {
      message: 'What is in this meal?',
      agent_type: 'scientist',
    };
    await expect(sendCoachChat(req)).rejects.toThrow('offline');
  });

  it('does not turn a failed voice request into canned chat or fake audio', async () => {
    const req: CoachChatRequest = {
      message: 'Help me understand this meal.',
      agent_type: 'scientist',
      include_audio: true,
    };
    await expect(sendCoachVoiceChat(req)).rejects.toThrow('offline');
  });

  it('surfaces speech synthesis failures instead of returning a success-shaped fallback', async () => {
    await expect(generateCoachTTS({ text: 'Hello, this is NutriVision AI Coach' })).rejects.toThrow('offline');
  });
});
