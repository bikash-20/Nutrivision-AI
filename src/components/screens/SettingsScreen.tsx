import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, CircleCheck, Download, RefreshCw, Settings2, Wifi, WifiOff } from 'lucide-react';
import { T } from '../../data';
import { useTokens } from '../../theme/useTokens';
import { checkLocalVoiceRuntime, discoverLocalModels, getLocalAISettings, saveLocalAISettings } from '../../lib/localAI';
import type { LocalAISettings, LocalModel, VoiceRuntimeStatus } from '../../lib/localAI';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTokens();
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const isDark = theme === 'dark';
  const [settings, setSettings] = useState<LocalAISettings>(() => getLocalAISettings());
  const [models, setModels] = useState<LocalModel[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceRuntimeStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  const refreshModels = useCallback(async () => {
    setModelStatus('checking');
    setError(null);
    try {
      const available = await discoverLocalModels(settings.ollamaUrl);
      setModels(available);
      setModelStatus('ready');
      const preferredModel = getLocalAISettings().preferredModel;
      if (preferredModel && !available.some((model) => model.name === preferredModel)) {
        setError(isBn ? 'নির্বাচিত মডেলটি পাওয়া যায়নি; একটি উপলভ্য মডেল বেছে নিন।' : 'The selected model is not installed. Choose an available model.');
      }
    } catch (reason) {
      setModels([]);
      setModelStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [isBn, settings.ollamaUrl]);

  const checkVoice = useCallback(async () => {
    setVoiceStatus(await checkLocalVoiceRuntime(settings.whisperUrl, settings.ttsUrl));
  }, [settings.whisperUrl, settings.ttsUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshModels(), 350);
    return () => window.clearTimeout(timer);
  }, [refreshModels]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const updateSetting = <K extends keyof LocalAISettings>(key: K, value: LocalAISettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveLocalAISettings(next);
  };

  const surface = isDark ? 'rgba(42, 32, 27, 0.92)' : 'rgba(255,255,255,0.82)';
  const border = isDark ? '1px solid rgba(255,255,255,0.12)' : `1px solid ${T.cardBorder}`;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 12,
    border,
    background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.9)',
    color: T.ink,
    font: 'inherit',
  };
  const cardStyle: React.CSSProperties = {
    background: surface,
    border,
    borderRadius: 18,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  return (
    <LocalizedContent>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 18px 150px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, color: T.ink, fontSize: 24, fontFamily: 'Fraunces, Georgia, serif' }}>
              {isBn ? 'সেটিংস' : 'Settings'}
            </h1>
            <p style={{ margin: '5px 0 0', color: T.inkSoft, fontSize: 13 }}>
              {isBn ? 'স্থানীয় AI মডেল ও অফলাইন পরিষেবা' : 'Local AI models and offline services'}
            </p>
          </div>
          <button type="button" onClick={onBack} style={{ ...inputStyle, width: 'auto', minHeight: 40, cursor: 'pointer' }}>
            {isBn ? 'সম্পন্ন' : 'Done'}
          </button>
        </header>

        <div role="status" style={{ ...cardStyle, flexDirection: 'row', alignItems: 'center', color: online ? T.accentGood : T.accentWarn }}>
          {online ? <Wifi size={18} /> : <WifiOff size={18} />}
          <div style={{ color: T.ink, fontSize: 13, lineHeight: 1.5 }}>
            <strong>{online ? (isBn ? 'ইন্টারনেট সংযুক্ত' : 'Internet connected') : (isBn ? 'অফলাইন মোড' : 'Offline mode')}</strong>
            <div style={{ color: T.inkSoft }}>
              {isBn
                ? 'প্রোফাইল, খাবার, বাজারের তালিকা ও অ্যাপের কাঠামো এই ডিভাইসে সংরক্ষিত হয়। AI-এর জন্য নিচের স্থানীয় মডেলগুলো সেট আপ করুন।'
                : 'Profile, meals, grocery list, and the app shell stay on this device. Local models below are required for offline AI.'}
            </div>
          </div>
        </div>

        <section style={cardStyle} aria-labelledby="local-model-heading">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <h2 id="local-model-heading" style={{ margin: 0, color: T.ink, fontSize: 17 }}>
                {isBn ? 'স্থানীয় মডেল' : 'Local models'}
              </h2>
              <p style={{ margin: '4px 0 0', color: T.inkSoft, fontSize: 12 }}>
                {isBn ? 'Ollama-এর সাথে সরাসরি সংযোগ' : 'Direct connection to Ollama'}
              </p>
            </div>
            <button type="button" aria-label={isBn ? 'মডেল রিফ্রেশ করুন' : 'Refresh models'} onClick={() => void refreshModels()} disabled={modelStatus === 'checking'} style={{ ...inputStyle, width: 42, minHeight: 42, padding: 0, cursor: 'pointer' }}>
              <RefreshCw size={17} className={modelStatus === 'checking' ? 'animate-spin' : ''} />
            </button>
          </div>

          <label style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600 }}>
            {isBn ? 'OLLAMA সার্ভার ঠিকানা' : 'OLLAMA SERVER URL'}
            <input value={settings.ollamaUrl} onChange={(event) => updateSetting('ollamaUrl', event.target.value)} onBlur={() => void refreshModels()} style={{ ...inputStyle, marginTop: 6 }} spellCheck={false} inputMode="url" />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: modelStatus === 'ready' ? T.accentGood : modelStatus === 'error' ? T.accentWarn : T.inkSoft, fontSize: 12 }}>
            {modelStatus === 'ready' ? <CircleCheck size={16} /> : modelStatus === 'error' ? <CircleAlert size={16} /> : <RefreshCw size={15} className="animate-spin" />}
            <span>
              {modelStatus === 'ready'
                ? (isBn ? `${models.length}টি মডেল শনাক্ত হয়েছে` : `${models.length} model${models.length === 1 ? '' : 's'} detected`)
                : modelStatus === 'error'
                  ? (isBn ? 'Ollama সংযোগ করা যায়নি' : 'Ollama is not reachable')
                  : (isBn ? 'মডেল পরীক্ষা করা হচ্ছে…' : 'Checking local models…')}
            </span>
          </div>

          {error && <p role="alert" style={{ margin: 0, color: T.accentWarn, fontSize: 12, lineHeight: 1.5 }}>{error}</p>}

          {models.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                {isBn ? 'মডেল নির্বাচন' : 'MODEL SELECTION'}
              </legend>
              {[null, ...models].map((model) => {
                const modelName = model?.name ?? '';
                const selected = settings.preferredModel === modelName;
                return (
                  <label key={modelName || 'auto'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, border: selected ? `1px solid ${T.primary}` : border, background: selected ? (isDark ? 'rgba(208,174,146,0.12)' : 'rgba(74,58,52,0.06)') : 'transparent', cursor: 'pointer' }}>
                    <input type="radio" name="local-model" checked={selected} onChange={() => updateSetting('preferredModel', modelName)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', color: T.ink, fontSize: 13, wordBreak: 'break-word' }}>
                        {model ? model.name : (isBn ? 'স্বয়ংক্রিয় (প্রস্তাবিত)' : 'Automatic (recommended)')}
                      </strong>
                      <span style={{ color: T.inkSoft, fontSize: 11 }}>
                        {model
                          ? `${model.loaded ? (isBn ? 'লোড করা' : 'Loaded') : (isBn ? 'ইনস্টল করা · ব্যবহারে লোড হবে' : 'Installed · loads on first use')}${model.size > 0 ? ` · ${formatBytes(model.size)}` : ''}`
                          : (isBn ? 'ইনস্টল করা সামঞ্জস্যপূর্ণ মডেল থেকে স্বয়ংক্রিয়ভাবে বেছে নেবে' : 'Automatically chooses from compatible installed models')}
                      </span>
                      {model && (
                        <span style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                          <CapabilityPill label={isBn ? 'টেক্সট' : 'Text'} enabled={model.text} />
                          <CapabilityPill label={isBn ? 'ছবি' : 'Vision'} enabled={model.vision} />
                        </span>
                      )}
                    </span>
                    {selected && <Check size={17} color={T.primary} />}
                  </label>
                );
              })}
            </fieldset>
          )}

          <p style={{ margin: 0, color: T.inkSoft, fontSize: 11, lineHeight: 1.5 }}>
            {isBn
              ? models.length === 0
                ? 'Ollama-এ মডেল ইনস্টল করা থাকলে রিফ্রেশ করুন; স্বয়ংক্রিয় নির্বাচন মডেল নিজে খুঁজে নেবে। ছবি বিশ্লেষণের জন্য Vision মডেল লাগবে।'
                : 'ছবি বিশ্লেষণ ও ছবির চ্যাটের জন্য Vision মডেল দরকার। নির্বাচিত মডেল অনুপযুক্ত হলে স্বয়ংক্রিয়ভাবে অন্য সামঞ্জস্যপূর্ণ মডেল ব্যবহার হবে।'
              : models.length === 0
                ? 'Install a model with Ollama, then refresh. Automatic selection will discover installed models; meal photos require a vision-capable model.'
                : 'Photo analysis and image chat require a vision-capable model. If your preferred model is incompatible or fails, another compatible installed model is tried.'}
          </p>
          <label style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600 }}>
            {isBn ? 'সিস্টেম নির্দেশনা (ঐচ্ছিক)' : 'SYSTEM PROMPT (OPTIONAL)'}
            <textarea
              value={settings.systemPrompt}
              onChange={(event) => updateSetting('systemPrompt', event.target.value)}
              placeholder={isBn ? 'সহায়ক ও সংক্ষিপ্ত উত্তর দিন।' : 'You are a helpful assistant that replies concisely.'}
              rows={3}
              style={{ ...inputStyle, marginTop: 6, resize: 'vertical' }}
            />
          </label>
        </section>

        <section style={cardStyle} aria-labelledby="voice-heading">
          <div>
            <h2 id="voice-heading" style={{ margin: 0, color: T.ink, fontSize: 17 }}>
              {isBn ? 'অফলাইন ভয়েস' : 'Offline voice'}
            </h2>
            <p style={{ margin: '4px 0 0', color: T.inkSoft, fontSize: 12, lineHeight: 1.5 }}>
              {isBn ? 'স্থানীয় Whisper (STT) এবং Piper বা Qwen3-TTS (TTS)' : 'Local Whisper (speech-to-text) and your choice of Piper or Qwen3-TTS'}
            </p>
          </div>
          <label style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600 }}>
            {isBn ? 'WHISPER TRANSCRIPTION ENDPOINT' : 'WHISPER TRANSCRIPTION ENDPOINT'}
            <input value={settings.whisperUrl} onChange={(event) => updateSetting('whisperUrl', event.target.value)} style={{ ...inputStyle, marginTop: 6 }} spellCheck={false} inputMode="url" />
          </label>
          <label style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600 }}>
            {isBn ? 'স্থানীয় TTS স্পিচ এন্ডপয়েন্ট' : 'LOCAL TTS SPEECH ENDPOINT'}
            <input value={settings.ttsUrl} onChange={(event) => updateSetting('ttsUrl', event.target.value)} style={{ ...inputStyle, marginTop: 6 }} spellCheck={false} inputMode="url" />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend style={{ color: T.inkSoft, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              {isBn ? 'কথা বলার ইঞ্জিন' : 'SPEECH ENGINE'}
            </legend>
            {([
              { id: 'piper', title: 'Piper', description: isBn ? 'স্থানীয় Piper ভয়েস মডেল' : 'Local Piper voice model' },
              { id: 'qwen3', title: 'Qwen3-TTS', description: isBn ? 'স্থানীয় Qwen3-TTS মডেল' : 'Local Qwen3-TTS model' },
            ] as const).map((provider) => {
              const ready = provider.id === 'piper'
                ? voiceStatus?.piper && voiceStatus.piperModel
                : voiceStatus?.qwen3Tts && voiceStatus.qwen3TtsModel;
              return (
                <label key={provider.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, border: settings.ttsProvider === provider.id ? `1px solid ${T.primary}` : border, background: settings.ttsProvider === provider.id ? (isDark ? 'rgba(208,174,146,0.12)' : 'rgba(74,58,52,0.06)') : 'transparent', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="local-tts-provider"
                    value={provider.id}
                    checked={settings.ttsProvider === provider.id}
                    onChange={() => updateSetting('ttsProvider', provider.id)}
                  />
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: 'block', color: T.ink, fontSize: 13 }}>{provider.title}</strong>
                    <span style={{ color: T.inkSoft, fontSize: 11 }}>{provider.description}</span>
                  </span>
                  <span style={{ color: ready ? T.accentGood : T.inkMuted, fontSize: 11, fontWeight: 600 }}>
                    {ready ? (isBn ? 'প্রস্তুত' : 'Ready') : voiceStatus ? (isBn ? 'অনুপলভ্য' : 'Unavailable') : (isBn ? 'পরীক্ষা হয়নি' : 'Not checked')}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <button type="button" onClick={() => void checkVoice()} style={{ ...inputStyle, width: 'fit-content', minHeight: 40, cursor: 'pointer' }}>
            {isBn ? 'ভয়েস সংযোগ পরীক্ষা করুন' : 'Test voice services'}
          </button>
          {voiceStatus && (
            <div role="status" style={{ color: voiceStatus.available ? T.accentGood : T.inkSoft, fontSize: 12, lineHeight: 1.5 }}>
              <div>
                {[
                  `Whisper: ${voiceStatus.whisper && voiceStatus.whisperModel ? 'ready' : 'not configured'}`,
                  `Piper: ${voiceStatus.piper && voiceStatus.piperModel ? 'ready' : 'not configured'}`,
                  `Qwen3-TTS: ${voiceStatus.qwen3Tts && voiceStatus.qwen3TtsModel ? 'ready' : 'not configured'}`,
                ].join(' · ')}
              </div>
              {voiceStatus.error && <div role="alert" style={{ color: T.accentWarn, marginTop: 4 }}>{voiceStatus.error}</div>}
            </div>
          )}
          <p style={{ margin: 0, color: T.inkSoft, fontSize: 11, lineHeight: 1.5 }}>
            {isBn
              ? 'ভয়েস মডেলগুলো আলাদাভাবে ডাউনলোড করে স্থানীয় রানটাইম চালু করতে হবে। Qwen3-TTS-এ বাংলা সমর্থিত নয়; Piper-এ নির্বাচিত ভয়েসের ভাষা সমর্থন পরীক্ষা করুন।'
              : 'Download voice weights and start the local runtime separately. Qwen3-TTS does not support Bengali here; Piper language support depends on the selected voice model.'}
          </p>
        </section>

        <div style={{ ...cardStyle, flexDirection: 'row', alignItems: 'flex-start', color: T.inkSoft, fontSize: 12, lineHeight: 1.5 }}>
          <Download size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {isBn
              ? 'প্রথমবার মডেল ও অ্যাপ ডাউনলোডের জন্য ইন্টারনেট লাগবে। এরপর অ্যাপ, খাবারের হিসাব ও ডিভাইস-স্থানীয় ডেটা অফলাইনে থাকে। অনলাইন বাজারদর ও Google সাইন-ইন ইন্টারনেট ছাড়া চলবে না।'
              : 'Initial app/model downloads require internet. After setup, the app shell, meal logging, nutrition estimates, and device-local data work offline. Live market prices and Google sign-in still require internet.'}
          </span>
        </div>
      </section>
    </LocalizedContent>
  );
}

function CapabilityPill({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 999, background: enabled ? 'rgba(122,140,79,0.14)' : 'rgba(120,120,120,0.12)', color: enabled ? T.accentGood : T.inkMuted, fontSize: 10 }}>
      {enabled ? <Check size={10} /> : <Settings2 size={10} />}
      {label}
    </span>
  );
}
