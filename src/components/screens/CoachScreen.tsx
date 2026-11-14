import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Send,
  Image as ImageIcon,
  X,
  Sparkles,
  CheckCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
} from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useTokens } from '../../theme/useTokens';
import { sendCoachRemote } from '../../lib/api';
import { chatWithLocalModel, getLocalAISettings, LocalAIError, synthesizeLocally, transcribeLocally } from '../../lib/localAI';
import {
  coachHistoryStorageKey,
  loadCoachSessionHistory,
  saveCoachSessionHistory,
} from '../../lib/coachSessionHistory';
import { getScientistDisplayName } from '../../lib/coachCopy';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import type {
  CoachAgentType,
  CoachMessage,
  UserProfile,
} from '../../types/schemas';

interface DisplayCoachMessage extends CoachMessage {
  persona?: string;
  voice_summary?: string | null;
  audio_base64?: string | null;
  audio_mime_type?: string;
  use_browser_tts?: boolean;
  tts_diagnostic?: string | null;
  runtime_label?: string;
}

interface CoachScreenProps {
  profile: UserProfile;
  sessionKey: string;
  imageContext?: string | null;
  localOnly?: boolean;
}

/**
 * Render LaTeX formula via KaTeX to HTML string.
 */
function renderLatexSpan(math: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(math, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return math;
  }
}

/**
 * Lightweight helper to parse inline tokens:
 * - Block LaTeX: $$...$$
 * - Inline LaTeX: $...$
 * - Bold text: **text**
 * - Citations: [উৎস:...] or [Source:...]
 */
function parseFormattedInline(text: string, isUser: boolean, isDark: boolean) {
  const tokenRegex = /(\$\$[\s\S]+?\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*[\s\S]+?\*\*|\[(?:উৎস|Source):[^\]]+\])/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Display LaTeX ($$...$$)
    if (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) {
      const math = part.slice(2, -2).trim();
      const html = renderLatexSpan(math, true);
      return (
        <span
          key={index}
          style={{
            display: 'block',
            margin: '8px 0',
            overflowX: 'auto',
            textAlign: 'center',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    // Inline LaTeX ($...$)
    if (part.startsWith('$') && part.endsWith('$') && part.length >= 3 && !part.startsWith('$$')) {
      const math = part.slice(1, -1).trim();
      const html = renderLatexSpan(math, false);
      return (
        <span
          key={index}
          style={{ display: 'inline-block', padding: '0 2px' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    // Bold text (**...**)
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const boldContent = part.slice(2, -2);
      return (
        <strong
          key={index}
          style={{
            fontWeight: 700,
            color: isUser ? '#FFFFFF' : (isDark ? '#F9F2E4' : '#2C1A11'),
          }}
        >
          {boldContent}
        </strong>
      );
    }

    // Clinical citations ([উৎস: ...] or [Source: ...])
    if (part.startsWith('[') && part.endsWith(']')) {
      return (
        <span
          key={index}
          style={{
            display: 'inline-block',
            fontSize: 'var(--text-xs)',
            padding: '2px 8px',
            borderRadius: 6,
            margin: '2px 0',
            backgroundColor: isUser
              ? 'rgba(255,255,255,0.2)'
              : (isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(200, 116, 40, 0.10)'),
            color: isUser
              ? '#FFFFFF'
              : (isDark ? '#E8C49A' : '#7C5A44'),
            fontWeight: 600,
          }}
        >
          {part}
        </span>
      );
    }

    return <span key={index}>{part}</span>;
  });
}

/**
 * Formatted message component supporting:
 * - Paragraphs separated by blank lines
 * - Bullet lists (•, -, *)
 * - Numbered lists (1., 2.)
 * - KaTeX math ($...$ and $$...$$)
 * - Bold text and clinical citations with adaptive contrast
 */
function FormattedMessage({
  content,
  isUser,
  isDark,
}: {
  content: string;
  isUser: boolean;
  isDark: boolean;
}) {
  if (!content) return null;

  const blocks = content.split(/\n\n+/);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.map((block, bIdx) => {
        const rawLines = block.split('\n').filter((l) => l.trim().length > 0);
        const isBulletList =
          rawLines.length > 0 &&
          rawLines.every((l) => /^([•\-*]|\d+\.)\s/.test(l.trim()));

        if (isBulletList) {
          return (
            <ul
              key={bIdx}
              style={{
                listStyle: 'none',
                margin: '4px 0',
                paddingLeft: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {rawLines.map((line, lIdx) => {
                const cleanLine = line.trim().replace(/^([•\-*]|\d+\.)\s*/, '');
                return (
                  <li
                    key={lIdx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      lineHeight: 1.6,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 7,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        backgroundColor: isUser
                          ? 'rgba(255,255,255,0.85)'
                          : (isDark ? '#E8C49A' : '#7C5A44'),
                      }}
                    />
                    <span style={{ flex: 1 }}>{parseFormattedInline(cleanLine, isUser, isDark)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={bIdx} style={{ margin: 0, lineHeight: 1.65 }}>
            {rawLines.map((line, lIdx) => (
              <span
                key={lIdx}
                style={{
                  display: lIdx > 0 ? 'block' : 'inline',
                  marginTop: lIdx > 0 ? 4 : 0,
                }}
              >
                {parseFormattedInline(line, isUser, isDark)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function CoachScreen({ profile, sessionKey, imageContext = null, localOnly = false }: CoachScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const scientistName = getScientistDisplayName(language);

  const [agentType, setAgentType] = useState<CoachAgentType>('scientist');
  const [messages, setMessages] = useState<DisplayCoachMessage[]>(
    () => loadCoachSessionHistory(sessionKey, 'scientist'),
  );
  const activeHistoryKeyRef = useRef(coachHistoryStorageKey(sessionKey, 'scientist'));
  const skipHistorySaveRef = useRef(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(imageContext);
  const [conversationImage, setConversationImage] = useState<string | null>(imageContext);
  const [chatError, setChatError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [citations, setCitations] = useState<string[]>([]);

  // Voice Assistant Audio state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number | null>(null);
  const [fetchingAudioId, setFetchingAudioId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Speech-to-Text state
  const [isListening, setIsListening] = useState(false);
  const [speechLang, setSpeechLang] = useState<'bn-BD' | 'en-US'>(() => (isBn ? 'bn-BD' : 'en-US'));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setSpeechLang(isBn ? 'bn-BD' : 'en-US');
  }, [isBn]);

  useEffect(() => {
    if (imageContext) {
      setImagePreview(imageContext);
      setConversationImage(imageContext);
    }
  }, [imageContext]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingAudio(false);
    setCurrentPlayingIndex(null);
  }, []);

  const playAudioForMessage = useCallback(async (idx: number, msg: DisplayCoachMessage) => {
    if (isPlayingAudio && currentPlayingIndex === idx) {
      stopAudio();
      return;
    }
    stopAudio();

    // 1. If audio bytes are already attached to this message, play immediately
    if (msg.audio_base64) {
      const mime = msg.audio_mime_type || 'audio/mpeg';
      const audio = new Audio(`data:${mime};base64,${msg.audio_base64}`);
      audioRef.current = audio;
      setCurrentPlayingIndex(idx);
      setIsPlayingAudio(true);
      audio.onended = () => {
        setIsPlayingAudio(false);
        setCurrentPlayingIndex(null);
      };
      audio.onerror = (e) => {
        console.warn('Local audio playback error:', e);
        setIsPlayingAudio(false);
        setCurrentPlayingIndex(null);
        setVoiceError('Saved local audio could not be played.');
      };
      audio.play().catch((err) => {
        console.warn('Saved audio playback failed:', err);
        setIsPlayingAudio(false);
        setCurrentPlayingIndex(null);
        setVoiceError('Saved local audio could not be played.');
      });
      return;
    }

    // Audio is synthesized by the selected on-device TTS runtime.
    const textToSynthesize = msg.voice_summary || msg.content;
    if (!textToSynthesize) return;

    setFetchingAudioId(idx);
    setVoiceError(null);
    try {
      const audioBlob = await synthesizeLocally(textToSynthesize, language === 'bn' ? 'bn-BD' : 'en-US');
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setCurrentPlayingIndex(idx);
      setIsPlayingAudio(true);
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setIsPlayingAudio(false);
        setCurrentPlayingIndex(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        setIsPlayingAudio(false);
        setCurrentPlayingIndex(null);
        setVoiceError('Local audio playback failed.');
      };
      await audio.play();
    } catch (err) {
      setVoiceError(err instanceof LocalAIError ? err.message : 'The selected local TTS engine could not synthesize speech.');
    } finally {
      setFetchingAudioId(null);
    }
  }, [isPlayingAudio, currentPlayingIndex, stopAudio, language]);

  // Cleanup speech/audio on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      recorderRef.current?.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stopAudio]);

  // Synchronize persona and welcome message with active language
  useEffect(() => {
    stopAudio();
    const historyKey = coachHistoryStorageKey(sessionKey, agentType);
    const restoreMessages = (welcome: DisplayCoachMessage) => {
      if (activeHistoryKeyRef.current !== historyKey) {
        activeHistoryKeyRef.current = historyKey;
        skipHistorySaveRef.current = true;
        const history = loadCoachSessionHistory(sessionKey, agentType);
        setMessages(history.length > 0 ? history : [welcome]);
        return;
      }

      setMessages((previous) => {
        if (previous.some((message) => message.role === 'user')) return previous;
        const history = loadCoachSessionHistory(sessionKey, agentType);
        return history.length > 0 ? history : [welcome];
      });
    };
    if (agentType === 'scientist') {
      const welcome: DisplayCoachMessage = {
        role: 'assistant',
        persona: 'scientist',
        content: isBn
          ? `🔬 **স্বাগতম! আমি ${scientistName}, আপনার পুষ্টি সহায়ক।**\n\n` +
            'খাবার বা ছবি সম্পর্কে জিজ্ঞাসা করুন। সেট আপ থাকলে এই ডিভাইসের স্থানীয় মডেল উত্তর দেবে; অনলাইনে থাকলে অনুমোদিত হোস্টেড মডেল বিকল্প হিসেবে ব্যবহার হতে পারে।'
          : `🔬 **Welcome! I am ${scientistName}, your nutrition assistant.**\n\n` +
            'Ask about a meal or attach a photo. When configured, a local model answers on this device; a hosted model is used only while online.',
        voice_summary: isBn
          ? `স্বাগতম! আমি ${scientistName}, আপনার পুষ্টি সহায়ক।`
          : `Welcome! I am ${scientistName}, your nutrition assistant.`,
      };
      restoreMessages(welcome);
      setCitations([]);
      setChatError(null);
      setVoiceError(null);
    } else {
      const welcome: DisplayCoachMessage = {
        role: 'assistant',
        persona: 'coach',
        content: isBn
          ? '🧠 **হ্যালো! আমি আপনার অভ্যাস সহায়ক।**\n\n' +
            'সুস্থ জীবনযাপন কোনো চাপ বা কড়া ডায়েট নয়, বরং ভালো লাগার অভ্যাস। পারিবারিক দাওয়াত, মিষ্টির ক্রেভিং বা রুটিন ধরে রাখার সহজ মনস্তাত্ত্বিক পরামর্শ পেতে আমাকে জানাতে পারেন। কোনো অপরাধবোধ ছাড়াই আমরা এগিয়ে যাব! 💚'
          : '🧠 **Hello! I am your habit coach.**\n\n' +
            'Healthy living isn\'t about rigid restrictions or guilt—it\'s about building compassionate, lasting habits. Let\'s navigate family feasts, sweet cravings, and daily routines together! 💚',
        voice_summary: isBn
          ? 'হ্যালো! আমি আপনার অভ্যাস সহায়ক।'
          : 'Hello! I am your habit coach. Let us build sustainable nutrition habits together.',
      };
      restoreMessages(welcome);
      setCitations([]);
      setChatError(null);
      setVoiceError(null);
    }
  }, [agentType, isBn, sessionKey, stopAudio]);

  useEffect(() => {
    if (skipHistorySaveRef.current) {
      skipHistorySaveRef.current = false;
      return;
    }
    if (activeHistoryKeyRef.current !== coachHistoryStorageKey(sessionKey, agentType)) return;
    saveCoachSessionHistory(sessionKey, agentType, messages);
  }, [agentType, messages, sessionKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChatError(null);
    e.currentTarget.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImagePreview(reader.result);
        setConversationImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleListening = async () => {
    if (isListening) {
      recorderRef.current?.stop();
      return;
    }
    setVoiceError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new LocalAIError('This browser does not support microphone recording. Type your message instead.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setIsListening(false);
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        const recording = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!recording.size) {
          setVoiceError('No audio was recorded. Try again.');
          return;
        }
        void transcribeLocally(recording, speechLang)
          .then((transcript) => setInput((current) => [current, transcript].filter(Boolean).join(' ')))
          .catch((error: unknown) => setVoiceError(error instanceof Error ? error.message : String(error)));
      };
      recorder.start();
      setIsListening(true);
    } catch (error) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setIsListening(false);
      setVoiceError(error instanceof Error ? error.message : 'Could not start local microphone recording.');
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    if (loading) return;
    const content = (textToSend ?? input).trim();
    if (!content && !imagePreview && !conversationImage) return;
    if (isListening) recorderRef.current?.stop();
    stopAudio();
    setChatError(null);

    const userMsg: DisplayCoachMessage = {
      role: 'user',
      content,
      image_ref: imagePreview || conversationImage,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setImagePreview(null);
    setConversationImage(userMsg.image_ref || null);
    setLoading(true);

    try {
      const historyToSend = messages.map((m) => ({
        role: m.role,
        content: m.content,
        image_ref: m.image_ref,
      }));

      let res: import('../../types/schemas').CoachChatResponse;
      let runtimeLabel: string;
      try {
        const local = await chatWithLocalModel(
          nextMessages.map((message, index) => ({
            role: message.role,
            content: message.content,
            image: index === nextMessages.length - 1 ? userMsg.image_ref : message.image_ref,
          })),
          {
            systemPrompt: [
              `You are a practical nutrition and food-image assistant. Reply in ${language === 'bn' ? 'Bengali' : 'English'}.`,
              'Describe visible image contents carefully. Do not invent details. Nutrition values are estimates, not medical advice.',
              `The user's profile is ${JSON.stringify(profile)}.`,
              getLocalAISettings().systemPrompt,
            ].join(' '),
            imageContext: userMsg.image_ref,
          },
        );
        runtimeLabel = `On-device · ${local.model}`;
        res = {
          reply: local.reply,
          citations: [],
          suggested_prompts: [],
          agent_type: agentType,
        };
      } catch (localError) {
        if (localOnly || (typeof navigator !== 'undefined' && !navigator.onLine)) throw localError;
        const remote = await sendCoachRemote({
          message: content,
          history: historyToSend,
          messages: nextMessages,
          agent_type: agentType,
          persona: agentType,
          user_profile: profile,
          lang: language,
        });
        runtimeLabel = 'Hosted model · online fallback';
        res = remote;
      }

      const assistantMsg: DisplayCoachMessage = {
        role: 'assistant',
        persona: agentType,
        content: res.reply,
        voice_summary: res.voice_summary,
        audio_base64: res.audio_base64,
        audio_mime_type: res.audio_mime_type,
        use_browser_tts: res.use_browser_tts,
        tts_diagnostic: res.tts_diagnostic,
        runtime_label: runtimeLabel,
      };

      console.info('[AI Coach Voice Chat Response]', {
        diagnostic: res.tts_diagnostic,
        useBrowserTTS: res.use_browser_tts,
        hasAudio: Boolean(res.audio_base64),
      });

      setMessages((prev) => [...prev, assistantMsg]);

      setCitations(res.citations ?? []);

    } catch (error) {
      setChatError(error instanceof Error ? error.message : (isBn ? 'স্থানীয় AI উত্তর দিতে পারেনি।' : 'The local AI request failed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <LocalizedContent>
      {/* Root Layout Container with guaranteed 160px bottom dock clearance */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
        {/* Header Title & Persona Switcher */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 22,
                  fontWeight: 700,
                  color: isDark ? '#FAF4EC' : '#FFF7EE',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                {isBn ? 'পুষ্টি এআই সহায়ক' : 'Nutrition AI assistant'}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: isDark ? '#E5D3C3' : '#FFF0E2', fontWeight: 500 }}>
                {isBn
                  ? 'স্থানীয় AI ব্যবহার করুন; অনলাইনে থাকলে প্রয়োজনে হোস্টেড AI বিকল্প'
                  : 'Local model first; hosted AI is used only as an online fallback'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAgentType((prev) => (prev === 'scientist' ? 'coach' : 'scientist'))}
              title={
                agentType === 'scientist'
                  ? (isBn ? 'কোচ পরিবর্তন করুন (ফারহান)' : 'Switch to Coach (Farhan)')
                  : (isBn ? 'কোচ পরিবর্তন করুন (ড. সুস্মিত)' : 'Switch to Scientist (Dr. Susmit)')
              }
              aria-label={isBn ? 'কোচ পরিবর্তন করুন' : 'Switch coach'}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: agentType === 'scientist'
                  ? (isDark ? 'rgba(208, 174, 146, 0.20)' : 'linear-gradient(135deg, rgba(200, 116, 40, 0.20), rgba(247, 238, 225, 0.8))')
                  : (isDark ? 'rgba(134, 239, 172, 0.20)' : 'linear-gradient(135deg, rgba(46, 99, 51, 0.20), rgba(247, 238, 225, 0.8))'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: agentType === 'scientist' ? (isDark ? '#E8C49A' : '#7C5A44') : (isDark ? '#86EFAC' : '#2E6333'),
                border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.8)',
                boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.8), 0 4px 12px rgba(44, 26, 17, 0.08)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Bot size={20} />
            </button>
          </div>
        </div>

        {/* Chat Thread Messages */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 360,
            maxHeight: 'clamp(380px, 64vh, 680px)',
            overflowY: 'auto',
            padding: '8px 4px',
          }}
        >
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            const isSpeakingThis = isPlayingAudio && currentPlayingIndex === idx;

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  gap: 4,
                  width: '100%',
                }}
              >
                {/* Sender badge */}
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: isDark ? 'rgba(249, 242, 228, 0.85)' : '#FFF0E2',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 4px',
                    flexWrap: 'wrap',
                  }}
                >
                  {isUser ? (
                    <span>{profile.name || (isBn ? 'আপনি' : 'You')}</span>
                  ) : agentType === 'scientist' ? (
                    <>
                      <span style={{ fontWeight: 600, color: isDark ? '#E8C49A' : '#FFE4C4' }}>
                        {isBn
                          ? `🔬 ${scientistName} · পুষ্টি বিজ্ঞানী`
                          : `🔬 ${scientistName} · Nutrition Scientist`}
                      </span>
                      <span style={{ opacity: 0.85 }}>• {scientistName}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontWeight: 600, color: isDark ? '#86EFAC' : '#A7F3D0' }}>
                        🧠 {isBn ? 'অভ্যাস সহায়ক' : 'Habit coach'}
                      </span>
                      <span style={{ opacity: 0.85 }}>• Habit guidance</span>
                    </>
                  )}
                  {!isUser && m.runtime_label && (
                    <span style={{ fontSize: 10, color: isDark ? '#B8C68A' : '#D9F99D' }}>{m.runtime_label}</span>
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={isUser ? 'coach-bubble-user' : 'coach-bubble-assistant champagne-panel'}
                  style={
                    isUser
                      ? {
                          padding: '12px 18px',
                          borderRadius: '20px 20px 4px 20px',
                          background: 'linear-gradient(145deg, #3D271D 0%, #24140D 100%)',
                          color: '#FFF8F0',
                          fontSize: '0.9375rem',
                          lineHeight: 1.5,
                          minWidth: '48px',
                          display: 'inline-block',
                          wordBreak: 'break-word',
                          maxWidth: '88%',
                          boxShadow: '0 6px 18px rgba(36, 20, 13, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.18)',
                        }
                      : {
                          maxWidth: '88%',
                          padding: '16px 20px',
                          borderRadius: '20px 20px 20px 4px',
                          fontSize: '0.9375rem',
                          lineHeight: 1.65,
                          color: isDark ? '#F9F2E4' : '#2C1A11',
                          wordBreak: 'break-word',
                        }
                  }
                >
                  {m.image_ref && (
                    <div style={{ marginBottom: 10, borderRadius: 10, overflow: 'hidden' }}>
                      <img
                        src={m.image_ref}
                        alt="Dish upload"
                        style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }}
                      />
                    </div>
                  )}

                  {/* Spoken Voice Summary Card */}
                  {!isUser && m.voice_summary && (
                    <div
                      style={{
                        padding: '9px 12px',
                        borderRadius: 12,
                        background: isDark ? 'rgba(208, 174, 146, 0.12)' : 'rgba(200, 116, 40, 0.08)',
                        border: isDark ? '1px solid rgba(208, 174, 146, 0.25)' : '1px solid rgba(200, 116, 40, 0.18)',
                        boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.5)',
                        marginBottom: 12,
                        fontSize: 'var(--text-xs)',
                        color: isDark ? '#E8C49A' : '#7C5A44',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                        <Volume2 size={14} style={{ flexShrink: 0, color: isDark ? '#E8C49A' : '#C87428' }} />
                        <span style={{ fontStyle: 'italic', lineHeight: 1.4 }}>
                          &ldquo;{m.voice_summary}&rdquo;
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => playAudioForMessage(idx, m)}
                        disabled={fetchingAudioId === idx}
                        aria-label={isSpeakingThis ? 'Stop voice' : 'Play voice'}
                        className="champagne-pill"
                        style={{
                          background: isSpeakingThis
                            ? (isDark ? 'rgba(240, 183, 154, 0.25)' : 'rgba(200, 116, 40, 0.18)')
                            : undefined,
                          border: 'none',
                          cursor: fetchingAudioId === idx ? 'wait' : 'pointer',
                          padding: '4px 8px',
                          color: isDark ? '#E8C49A' : '#7C5A44',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                          fontSize: 11,
                          opacity: fetchingAudioId === idx ? 0.7 : 1,
                        }}
                      >
                        {fetchingAudioId === idx ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>{isBn ? 'প্রস্তুত হচ্ছে...' : 'Loading...'}</span>
                          </>
                        ) : isSpeakingThis ? (
                          <>
                            <VolumeX size={13} />
                            <span>{isBn ? 'থামুন' : 'Stop'}</span>
                          </>
                        ) : (
                          <>
                            <Volume2 size={13} />
                            <span>{isBn ? 'শুনুন' : 'Listen'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <FormattedMessage content={m.content} isUser={isUser} isDark={isDark} />

                  {/* Fallback Listen action for assistant messages without voice_summary */}
                  {!isUser && !m.voice_summary && m.content && (
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => playAudioForMessage(idx, m)}
                        disabled={fetchingAudioId === idx}
                        aria-label={isSpeakingThis ? 'Stop voice' : 'Play voice'}
                        className="champagne-pill"
                        style={{
                          background: isSpeakingThis
                            ? (isDark ? 'rgba(240, 183, 154, 0.25)' : 'rgba(200, 116, 40, 0.18)')
                            : undefined,
                          cursor: fetchingAudioId === idx ? 'wait' : 'pointer',
                          padding: '4px 10px',
                          color: isDark ? '#E8C49A' : '#7C5A44',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                          fontSize: 11,
                          opacity: fetchingAudioId === idx ? 0.7 : 1,
                        }}
                      >
                        {fetchingAudioId === idx ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>{isBn ? 'প্রস্তুত হচ্ছে...' : 'Loading...'}</span>
                          </>
                        ) : isSpeakingThis ? (
                          <>
                            <VolumeX size={12} />
                            <span>{isBn ? 'থামুন' : 'Stop'}</span>
                          </>
                        ) : (
                          <>
                            <Volume2 size={12} />
                            <span>{isBn ? 'শুনুন' : 'Listen'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="champagne-panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 16,
                width: 'fit-content',
                fontSize: 'var(--text-xs)',
                color: isDark ? '#F9F2E4' : '#7C5A44',
              }}
            >
              <Sparkles size={14} className="animate-spin" color={isDark ? '#E8C49A' : '#C87428'} />
              <span>
                {agentType === 'scientist'
                  ? isBn
                    ? 'ডাটাবেজ তথ্য ও পুষ্টি বিজ্ঞান বিশ্লেষণ হচ্ছে…'
                    : 'Analyzing database targets & biochemical nutrition…'
                  : isBn
                    ? 'সহানুভূতিশীল আচরণ নির্দেশিকা সাজানো হচ্ছে…'
                    : 'Formulating habit guidance from your data…'}
              </span>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Domain Citation Badges */}
        {citations.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: isDark ? '#E5D3C3' : '#FFF0E2', fontWeight: 600 }}>
              {isBn ? 'স্বীকৃত তথ্যসূত্র:' : 'Official Citations:'}
            </span>
            {citations.map((c, i) => (
              <span
                key={i}
                className="champagne-pill"
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: '3px 8px',
                  borderRadius: 8,
                  color: isDark ? '#F9F2E4' : '#2C1A11',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CheckCircle size={11} color={isDark ? '#86EFAC' : '#2E6333'} />
                {c}
              </span>
            ))}
          </div>
        )}


        {/* Image Attachment Preview */}
        <AnimatePresence>
          {imagePreview && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="champagne-panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 6,
                borderRadius: 14,
                width: 'fit-content',
              }}
            >
              <img
                src={imagePreview}
                alt="Upload preview"
                style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }}
              />
              <span style={{ fontSize: 'var(--text-xs)', color: isDark ? '#F9F2E4' : '#2C1A11' }}>
                {isBn ? 'খাবারের ছবি যুক্ত করা হয়েছে' : 'Dish photo attached'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setImagePreview(null);
                  setConversationImage(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: isDark ? '#FAF4EC' : '#5C3A27',
                }}
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Bar with Attachment, Mic, and Send */}
        <div
          className="champagne-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            boxShadow: isDark
              ? '0 8px 30px rgba(0, 0, 0, 0.45)'
              : 'inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 8px 28px rgba(44, 26, 17, 0.12)',
          }}
        >
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach photo"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isDark ? 'rgba(249, 242, 228, 0.88)' : '#3D271D',
              padding: 6,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ImageIcon size={18} />
          </button>

          {/* Voice Mic Button */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.90 }}
            onClick={toggleListening}
            aria-label={isListening ? 'Stop listening' : 'Start voice input'}
            style={{
              background: isListening
                ? (isDark ? 'rgba(240, 183, 154, 0.3)' : 'rgba(200, 116, 40, 0.18)')
                : 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isListening ? (isDark ? '#F0B79A' : '#C87428') : (isDark ? 'rgba(249, 242, 228, 0.88)' : '#3D271D'),
              padding: 6,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isListening ? (
              <MicOff size={18} className="animate-pulse" />
            ) : (
              <Mic size={18} />
            )}
          </motion.button>

          {/* Quick Voice Language Toggle Pill (BN / EN) */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              const next = speechLang === 'bn-BD' ? 'en-US' : 'bn-BD';
              setSpeechLang(next);
              if (isListening) recorderRef.current?.stop();
            }}
            aria-label={`Switch voice language, currently ${speechLang === 'bn-BD' ? 'Bangla' : 'English'}`}
            title={speechLang === 'bn-BD' ? 'ভয়েস ভাষা: বাংলা (ইংরেজিতে পরিবর্তন করতে ট্যাপ করুন)' : 'Voice language: English (Tap to switch to Bangla)'}
            className="champagne-pill"
            style={{
              padding: '3px 8px',
              borderRadius: 999,
              color: isDark ? '#F9F2E4' : '#2C1A11',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.3,
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            <span>{speechLang === 'bn-BD' ? 'বাং' : 'EN'}</span>
          </motion.button>

          <input
            type="text"
            className="coach-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isListening
                ? speechLang === 'bn-BD'
                  ? 'বাংলায় কথা বলুন… শুনছি…'
                  : 'Listening in English… speak now…'
                : agentType === 'scientist'
                ? isBn
                  ? 'ডায়েট বা খাবার নিয়ে জিজ্ঞাসা করুন…'
                  : 'Ask about diet, glycemic load, pantry…'
                : isBn
                ? 'দাওয়াত বা অভ্যাস সম্পর্কে জিজ্ঞাসা করুন…'
                : 'Ask about feasts, cravings, habits…'
            }
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 'var(--text-base)',
              color: isDark ? '#F9F2E4' : '#2C1A11',
              padding: '6px 8px',
            }}
          />

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => handleSendMessage()}
            disabled={loading || (!input.trim() && !imagePreview && !conversationImage)}
            aria-label="Send message"
            style={{
              background: !input.trim() && !imagePreview && !conversationImage
                ? (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(74, 58, 52, 0.20)')
                : (isDark ? '#D0AE92' : 'linear-gradient(145deg, #3D271D 0%, #24140D 100%)'),
              border: 'none',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: !input.trim() && !imagePreview && !conversationImage
                ? (isDark ? 'rgba(249, 242, 228, 0.4)' : 'rgba(255, 255, 255, 0.7)')
                : '#FFFFFF',
              boxShadow: !input.trim() && !imagePreview && !conversationImage
                ? 'none'
                : '0 4px 12px rgba(36, 20, 13, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.25)',
              cursor: !input.trim() && !imagePreview && !conversationImage ? 'default' : 'pointer',
              transition: 'background 180ms ease, box-shadow 180ms ease',
            }}
          >
            <Send size={15} />
          </motion.button>
        </div>
        {chatError && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 242, 242, 0.92)',
              border: isDark ? '1px solid rgba(252, 165, 165, 0.35)' : '1px solid rgba(220, 38, 38, 0.25)',
              color: isDark ? '#FCA5A5' : '#991B1B',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            {chatError}
          </div>
        )}
        {voiceError && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 242, 242, 0.92)',
              border: isDark ? '1px solid rgba(252, 165, 165, 0.35)' : '1px solid rgba(220, 38, 38, 0.25)',
              color: isDark ? '#FCA5A5' : '#991B1B',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            {voiceError}
          </div>
        )}
      </div>
    </LocalizedContent>
  );
}
