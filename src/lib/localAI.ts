import type { AnalyzeResult, CoachRole, DetectedItem, UserProfile } from '../types/schemas';
import * as storage from './storage';

const SETTINGS_KEY = 'local-ai-settings';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_WHISPER_URL = 'http://localhost:5005/transcribe';
const DEFAULT_TTS_URL = 'http://localhost:5005/speak';

export type LocalTTSProvider = 'piper' | 'qwen3';

export interface LocalAISettings {
  ollamaUrl: string;
  preferredModel: string;
  systemPrompt: string;
  whisperUrl: string;
  ttsUrl: string;
  ttsProvider: LocalTTSProvider;
}

export interface LocalModel {
  name: string;
  size: number;
  loaded: boolean;
  text: boolean;
  vision: boolean;
}

export interface LocalChatMessage {
  role: CoachRole;
  content: string;
  image?: string | null;
}

export interface VoiceRuntimeStatus {
  available: boolean;
  whisper: boolean;
  tts: boolean;
  whisperModel: boolean;
  ttsModel: boolean;
  piper: boolean;
  piperModel: boolean;
  qwen3Tts: boolean;
  qwen3TtsModel: boolean;
  error?: string;
}

export const DEFAULT_LOCAL_AI_SETTINGS: LocalAISettings = {
  ollamaUrl: DEFAULT_OLLAMA_URL,
  preferredModel: '',
  systemPrompt: '',
  whisperUrl: DEFAULT_WHISPER_URL,
  ttsUrl: DEFAULT_TTS_URL,
  ttsProvider: 'qwen3',
};

export class LocalAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAIError';
  }
}

export function getLocalAISettings(): LocalAISettings {
  const saved = storage.load<Partial<LocalAISettings>>(SETTINGS_KEY);
  return {
    ...DEFAULT_LOCAL_AI_SETTINGS,
    ...saved,
    ollamaUrl: normalizeBaseUrl(saved?.ollamaUrl || DEFAULT_OLLAMA_URL),
    whisperUrl: saved?.whisperUrl || DEFAULT_WHISPER_URL,
    ttsUrl: saved?.ttsUrl || DEFAULT_TTS_URL,
    ttsProvider: saved?.ttsProvider === 'piper' ? 'piper' : 'qwen3',
  };
}

export function saveLocalAISettings(settings: LocalAISettings): void {
  const normalized = {
    ...settings,
    ollamaUrl: normalizeBaseUrl(settings.ollamaUrl),
    whisperUrl: settings.whisperUrl.trim(),
    ttsUrl: settings.ttsUrl.trim(),
  };
  storage.save(SETTINGS_KEY, normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('local-ai-settings-updated', { detail: normalized }));
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function validatedOllamaUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new LocalAIError('Enter a valid Ollama URL, such as http://localhost:11434.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new LocalAIError('Ollama URL must use HTTP or HTTPS and must not contain credentials.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function localVoiceUrl(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new LocalAIError('Enter a valid local voice service URL.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new LocalAIError('Voice processing must use a loopback URL on this device (localhost or 127.0.0.1).');
  }
  return url;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new LocalAIError(`Local model service returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof LocalAIError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LocalAIError('The local model service did not respond within 12 seconds.');
    }
    throw new LocalAIError(
      'Cannot reach the local model service. Start Ollama and allow this app in its CORS settings.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function inferVisionFromName(name: string): boolean {
  return /(?:^|[-_:])(vl|vision)(?:[-_:]|$)|llava|bakllava|moondream|minicpm-v|granite3\.2-vision/i.test(name);
}

export async function discoverLocalModels(baseUrl = getLocalAISettings().ollamaUrl): Promise<LocalModel[]> {
  const base = validatedOllamaUrl(baseUrl);
  const [tags, running] = await Promise.all([
    requestJson<{ models?: Array<{ name: string; size?: number }> }>(`${base}/api/tags`),
    requestJson<{ models?: Array<{ name: string; model?: string }> }>(`${base}/api/ps`).catch(() => ({ models: [] })),
  ]);
  const loaded = new Set((running.models ?? []).flatMap((model) => [model.name, model.model]).filter(Boolean));
  const models = await Promise.all(
    (tags.models ?? []).map(async (model): Promise<LocalModel> => {
      const details = await requestJson<{
        capabilities?: string[];
        model_info?: Record<string, unknown>;
        details?: { families?: string[] };
      }>(`${base}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.name }),
      }).catch(() => null);
      const capabilities = details?.capabilities ?? [];
      const modelInfo = Object.keys(details?.model_info ?? {}).join(' ');
      const supportsVision =
        capabilities.includes('vision') ||
        /projector|vision\.encoder/i.test(modelInfo) ||
        inferVisionFromName(model.name);
      return {
        name: model.name,
        size: model.size ?? 0,
        loaded: loaded.has(model.name),
        text: !capabilities.length || capabilities.includes('completion') || capabilities.includes('tools'),
        vision: supportsVision,
      };
    }),
  );
  return models.filter((model) => model.text);
}

function orderedModels(models: LocalModel[], preferredModel: string, needsVision: boolean): LocalModel[] {
  const compatible = models.filter((model) => model.text && (!needsVision || model.vision));
  return compatible.sort((a, b) => {
    if (a.name === preferredModel) return -1;
    if (b.name === preferredModel) return 1;
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function imagePayload(dataUrl: string): string {
  const separator = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/') || separator < 0) {
    throw new LocalAIError('The attached image is not a supported image data URL.');
  }
  return dataUrl.slice(separator + 1);
}

async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
  temperature = 0.2,
): Promise<string> {
  const data = await requestJson<{ message?: { content?: string }; error?: string }>(
    `${validatedOllamaUrl(baseUrl)}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature },
      }),
    },
  );
  const content = data.message?.content?.trim();
  if (!content) throw new LocalAIError(data.error || `Model "${model}" returned an empty response.`);
  return content;
}

function parseDetectedItems(content: string): DetectedItem[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  const objectStart = content.indexOf('{');
  const objectEnd = content.lastIndexOf('}');
  const json = start >= 0 && end > start
    ? content.slice(start, end + 1)
    : objectStart >= 0 && objectEnd > objectStart
      ? content.slice(objectStart, objectEnd + 1)
      : content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LocalAIError('The local vision model response was not valid JSON. Try another vision model.');
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'detected' in parsed
      ? (parsed as { detected: unknown }).detected
      : [];
  if (!Array.isArray(items)) {
    throw new LocalAIError('The local vision model did not return a food-item list.');
  }
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: String(item.name).trim(),
      name_bn: typeof item.name_bn === 'string' ? item.name_bn : null,
      confidence: Math.max(0, Math.min(100, Number(item.confidence) || 0)),
      grams: Math.max(1, Number(item.grams) || 100),
      note: typeof item.note === 'string' ? item.note : null,
    }));
}

export async function analyzeImageLocally(
  dataUrl: string,
  profile?: UserProfile | null,
): Promise<{ result: AnalyzeResult; model: string }> {
  const settings = getLocalAISettings();
  const models = orderedModels(await discoverLocalModels(settings.ollamaUrl), settings.preferredModel, true);
  if (!models.length) {
    throw new LocalAIError('No local image-capable model is installed. Add a vision model in Ollama, then refresh Settings.');
  }

  const image = imagePayload(dataUrl);
  const language = profile?.language === 'bn' ? 'Bengali' : 'English';
  const prompt = [
    'Analyze this meal image and identify visible foods only. Do not invent ingredients.',
    `Reply in ${language}. Return only a JSON array with objects shaped as {"name":"canonical food name","name_bn":"Bengali name or null","confidence":0-100,"grams":100}.`,
    'Use a reasonable portion estimate. If no food is visible, return [].',
  ].join(' ');
  let lastError: unknown;
  for (const model of models) {
    try {
      const content = await ollamaChat(settings.ollamaUrl, model.name, [
        { role: 'user', content: prompt, images: [image] },
      ]);
      const detected = parseDetectedItems(content);
      return {
        result: {
          detected,
          is_food: detected.length > 0,
          pipeline: [
            { stage: 'capture', status: 'done', startedAt: Date.now(), finishedAt: Date.now(), label: 'Image prepared on device' },
            { stage: 'vision-id', status: 'done', startedAt: Date.now(), finishedAt: Date.now(), label: `Local vision: ${model.name}` },
          ],
        },
        model: model.name,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new LocalAIError(
    `All installed local vision models failed. ${lastError instanceof Error ? lastError.message : ''}`.trim(),
  );
}

export async function chatWithLocalModel(
  messages: LocalChatMessage[],
  options: { systemPrompt: string; imageContext?: string | null },
): Promise<{ reply: string; model: string }> {
  const settings = getLocalAISettings();
  const needsVision = Boolean(options.imageContext || messages.some((message) => message.image));
  const models = orderedModels(await discoverLocalModels(settings.ollamaUrl), settings.preferredModel, needsVision);
  if (!models.length) {
    throw new LocalAIError(
      needsVision
        ? 'No local image-capable model is installed. Add a vision model in Ollama to chat about photos.'
        : 'No compatible local chat model is installed. Add a chat model in Ollama, then refresh Settings.',
    );
  }
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  let lastError: unknown;
  for (const model of models) {
    try {
      const requestMessages = [
        { role: 'system', content: options.systemPrompt },
        ...messages.map((message, index) => {
          const image = message.image || (index === lastUserIndex ? options.imageContext : null);
          return {
            role: message.role,
            content: message.content || (image ? 'Describe this image.' : ''),
            ...(image ? { images: [imagePayload(image)] } : {}),
          };
        }),
      ];
      return { reply: await ollamaChat(settings.ollamaUrl, model.name, requestMessages), model: model.name };
    } catch (error) {
      lastError = error;
    }
  }
  throw new LocalAIError(
    `All compatible local chat models failed. ${lastError instanceof Error ? lastError.message : ''}`.trim(),
  );
}

async function voiceRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(localVoiceUrl(url), { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null;
      throw new LocalAIError(body?.detail || `Local voice service returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof LocalAIError) throw error;
    throw new LocalAIError('Cannot reach the local voice service. Configure and start the Whisper and selected TTS runtime in Settings.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeLocally(audio: Blob, language: string): Promise<string> {
  const settings = getLocalAISettings();
  const formData = new FormData();
  formData.append('audio', audio, 'recording.webm');
  formData.append('language', language.startsWith('bn') ? 'bn' : 'en');
  const result = await voiceRequest<{ text?: string }>(settings.whisperUrl, { method: 'POST', body: formData });
  if (!result.text?.trim()) throw new LocalAIError('Whisper returned no transcript. Try speaking again.');
  return result.text.trim();
}

export async function synthesizeLocally(text: string, language: string): Promise<Blob> {
  const settings = getLocalAISettings();
  const result = await voiceRequest<{ audio_base64?: string; mime_type?: string }>(settings.ttsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      language: language.startsWith('bn') ? 'Bengali' : 'English',
      provider: settings.ttsProvider,
    }),
  });
  if (!result.audio_base64) throw new LocalAIError(`${settings.ttsProvider === 'piper' ? 'Piper' : 'Qwen3-TTS'} did not return audio bytes.`);
  const binary = atob(result.audio_base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: result.mime_type || 'audio/wav' });
}

export async function checkLocalVoiceRuntime(whisperUrl: string, ttsUrl: string): Promise<VoiceRuntimeStatus> {
  let whisperHealth: URL;
  let ttsHealth: URL;
  try {
    whisperHealth = localVoiceUrl(whisperUrl);
    ttsHealth = localVoiceUrl(ttsUrl);
  } catch (error) {
    return {
      available: false,
      whisper: false,
      tts: false,
      whisperModel: false,
      ttsModel: false,
      piper: false,
      piperModel: false,
      qwen3Tts: false,
      qwen3TtsModel: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  whisperHealth.pathname = '/health';
  whisperHealth.search = '';
  ttsHealth.pathname = '/health';
  ttsHealth.search = '';
  const [whisper, tts] = await Promise.all([
    requestJson<VoiceRuntimeStatus>(whisperHealth.toString()).catch(() => null),
    requestJson<VoiceRuntimeStatus>(ttsHealth.toString()).catch(() => null),
  ]);
  if (!whisper && !tts) {
    return {
      available: false,
      whisper: false,
      tts: false,
      whisperModel: false,
      ttsModel: false,
      piper: false,
      piperModel: false,
      qwen3Tts: false,
      qwen3TtsModel: false,
      error: 'Local voice runtime is not reachable.',
    };
  }
  const status = whisper ?? tts!;
  return {
    ...status,
    available: Boolean(whisper?.whisper && whisper?.whisperModel && tts?.tts && tts?.ttsModel),
    whisper: Boolean(whisper?.whisper),
    tts: Boolean(tts?.tts),
    whisperModel: Boolean(whisper?.whisperModel),
    ttsModel: Boolean(tts?.ttsModel),
    piper: Boolean(tts?.piper),
    piperModel: Boolean(tts?.piperModel),
    qwen3Tts: Boolean(tts?.qwen3Tts ?? tts?.tts),
    qwen3TtsModel: Boolean(tts?.qwen3TtsModel ?? tts?.ttsModel),
  };
}
