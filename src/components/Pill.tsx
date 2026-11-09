import { memo } from 'react';
import { motion } from 'framer-motion';
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
  const activeBg = tone === 'warning'
    ? 'linear-gradient(145deg, #9C3818 0%, #7A240E 100%)'
    : 'linear-gradient(145deg, #42291E 0%, #24140D 100%)';
  const activeColor = '#FAF4EC';

  return (
    <LocalizedContent>
      <motion.button
        type="button"
        className="profile-option-pill champagne-pill"
        onClick={onClick}
        aria-pressed={!!active}
        aria-label={ariaLabel}
        whileHover={{ y: -1, scale: 1.02 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        style={{
          position: 'relative',
          background: active ? activeBg : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.72)'),
          color: active ? activeColor : (isDark ? '#FAF4EC' : '#2C1A11'),
          border: active
            ? '1px solid rgba(255, 255, 255, 0.35)'
            : isDark
            ? '1px solid rgba(255, 255, 255, 0.16)'
            : '1px solid rgba(255, 255, 255, 0.85)',
          borderRadius: 999,
          padding: '8px 16px',
          fontFamily: 'Inter',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          minHeight: 36,
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          boxShadow: active
            ? '0 8px 20px -4px rgba(36, 20, 13, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.35)'
            : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85), 0 2px 6px -3px rgba(61, 39, 29, 0.08)',
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
