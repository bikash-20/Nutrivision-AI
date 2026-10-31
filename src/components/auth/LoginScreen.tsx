import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LogIn, ShieldCheck, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { loginWithGoogle } from '../../lib/auth';
import { initGoogleAuth } from '../../lib/googleAuth';
import type { AuthSession } from '../../types/schemas';
import LanguageToggle from '../../i18n/LanguageToggle';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';

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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Google Identity Services
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

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
  }, [isBn, onSignedIn]);

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
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
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
            transform: 'scale(1.02)', // Prevents mobile viewport elastic bounce gaps
            filter: 'brightness(0.92) contrast(1.04)',
          }}
        />

        {/* Cinematic Vignette & Radial Light Overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1,
            background:
              'radial-gradient(ellipse 90% 80% at 20% 20%, rgba(201, 98, 45, 0.22) 0%, transparent 65%), linear-gradient(180deg, rgba(16, 11, 9, 0.60) 0%, rgba(16, 11, 9, 0.74) 45%, rgba(16, 11, 9, 0.92) 100%)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
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
          }}
        >
          {/* Brand mark */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 12px 6px 8px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
            }}
          >
            <img
              src="/icon-32.png"
              alt=""
              aria-hidden="true"
              width={26}
              height={26}
              style={{ borderRadius: 8, display: 'block' }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#F9F2E4',
                letterSpacing: '-0.01em',
              }}
            >
              {isBn ? 'নিউট্রিভিশন' : 'NutriVision'}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '2px 6px',
                borderRadius: 6,
                background: 'rgba(201, 98, 45, 0.35)',
                color: '#FFB899',
                border: '1px solid rgba(201, 98, 45, 0.45)',
              }}
            >
              AI
            </span>
          </div>

          {/* Language Toggle */}
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
              background: 'rgba(26, 18, 14, 0.82)',
              backdropFilter: 'blur(24px) saturate(190%)',
              WebkitBackdropFilter: 'blur(24px) saturate(190%)',
              border: '1px solid rgba(249, 242, 228, 0.18)',
              borderRadius: 26,
              boxShadow:
                '0 28px 65px -14px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08) inset',
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
                    'linear-gradient(135deg, rgba(201, 98, 45, 0.95) 0%, rgba(138, 52, 22, 0.95) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  boxShadow:
                    '0 12px 28px -6px rgba(201, 98, 45, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.25) inset',
                }}
              >
                <LogIn size={30} color="#FFF8F0" strokeWidth={2.3} />
              </div>

              <h1
                style={{
                  fontSize: 'clamp(22px, 3.5vw, 26px)',
                  fontWeight: 700,
                  color: '#F9F2E4',
                  margin: '0 0 8px',
                  letterSpacing: '-0.02em',
                }}
              >
                {isBn ? 'নিউট্রিভিশন এআই' : 'NutriVision AI'}
              </h1>

              <p
                style={{
                  fontSize: 'clamp(12.5px, 2vw, 13.5px)',
                  color: 'rgba(249, 242, 228, 0.78)',
                  margin: 0,
                  lineHeight: 1.55,
                  maxWidth: 340,
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
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'rgba(249, 242, 228, 0.65)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {isBn ? 'গুগল অ্যাকাউন্ট দিয়ে সাইন ইন' : 'Sign in with Google'}
              </div>

              {/* Official GSI Button Mount */}
              {GOOGLE_CLIENT_ID ? (
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
                  }}
                >
                  {isBn
                    ? 'গুগল ক্লায়েন্ট আইডি সেট করা নেই। দয়া করে VITE_GOOGLE_CLIENT_ID পরিবেশ ভেরিয়েবল সেট করুন।'
                    : 'Google Client ID is not configured. Please set VITE_GOOGLE_CLIENT_ID in your environment variables.'}
                </div>
              )}

              {/* Loading / Cold Start status indicator */}
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

              {/* Error banner */}
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

            {/* Security Trust Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '4px 8px',
                textAlign: 'center',
              }}
            >
              <ShieldCheck size={14} color="rgba(249, 242, 228, 0.65)" />
              <span
                style={{
                  fontSize: 11.5,
                  color: 'rgba(249, 242, 228, 0.65)',
                }}
              >
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
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              color: 'rgba(249, 242, 228, 0.60)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              justifyContent: 'center',
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
