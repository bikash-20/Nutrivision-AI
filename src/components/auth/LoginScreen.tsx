import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { continueOffline, loginWithGoogle } from '../../lib/auth';
import { initGoogleAuth } from '../../lib/googleAuth';
import type { AuthSession } from '../../types/schemas';
import LanguageToggle from '../../i18n/LanguageToggle';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { GUIDE_STEPS } from './landingGuideSteps';

interface LoginScreenProps {
  /** Called with the new session once login succeeds. */
  onSignedIn: (session: AuthSession) => void;
}

const GOOGLE_CLIENT_ID: string = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID
    ? import.meta.env.VITE_GOOGLE_CLIENT_ID
    : ''
).trim();

export default function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const reduceMotion = useReducedMotion();

  const [loginOpen, setLoginOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  const activeStep = GUIDE_STEPS[activeIdx] ?? GUIDE_STEPS[0];

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!loginOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  // Initialize Google Identity Services when the Login modal is open and online.
  useEffect(() => {
    if (!loginOpen || !GOOGLE_CLIENT_ID || !online) return;

    let mounted = true;
    const btnWidth =
      typeof window !== 'undefined'
        ? Math.min(320, Math.max(250, window.innerWidth - 72))
        : 300;

    void initGoogleAuth({
      clientId: GOOGLE_CLIENT_ID,
      buttonContainer: googleBtnContainerRef.current,
      buttonWidth: btnWidth,
      locale: isBn ? 'bn' : 'en',
      promptOneTap: false,
      onSuccess: async (credential) => {
        if (!mounted) return;
        setGoogleLoading(true);
        setError(null);
        try {
          const session = await loginWithGoogle(credential);
          if (mounted) onSignedIn(session);
        } catch (err: unknown) {
          if (mounted) {
            const msg =
              err instanceof Error
                ? err.message
                : isBn
                ? 'গুগল সাইন ইন সম্পন্ন করা যায়নি'
                : 'Google sign-in could not be completed';
            setError(msg);
          }
        } finally {
          if (mounted) setGoogleLoading(false);
        }
      },
      onError: (err: unknown) => {
        if (mounted) {
          // eslint-disable-next-line no-console
          console.warn('Google Identity Services button error:', err);
        }
      },
    });

    return () => {
      mounted = false;
    };
  }, [isBn, online, onSignedIn, loginOpen]);

  const scrollToStep = (idx: number) => {
    setActiveIdx(idx);
    if (typeof document !== 'undefined') {
      document.getElementById('guide-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return (
    <LocalizedContent>
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          width: '100%',
          overflowX: 'hidden',
          color: '#FFF7EE',
          fontFamily: isBn ? "'Hind Siliguri', 'Inter', sans-serif" : "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Warm espresso & champagne ambient background matching the main app */}
        <div className="sage-bg" />

        {/* Sticky Top Bar with Language Toggle & Instant Login Toggle */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            width: '100%',
            background: 'rgba(36, 19, 10, 0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          <div
            style={{
              maxWidth: 1180,
              margin: '0 auto',
              padding: 'calc(env(safe-area-inset-top, 0px) + 10px) clamp(16px, 4vw, 32px) 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src="/icon-96.png"
                alt=""
                aria-hidden="true"
                width={30}
                height={30}
                style={{
                  borderRadius: 9,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                }}
              />
              <span
                style={{
                  fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#FFF7EE',
                  letterSpacing: '-0.015em',
                }}
              >
                {isBn ? 'নিউট্রিভিশন' : 'NutriVision'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LanguageToggle />
              <motion.button
                type="button"
                onClick={() => setLoginOpen((open) => !open)}
                aria-expanded={loginOpen}
                whileTap={{ scale: 0.96 }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: '1px solid rgba(255, 255, 255, 0.65)',
                  background: loginOpen ? '#24130A' : '#FAF4EC',
                  color: loginOpen ? '#FFF7EE' : '#24130A',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.24)',
                  whiteSpace: 'nowrap',
                }}
              >
                <LogIn size={15} />
                <span>{isBn ? 'লগইন' : 'Login'}</span>
              </motion.button>
            </div>
          </div>
        </header>

        {/* Main Landing Content */}
        <main
          style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: 1180,
            margin: '0 auto',
            padding: 'clamp(28px, 5vw, 56px) clamp(16px, 4vw, 32px) 64px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(36px, 6vw, 60px)',
          }}
        >
          {/* ── 1. Hero Welcome & Concise Product Definition ─────────── */}
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 'clamp(24px, 4vw, 44px)',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  alignSelf: 'flex-start',
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: 'rgba(255, 245, 235, 0.16)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  color: '#FFE4C4',
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
              >
                <Sparkles size={13} />
                <span>
                  {isBn
                    ? 'দেশি ও ক্লিনিক্যাল পুষ্টি এআই'
                    : 'Clinical & Bangladeshi Nutrition AI'}
                </span>
              </div>

              <h1
                style={{
                  margin: 0,
                  fontFamily: isBn ? "'Hind Siliguri', Georgia, serif" : 'var(--font-serif)',
                  fontSize: 'clamp(30px, 4.6vw, 48px)',
                  fontWeight: 700,
                  lineHeight: 1.14,
                  letterSpacing: '-0.025em',
                  color: '#FFF8F0',
                }}
              >
                {isBn
                  ? 'খাবারের ছবি তুলুন। প্রতিটি পুষ্টিগুণ ও স্বাস্থ্য সতর্কতা জানুন।'
                  : 'Snap your plate. Know every macro, risk & cost.'}
              </h1>

              <p
                style={{
                  margin: 0,
                  fontSize: 'clamp(15px, 2vw, 17px)',
                  lineHeight: 1.6,
                  color: '#F3DFCA',
                  maxWidth: 560,
                }}
              >
                {isBn
                  ? 'নিউট্রিভিশন আপনার প্লেটের ছবি থেকে RAG ও ভিশন মডেলের মাধ্যমে ক্যালরি বিশ্লেষণ করে, ডায়েট সতর্কতা দেখায়, চালডালের লাইভ বাজারদরসহ বাজার তালিকা তৈরি করে এবং লাইভ রুমে খাবার শেয়ার করার সুবিধা দেয়।'
                  : 'NutriVision reads your meal photo with our culinary RAG and vision pipeline, flags dietary conflicts against your health profile, pulls live Chaldal grocery prices, and includes an AI nutrition coach plus 24h chat rooms.'}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 4 }}>
                <motion.button
                  type="button"
                  onClick={() => setLoginOpen(true)}
                  whileHover={reduceMotion ? {} : { y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '13px 24px',
                    borderRadius: 999,
                    border: 'none',
                    background: '#FAF4EC',
                    color: '#24130A',
                    fontFamily: 'inherit',
                    fontSize: 14.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  <LogIn size={16} />
                  <span>{isBn ? 'গুগল লগইন / শুরু করুন' : 'Sign In & Start'}</span>
                </motion.button>

                <a
                  href="#guide-steps"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '13px 20px',
                    borderRadius: 999,
                    border: '1px solid rgba(255, 255, 255, 0.38)',
                    background: 'rgba(255, 245, 235, 0.14)',
                    color: '#FFF8F0',
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: 'none',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <span>{isBn ? 'ধাপে ধাপে গাইড দেখুন' : 'Read Step-by-Step Guide'}</span>
                  <ArrowDown size={15} />
                </a>
              </div>
            </div>

            {/* Online vs Offline quick clarity card */}
            <div
              className="champagne-panel"
              style={{
                padding: '22px 20px',
                borderRadius: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                color: '#24130A',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                    fontSize: 18,
                    fontWeight: 700,
                    color: '#24130A',
                  }}
                >
                  {isBn ? 'অনলাইন ও অফলাইন সুবিধা' : 'Online vs Offline Access'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(45, 106, 79, 0.14)',
                    color: '#2D6A4F',
                  }}
                >
                  {isBn ? 'দুভাবেই ব্যবহারযোগ্য' : 'Dual-Mode'}
                </span>
              </div>

              <div
                style={{
                  padding: '13px 14px',
                  borderRadius: 16,
                  background: 'rgba(255, 252, 248, 0.72)',
                  border: '1px solid rgba(92, 58, 39, 0.14)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'rgba(45, 106, 79, 0.14)',
                    color: '#2D6A4F',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Wifi size={17} />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#24130A' }}>
                    {isBn ? 'অনলাইন (গুগল অ্যাকাউন্ট)' : 'Online (Google Sign-In)'}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: '#5C3A27' }}>
                    {isBn
                      ? 'প্রোফাইল ও খাবার ক্লাউডে সিঙ্ক, ভিশন + RAG খাবার শনাক্তকরণ, চালডাল লাইভ দাম, এআই কোচ ও ২৪ ঘণ্টার রুম চ্যাট।'
                      : 'Cloud profile sync, Vision + RAG plate recognition, live Chaldal prices, hosted AI Coach & 24h Room chat.'}
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '13px 14px',
                  borderRadius: 16,
                  background: 'rgba(255, 252, 248, 0.72)',
                  border: '1px solid rgba(92, 58, 39, 0.14)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'rgba(200, 116, 40, 0.14)',
                    color: '#9C4D11',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <WifiOff size={17} />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#24130A' }}>
                    {isBn ? 'অফলাইন মোড (ইন্টারনেট ছাড়াই)' : 'Offline Mode (No Internet Needed)'}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: '#5C3A27' }}>
                    {isBn
                      ? 'ডিভাইসে প্রোফাইল ও বিএমআর/টিডিইই লক্ষ্য নির্ধারণ, খাবার লগ করা, খাদ্য-স্বাস্থ্য সতর্কতা ও সংরক্ষিত পুষ্টি ডেটা দেখা।'
                      : 'Keep your profile & BMR/TDEE calorie targets on-device, log meals locally, run dietary conflict checks, and browse cached nutrition.'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── 2. Step-by-Step Interactive User Guide (Step 0 – Step 8) ── */}
          <section
            id="guide-steps"
            style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#E8C49A',
                    marginBottom: 4,
                  }}
                >
                  {isBn ? 'ব্যবহার নির্দেশিকা' : 'STEP-BY-STEP USER GUIDE'}
                </div>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                    fontSize: 'clamp(24px, 3.2vw, 32px)',
                    fontWeight: 700,
                    color: '#FFF8F0',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {isBn
                    ? 'সাইন ইন থেকে লাইভ রুম পর্যন্ত সম্পূর্ণ যাত্রা'
                    : 'From sign-in to live room chat in 9 steps'}
                </h2>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setActiveIdx((i) => (i - 1 + GUIDE_STEPS.length) % GUIDE_STEPS.length)}
                  aria-label={isBn ? 'পূর্ববর্তী ধাপ' : 'Previous step'}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.35)',
                    background: 'rgba(255, 245, 235, 0.14)',
                    color: '#FFF8F0',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIdx((i) => (i + 1) % GUIDE_STEPS.length)}
                  aria-label={isBn ? 'পরবর্তী ধাপ' : 'Next step'}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.35)',
                    background: 'rgba(255, 245, 235, 0.14)',
                    color: '#FFF8F0',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* Step Pill Selector Rail */}
            <div
              role="tablist"
              aria-label={isBn ? 'ধাপ নির্বাচন' : 'Guide steps'}
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 6,
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {GUIDE_STEPS.map((step, idx) => {
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveIdx(idx)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      border: isActive
                        ? '1px solid #FAF4EC'
                        : '1px solid rgba(255, 255, 255, 0.25)',
                      background: isActive ? '#FAF4EC' : 'rgba(255, 245, 235, 0.12)',
                      color: isActive ? '#24130A' : '#FFF7EE',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      transition: 'background 150ms ease, color 150ms ease',
                    }}
                  >
                    {isBn ? step.badgeBn : step.badgeEn}
                  </button>
                );
              })}
            </div>

            {/* Featured Step Viewer */}
            <div
              id="guide-viewer"
              className="champagne-panel"
              style={{
                padding: 'clamp(18px, 3vw, 28px)',
                borderRadius: 26,
                color: '#24130A',
              }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeStep.id}
                  initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 'clamp(20px, 3.5vw, 36px)',
                    alignItems: 'center',
                  }}
                >
                  {/* Step Details */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <span
                      style={{
                        alignSelf: 'flex-start',
                        padding: '4px 12px',
                        borderRadius: 999,
                        background: '#24130A',
                        color: '#FAF4EC',
                        fontSize: 11.5,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {isBn ? activeStep.badgeBn : activeStep.badgeEn}
                    </span>

                    <h3
                      style={{
                        margin: 0,
                        fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                        fontSize: 'clamp(22px, 3vw, 28px)',
                        fontWeight: 700,
                        color: '#24130A',
                        lineHeight: 1.25,
                      }}
                    >
                      {isBn ? activeStep.titleBn : activeStep.titleEn}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 14.5,
                        lineHeight: 1.65,
                        color: '#4A2E1F',
                      }}
                    >
                      {isBn ? activeStep.summaryBn : activeStep.summaryEn}
                    </p>

                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {(isBn ? activeStep.pointsBn : activeStep.pointsEn).map((pt, i) => (
                        <li
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: '#24130A',
                            lineHeight: 1.45,
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: 'rgba(45, 106, 79, 0.16)',
                              color: '#2D6A4F',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              marginTop: 1,
                            }}
                          >
                            <Check size={12} strokeWidth={2.8} />
                          </span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>

                    {activeStep.stepNumber === 0 && (
                      <div style={{ paddingTop: 6 }}>
                        <button
                          type="button"
                          onClick={() => setLoginOpen(true)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 18px',
                            borderRadius: 999,
                            border: 'none',
                            background: '#24130A',
                            color: '#FAF4EC',
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <LogIn size={14} />
                          <span>{isBn ? 'এখনই সাইন ইন খুলুন' : 'Open Sign-In Now'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Framed Screenshot Preview */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      background: 'linear-gradient(145deg, #2B170E 0%, #1B0E08 100%)',
                      borderRadius: 20,
                      padding: 12,
                      border: '1px solid rgba(36, 19, 10, 0.25)',
                      boxShadow: '0 16px 36px rgba(36, 18, 10, 0.28)',
                    }}
                  >
                    <img
                      src={activeStep.image}
                      alt={isBn ? activeStep.titleBn : activeStep.titleEn}
                      style={{
                        width: '100%',
                        maxHeight: 460,
                        objectFit: 'contain',
                        borderRadius: 12,
                        display: 'block',
                      }}
                    />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* All 9 Steps Thumbnail Overview */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 12,
                marginTop: 4,
              }}
            >
              {GUIDE_STEPS.map((step, idx) => {
                const selected = idx === activeIdx;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => scrollToStep(idx)}
                    style={{
                      textAlign: 'left',
                      padding: 10,
                      borderRadius: 18,
                      border: selected
                        ? '2px solid #FAF4EC'
                        : '1px solid rgba(255, 255, 255, 0.22)',
                      background: selected
                        ? 'rgba(250, 244, 236, 0.96)'
                        : 'rgba(255, 248, 240, 0.85)',
                      color: '#24130A',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: selected
                        ? '0 12px 26px rgba(0, 0, 0, 0.28)'
                        : '0 4px 14px rgba(0, 0, 0, 0.15)',
                      transition: 'transform 150ms ease, box-shadow 150ms ease',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: 128,
                        borderRadius: 11,
                        overflow: 'hidden',
                        background: '#24130A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={step.image}
                        alt={isBn ? step.badgeBn : step.badgeEn}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'top center',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#9C4D11' }}>
                        {isBn ? step.badgeBn : step.badgeEn}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#24130A',
                          lineHeight: 1.3,
                          marginTop: 2,
                        }}
                      >
                        {isBn ? step.titleBn : step.titleEn}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </main>

        {/* Bottom Attribution Footer */}
        <footer
          style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: 1180,
            margin: '0 auto',
            padding: '0 clamp(16px, 4vw, 32px) calc(env(safe-area-inset-bottom, 0px) + 28px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12.5, color: 'rgba(255, 240, 226, 0.85)', fontWeight: 500 }}>
            {isBn
              ? 'বাংলাদেশি খাদ্য উপাদান ডেটাবেজ ও ক্লিনিক্যাল পুষ্টি এআই'
              : 'Bangladeshi Food Composition & Clinical Nutrition AI'}
          </span>
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: 'rgba(255, 245, 235, 0.16)',
              color: '#FFF8F0',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isBn ? 'অ্যাপে প্রবেশ করুন →' : 'Launch App / Login →'}
          </button>
        </footer>

        {/* ── Login Modal (Toggled from Top Bar or CTA) ──────────────── */}
        <AnimatePresence>
          {loginOpen && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={isBn ? 'নিউট্রিভিশন লগইন' : 'Sign in to NutriVision'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLoginOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 60,
                background: 'rgba(18, 9, 5, 0.72)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px 16px',
              }}
            >
              <motion.div
                initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 430,
                  background: 'rgba(30, 18, 12, 0.96)',
                  border: '1px solid rgba(249, 242, 228, 0.22)',
                  borderRadius: 26,
                  boxShadow: '0 28px 70px rgba(0, 0, 0, 0.75)',
                  padding: '28px 24px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 18,
                  color: '#FFF8F0',
                }}
              >
                <button
                  type="button"
                  onClick={() => setLoginOpen(false)}
                  aria-label={isBn ? 'বন্ধ করুন' : 'Close login'}
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#FFF8F0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>

                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 16,
                    background: 'linear-gradient(135deg, #C87428 0%, #8C4716 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 10px 24px rgba(200, 116, 40, 0.4)',
                  }}
                >
                  <LogIn size={25} color="#FFF8F0" />
                </div>

                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                      fontSize: 25,
                      fontWeight: 700,
                      color: '#FFF8F0',
                    }}
                  >
                    {isBn ? 'নিউট্রিভিশনে প্রবেশ করুন' : 'Sign in to NutriVision'}
                  </h2>
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'rgba(249, 242, 228, 0.78)',
                      maxWidth: 330,
                    }}
                  >
                    {isBn
                      ? 'অনলাইনে RAG বিশ্লেষণ, চালডাল বাজারদর ও রুম পেতে গুগল দিয়ে প্রবেশ করুন; অথবা অফলাইন মোডে চালিয়ে যান।'
                      : 'Sign in with Google for RAG food analysis, live prices & 24h rooms — or continue offline on this device.'}
                  </p>
                </div>

                {/* Google Sign-In Box */}
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                    padding: '16px 14px',
                    borderRadius: 18,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'rgba(249, 242, 228, 0.68)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {isBn ? 'গুগল অ্যাকাউন্ট দিয়ে সাইন ইন' : 'Online Access · Google OAuth'}
                  </div>

                  {!online ? (
                    <div
                      role="status"
                      style={{
                        color: 'rgba(249, 242, 228, 0.85)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      {isBn
                        ? 'ইন্টারনেট সংযোগ নেই। নিচের অফলাইন বোতাম দিয়ে অ্যাপ ব্যবহার করুন।'
                        : 'You are offline. Use the offline option below to continue on this device.'}
                    </div>
                  ) : GOOGLE_CLIENT_ID ? (
                    <div
                      ref={googleBtnContainerRef}
                      style={{
                        minHeight: 46,
                        display: 'flex',
                        justifyContent: 'center',
                        width: '100%',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: 'rgba(217, 119, 6, 0.16)',
                        border: '1px solid rgba(217, 119, 6, 0.35)',
                        color: '#FCD34D',
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      {isBn
                        ? 'গুগল ক্লায়েন্ট আইডি সেট করা নেই। VITE_GOOGLE_CLIENT_ID কনফিগার করুন।'
                        : 'Google Client ID is not configured (VITE_GOOGLE_CLIENT_ID).'}
                    </div>
                  )}

                  {googleLoading && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'rgba(200, 116, 40, 0.18)',
                        width: '100%',
                        justifyContent: 'center',
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      <RefreshCw
                        size={14}
                        color="#FFB899"
                        style={{ animation: reduceMotion ? undefined : 'spin 1.5s linear infinite' }}
                      />
                      <span>{isBn ? 'সার্ভারে যাচাই করা হচ্ছে…' : 'Verifying with server…'}</span>
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'rgba(239, 68, 68, 0.18)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        width: '100%',
                        textAlign: 'left',
                      }}
                    >
                      <AlertCircle size={15} color="#FCA5A5" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 12, color: '#FEE2E2', lineHeight: 1.4 }}>{error}</span>
                    </div>
                  )}
                </div>

                {/* Offline Fallback Button */}
                <button
                  type="button"
                  onClick={() => onSignedIn(continueOffline())}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    borderRadius: 14,
                    border: '1px solid rgba(249, 242, 228, 0.3)',
                    background: 'rgba(249, 242, 228, 0.12)',
                    color: '#FFF8F0',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isBn ? 'অফলাইনে চালিয়ে যান' : 'Continue offline'}
                </button>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: 'rgba(249, 242, 228, 0.65)',
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>
                    {isBn
                      ? 'গুগল ওঅথ ২.০ এবং এনক্রিপ্টেড সেশন'
                      : 'Secured via Google OAuth 2.0 & JWT'}
                  </span>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LocalizedContent>
  );
}
