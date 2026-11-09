import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Check, Flame, Minus, Plus, Trash2, Edit3, ChevronDown, ShoppingBag, Loader2,
} from 'lucide-react';
import { T, NUTRITION_DB, CATEGORY_TILES } from '../data';
import { getEffectiveNutrition } from '../lib/personalize';
import { triggerHaptic } from '../lib/haptics';
import type { DetectedItem } from '../types/schemas';
import Chip from './Chip';
import AddCustomModal from './AddCustomModal';
import { LocalizedContent, useLanguage } from '../i18n/LanguageContext';
import { toBengaliDigits } from '../lib/format';

interface ItemMeta {
  protein: number; carbs: number; fat: number; kcal: number;
  fiber: number; sodium: number; sugar: number; glycemic: number;
  emoji: string; category: string;
  alternatives: string[]; pairings: string[];
}

function itemNutrition(item: DetectedItem): ItemMeta | null {
  const n = getEffectiveNutrition(item.name);
  const factor = item.grams / 100;
  const desc = NUTRITION_DB[item.name];
  return {
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    kcal: n.kcal * factor,
    fiber: n.fiber * factor,
    sodium: n.sodium * factor,
    sugar: n.sugar * factor,
    glycemic: n.glycemic ?? 0.3,
    emoji: desc?.emoji ?? '🍽️',
    category: desc?.category ?? 'other',
    alternatives: desc?.alternatives ?? [],
    pairings: desc?.pairings ?? [],
  };
}

function confidenceBadge(conf: number) {
  if (conf >= 80) return { tier: 'high' as const, label: `${conf}%`, dot: '🟢' };
  if (conf >= 60) return { tier: 'medium' as const, label: `${conf}%`, dot: '🟡' };
  return { tier: 'low' as const, label: `${conf}%`, dot: '🔴' };
}

const LONG_PRESS_MS = 450;
const SWIPE_THRESHOLD = 80;

interface ExpandableRowProps {
  item: DetectedItem;
  isConfirmed?: boolean;
  isSelected?: boolean;
  multiSelect?: boolean;
  editMode?: boolean;
  onConfirm?: (name: string) => void;
  onRemove?: (name: string) => void;
  onGramsChange?: (name: string, delta: number, absolute?: boolean) => void;
  onLongPress?: (name: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  onReplace?: (oldName: string, newName: string) => void;
  onAddPairing?: (name: string, pairing: string) => void;
  onToggleGrocery?: (name: string) => Promise<void | boolean> | void;
  isItemInGrocery?: boolean;
  glycemic?: number;
  maxProtein?: number;
  maxCarbs?: number;
  maxFat?: number;
}

/**
 * Expandable, swipeable, long-pressable row.
 */
export default function ExpandableRow({
  item,
  isConfirmed,
  isSelected,
  multiSelect,
  editMode,
  onConfirm,
  onRemove,
  onGramsChange,
  onLongPress,
  onRename,
  onReplace,
  onAddPairing,
  onToggleGrocery,
  isItemInGrocery,
  glycemic,
  maxProtein,
  maxCarbs,
  maxFat,
}: ExpandableRowProps) {
  const reduceMotion = useReducedMotion();
  const { foodName, language } = useLanguage();
  const isBn = language === 'bn';
  const displayName = foodName(item.name, item.name_bn);
  const [expanded, setExpanded] = useState(false);
  const [sliderOpen, setSliderOpen] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const [pulseHalo, setPulseHalo] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [isTogglingGrocery, setIsTogglingGrocery] = useState(false);
  const longPressTimerRef = useRef<number>(0);

  const openRename = () => setRenameOpen(true);
  const closeRename = () => setRenameOpen(false);
  const submitRename = (newName: string) => {
    if (newName && newName !== item.name) {
      onRename?.(item.name, newName);
    }
    setRenameOpen(false);
  };

  const meta = itemNutrition(item);
  const badge = confidenceBadge(item.confidence);

  useEffect(() => {
    if (isConfirmed) {
      setPulseHalo(true);
      const t = setTimeout(() => setPulseHalo(false), 800);
      return () => clearTimeout(t);
    }
  }, [isConfirmed, item.confidence]);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [role="slider"]')) return;
    longPressTimerRef.current = window.setTimeout(() => {
      onLongPress?.(item.name);
    }, LONG_PRESS_MS);
  };
  const onPointerUpLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = 0;
    }
  };

  const onClickRipple = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRipple({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setTimeout(() => setRipple(null), 650);
  };

  const tileStyle = meta
    ? { background: (CATEGORY_TILES as Record<string, string>)[meta.category] || CATEGORY_TILES.other }
    : { background: CATEGORY_TILES.other };

  const [draftName, setDraftName] = useState(item.name);
  useEffect(() => setDraftName(item.name), [item.name]);

  return (
    <LocalizedContent>
    <motion.div
      layout
      drag={multiSelect ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.15}
      onDragEnd={(_, info) => {
        if (multiSelect) return;
        if (info.offset.x < -SWIPE_THRESHOLD) {
          onRemove?.(item.name);
        } else if (
          info.offset.x > SWIPE_THRESHOLD &&
          badge.tier === 'low' &&
          !isConfirmed
        ) {
          onConfirm?.(item.name);
        }
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -200, transition: { duration: 0.2 } }}
      whileHover={!reduceMotion ? { y: -1 } : {}}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUpLeave}
      onPointerLeave={onPointerUpLeave}
      className={`champagne-panel ${pulseHalo ? 'halo-pulse' : ''}`}
      style={{
        position: 'relative',
        borderRadius: 20,
        border: isSelected
          ? '1.5px solid #C87428'
          : undefined,
        overflow: 'hidden',
        touchAction: 'pan-y',
        cursor: 'pointer',
        marginBottom: 10,
      }}
    >
      <div className="swipe-bg left"><Trash2 size={16} /></div>
      <div className="swipe-bg right"><Check size={16} /></div>

      <motion.div
        layout="position"
        onClick={(e) => {
          onClickRipple(e);
          if (!multiSelect) setExpanded((v) => !v);
        }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          background: 'transparent',
        }}
      >
        <motion.div
          className={`food-tile ${meta?.category || 'other'} ${isSelected ? 'selected' : ''}`}
          style={tileStyle}
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          <span aria-hidden="true">{meta?.emoji || '🍽️'}</span>
          {ripple && (
            <span
              className="ripple"
              style={{ left: ripple.x, top: ripple.y }}
            />
          )}
        </motion.div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editMode ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => onRename?.(item.name, draftName)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRename?.(item.name, draftName);
                }
                if (e.key === 'Escape') {
                  setDraftName(item.name);
                  onRename?.(item.name, item.name);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Rename ${displayName}`}
              style={{
                width: '100%',
                fontFamily: 'Inter',
                fontSize: 15,
                fontWeight: 600,
                color: T.ink,
                background: T.cardBg,
                border: `1px solid ${T.primary}`,
                borderRadius: 8,
                padding: '4px 8px',
                outline: 'none',
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontFamily: 'Inter',
                  fontSize: 15,
                  fontWeight: 600,
                  color: T.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {displayName}
              </span>
              {meta && (
                <span className="kcal-chip" aria-label={isBn ? `${toBengaliDigits(Math.round(meta.kcal))} ক্যালরি` : `${Math.round(meta.kcal)} calories`}>
                  <Flame size={10} /> {isBn ? toBengaliDigits(Math.round(meta.kcal)) : Math.round(meta.kcal)}
                </span>
              )}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              fontFamily: 'Inter',
              fontSize: 12,
              color: T.inkSoft,
            }}
          >
            <span className="tnum">~{isBn ? toBengaliDigits(item.grams) : item.grams} {isBn ? 'গ্রাম' : 'g'}</span>
            {glycemic !== undefined && (glycemic > 0.5 || glycemic < 0.1) && (
              <span
                className="gi-chip"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 6px',
                  borderRadius: 999,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  background: glycemic > 0.5 ? 'rgba(201, 98, 45, 0.16)' : 'rgba(122, 140, 79, 0.18)',
                  color: glycemic > 0.5 ? '#A14B22' : '#4F6630',
                  border: glycemic > 0.5
                    ? '1px solid rgba(201, 98, 45, 0.40)'
                    : '1px solid rgba(122, 140, 79, 0.45)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                title={glycemic > 0.5
                  ? (isBn ? 'উচ্চ গ্লাইসেমিক প্রভাব' : 'High glycemic impact')
                  : (isBn ? 'কম গ্লাইসেমিক প্রভাব' : 'Low glycemic impact')}
              >
                {glycemic > 0.5 ? (isBn ? '↑ উচ্চ গ্লাইসেমিক' : '↑ high-GI') : (isBn ? '↓ কম গ্লাইসেমিক' : '↓ low-GI')}
              </span>
            )}
            {badge.tier === 'low' && (
              <span style={{ color: T.accentWarn, fontWeight: 600 }}>
                {isBn ? 'নিশ্চিত করতে চাপুন' : 'Tap to confirm'}
              </span>
            )}
            {isConfirmed && (
              <span style={{ color: T.accentGood, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Check size={11} strokeWidth={3} /> {isBn ? 'নিশ্চিত করা হয়েছে' : 'Confirmed'}
              </span>
            )}
          </div>

          {badge.tier !== 'high' && (
            <div className="conf-meter" style={{ marginTop: 6 }}>
              <motion.span
                initial={{ width: 0 }}
                animate={{ width: `${item.confidence}%` }}
                transition={{ type: 'spring', stiffness: 80, damping: 18 }}
              />
            </div>
          )}
        </div>

        <motion.span
          className={`conf-badge ${badge.tier}`}
          onClick={(e) => {
            e.stopPropagation();
            if (badge.tier === 'low' && !isConfirmed) onConfirm?.(item.name);
          }}
          whileTap={{ scale: 0.92 }}
          style={{ cursor: badge.tier === 'low' && !isConfirmed ? 'pointer' : 'default' }}
        >
          <span aria-hidden="true">{badge.dot}</span>
          {isBn ? `${toBengaliDigits(item.confidence)}%` : badge.label}
        </motion.span>

        {!editMode && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{
              display: 'inline-flex',
              color: T.inkSoft,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <ChevronDown size={14} />
          </motion.span>
        )}
      </motion.div>

      <AnimatePresence initial={false}>
        {expanded && !editMode && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '0 14px 14px',
                borderTop: '1px solid rgba(74, 58, 52, 0.10)',
              }}
            >
              {meta && (
                <div style={{ marginTop: 12, marginBottom: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontFamily: 'Inter',
                      fontSize: 11,
                      color: T.inkSoft,
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                    }}
                  >
                    <span>{isBn ? 'প্রধান পুষ্টি' : 'Macros'}</span>
                    <span className="tnum">{isBn ? toBengaliDigits(Math.round(meta.kcal)) : Math.round(meta.kcal)} {isBn ? 'কিলোক্যালরি' : 'kcal'}</span>
                  </div>
                  {[
                    { label: isBn ? 'প্রোটিন' : 'Protein', value: meta.protein, color: T.primary, max: maxProtein ?? 50 },
                    { label: isBn ? 'কার্বোহাইড্রেট' : 'Carbs',   value: meta.carbs,   color: T.accentAmber, max: maxCarbs ?? 80 },
                    { label: isBn ? 'চর্বি' : 'Fat',     value: meta.fat,     color: T.accentGood, max: maxFat ?? 65 },
                  ].map((m) => (
                    <div
                      key={m.label}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isBn ? '75px 1fr 54px' : '60px 1fr 50px',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Inter',
                          fontSize: 11,
                          color: T.ink,
                          fontWeight: 500,
                        }}
                      >
                        {m.label}
                      </span>
                      <div
                        style={{
                          height: 5,
                          borderRadius: 3,
                          background: 'rgba(74, 58, 52, 0.10)',
                          overflow: 'hidden',
                        }}
                      >
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, (m.value / m.max) * 100)}%` }}
                          transition={{ type: 'spring', stiffness: 100, damping: 18 }}
                          style={{
                            height: '100%',
                            background: m.color,
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <span
                        className="tnum"
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          color: T.ink,
                          textAlign: 'right',
                        }}
                      >
                        {isBn ? toBengaliDigits(Math.round(m.value)) : Math.round(m.value)} {isBn ? 'গ্রাম' : 'g'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: 'Inter',
                    fontSize: 11,
                    color: T.inkSoft,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {isBn ? 'পরিমাণ' : 'Portion'}
                </span>

                <motion.button
                  type="button"
                  onClick={() => onGramsChange?.(item.name, -25)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  aria-label={isBn ? `${displayName} ২৫ গ্রাম কমান` : `Decrease ${displayName} by 25g`}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: '1px solid rgba(74, 58, 52, 0.18)',
                    background: T.cardBg,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <Minus size={13} color={T.ink} strokeWidth={2.2} />
                </motion.button>

                <motion.button
                  type="button"
                  onClick={() => onGramsChange?.(item.name, 25)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    longPressTimerRef.current = window.setTimeout(() => {
                      setSliderOpen(true);
                    }, LONG_PRESS_MS);
                  }}
                  onPointerUp={() => clearTimeout(longPressTimerRef.current)}
                  onPointerLeave={() => clearTimeout(longPressTimerRef.current)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  aria-label={isBn ? `${displayName} ২৫ গ্রাম বাড়ান` : `Increase ${displayName} by 25g. Long-press for slider editor.`}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: 'none',
                    background: T.primary,
                    color: '#FFFFFF',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: `0 4px 10px -3px ${T.primary}55`,
                  }}
                >
                  <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
                </motion.button>

                <span
                  className="tnum"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    fontWeight: 700,
                    color: T.ink,
                    minWidth: 50,
                    textAlign: 'right',
                  }}
                >
                  {isBn ? toBengaliDigits(item.grams) : item.grams} {isBn ? 'গ্রাম' : 'g'}
                </span>
              </div>

              <AnimatePresence>
                {sliderOpen && (
                  <motion.div
                    key="slider"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      marginBottom: 12,
                      padding: 10,
                      borderRadius: 12,
                      background: T.cardBg,
                      border: `1px solid ${T.primary}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontFamily: 'Inter',
                        fontSize: 11,
                        color: T.inkSoft,
                        marginBottom: 6,
                      }}
                    >
                      <span>{isBn ? 'পরিমাণ সমন্বয়' : 'Portion editor'}</span>
                      <button
                        type="button"
                        onClick={() => setSliderOpen(false)}
                        aria-label={isBn ? 'সম্পন্ন করুন' : 'Close portion editor'}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: T.primary,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isBn ? 'সম্পন্ন' : 'Done'}
                      </button>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={800}
                      step={5}
                      value={item.grams}
                      onChange={(e) => onGramsChange?.(item.name, Number(e.target.value) - item.grams, true)}
                      aria-label={isBn ? `${displayName}-এর জন্য গ্রাম হিসেবে পরিমাণ` : `Portion size in grams for ${displayName}`}
                      style={{ width: '100%', accentColor: T.primary }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {badge.tier === 'low' && meta && (meta.alternatives?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontFamily: 'Inter',
                      fontSize: 11,
                      color: T.inkSoft,
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {isBn ? 'আপনি কি এটি বোঝাতে চেয়েছেন?' : 'Did you mean?'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(meta.alternatives ?? []).map((alt, idx) => {
                      const altMeta = NUTRITION_DB[alt] || { emoji: '🍽️', category: 'other', kcal: 100, protein: 5, carbs: 10, fat: 3 };
                      // Stable confidence: offset varies by index, not random
                      const altConf = Math.max(60, Math.min(95, item.confidence + 8 + idx * 5));
                      return (
                        <Chip
                          key={alt}
                          label={`${altMeta.emoji} ${foodName(alt)} · ${isBn ? toBengaliDigits(altConf) : altConf}%`}
                          size="sm"
                          onClick={() => onReplace?.(item.name, alt)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {meta && (meta.pairings?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontFamily: 'Inter',
                      fontSize: 11,
                      color: T.inkSoft,
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {isBn ? 'এর সাথে সাধারণত যা খাওয়া হয়…' : 'You usually eat this with…'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(meta.pairings ?? []).map((p) => (
                      <Chip
                        key={p}
                        label={`+ ${foodName(p)}`}
                        size="sm"
                        onClick={() => onAddPairing?.(item.name, p)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <motion.button
                  type="button"
                  onClick={() => onRemove?.(item.name)}
                  whileHover={{ x: 1, scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  aria-label={isBn ? `${displayName} মুছে ফেলুন` : `Remove ${displayName}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    borderRadius: 10,
                    background: 'rgba(201, 98, 45, 0.12)',
                    border: '1px solid rgba(201, 98, 45, 0.30)',
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.accentWarn,
                    cursor: 'pointer',
                    minHeight: 32,
                  }}
                >
                  <Trash2 size={11} /> {isBn ? 'মুছে ফেলুন' : 'Remove'}
                </motion.button>

                {onToggleGrocery && (
                  <motion.button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setIsTogglingGrocery(true);
                      triggerHaptic('light');
                      try {
                        await onToggleGrocery(item.name);
                        triggerHaptic('success');
                      } finally {
                        setIsTogglingGrocery(false);
                      }
                    }}
                    disabled={isTogglingGrocery}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    aria-label={
                      isItemInGrocery
                        ? (isBn ? `${displayName} ইতিমধ্যে বাজারে আছে` : `${displayName} is in Grocery`)
                        : (isBn ? `${displayName} বাজারে যোগ করুন` : `Add ${displayName} to Grocery`)
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: isItemInGrocery ? 'rgba(46, 125, 50, 0.12)' : 'rgba(74, 58, 52, 0.07)',
                      border: isItemInGrocery ? '1px solid rgba(46, 125, 50, 0.35)' : '1px solid rgba(74, 58, 52, 0.16)',
                      fontFamily: 'Inter',
                      fontSize: 11,
                      fontWeight: 600,
                      color: isItemInGrocery ? '#2E7D32' : T.ink,
                      cursor: isTogglingGrocery ? 'wait' : 'pointer',
                      minHeight: 32,
                    }}
                  >
                    {isTogglingGrocery ? (
                      <>
                        <Loader2 size={11} className="animate-spin" />
                        <span>{isBn ? 'যোগ হচ্ছে...' : 'Adding...'}</span>
                      </>
                    ) : isItemInGrocery ? (
                      <>
                        <Check size={11} strokeWidth={2.5} />
                        <span>{isBn ? 'বাজারে আছে' : 'In Grocery'}</span>
                      </>
                    ) : (
                      <>
                        <ShoppingBag size={11} color={T.primary} />
                        <span>{isBn ? 'বাজারে যোগ' : 'Add to Grocery'}</span>
                      </>
                    )}
                  </motion.button>
                )}

                {badge.tier === 'low' && !isConfirmed && (
                  <motion.button
                    type="button"
                    onClick={() => onConfirm?.(item.name)}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    aria-label={isBn ? `${displayName} নিশ্চিত করুন` : `Confirm ${displayName}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: T.accentGood,
                      border: 'none',
                      fontFamily: 'Inter',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      minHeight: 32,
                      boxShadow: `0 4px 10px -3px ${T.accentGood}66`,
                    }}
                  >
                    <Check size={11} strokeWidth={3} /> {isBn ? 'নিশ্চিত করুন' : 'Confirm'}
                  </motion.button>
                )}

                {editMode && (
                  <motion.button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRename();
                    }}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    aria-label={isBn ? `${displayName}-এর নাম পরিবর্তন করুন` : `Rename ${displayName}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: 'transparent',
                      border: '1px solid rgba(74, 58, 52, 0.18)',
                      fontFamily: 'Inter',
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.ink,
                      cursor: 'pointer',
                      minHeight: 32,
                    }}
                  >
                    <Edit3 size={11} /> {isBn ? 'নাম পরিবর্তন' : 'Rename'}
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AddCustomModal
        mode="rename"
        open={renameOpen}
        onClose={closeRename}
        onSubmit={submitRename}
        defaultName={item.name}
        defaultGrams={item.grams}
      />
    </motion.div>
    </LocalizedContent>
  );
}