import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { T } from '../data';
import { useLanguage } from '../i18n/LanguageContext';

interface PhoneFrameProps {
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Responsive phone frame for the demo.
 *
 * - Mobile (<768px): fills the viewport like a native app — no bezel, no shadow
 * - Desktop (≥768px): centered phone mockup with bezel + 3D tilt entrance
 */
export default function PhoneFrame({ children, headerRight, footer }: PhoneFrameProps) {
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Mobile: full-screen native-app feel ──────────────────────────────
  if (isMobile) {
    return (
      <div
        style={{
          height: '100dvh',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Gradient background */}
        <div className="sage-bg" />

        {/* App header */}
        <div
          style={{
            position: 'relative',
            zIndex: 3,
            // Reserve space for the iOS status bar / browser URL bar so the
            // header doesn't slide under the device chrome.
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            paddingBottom: 12,
            paddingLeft: 22,
            paddingRight: 22,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'transparent',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <img
              src="/icon-96.png"
              alt=""
              aria-hidden="true"
              width={24}
              height={24}
              style={{ borderRadius: 6 }}
            />
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 600,
                fontSize: 20,
                color: T.earth6,
              }}
            >
              {isBn ? 'নিউট্রিভিশন' : 'NutriVision'}
            </span>
          </div>
          {headerRight}
        </div>

        {/* Screen content */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            paddingTop: 8,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)',
          }}
        >
          {children}
        </div>
        {footer}
      </div>
    );
  }

  // ── Desktop: full-width app shell ───────────────────────────────────
  return (
    <motion.div
      className="app-desktop-shell"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ opacity: { duration: 0.4 }, y: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
    >
      <div className="sage-bg" />

      <header className="app-desktop-header">
        <div className="app-desktop-brand">
          <img
            src="/icon-96.png"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
          />
          <span>{isBn ? 'নিউট্রিভিশন' : 'NutriVision'}</span>
        </div>
        {headerRight}
      </header>

      <main className="app-desktop-content">{children}</main>
      {footer}
    </motion.div>
  );
}
