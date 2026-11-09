import { motion } from 'framer-motion';
import { TABS } from '../data';
import { LocalizedContent } from '../i18n/LanguageContext';

interface StepDotsProps {
  active: number;
  onChange?: (i: number) => void;
}

/**
 * Pagination pill dots for the header.
 */
export default function StepDots({ active, onChange }: StepDotsProps) {
  return (
    <LocalizedContent>
    <div
      style={{ display: 'flex', gap: 5, alignItems: 'center' }}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TABS.length}
      aria-valuenow={active + 1}
      aria-label={`Step ${active + 1} of ${TABS.length}`}
    >
      {TABS.map((t, i) => {
        const isActive = i === active;
        return (
          <motion.button
            key={t.id}
            type="button"
            aria-label={`Go to ${t.label}`}
            onClick={() => onChange?.(i)}
            whileHover={!isActive ? { scale: 1.15 } : {}}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            style={{
              position: 'relative',
              background: 'none',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <motion.div
              initial={false}
              animate={{
                width: isActive ? 22 : 6,
                borderRadius: isActive ? 4 : '50%',
                backgroundColor: isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.42)',
                boxShadow: isActive ? '0 0 10px rgba(255, 255, 255, 0.75)' : 'none',
              }}
              whileHover={
                !isActive
                  ? { backgroundColor: 'rgba(255, 255, 255, 0.85)' }
                  : {}
              }
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              style={{
                height: 5,
              }}
            />

            {!isActive && (
              <motion.span
                aria-hidden="true"
                initial={{ opacity: 0, y: 6 }}
                whileHover={{ opacity: 1, y: 0 }}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: 'rgba(46, 37, 34, 0.92)',
                  color: '#FFFFFF',
                  fontFamily: 'Inter',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                {t.label}
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
    </LocalizedContent>
  );
}