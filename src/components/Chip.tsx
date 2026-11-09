import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { T } from '../data';
import { useTokens } from '../theme/useTokens';
import { LocalizedContent } from '../i18n/LanguageContext';

interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

/**
 * Tag-style chip with check toggle. Used for medical conditions, dietary preferences, and allergens.
 *
 * Memoized to prevent unnecessary re-renders when sibling chips toggle — only
 * re-renders when its own `active` or `label` props change.
 */
const Chip = memo(function Chip({
  label,
  active,
  onClick,
  ariaLabel,
  size = 'md',
}: ChipProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const padding = size === 'sm' ? '6px 10px' : '8px 14px';
  const fontSize = size === 'sm' ? 11.5 : 12.5;

  return (
    <LocalizedContent>
      <motion.button
        type="button"
        onClick={onClick}
        aria-pressed={!!active}
        aria-label={ariaLabel || `Toggle ${label}`}
        whileHover={{ y: -1, scale: 1.03 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        className="champagne-pill"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding,
          borderRadius: 999,
          background: active
            ? 'linear-gradient(145deg, #42291E 0%, #24140D 100%)'
            : isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 250, 244, 0.72)',
          border: active
            ? '1px solid rgba(255, 255, 255, 0.35)'
            : isDark
            ? '1px solid rgba(255, 255, 255, 0.16)'
            : '1px solid rgba(255, 255, 255, 0.85)',
          boxShadow: active
            ? '0 8px 20px -4px rgba(36, 20, 13, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.35)'
            : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85), 0 2px 6px -3px rgba(61, 39, 29, 0.08)',
          cursor: 'pointer',
          fontFamily: 'Inter',
          fontSize,
          fontWeight: 600,
          color: active ? '#FAF4EC' : (isDark ? '#FAF4EC' : '#2C1A11'),
          whiteSpace: 'nowrap',
          minHeight: 36,
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          transition:
            'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease',
        }}
      >
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="dot"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.14 }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                flexShrink: 0,
              }}
            >
              <Check size={12} color="#FFFFFF" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
        <span>{label}</span>
      </motion.button>
    </LocalizedContent>
  );
});

export default Chip;
