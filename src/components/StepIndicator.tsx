import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { T, STEP_LABELS } from '../data';
import { useTokens } from '../theme/useTokens';
import { LocalizedContent, useLanguage } from '../i18n/LanguageContext';
import { toBengaliDigits } from '../lib/format';

interface StepIndicatorProps {
  step: number;
  onStep?: (i: number) => void;
}

const STEP_LABELS_BN = ['পর্যালোচনা', 'সমন্বয়', 'নিশ্চিতকরণ'];

/** 3-step horizontal indicator (Review → Adjust → Confirm). */
export default function StepIndicator({ step, onStep }: StepIndicatorProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language } = useLanguage();
  const isBn = language === 'bn';

  return (
    <LocalizedContent>
    <div
      className="results-step-indicator champagne-pill"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        width: '100%',
        borderRadius: 999,
      }}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEP_LABELS.length}
      aria-valuenow={step + 1}
      aria-label={`Step ${step + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[step]}`}
    >
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        const displayLabel = isBn ? STEP_LABELS_BN[i] : label;

        return (
          <div
            key={label}
            className="results-step"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: i === STEP_LABELS.length - 1 ? '0 0 auto' : 1,
              minWidth: 0,
            }}
          >
            <motion.button
              className="results-step-button"
              type="button"
              onClick={() => onStep?.(i)}
              whileHover={{ y: -1, scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={`Go to step ${i + 1}: ${displayLabel}`}
              style={{
                position: 'relative',
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: current
                  ? '1px solid rgba(255, 255, 255, 0.45)'
                  : done
                  ? '1px solid rgba(46, 125, 50, 0.35)'
                  : isDark
                  ? '1px solid rgba(255, 255, 255, 0.15)'
                  : '1px solid rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                padding: 0,
                background: current
                  ? 'linear-gradient(145deg, #42291E 0%, #22120A 100%)'
                  : done
                  ? 'linear-gradient(145deg, #166534 0%, #0F4522 100%)'
                  : isDark
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(255, 250, 244, 0.7)',
                boxShadow: current
                  ? '0 4px 12px -2px rgba(36, 20, 13, 0.5), inset 0 1px 1px rgba(255,255,255,0.45)'
                  : done
                  ? '0 3px 8px -2px rgba(22, 101, 52, 0.35)'
                  : 'inset 0 1px 1px rgba(255,255,255,0.8)',
              }}
            >
              {done ? (
                <Check size={11} color="#FFFFFF" strokeWidth={3} />
              ) : (
                <span
                  style={{
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontWeight: 700,
                    color: current ? '#FFFFFF' : isDark ? '#D8C4B6' : '#684A37',
                  }}
                >
                  {isBn ? toBengaliDigits(i + 1) : i + 1}
                </span>
              )}
            </motion.button>
            <span
              className="results-step-label"
              onClick={() => onStep?.(i)}
              style={{
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: current ? 700 : 500,
                color: current ? (isDark ? '#F9F2E4' : '#24130A') : (isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35'),
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                cursor: 'pointer',
                letterSpacing: '-0.01em',
              }}
            >
              {displayLabel}
            </span>

            {i < STEP_LABELS.length - 1 && (
              <motion.span
                className="results-step-separator"
                animate={{ opacity: done ? 1 : 0.4 }}
                transition={{ duration: 0.2 }}
                style={{
                  flex: 1,
                  height: 1.5,
                  borderRadius: 1,
                  background: done
                    ? 'linear-gradient(90deg, #166534 0%, #3D271D 100%)'
                    : 'rgba(92, 60, 46, 0.2)',
                  marginLeft: 2,
                  marginRight: 4,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
    </LocalizedContent>
  );
}