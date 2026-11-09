import { motion } from 'framer-motion';
import {
  Camera, ScanLine, Activity, User, ShoppingBag, Bot,
} from 'lucide-react';
import { TABS } from '../data';
import { useTokens } from '../theme/useTokens';
import { LocalizedContent, useLanguage } from '../i18n/LanguageContext';

const ICONS: Record<string, typeof Camera> = { Camera, ScanLine, Activity, User, ShoppingBag, Bot };

interface BottomNavProps {
  active: number;
  onChange: (next: number) => void;
}

/**
 * Floating bottom navigation dock per spec §4D.
 */
export default function BottomNav({ active, onChange }: BottomNavProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language } = useLanguage();
  const isBn = language === 'bn';

  const getTabLabel = (id: string, fallback: string) => {
    if (!isBn) return fallback;
    switch (id) {
      case 'capture': return 'ক্যামেরা';
      case 'results': return 'ফলাফল';
      case 'nutrients': return 'পুষ্টি';
      case 'profile': return 'প্রোফাইল';
      case 'grocery': return 'বাজার';
      case 'coach': return 'AI কোচ';
      default: return fallback;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(0, active - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(TABS.length - 1, active + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(TABS.length - 1);
    }
  };

  return (
    <LocalizedContent>
    <div
      className="bottom-nav-container"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        padding: '0 20px',
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      <motion.div
        className="glass-card"
        role="tablist"
        aria-label={isBn ? 'অ্যাপ নেভিগেশন' : 'App navigation'}
        onKeyDown={onKeyDown}
        whileHover={{ y: -1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 86,
          borderRadius: 36,
          padding: '6px 10px',
          background: isDark
            ? 'linear-gradient(145deg, rgba(35, 25, 20, 0.92) 0%, rgba(20, 14, 11, 0.95) 100%)'
            : 'linear-gradient(135deg, rgba(255, 248, 240, 0.65) 0%, rgba(246, 232, 218, 0.48) 100%)',
          backdropFilter: 'blur(32px) saturate(160%)',
          WebkitBackdropFilter: 'blur(32px) saturate(160%)',
          border: isDark
            ? '1.5px solid rgba(255, 255, 255, 0.12)'
            : '1.5px solid rgba(255, 255, 255, 0.82)',
          boxShadow: isDark
            ? '0 12px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255,255,255,0.1)'
            : '0 20px 48px -10px rgba(61, 39, 29, 0.22), inset 0 1.5px 2px rgba(255, 255, 255, 0.9)',
        }}
      >
        {TABS.map((t, i) => {
          const Icon = ICONS[t.icon] || Camera;
          const isActive = i === active;
          return (
            <motion.button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={t.label}
              aria-controls={`panel-${t.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(i)}
              whileHover={!isActive ? { y: -2 } : { y: -1 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className="nav-tab-btn"
              style={{
                position: 'relative',
                flex: 1,
                width: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 0',
                fontFamily: 'inherit',
                minHeight: 68,
                minWidth: 0,
                zIndex: 1,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 42,
                  height: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    style={{
                      position: 'absolute',
                      inset: -2,
                      borderRadius: 999,
                      background: 'linear-gradient(145deg, #42291E 0%, #22120A 100%)',
                      boxShadow:
                        '0 8px 22px -3px rgba(36, 20, 13, 0.55), inset 0 1.5px 1px rgba(255, 255, 255, 0.4)',
                    }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                  />
                )}
                <span
                  className="nav-tab-icon"
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'inline-flex',
                    color: isActive ? '#FFFFFF' : (isDark ? '#D0AE92' : '#4A2E1F'),
                    transition: 'color 200ms ease',
                  }}
                >
                  <Icon
                    size={isActive ? 20 : 21}
                    strokeWidth={1.8}
                    color="currentColor"
                  />
                </span>

                {!isActive && (
                  <span
                    aria-hidden="true"
                    className="nav-tab-halo"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.45)',
                      opacity: 0,
                      transform: 'scale(0.85)',
                      transition: 'opacity 180ms ease, transform 180ms ease',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                  />
                )}
              </div>
              <span
                className="nav-tab-label"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 600,
                  color: isActive ? (isDark ? '#F9F2E4' : '#24130A') : (isDark ? 'rgba(249, 242, 228, 0.72)' : '#4A2E1F'),
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                  transition: 'color 200ms ease, font-weight 200ms ease',
                }}
              >
                {getTabLabel(t.id, t.label)}
              </span>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
    </LocalizedContent>
  );
}