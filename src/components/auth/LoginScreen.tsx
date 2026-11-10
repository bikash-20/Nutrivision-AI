import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LogIn,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { continueOffline, loginWithGoogle } from '../../lib/auth';
import { initGoogleAuth } from '../../lib/googleAuth';
import type { AuthSession } from '../../types/schemas';
import LanguageToggle from '../../i18n/LanguageToggle';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { useTokens } from '../../theme/useTokens';
import { GUIDE_STEPS } from './landingGuideSteps';

interface LoginScreenProps {
  /** Called with the new session once login succeeds. */
  onSignedIn: (session: AuthSession) => void;
  /** True when the user is already signed in and navigated to the landing page via the logo. */
  isSignedIn?: boolean;
  /** Called to return directly to the active app session when already signed in. */
  onReturnToApp?: () => void;
}

const GOOGLE_CLIENT_ID: string = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID
    ? import.meta.env.VITE_GOOGLE_CLIENT_ID
    : ''
).trim();

type AuthView = 'landing' | 'login';

export default function LoginScreen({ onSignedIn, isSignedIn = false, onReturnToApp }: LoginScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const reduceMotion = useReducedMotion();

  const lp = isDark
    ? {
        headerBg: 'rgba(22, 16, 13, 0.84)',
        panelInk: '#F9F2E4',
        panelBody: 'rgba(249, 242, 228, 0.84)',
        panelMuted: '#E8C49A',
        subCardBg: 'rgba(255, 255, 255, 0.05)',
        subCardBorder: 'rgba(255, 255, 255, 0.12)',
        onlineChipBg: 'rgba(184, 198, 138, 0.18)',
        onlineChipFg: '#B8C68A',
        offlineChipBg: 'rgba(240, 183, 154, 0.18)',
        offlineChipFg: '#F0B79A',
        stepBadgeBg: '#D0AE92',
        stepBadgeFg: '#1F1815',
        stepCtaBg: '#FAF4EC',
        stepCtaFg: '#24130A',
        gridBg: 'rgba(42, 32, 27, 0.90)',
        gridSelectedBg: 'rgba(61, 47, 40, 0.98)',
        gridBorder: 'rgba(255, 255, 255, 0.14)',
        gridSelectedBorder: '#D0AE92',
        gridStepTag: '#E8C49A',
        ollamaIconBg: 'rgba(208, 174, 146, 0.16)',
        ollamaIconFg: '#E8C49A',
        imgFrameBorder: 'rgba(255, 255, 255, 0.14)',
      }
    : {
        headerBg: 'rgba(36, 19, 10, 0.72)',
        panelInk: '#24130A',
        panelBody: '#4A2E1F',
        panelMuted: '#5C3A27',
        subCardBg: 'rgba(255, 252, 248, 0.85)',
        subCardBorder: 'rgba(92, 58, 39, 0.14)',
        onlineChipBg: 'rgba(45, 106, 79, 0.14)',
        onlineChipFg: '#2D6A4F',
        offlineChipBg: 'rgba(200, 116, 40, 0.14)',
        offlineChipFg: '#9C4D11',
        stepBadgeBg: '#24130A',
        stepBadgeFg: '#FAF4EC',
        stepCtaBg: '#24130A',
        stepCtaFg: '#FAF4EC',
        gridBg: 'rgba(255, 248, 240, 0.85)',
        gridSelectedBg: 'rgba(250, 244, 236, 0.96)',
        gridBorder: 'rgba(255, 255, 255, 0.22)',
        gridSelectedBorder: '#FAF4EC',
        gridStepTag: '#9C4D11',
        ollamaIconBg: 'rgba(36, 19, 10, 0.1)',
        ollamaIconFg: '#24130A',
        imgFrameBorder: 'rgba(36, 19, 10, 0.22)',
      };

  const [view, setView] = useState<AuthView>(() => {
    if (!isSignedIn && typeof window !== 'undefined' && window.location.hash === '#login') {
      return 'login';
    }
    return 'landing';
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  const googleBtnContainerRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);

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

  // Support browser back/forward between landing (#) and login (#login)
  useEffect(() => {
    const handleHashChange = () => {
      setView(window.location.hash === '#login' ? 'login' : 'landing');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const openLoginPage = useCallback(() => {
    setView('login');
    if (typeof window !== 'undefined') {
      if (window.location.hash !== '#login') {
        window.history.pushState(null, '', '#login');
      }
      window.scrollTo({ top: 0 });
    }
  }, []);

  const backToLanding = useCallback(() => {
    setView('landing');
    if (typeof window !== 'undefined') {
      if (window.location.hash === '#login') {
        window.history.pushState(null, '', window.location.pathname + window.location.search);
      }
      window.scrollTo({ top: 0 });
    }
  }, []);

  const scrollToLandingTop = useCallback(() => {
    if (lenisRef.current) {
      lenisRef.current.scrollTo(0);
    } else if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (isSignedIn && onReturnToApp) {
      onReturnToApp();
      return;
    }
    openLoginPage();
  }, [isSignedIn, onReturnToApp, openLoginPage]);

  // Heavy Lenis smooth inertia scroll on the Landing Page
  useEffect(() => {
    if (view !== 'landing' || reduceMotion) {
      lenisRef.current?.destroy();
      lenisRef.current = null;
      return;
    }

    const lenis = new Lenis({
      lerp: 0.042,
      duration: 1.9,
      smoothWheel: true,
      wheelMultiplier: 0.8,
      touchMultiplier: 1.35,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });
    lenisRef.current = lenis;

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };
    rafId = window.requestAnimationFrame(raf);

    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [view, reduceMotion]);

  // Initialize Google Identity Services when on the dedicated Login view
  useEffect(() => {
    if (view !== 'login' || !GOOGLE_CLIENT_ID || !online) return;

    let mounted = true;
    const btnWidth =
      typeof window !== 'undefined'
        ? Math.min(320, Math.max(260, window.innerWidth - 72))
        : 300;

    void initGoogleAuth({
      clientId: GOOGLE_CLIENT_ID,
      buttonContainer: googleBtnContainerRef.current,
      buttonWidth: btnWidth,
      locale: isBn ? 'bn' : 'en',
      promptOneTap: true,
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
  }, [isBn, online, onSignedIn, view]);

  const smoothScrollToId = (id: string) => {
    if (typeof document === 'undefined') return;
    const target = document.getElementById(id);
    if (!target) return;
    if (lenisRef.current) {
      lenisRef.current.scrollTo(target, { offset: -76, duration: 1.5 });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToStep = (idx: number) => {
    setActiveIdx(idx);
    smoothScrollToId('guide-viewer');
  };

  // ── Dedicated Previous Full-Screen Login Page (/nutrivision-ai.jpeg) ──
  if (view === 'login') {
    return (
      <LocalizedContent>
        <div
          className="login-viewport-root"
          style={{
            position: 'relative',
            minHeight: '100dvh',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflowX: 'hidden',
            overflowY: 'auto',
            color: '#F9F2E4',
            fontFamily: "'Outfit', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
            letterSpacing: '-0.01em',
          }}
        >
          {/* Full-viewport Culinary Background Photo (from public/nutrivision-ai.jpeg) */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              backgroundImage: 'url("/nutrivision-ai.jpeg")',
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
              transform: 'scale(1.02)',
              filter: 'brightness(1.0) contrast(1.02) saturate(1.05)',
              opacity: 1,
            }}
          />

          {/* Minimal soft ambient vignette — food photo stays pin-sharp, bright, and vibrant */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              background:
                'linear-gradient(180deg, rgba(0, 0, 0, 0.28) 0%, rgba(0, 0, 0, 0.05) 30%, rgba(0, 0, 0, 0.05) 70%, rgba(0, 0, 0, 0.38) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Top Header Bar */}
          <header
            style={{
              position: 'relative',
              zIndex: 10,
              width: '100%',
              maxWidth: 1200,
              margin: '0 auto',
              padding: 'calc(env(safe-area-inset-top, 0px) + 16px) clamp(16px, 4vw, 32px) 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            {/* Brand mark — redirects to landing page */}
            <button
              type="button"
              onClick={backToLanding}
              aria-label={isBn ? 'হোম পেজে যান' : 'Go to landing page'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 14px 7px 10px',
                borderRadius: 999,
                background: 'rgba(20, 14, 11, 0.90)',
                border: '1px solid rgba(255, 255, 255, 0.24)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                cursor: 'pointer',
              }}
            >
              <img
                src="/icon-96.png"
                alt=""
                aria-hidden="true"
                width={26}
                height={26}
                style={{ borderRadius: 8, display: 'block' }}
              />
              <span
                style={{
                  fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  letterSpacing: '-0.01em',
                  textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                }}
              >
                {isBn ? 'নিউট্রিভিশন' : 'NutriVision'}
              </span>
              <span
                style={{
                  fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, #E8590C 0%, #C92A2A 100%)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.40)',
                  boxShadow: '0 2px 8px rgba(201, 42, 42, 0.55)',
                }}
              >
                {isBn ? 'এআই' : 'AI'}
              </span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={backToLanding}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 38,
                  padding: '0 14px',
                  borderRadius: 999,
                  background: 'rgba(20, 14, 11, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  color: '#FAF4EC',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                }}
              >
                <ArrowLeft size={14} />
                <span>{isBn ? 'গাইড দেখুন' : 'Guide'}</span>
              </button>
              <div
                style={{
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  borderRadius: 999,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                }}
              >
                <LanguageToggle />
              </div>
            </div>
          </header>

          {/* Center Responsive Glass Card */}
          <main
            style={{
              position: 'relative',
              zIndex: 10,
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px clamp(16px, 4vw, 32px)',
              width: '100%',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
              }}
              style={{
                width: '100%',
                maxWidth: 440,
                background: 'rgba(24, 16, 12, 0.85)',
                backdropFilter: 'blur(28px) saturate(190%)',
                WebkitBackdropFilter: 'blur(28px) saturate(190%)',
                border: '1px solid rgba(249, 242, 228, 0.18)',
                borderRadius: 26,
                boxShadow:
                  '0 28px 65px -14px rgba(0, 0, 0, 0.80), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
                padding: 'clamp(28px, 6vw, 40px) clamp(20px, 5vw, 32px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 22,
              }}
            >
              {/* Header Icon Emblem */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    background:
                      'linear-gradient(135deg, rgba(217, 72, 15, 0.95) 0%, rgba(154, 43, 14, 0.95) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                    boxShadow:
                      '0 12px 28px -6px rgba(217, 72, 15, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.25) inset',
                  }}
                >
                  <LogIn size={30} color="#FFF8F0" strokeWidth={2.3} />
                </div>

                {/* Aesthetic Editorial Brand Title */}
                <h1
                  style={{
                    fontFamily: isBn
                      ? "'Hind Siliguri', 'Outfit', sans-serif"
                      : "'Fraunces', 'Plus Jakarta Sans', Georgia, serif",
                    fontSize: 'clamp(26px, 4vw, 32px)',
                    fontWeight: 700,
                    color: '#FFF8F0',
                    margin: '0 0 10px',
                    letterSpacing: '-0.025em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{isBn ? 'নিউট্রিভিশন' : 'NutriVision'}</span>
                  <span
                    style={{
                      fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                      fontSize: 'clamp(14px, 2.2vw, 17px)',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      padding: '3px 11px',
                      borderRadius: 999,
                      background: 'linear-gradient(135deg, #E8590C 0%, #C92A2A 100%)',
                      color: '#FFFFFF',
                      border: '1px solid rgba(255, 255, 255, 0.35)',
                      boxShadow: '0 4px 14px rgba(201, 42, 42, 0.50)',
                      verticalAlign: 'middle',
                    }}
                  >
                    {isBn ? 'এআই' : 'AI'}
                  </span>
                </h1>

                <p
                  style={{
                    fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                    fontSize: 'clamp(13px, 2vw, 14px)',
                    color: 'rgba(249, 242, 228, 0.82)',
                    margin: 0,
                    lineHeight: 1.6,
                    maxWidth: 340,
                    fontWeight: 400,
                  }}
                >
                  {isBn
                    ? 'আপনার খাবারের ছবি তুলে তাৎক্ষণিক পুষ্টি বিশ্লেষণ, নিরাপত্তা সতর্কতা ও বাজারের তালিকা পেতে সাইন ইন করুন।'
                    : 'Sign in with Google to access personalized nutrition intelligence, clinical safety alerts, and meal tracking.'}
                </p>
              </div>

              {/* Google Sign-In Action Block */}
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 14,
                  padding: '20px 16px',
                  borderRadius: 18,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.10)',
                }}
              >
                <div
                  style={{
                    fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'rgba(249, 242, 228, 0.65)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                  }}
                >
                  {isBn ? 'গুগল অ্যাকাউন্ট দিয়ে সাইন ইন' : 'Sign in with Google'}
                </div>

                {!online ? (
                  <div
                    role="status"
                    style={{
                      color: 'rgba(249, 242, 228, 0.8)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    {isBn
                      ? 'গুগল সাইন-ইনের জন্য ইন্টারনেট প্রয়োজন। অফলাইনে চালিয়ে যেতে নিচের বোতাম ব্যবহার করুন।'
                      : 'Google sign-in needs internet. Use the button below to continue offline.'}
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
                      padding: '12px 16px',
                      borderRadius: 12,
                      background: 'rgba(217, 119, 6, 0.15)',
                      border: '1px solid rgba(217, 119, 6, 0.35)',
                      color: '#FCD34D',
                      fontSize: 12,
                      lineHeight: 1.45,
                      textAlign: 'center',
                      fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                    }}
                  >
                    {isBn
                      ? 'গুগল ক্লায়েন্ট আইডি সেট করা নেই। দয়া করে VITE_GOOGLE_CLIENT_ID পরিবেশ ভেরিয়েবল সেট করুন।'
                      : 'Google Client ID is not configured. Please set VITE_GOOGLE_CLIENT_ID in your environment variables.'}
                  </div>
                )}

                <AnimatePresence>
                  {googleLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px 14px',
                        borderRadius: 14,
                        background: 'rgba(201, 98, 45, 0.15)',
                        border: '1px solid rgba(201, 98, 45, 0.30)',
                        width: '100%',
                        textAlign: 'center',
                        fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RefreshCw
                          size={15}
                          color="#FFB899"
                          className={reduceMotion ? '' : 'animate-spin'}
                          style={{ animation: 'spin 1.5s linear infinite' }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#F9F2E4' }}>
                          {isBn ? 'সার্ভারের সাথে যাচাই করা হচ্ছে…' : 'Verifying with server…'}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'rgba(249, 242, 228, 0.75)',
                          lineHeight: 1.4,
                          maxWidth: 290,
                        }}
                      >
                        {isBn
                          ? 'সার্ভার কোল্ড স্টার্ট হলে প্রথমবার ৩০-৪৫ সেকেন্ড সময় লাগতে পারে।'
                          : 'Render backend may take 30–45s to wake up on first visit.'}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      role="alert"
                      aria-live="assertive"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '12px 14px',
                        borderRadius: 14,
                        background: 'rgba(239, 68, 68, 0.18)',
                        border: '1px solid rgba(239, 68, 68, 0.40)',
                        width: '100%',
                        textAlign: 'left',
                        fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      <AlertCircle size={16} color="#F87171" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#FCA5A5' }}>
                          {isBn ? 'সাইন ইন ব্যর্থ হয়েছে' : 'Sign in failed'}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: '#FEE2E2',
                            marginTop: 2,
                            lineHeight: 1.4,
                            wordBreak: 'break-word',
                          }}
                        >
                          {error}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => onSignedIn(continueOffline())}
                style={{
                  width: '100%',
                  minHeight: 44,
                  borderRadius: 12,
                  border: '1px solid rgba(249, 242, 228, 0.3)',
                  background: 'rgba(249, 242, 228, 0.12)',
                  color: '#FFF8F0',
                  font: '600 14px Inter, system-ui, sans-serif',
                  cursor: 'pointer',
                }}
              >
                {isBn ? 'অফলাইনে চালিয়ে যান' : 'Continue offline'}
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  textAlign: 'center',
                  fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
                }}
              >
                <ShieldCheck size={14} color="rgba(249, 242, 228, 0.65)" />
                <span style={{ fontSize: 11.5, color: 'rgba(249, 242, 228, 0.65)' }}>
                  {isBn
                    ? 'গুগল ওঅথ ২.০ এবং সুরক্ষিত ব্যাকএন্ড পারসিস্টেন্স'
                    : 'Secured via Google OAuth 2.0 & encrypted JWT sessions'}
                </span>
              </div>
            </motion.div>
          </main>

          {/* Bottom Attribution Footer */}
          <footer
            style={{
              position: 'relative',
              zIndex: 10,
              width: '100%',
              maxWidth: 1200,
              margin: '0 auto',
              padding: '12px clamp(16px, 4vw, 32px) calc(env(safe-area-inset-bottom, 0px) + 16px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontFamily: "'Outfit', 'Plus Jakarta Sans', sans-serif",
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                color: '#F9F2E4',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                justifyContent: 'center',
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(20, 14, 11, 0.65)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
              }}
            >
              <Sparkles size={12} color="#FFB899" />
              <span>
                {isBn
                  ? 'বাংলাদেশি খাদ্য উপাদান ডেটাবেজ ও ক্লিনিক্যাল এআই ইঞ্জিন'
                  : 'Bangladeshi Food Composition & Clinical Dietary AI Engine'}
              </span>
            </div>
          </footer>
        </div>
      </LocalizedContent>
    );
  }

  // ── Landing Page (with Heavy Lenis Scroll + Step Guide + Local AI Settings) ──
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
        <div className="sage-bg" />

        {/* Sticky Top Bar with Language Toggle & Login Page Redirect Toggle */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            width: '100%',
            background: lp.headerBg,
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
            <button
              type="button"
              onClick={scrollToLandingTop}
              aria-label={isBn ? 'হোম পেজের শুরুতে যান' : 'Scroll to top of landing page'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
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
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LanguageToggle />
              <motion.button
                type="button"
                onClick={handlePrimaryAction}
                whileTap={{ scale: 0.96 }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: '1px solid rgba(255, 255, 255, 0.65)',
                  background: '#FAF4EC',
                  color: '#24130A',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.24)',
                  whiteSpace: 'nowrap',
                }}
              >
                <LogIn size={15} />
                <span>
                  {isSignedIn
                    ? isBn
                      ? 'অ্যাপে ফিরুন'
                      : 'Open App'
                    : isBn
                    ? 'লগইন'
                    : 'Login'}
                </span>
              </motion.button>
            </div>
          </div>
        </header>

        {/* ── 1. Full-Viewport Hero Section ONLY (clean titles & CTAs over hero photo) ── */}
        <section
          className="landing-hero-section"
          aria-label={isBn ? 'পরিচিতি' : 'Welcome'}
        >
          {/* Hero-only culinary background image (never shown outside this section) */}
          <div aria-hidden="true" className="landing-hero-bg" />

          {/* Responsive directional espresso contrast scrim */}
          <div aria-hidden="true" className="landing-hero-scrim" />

          <div
            className="landing-hero-inner"
            style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              maxWidth: 1180,
              margin: '0 auto',
              padding: 'clamp(44px, 7vw, 88px) clamp(18px, 4.5vw, 36px) clamp(48px, 8vw, 88px)',
            }}
          >
            <div
              className="landing-hero-copy"
              style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  alignSelf: 'flex-start',
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(20, 10, 5, 0.72)',
                  border: '1px solid rgba(255, 228, 196, 0.36)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
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
                className="landing-hero-title"
                style={{
                  margin: 0,
                  fontFamily: isBn ? "'Hind Siliguri', Georgia, serif" : 'var(--font-serif)',
                  fontSize: 'clamp(34px, 5vw, 56px)',
                  fontWeight: 700,
                  lineHeight: 1.12,
                  letterSpacing: '-0.025em',
                  color: '#FFF8F0',
                  textShadow: '0 3px 18px rgba(10, 4, 2, 0.8)',
                }}
              >
                {isBn
                  ? 'খাবারের ছবি তুলুন। প্রতিটি পুষ্টিগুণ ও স্বাস্থ্য সতর্কতা জানুন।'
                  : 'Snap your plate. Know every macro, risk & cost.'}
              </h1>

              <p
                className="landing-hero-subtitle"
                style={{
                  margin: 0,
                  fontSize: 'clamp(15.5px, 2vw, 18px)',
                  lineHeight: 1.65,
                  color: '#FAF0E4',
                  maxWidth: 560,
                  textShadow: '0 2px 12px rgba(10, 4, 2, 0.85)',
                }}
              >
                {isBn
                  ? 'নিউট্রিভিশন আপনার প্লেটের ছবি থেকে RAG ও ভিশন মডেলের মাধ্যমে ক্যালরি বিশ্লেষণ করে, ডায়েট সতর্কতা দেখায়, চালডালের লাইভ বাজারদরসহ বাজার তালিকা তৈরি করে এবং লোকাল Ollama, Whisper ও Piper দিয়ে অফলাইনেও কাজ করে।'
                  : 'NutriVision analyzes meal photos via our culinary RAG and vision pipeline, detects dietary conflicts, syncs live Chaldal market prices, supports 24h live chat rooms, and runs locally with Ollama, Whisper, and Piper.'}
              </p>

              <div
                className="landing-hero-actions"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 6 }}
              >
                <motion.button
                  type="button"
                  onClick={handlePrimaryAction}
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
                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
                  }}
                >
                  <LogIn size={16} />
                  <span>
                    {isSignedIn
                      ? isBn
                        ? 'অ্যাপে ফিরুন'
                        : 'Open App'
                      : isBn
                      ? 'লগইন পেজে যান'
                      : 'Go to Login Page'}
                  </span>
                </motion.button>

                <button
                  type="button"
                  onClick={() => smoothScrollToId('guide-steps')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '13px 20px',
                    borderRadius: 999,
                    border: '1px solid rgba(255, 255, 255, 0.44)',
                    background: 'rgba(20, 10, 5, 0.65)',
                    color: '#FFF8F0',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  <span>{isBn ? 'ব্যবহার নির্দেশিকা দেখুন' : 'Explore User Guide'}</span>
                  <ArrowDown size={15} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <main
          style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: 1180,
            margin: '0 auto',
            padding: 'clamp(36px, 5vw, 56px) clamp(16px, 4vw, 32px) 64px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(40px, 6vw, 68px)',
          }}
        >
          {/* ── Online vs Offline Access Strip (moved cleanly below the Hero) ── */}
          <section aria-label={isBn ? 'অনলাইন ও অফলাইন সুবিধা' : 'Online vs Offline Access'}>
            <div
              className="champagne-panel"
              style={{
                padding: 'clamp(18px, 3vw, 24px)',
                borderRadius: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                color: lp.panelInk,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                    fontSize: 20,
                    fontWeight: 700,
                    color: lp.panelInk,
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
                    background: lp.onlineChipBg,
                    color: lp.onlineChipFg,
                  }}
                >
                  {isBn ? 'দুভাবেই ব্যবহারযোগ্য' : 'Dual-Mode'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 16,
                    background: lp.subCardBg,
                    border: `1px solid ${lp.subCardBorder}`,
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
                      background: lp.onlineChipBg,
                      color: lp.onlineChipFg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Wifi size={17} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: lp.panelInk }}>
                      {isBn ? 'অনলাইন (গুগল অ্যাকাউন্ট)' : 'Online (Google Sign-In)'}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.55, color: lp.panelBody }}>
                      {isBn
                        ? 'প্রোফাইল সিঙ্ক, ভিশন + RAG খাবার শনাক্তকরণ, চালডাল লাইভ দাম, এআই কোচ ও ২৪ ঘণ্টার রুম চ্যাট।'
                        : 'Cloud profile sync, Vision + RAG plate recognition, live Chaldal prices, hosted AI Coach & 24h Room chat.'}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: 16,
                    background: lp.subCardBg,
                    border: `1px solid ${lp.subCardBorder}`,
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
                      background: lp.offlineChipBg,
                      color: lp.offlineChipFg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <WifiOff size={17} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: lp.panelInk }}>
                      {isBn ? 'অফলাইন মোড (ইন্টারনেট ছাড়াই)' : 'Offline Mode (No Internet Needed)'}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.55, color: lp.panelBody }}>
                      {isBn
                        ? 'ডিভাইসে প্রোফাইল ও বিএমআর/টিডিইই হিসাব, খাবার লগ, সতর্কতা নিয়ম এবং লোকাল Ollama, Whisper ও Piper ব্যবহার করুন।'
                        : 'Keep your profile & BMR/TDEE targets on-device, log meals locally, check conflict rules, and run local Ollama, Whisper & Piper.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── 2. Step-by-Step Interactive User Guide (Steps 0–10) ─── */}
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
                    ? 'সাইন ইন থেকে লোকাল এআই সেটিংস — প্রতিটি ধাপ'
                    : 'Every step from Google sign-in to local AI setup'}
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
                color: lp.panelInk,
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <span
                      style={{
                        alignSelf: 'flex-start',
                        padding: '4px 12px',
                        borderRadius: 999,
                        background: lp.stepBadgeBg,
                        color: lp.stepBadgeFg,
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
                        color: lp.panelInk,
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
                        color: lp.panelBody,
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
                            color: lp.panelInk,
                            lineHeight: 1.45,
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: lp.onlineChipBg,
                              color: lp.onlineChipFg,
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
                          onClick={handlePrimaryAction}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 18px',
                            borderRadius: 999,
                            border: 'none',
                            background: lp.stepCtaBg,
                            color: lp.stepCtaFg,
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <LogIn size={14} />
                          <span>
                            {isSignedIn
                              ? isBn
                                ? 'অ্যাপে ফিরুন'
                                : 'Open App'
                              : isBn
                              ? 'লগইন পেজে যান'
                              : 'Go to Login Page'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      background: 'linear-gradient(145deg, #2B170E 0%, #1B0E08 100%)',
                      borderRadius: 20,
                      padding: 12,
                      border: `1px solid ${lp.imgFrameBorder}`,
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

            {/* All Steps Visual Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))',
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
                        ? `2px solid ${lp.gridSelectedBorder}`
                        : `1px solid ${lp.gridBorder}`,
                      background: selected ? lp.gridSelectedBg : lp.gridBg,
                      color: lp.panelInk,
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
                        height: 124,
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
                      <div style={{ fontSize: 11, fontWeight: 800, color: lp.gridStepTag }}>
                        {isBn ? step.badgeBn : step.badgeEn}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: lp.panelInk,
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

          {/* ── 3. Dedicated Settings Feature Spotlight: Local Ollama, Whisper & Piper ── */}
          <section
            id="local-ai"
            style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
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
                {isBn ? 'সেটিংস ও প্রাইভেসি' : 'SETTINGS & ON-DEVICE AI'}
              </div>
              <h2
                style={{
                  margin: 0,
                  fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                  fontSize: 'clamp(24px, 3vw, 30px)',
                  fontWeight: 700,
                  color: '#FFF8F0',
                  letterSpacing: '-0.02em',
                }}
              >
                {isBn
                  ? 'লোকাল Ollama, Whisper ও Piper ভয়েস নিজের ডিভাইসে চালান'
                  : 'Run local Ollama models, Whisper STT & Piper voice privately'}
              </h2>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 18,
              }}
            >
              {/* Local Ollama Card (ollama-2.png) */}
              <div
                className="champagne-panel"
                style={{
                  padding: 18,
                  borderRadius: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  color: lp.panelInk,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      background: lp.ollamaIconBg,
                      color: lp.ollamaIconFg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Cpu size={18} />
                  </div>
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                        fontSize: 17,
                        fontWeight: 700,
                        color: lp.panelInk,
                      }}
                    >
                      {isBn ? 'লোকাল Ollama মডেল সংযোগ' : 'Local Ollama Models'}
                    </h3>
                    <div style={{ fontSize: 12, color: lp.panelMuted, fontWeight: 600 }}>
                      http://localhost:11434
                    </div>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: lp.panelBody }}>
                  {isBn
                    ? 'সেটিংস থেকে আপনার কম্পিউটারের Ollama সার্ভার যুক্ত করলে ইনস্টল করা চ্যাট ও ভিশন মডেল স্বয়ংক্রিয়ভাবে যুক্ত হয়—কোনো ডেটা বাইরে না পাঠিয়েই প্লেট ও প্রশ্ন বিশ্লেষণ করা যায়।'
                    : 'Point Settings to your local Ollama server for automatic model discovery, custom system prompts, and private on-device meal photo & nutrition reasoning.'}
                </p>

                <div
                  style={{
                    borderRadius: 16,
                    overflow: 'hidden',
                    background: '#24130A',
                    border: `1px solid ${lp.imgFrameBorder}`,
                  }}
                >
                  <img
                    src="/ollama-2.png"
                    alt={isBn ? 'লোকাল Ollama মডেল সেটিংস' : 'Local Ollama model settings'}
                    loading="lazy"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </div>
              </div>

              {/* Offline Whisper & Piper Card (ollama-1.png) */}
              <div
                className="champagne-panel"
                style={{
                  padding: 18,
                  borderRadius: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  color: lp.panelInk,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      background: lp.onlineChipBg,
                      color: lp.onlineChipFg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Mic size={18} />
                  </div>
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: isBn ? "'Hind Siliguri', serif" : 'var(--font-serif)',
                        fontSize: 17,
                        fontWeight: 700,
                        color: lp.panelInk,
                      }}
                    >
                      {isBn ? 'অফলাইন Whisper ও Piper ভয়েস' : 'Offline Whisper, Piper & Qwen3-TTS'}
                    </h3>
                    <div style={{ fontSize: 12, color: lp.panelMuted, fontWeight: 600 }}>
                      http://localhost:5005/transcribe · /speak
                    </div>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: lp.panelBody }}>
                  {isBn
                    ? 'ইন্টারনেট ছাড়াই কথা বলে প্রশ্ন করতে লোকাল Whisper এবং উত্তর শোনার জন্য Piper বা Qwen3-TTS ইঞ্জিন বেছে নিন। সেটিংসে এক ক্লিকেই ভয়েস সার্ভিস পরীক্ষা করা যায়।'
                    : 'Transcribe voice questions privately with local Whisper and hear AI Coach responses through Piper or Qwen3-TTS weights, complete with a one-click service check.'}
                </p>

                <div
                  style={{
                    borderRadius: 16,
                    overflow: 'hidden',
                    background: '#24130A',
                    border: `1px solid ${lp.imgFrameBorder}`,
                  }}
                >
                  <img
                    src="/ollama-1.png"
                    alt={isBn ? 'অফলাইন Whisper ও Piper সেটিংস' : 'Offline Whisper and Piper voice settings'}
                    loading="lazy"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* Bottom Footer */}
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
            onClick={handlePrimaryAction}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: '#FAF4EC',
              color: '#24130A',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isSignedIn
              ? isBn
                ? 'অ্যাপে ফিরে যান →'
                : 'Back to App →'
              : isBn
              ? 'লগইন পেজে প্রবেশ করুন →'
              : 'Proceed to Login →'}
          </button>
        </footer>
      </div>
    </LocalizedContent>
  );
}
