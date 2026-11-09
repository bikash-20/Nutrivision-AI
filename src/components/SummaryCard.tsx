import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Flame, TrendingUp, BarChart2 } from 'lucide-react';
import { T } from '../data';
import { useTokens } from '../theme/useTokens';
import useCountUp from './useCountUp';
import { LocalizedContent, useLanguage } from '../i18n/LanguageContext';
import { toBengaliDigits } from '../lib/format';
import RevenueCurveChart from './RevenueCurveChart';
import type { UserProfile } from '../types/schemas';
import { getDynamicTargets } from '../lib/personalize';

interface Totals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface SummaryCardProps {
  totals: Totals;
  itemCount: number;
  profile?: UserProfile | null;
}

/**
 * Sticky header summary card for the Results screen with toggleable
 * Revenue-Style trajectory curve and high-contrast macro gauges.
 */
export default function SummaryCard({ totals, itemCount, profile }: SummaryCardProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(true);
  const [showCurve, setShowCurve] = useState(false);
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const kcal = useCountUp(Math.round(totals.kcal));
  const protein = useCountUp(Math.round(totals.protein));
  const carbs = useCountUp(Math.round(totals.carbs));
  const fat = useCountUp(Math.round(totals.fat));

  const targets = useMemo(() => getDynamicTargets(profile), [profile]);
  const mealsPerDay = Math.max(1, profile?.mealsPerDay ?? 3);
  const targetProtein = Math.max(15, Math.round(targets.protein / mealsPerDay));
  const targetCarbs = Math.max(25, Math.round(targets.carbs / mealsPerDay));
  const targetFat = Math.max(10, Math.round(targets.fat / mealsPerDay));

  const macros = [
    { label: isBn ? 'প্রোটিন' : 'Protein', value: Math.round(protein), color: T.primary, pct: Math.min(100, Math.round((totals.protein / targetProtein) * 100)) },
    { label: isBn ? 'কার্বোহাইড্রেট' : 'Carbs',   value: Math.round(carbs),   color: T.accentAmber, pct: Math.min(100, Math.round((totals.carbs / targetCarbs) * 100)) },
    { label: isBn ? 'চর্বি' : 'Fat',     value: Math.round(fat),     color: T.accentGood, pct: Math.min(100, Math.round((totals.fat / targetFat) * 100)) },
  ];

  return (
    <LocalizedContent>
    <motion.div
      layout
      className="champagne-panel"
      style={{
        borderRadius: 24,
        padding: open ? '16px 18px' : '12px 16px',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 15,
              fontWeight: 700,
              color: isDark ? '#F9F2E4' : '#24130A',
              whiteSpace: 'nowrap',
              letterSpacing: '-0.01em',
            }}
          >
            🍽️ {isBn ? toBengaliDigits(itemCount) : itemCount} {isBn ? 'টি খাবার' : itemCount === 1 ? 'item' : 'items'}
          </div>
          <span style={{ color: '#96735B', fontSize: 12 }}>·</span>
          <span
            className="kcal-chip champagne-pill"
            style={{
              fontSize: 12,
              padding: '3px 9px',
              fontWeight: 700,
              background: 'linear-gradient(135deg, rgba(200, 116, 40, 0.16) 0%, rgba(200, 116, 40, 0.08) 100%)',
              border: '1px solid rgba(200, 116, 40, 0.35)',
              color: isDark ? '#F5C28C' : '#9C4D11',
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Flame size={12} color="#C87428" /> {isBn ? toBengaliDigits(Math.round(kcal)) : Math.round(kcal)} {isBn ? 'কিলোক্যালরি' : 'kcal'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <motion.button
            type="button"
            onClick={() => setShowCurve((v) => !v)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            title={showCurve ? (isBn ? 'ম্যাক্রো বিবরণ দেখুন' : 'View macros') : (isBn ? 'গতিপথ কার্ভ চার্ট দেখুন' : 'View trajectory curve')}
            className="champagne-pill"
            style={{
              padding: '5px 10px',
              borderRadius: 999,
              background: showCurve
                ? 'linear-gradient(145deg, #42291E 0%, #24140D 100%)'
                : isDark
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(255, 250, 244, 0.7)',
              color: showCurve ? '#FAF4EC' : isDark ? '#F9F2E4' : '#24130A',
              border: showCurve
                ? '1px solid rgba(255, 255, 255, 0.35)'
                : isDark
                ? '1px solid rgba(255, 255, 255, 0.16)'
                : '1px solid rgba(255, 255, 255, 0.85)',
              boxShadow: showCurve ? '0 4px 12px -2px rgba(36, 20, 13, 0.45)' : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {showCurve ? <BarChart2 size={12} /> : <TrendingUp size={12} />}
            <span>{showCurve ? (isBn ? 'ম্যাক্রো' : 'Macros') : (isBn ? 'গতিপথ' : 'Curve')}</span>
          </motion.button>

          <motion.button
            type="button"
            onClick={() => setOpen((v) => !v)}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            aria-label={open ? (isBn ? 'সারসংক্ষেপ গুটিয়ে নিন' : 'Collapse summary') : (isBn ? 'সারসংক্ষেপ প্রসারিত করুন' : 'Expand summary')}
            aria-expanded={open}
            className="champagne-pill"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(255, 250, 244, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.85)',
              boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <motion.span
              animate={{ rotate: open ? 0 : 180 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'inline-flex', color: T.inkSoft }}
            >
              <ChevronDown size={14} />
            </motion.span>
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden', marginTop: 12 }}
          >
            {showCurve ? (
              <RevenueCurveChart
                currentKcal={Math.round(totals.kcal)}
                dailyTarget={targets.kcal}
                mealsLogged={itemCount}
                macros={{
                  protein: Math.round(totals.protein),
                  carbs: Math.round(totals.carbs),
                  fat: Math.round(totals.fat),
                }}
                showMacroChips={false}
                title={isBn ? 'এই খাবারের ক্যালরি প্রভাব' : 'Meal Calorie Trajectory'}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {macros.map((m) => (
                  <div
                    key={m.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isBn ? '80px 1fr 60px' : '65px 1fr 50px',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'Inter',
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: '#2C1A11',
                      }}
                    >
                      {m.label}
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 999,
                        background: 'rgba(92, 60, 46, 0.12)',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.65)',
                        boxShadow: 'inset 0 1px 2px rgba(61, 39, 29, 0.12)',
                      }}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${m.pct}%` }}
                        transition={{ type: 'spring', stiffness: 100, damping: 18 }}
                        style={{
                          height: '100%',
                          background: m.label.includes('Prot') || m.label.includes('প্রোটিন')
                            ? 'linear-gradient(90deg, #684A37 0%, #3D271D 100%)'
                            : m.label.includes('Carb') || m.label.includes('কার্বো')
                            ? 'linear-gradient(90deg, #E08238 0%, #C87428 100%)'
                            : 'linear-gradient(90deg, #3B8258 0%, #2D6A4F 100%)',
                          borderRadius: 999,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                        }}
                      />
                    </div>
                    <div
                      className="tnum"
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: '#3D271D',
                        textAlign: 'right',
                      }}
                    >
                      {isBn ? toBengaliDigits(m.value) : m.value} {isBn ? 'গ্রাম' : 'g'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </LocalizedContent>
  );
}