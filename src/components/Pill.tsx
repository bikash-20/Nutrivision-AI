import { memo } from 'react';
import { motion } from 'framer-motion';
import { T } from '../data';
import { useTokens } from '../theme/useTokens';
import { LocalizedContent } from '../i18n/LanguageContext';

interface PillProps {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  tone?: 'accent' | 'warning';
  layoutId?: string;
  ariaLabel?: string;
}

/**
 * Toggle pill for the Profile screen.
 *
 * Designed with solid continuous backdrop rendering to prevent GPU texture
 * flashes and layoutId transparent-frame flickering on toggle.
 */
const Pill = memo(function Pill({
  children,
  active,
  onClick,
  tone = 'accent',
  ariaLabel,
}: PillProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const activeBg = tone === 'warning' ? T.accentWarn : T.primary;
  const activeColor = '#FFFFFF';

  return (
    <LocalizedContent>
      <motion.button
        type="button"
        className="profile-option-pill"
        onClick={onClick}
        aria-pressed={!!active}
        aria-label={ariaLabel}
        whileHover={{ y: -1, scale: 1.02 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        style={{
          position: 'relative',
          background: active ? activeBg : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(249, 242, 228, 0.7)'),
          color: active ? activeColor : T.ink,
          border: active
            ? `1px solid ${activeBg}`
            : isDark
            ? '1px solid rgba(255, 255, 255, 0.14)'
            : '1px solid rgba(74, 58, 52, 0.18)',
          borderRadius: 20,
          padding: '8px 14px',
          fontFamily: 'Inter',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          minHeight: 36,
          backdropFilter: 'blur(8px) saturate(130%)',
          WebkitBackdropFilter: 'blur(8px) saturate(130%)',
          boxShadow: active
            ? `0 6px 14px -4px ${activeBg}80, inset 0 1px 0 rgba(255,255,255,0.35)`
            : 'inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 6px -3px rgba(46,37,34,0.12)',
          transition:
            'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease',
        }}
      >
        <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
      </motion.button>
    </LocalizedContent>
  );
});

export default Pill;
