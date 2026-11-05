import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatWithLocalModel,
  checkLocalVoiceRuntime,
  DEFAULT_LOCAL_AI_SETTINGS,
  saveLocalAISettings,
  synthesizeLocally,
} from './localAI';

const values = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

describe('local AI adapter', () => {
  beforeEach(() => {
    values.clear();
    vi.restoreAllMocks();
  });

  it('falls back to another compatible vision model and sends the attached image locally', async () => {
    saveLocalAISettings({ ...DEFAULT_LOCAL_AI_SETTINGS, preferredModel: 'broken-vision' });
    const chatModels: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'broken-vision' }, { name: 'working-vision' }] });
      }
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'working-vision' }] });
      if (url.endsWith('/api/show')) {
        return Response.json({ capabilities: ['completion', 'vision'] });
      }
      if (url.endsWith('/api/chat')) {
        const request = JSON.parse(String(init?.body)) as {
          model: string;
          messages: Array<{ images?: string[] }>;
        };
        chatModels.push(request.model);
        if (request.model === 'broken-vision') {
          return Response.json({ error: 'model failed' }, { status: 503 });
        }
        expect(request.messages.at(-1)?.images).toEqual(['aGVsbG8=']);
        return Response.json({ message: { content: 'This appears to be a meal.' } });
      }
      throw new Error(`Unexpected local AI URL: ${url}`);
    }) as typeof fetch;

    const result = await chatWithLocalModel(
      [{ role: 'user', content: 'What is in this photo?', image: 'data:image/png;base64,aGVsbG8=' }],
      { systemPrompt: 'Reply carefully.' },
    );

    expect(result).toEqual({ reply: 'This appears to be a meal.', model: 'working-vision' });
    expect(chatModels).toEqual(['broken-vision', 'working-vision']);
  });

  it('rejects non-loopback voice endpoints without making a network request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const status = await checkLocalVoiceRuntime(
      'https://voice.example/transcribe',
      'http://localhost:5005/speak',
    );

    expect(status.available).toBe(false);
    expect(status.error).toContain('loopback URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the selected local speech engine to the voice service', async () => {
    saveLocalAISettings({ ...DEFAULT_LOCAL_AI_SETTINGS, ttsProvider: 'piper' });
    const fetchMock = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        text: 'Hello there.',
        language: 'English',
        provider: 'piper',
      });
      return Response.json({ audio_base64: btoa('wav-data'), mime_type: 'audio/wav' });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const audio = await synthesizeLocally('Hello there.', 'en-US');

    expect(audio.type).toBe('audio/wav');
    expect(await audio.text()).toBe('wav-data');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports the Piper and Qwen3-TTS runtime availability independently', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      available: true,
      whisper: true,
      whisperModel: true,
      tts: true,
      ttsModel: true,
      piper: true,
      piperModel: true,
      qwen3Tts: false,
      qwen3TtsModel: false,
    })) as typeof fetch;

    const status = await checkLocalVoiceRuntime(
      'http://localhost:5005/transcribe',
      'http://localhost:5005/speak',
    );

    expect(status.piper).toBe(true);
    expect(status.qwen3Tts).toBe(false);
    expect(status.available).toBe(true);
  });
});
