import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { useReducedMotion } from 'framer-motion';
import { loginWithGoogle } from '../../lib/auth';
import { initGoogleAuth } from '../../lib/googleAuth';
import type { AuthSession } from '../../types/schemas';
import { useLanguage } from '../../i18n/LanguageContext';
import { useTokens } from '../../theme/useTokens';
import LoginView from './LoginView';
import LandingView, { type LandingPalette } from './LandingView';

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

  const lp: LandingPalette = isDark
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

  if (view === 'login') {
    return (
      <LoginView
        isBn={isBn}
        reduceMotion={reduceMotion}
        online={online}
        googleLoading={googleLoading}
        error={error}
        googleClientId={GOOGLE_CLIENT_ID}
        googleBtnContainerRef={googleBtnContainerRef}
        onSignedIn={onSignedIn}
        backToLanding={backToLanding}
      />
    );
  }

  return (
    <LandingView
      isBn={isBn}
      isSignedIn={isSignedIn}
      reduceMotion={reduceMotion}
      activeIdx={activeIdx}
      setActiveIdx={setActiveIdx}
      scrollToStep={scrollToStep}
      smoothScrollToId={smoothScrollToId}
      scrollToLandingTop={scrollToLandingTop}
      handlePrimaryAction={handlePrimaryAction}
      lp={lp}
    />
  );
}
