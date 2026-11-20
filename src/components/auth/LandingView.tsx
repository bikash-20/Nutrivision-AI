import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LogIn,
  Mic,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import LanguageToggle from '../../i18n/LanguageToggle';
import { LocalizedContent } from '../../i18n/LanguageContext';
import { GUIDE_STEPS } from './landingGuideSteps';

export interface LandingPalette {
  headerBg: string;
  panelInk: string;
  panelBody: string;
  panelMuted: string;
  subCardBg: string;
  subCardBorder: string;
  onlineChipBg: string;
  onlineChipFg: string;
  offlineChipBg: string;
  offlineChipFg: string;
  stepBadgeBg: string;
  stepBadgeFg: string;
  stepCtaBg: string;
  stepCtaFg: string;
  gridBg: string;
  gridSelectedBg: string;
  gridBorder: string;
  gridSelectedBorder: string;
  gridStepTag: string;
  ollamaIconBg: string;
  ollamaIconFg: string;
  imgFrameBorder: string;
}

interface LandingViewProps {
  isBn: boolean;
  isSignedIn: boolean;
  reduceMotion: boolean | null;
  activeIdx: number;
  setActiveIdx: React.Dispatch<React.SetStateAction<number>>;
  scrollToStep: (idx: number) => void;
  smoothScrollToId: (id: string) => void;
  scrollToLandingTop: () => void;
  handlePrimaryAction: () => void;
  lp: LandingPalette;
}

export default function LandingView({
  isBn,
  isSignedIn,
  reduceMotion,
  activeIdx,
  setActiveIdx,
  scrollToStep,
  smoothScrollToId,
  scrollToLandingTop,
  handlePrimaryAction,
  lp,
}: LandingViewProps) {
  const activeStep = GUIDE_STEPS[activeIdx] ?? GUIDE_STEPS[0];

  return (
    <LocalizedContent>
      <div
        className="landing-viewport-root"
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
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#docs';
                  window.dispatchEvent(new Event('hashchange'));
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 38,
                  padding: '0 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(232, 196, 154, 0.4)',
                  background: 'rgba(232, 196, 154, 0.12)',
                  color: '#FAF4EC',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <span>📑</span>
                <span>/docs</span>
              </button>
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

        {/* ── 1. Full-Viewport Hero Section ONLY ── */}
        <section
          className="landing-hero-section"
          aria-label={isBn ? 'পরিচিতি' : 'Welcome'}
        >
          <div aria-hidden="true" className="landing-hero-bg" />
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
                className="landing-hero-eyebrow"
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
          {/* ── Online vs Offline Access Strip ── */}
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

          {/* ── 2. Step-by-Step Interactive User Guide ── */}
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

          {/* ── 3. Dedicated Settings Feature Spotlight ── */}
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
