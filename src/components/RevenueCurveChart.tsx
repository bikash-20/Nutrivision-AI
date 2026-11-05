import { useEffect, useId, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import { T } from '../data';
import { useTokens } from '../theme/useTokens';
import { useLanguage, LocalizedContent } from '../i18n/LanguageContext';
import { toBengaliDigits } from '../lib/format';

export interface Point {
  x: number;
  y: number;
  val: number;
  timeLabel: string;
  timeLabelBn: string;
  type: 'actual' | 'forecast';
}

export interface RevenueCurveChartProps {
  currentKcal: number;
  dailyTarget: number;
  mealsLogged?: number;
  subtitle?: string;
  macros?: {
    protein: number;
    carbs: number;
    fat: number;
  };
  mealHistory?: Array<{ timeStr?: string; kcal: number; name?: string }>;
  showMacroChips?: boolean;
  title?: string;
  className?: string;
  onCardClick?: () => void;
}

export function getResponsiveChartFontSize(containerWidth: number): number {
  if (containerWidth <= 0) return 11;
  const renderedFontSize = Math.min(13, Math.max(11, containerWidth * 0.018));
  return (600 / containerWidth) * renderedFontSize;
}

/**
 * Converts an array of points into a smooth Catmull-Rom cubic Bezier SVG path.
 */
export function pointsToCatmullRomBezierPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return d;
}

export default function RevenueCurveChart({
  currentKcal,
  dailyTarget,
  mealsLogged = 1,
  subtitle,
  macros = { protein: 94, carbs: 71, fat: 39 },
  showMacroChips = true,
  title,
  className,
  onCardClick,
}: RevenueCurveChartProps) {
  const { language } = useLanguage();
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const isBn = language === 'bn';
  const gradientId = useId();
  const [activeTooltip, setActiveTooltip] = useState<Point | null>(null);
  const [chartWidth, setChartWidth] = useState(600);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // SVG coordinate system
  const VIEW_WIDTH = 600;
  const VIEW_HEIGHT = 220;
  const axisFontSize = getResponsiveChartFontSize(chartWidth);
  const MARGIN_LEFT = Math.max(52, Math.ceil(axisFontSize * 2.8 + 8));
  const MARGIN_RIGHT = 24;
  const MARGIN_TOP = 36;
  const MARGIN_BOTTOM = Math.max(36, Math.ceil(axisFontSize * 2));
  const targetBadgeWidth = axisFontSize * (106 / 9.5);
  const targetBadgeHeight = axisFontSize * (20 / 9.5);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const nextWidth = Math.round(container.getBoundingClientRect().width);
      setChartWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const plotWidth = VIEW_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = VIEW_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const yBaseline = MARGIN_TOP + plotHeight;

  // Adaptive scale bounds
  const targetKcal = Math.max(1200, dailyTarget || 2000);
  const activeKcal = Math.max(0, currentKcal || 0);
  const maxY = Math.max(2500, Math.ceil(Math.max(targetKcal, activeKcal) * 1.15 / 500) * 500);

  const scaleX = (hoursFrom8: number) => MARGIN_LEFT + (Math.max(0, Math.min(15, hoursFrom8)) / 15) * plotWidth;
  const scaleY = (val: number) => yBaseline - (Math.max(0, val) / maxY) * plotHeight;

  // X-axis 5 key time ticks (08:00, 12:00, 16:00, 20:00, 23:00)
  const xTicks = [
    { hours: 0, en: '8 AM', bn: 'সকাল ৮টা' },
    { hours: 4, en: '12 PM', bn: 'দুপুর ১২টা' },
    { hours: 8, en: '4 PM', bn: 'বিকাল ৪টা' },
    { hours: 12, en: '8 PM', bn: 'রাত ৮টা' },
    { hours: 15, en: '11 PM', bn: 'রাত ১১টা' },
  ];

  // Y-axis 5 ticks (0, 500, 1000, 1500, 2000, 2500)
  const yTickStep = maxY <= 2500 ? 500 : Math.round(maxY / 5 / 100) * 100;
  const yTicks: number[] = [];
  for (let v = 0; v <= maxY; v += yTickStep) {
    yTicks.push(v);
  }

  // Construct trajectory points
  // Point 0: 08:00 AM (0 kcal)
  const p0: Point = {
    x: scaleX(0),
    y: scaleY(0),
    val: 0,
    timeLabel: '8:00 AM',
    timeLabelBn: 'সকাল ৮:০০',
    type: 'actual',
  };

  let actualPoints: Point[] = [p0];
  let forecastPoints: Point[] = [];

  if (activeKcal === 0) {
    // Zero intake state: flat actual line at 0
    actualPoints = [
      p0,
      { x: scaleX(5), y: scaleY(0), val: 0, timeLabel: '1:00 PM', timeLabelBn: 'দুপুর ১:০০', type: 'actual' },
    ];
    // Gentle forecast curve to target
    forecastPoints = [
      actualPoints[1],
      { x: scaleX(8), y: scaleY(targetKcal * 0.35), val: Math.round(targetKcal * 0.35), timeLabel: '4:00 PM', timeLabelBn: 'বিকাল ৪:০০', type: 'forecast' },
      { x: scaleX(12), y: scaleY(targetKcal * 0.85), val: Math.round(targetKcal * 0.85), timeLabel: '8:00 PM', timeLabelBn: 'রাত ৮:০০', type: 'forecast' },
      { x: scaleX(15), y: scaleY(targetKcal), val: Math.round(targetKcal), timeLabel: '11:00 PM', timeLabelBn: 'রাত ১১:০০', type: 'forecast' },
    ];
  } else {
    // Current meal intake trajectory
    // Breakfast at ~9:30 AM
    const breakfastKcal = Math.round(activeKcal * 0.35);
    const pBreakfast: Point = {
      x: scaleX(1.5),
      y: scaleY(breakfastKcal),
      val: breakfastKcal,
      timeLabel: '9:30 AM',
      timeLabelBn: 'সকাল ৯:৩০',
      type: 'actual',
    };

    // Lunch / main logged meal at ~1:00 PM
    const pLunch: Point = {
      x: scaleX(5),
      y: scaleY(activeKcal),
      val: activeKcal,
      timeLabel: '1:00 PM',
      timeLabelBn: 'দুপুর ১:০০',
      type: 'actual',
    };

    // Current time plateau at ~2:30 PM
    const pCurrent: Point = {
      x: scaleX(6.5),
      y: scaleY(activeKcal),
      val: activeKcal,
      timeLabel: '2:30 PM (Now)',
      timeLabelBn: 'দুপুর ২:৩০ (বর্তমান)',
      type: 'actual',
    };

    actualPoints = [p0, pBreakfast, pLunch, pCurrent];

    // Forecast trajectory continuing toward daily target
    const eveningSnackKcal = Math.round(activeKcal + (targetKcal - activeKcal) * 0.35);
    const dinnerKcal = Math.round(activeKcal + (targetKcal - activeKcal) * 0.90);

    forecastPoints = [
      pCurrent,
      {
        x: scaleX(9.5),
        y: scaleY(eveningSnackKcal),
        val: eveningSnackKcal,
        timeLabel: '5:30 PM',
        timeLabelBn: 'বিকাল ৫:৩০',
        type: 'forecast',
      },
      {
        x: scaleX(12.5),
        y: scaleY(dinnerKcal),
        val: dinnerKcal,
        timeLabel: '8:30 PM',
        timeLabelBn: 'রাত ৮:৩০',
        type: 'forecast',
      },
      {
        x: scaleX(15),
        y: scaleY(targetKcal),
        val: targetKcal,
        timeLabel: '11:00 PM (Target)',
        timeLabelBn: 'রাত ১১:০০ (লক্ষ্যমাত্রা)',
        type: 'forecast',
      },
    ];
  }

  const actualPath = pointsToCatmullRomBezierPath(actualPoints);
  const forecastPath = pointsToCatmullRomBezierPath(forecastPoints);

  // Area path closing down to baseline
  const lastActual = actualPoints[actualPoints.length - 1];
  const areaPath = `${actualPath} L ${lastActual.x.toFixed(1)} ${yBaseline.toFixed(1)} L ${actualPoints[0].x.toFixed(1)} ${yBaseline.toFixed(1)} Z`;

  // Target line Y coordinate
  const targetY = scaleY(targetKcal);

  // Current active milestone dot
  const currentDot = actualPoints[actualPoints.length - 1];

  // Default display title
  const displayTitle = title || (isBn ? 'দৈনিক ক্যালরি গতিপথ ও পূর্বাভাস' : 'Calorie Trajectory & Intake Forecast');

  return (
    <LocalizedContent>
      <motion.div
        layout
        onClick={onCardClick}
        className={`glass-card ${className || ''}`}
        style={{
          borderRadius: 20,
          padding: '16px 18px',
          background: isDark ? 'rgba(42, 32, 27, 0.94)' : T.cardBg,
          border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : `1px solid ${T.cardBorderSoft}`,
          boxShadow: isDark ? '0 8px 32px rgba(0, 0, 0, 0.45)' : '0 8px 30px rgba(46, 37, 34, 0.08)',
          cursor: onCardClick ? 'pointer' : 'default',
          position: 'relative',
        }}
      >
        {/* Header with Title and Executive Legend */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: isDark ? 'rgba(208, 174, 146, 0.18)' : 'rgba(201, 98, 45, 0.12)',
                color: isDark ? '#E8C49A' : T.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={16} strokeWidth={2.4} />
            </div>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontFamily: 'Inter',
                  fontSize: 14,
                  fontWeight: 700,
                  color: isDark ? '#F9F2E4' : T.ink,
                  letterSpacing: '-0.01em',
                }}
              >
                {displayTitle}
              </h3>
              <p
                style={{
                  margin: '2px 0 0',
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: 600,
                  color: isDark ? 'rgba(249, 242, 228, 0.78)' : T.inkSoft,
                }}
              >
                {subtitle
                  ? subtitle
                  : isBn
                  ? `আজ ${toBengaliDigits(mealsLogged)} বেলা গ্রহণ · বর্তমান মোট ${toBengaliDigits(activeKcal)} কিলোক্যালরি`
                  : `${mealsLogged} meal${mealsLogged !== 1 ? 's' : ''} logged · Current ${activeKcal} kcal`}
              </p>
            </div>
          </div>

          {/* High-Contrast Badges & Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 3,
                  borderRadius: 2,
                  background: isDark ? '#D0AE92' : T.primary,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: isDark ? '#F9F2E4' : T.ink }}>
                {isBn ? 'বর্তমান গ্রহণ' : 'Actual'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 12,
                  height: 0,
                  borderTop: `2px dashed ${isDark ? '#E8C49A' : T.accentAmber}`,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: isDark ? '#F9F2E4' : T.ink }}>
                {isBn ? 'পূর্বাভাস' : 'Forecast'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 12,
                  height: 0,
                  borderTop: `2px dashed #2E7D32`,
                  display: 'inline-block',
                }}
              />
              <span
                style={{
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: 700,
                  color: isDark ? '#86EFAC' : '#166534',
                  background: isDark ? 'rgba(34, 197, 94, 0.16)' : '#DCFCE7',
                  border: isDark ? '1px solid rgba(34, 197, 94, 0.35)' : 'none',
                  padding: '2px 6px',
                  borderRadius: 6,
                }}
              >
                {isBn ? `লক্ষ্য: ${toBengaliDigits(targetKcal)}` : `Target: ${targetKcal}`}
              </span>
            </div>
          </div>
        </div>

        {/* SVG Revenue-Style Chart Surface */}
        <div ref={chartContainerRef} style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              overflow: 'visible',
            }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.primary} stopOpacity={0.28} />
                <stop offset="70%" stopColor={T.primary} stopOpacity={0.06} />
                <stop offset="100%" stopColor={T.primary} stopOpacity={0.0} />
              </linearGradient>

              <filter id={`glow-${gradientId}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Subtle Gridlines & Y-Axis Numeric Labels */}
            {yTicks.map((yVal) => {
              const yPos = scaleY(yVal);
              return (
                <g key={yVal}>
                  <line
                    x1={MARGIN_LEFT}
                    y1={yPos}
                    x2={VIEW_WIDTH - MARGIN_RIGHT}
                    y2={yPos}
                    stroke={isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(74, 58, 52, 0.08)'}
                    strokeWidth={1}
                    strokeDasharray={yVal === 0 ? undefined : '3,3'}
                  />
                  <text
                    x={MARGIN_LEFT - 8}
                    y={yPos + axisFontSize * 0.38}
                    textAnchor="end"
                    fill={T.inkSoft}
                    fontSize={axisFontSize}
                    fontWeight={600}
                    fontFamily="Inter, sans-serif"
                    className="tnum"
                  >
                    {isBn ? toBengaliDigits(yVal) : yVal}
                  </text>
                </g>
              );
            })}

            {/* Target Line Across Chart */}
            <line
              x1={MARGIN_LEFT}
              y1={targetY}
              x2={VIEW_WIDTH - MARGIN_RIGHT}
              y2={targetY}
              stroke={isDark ? '#4ADE80' : '#2E7D32'}
              strokeWidth={1.8}
              strokeDasharray="5,4"
              opacity={0.85}
            />

            {/* Target Flag Badge */}
            <g transform={`translate(${VIEW_WIDTH - MARGIN_RIGHT - targetBadgeWidth}, ${targetY - targetBadgeHeight * 0.7})`}>
              <rect
                width={targetBadgeWidth}
                height={targetBadgeHeight}
                rx={targetBadgeHeight / 2}
                fill={isDark ? 'rgba(34, 197, 94, 0.20)' : '#DCFCE7'}
                stroke={isDark ? '#4ADE80' : '#166534'}
                strokeWidth={1}
              />
              <text
                x={targetBadgeWidth / 2}
                y={targetBadgeHeight * 0.68}
                textAnchor="middle"
                fill={isDark ? '#86EFAC' : '#166534'}
                fontSize={axisFontSize}
                fontWeight={700}
                fontFamily="Inter, sans-serif"
              >
                {isBn ? `🎯 লক্ষ্য: ${toBengaliDigits(targetKcal)} কিলোক্যালরি` : `🎯 Goal: ${targetKcal} kcal`}
              </text>
            </g>

            {/* Soft Flowing Area Gradient Under Actual Curve */}
            <motion.path
              d={areaPath}
              fill={`url(#${gradientId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            />

            {/* Dashed Forecast Curve */}
            <motion.path
              d={forecastPath}
              fill="none"
              stroke={T.accentAmber}
              strokeWidth={2.4}
              strokeDasharray="6,5"
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.95 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            />

            {/* Flowing Catmull-Rom Actual Curve Line (Draw-in Animation) */}
            <motion.path
              d={actualPath}
              fill="none"
              stroke={T.primary}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />

            {/* Milestone Circles for Actual Data Points */}
            {actualPoints.map((pt, i) => (
              <g
                key={i}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setActiveTooltip(pt)}
                onMouseLeave={() => setActiveTooltip(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTooltip((prev) => (prev === pt ? null : pt));
                }}
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={i === actualPoints.length - 1 ? 5.5 : 4}
                  fill={isDark ? '#2A201B' : '#FFFFFF'}
                  stroke={T.primary}
                  strokeWidth={2.5}
                />
              </g>
            ))}

            {/* Forecast Marker Circles */}
            {forecastPoints.slice(1).map((pt, i) => (
              <g
                key={`f-${i}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setActiveTooltip(pt)}
                onMouseLeave={() => setActiveTooltip(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTooltip((prev) => (prev === pt ? null : pt));
                }}
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5}
                  fill={isDark ? '#2A201B' : '#FFFFFF'}
                  stroke={T.accentAmber}
                  strokeWidth={2}
                />
              </g>
            ))}

            {/* Glowing Active Current Intake Node */}
            <g transform={`translate(${currentDot.x}, ${currentDot.y})`}>
              <motion.circle
                r={10}
                fill={T.primary}
                opacity={0.25}
                animate={{ scale: [1, 1.45, 1], opacity: [0.35, 0.05, 0.35] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <circle r={5.5} fill={isDark ? '#2A201B' : '#FFFFFF'} stroke={T.primary} strokeWidth={3} />
            </g>

            {/* X-Axis Horizontal Base Line */}
            <line
              x1={MARGIN_LEFT}
              y1={yBaseline}
              x2={VIEW_WIDTH - MARGIN_RIGHT}
              y2={yBaseline}
              stroke={isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(74, 58, 52, 0.18)'}
              strokeWidth={1.5}
            />

            {/* X-Axis Time Ticks */}
            {xTicks.map((tick) => {
              const xPos = scaleX(tick.hours);
              return (
                <g key={tick.hours}>
                  <line
                    x1={xPos}
                    y1={yBaseline}
                    x2={xPos}
                    y2={yBaseline + 5}
                    stroke={isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(74, 58, 52, 0.25)'}
                    strokeWidth={1.2}
                  />
                  <text
                    x={xPos}
                    y={yBaseline + axisFontSize * 1.5}
                    textAnchor={tick.hours === 0 ? 'start' : tick.hours === 15 ? 'end' : 'middle'}
                    fill={T.ink}
                    fontSize={axisFontSize}
                    fontWeight={600}
                    fontFamily="Inter, sans-serif"
                  >
                    {isBn ? tick.bn : tick.en}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Interactive Floating Tooltip */}
          <AnimatePresence>
            {activeTooltip && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: 'absolute',
                  left: `${(activeTooltip.x / VIEW_WIDTH) * 100}%`,
                  top: `${(activeTooltip.y / VIEW_HEIGHT) * 100}%`,
                  transform: 'translate(-50%, -125%)',
                  background: 'rgba(46, 37, 34, 0.94)',
                  color: '#FFFFFF',
                  padding: '6px 10px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontFamily: 'Inter',
                  fontWeight: 600,
                  pointerEvents: 'none',
                  zIndex: 20,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 14px rgba(46, 37, 34, 0.35)',
                }}
              >
                <div>{isBn ? activeTooltip.timeLabelBn : activeTooltip.timeLabel}</div>
                <div style={{ color: activeTooltip.type === 'actual' ? '#FDBA74' : '#FDE68A', fontWeight: 700 }}>
                  {isBn ? toBengaliDigits(activeTooltip.val) : activeTooltip.val} {isBn ? 'কিলোক্যালরি' : 'kcal'}
                  {activeTooltip.type === 'forecast' && (isBn ? ' (পূর্বাভাস)' : ' (Forecast)')}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Stat Chips for Macros (Protein, Carbs, Fat) */}
        {showMacroChips && macros && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid rgba(74, 58, 52, 0.08)',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            {/* Protein Chip */}
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(249, 242, 228, 0.65)',
                border: `1px solid ${T.cardBorderSoft}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.ink }}>
                  {isBn ? 'প্রোটিন' : 'Protein'}
                </span>
                <span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: T.primary }}>
                  {isBn ? `${toBengaliDigits(macros.protein)} গ্রাম` : `${macros.protein}g`}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(74, 58, 52, 0.1)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.round((macros.protein / 90) * 100))}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  style={{ height: '100%', background: T.primary, borderRadius: 2 }}
                />
              </div>
            </div>

            {/* Carbs Chip */}
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(249, 242, 228, 0.65)',
                border: `1px solid ${T.cardBorderSoft}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.ink }}>
                  {isBn ? 'কার্বস' : 'Carbs'}
                </span>
                <span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: T.accentAmber }}>
                  {isBn ? `${toBengaliDigits(macros.carbs)} গ্রাম` : `${macros.carbs}g`}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(74, 58, 52, 0.1)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.round((macros.carbs / 220) * 100))}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                  style={{ height: '100%', background: T.accentAmber, borderRadius: 2 }}
                />
              </div>
            </div>

            {/* Fat Chip */}
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(249, 242, 228, 0.65)',
                border: `1px solid ${T.cardBorderSoft}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.ink }}>
                  {isBn ? 'চর্বি' : 'Fat'}
                </span>
                <span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: isDark ? '#86EFAC' : '#166534' }}>
                  {isBn ? `${toBengaliDigits(macros.fat)} গ্রাম` : `${macros.fat}g`}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(74, 58, 52, 0.1)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.round((macros.fat / 65) * 100))}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                  style={{ height: '100%', background: isDark ? '#4ADE80' : '#2E7D32', borderRadius: 2 }}
                />
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </LocalizedContent>
  );
}
