import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Camera, Sparkles, ScanLine, RotateCcw, X, Upload, UtensilsCrossed, History, ShoppingBag, ChevronRight, Clock } from 'lucide-react';
import { T, getGreeting, NUTRITION_DB } from '../../data';
import { useTokens } from '../../theme/useTokens';
import { getPhotoUploadHashFromBytes, getTodaySummary, getMealHistory } from '../../lib/api';
import { formatRelative, pickThumbnailStyle, toBengaliDigits } from '../../lib/format';
import RevenueCurveChart from '../../components/RevenueCurveChart';
import { MOCK_TABS } from '../../mocks/fixtures';
import type { MealEntry, TodaySummary } from '../../types/schemas';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';

type CapturePhase = 'idle' | 'camera' | 'captured';

/** Tab indices match the order in src/mocks/fixtures.ts → MOCK_TABS.
 *  Resolved by id rather than hard-coded so adding/removing a tab in
 *  `MOCK_TABS` doesn't silently break cross-tab navigation here. */
const TAB_GROCERY = (() => {
  const idx = MOCK_TABS.findIndex((t) => t.id === 'grocery');
  return idx >= 0 ? idx : 4;
})();

interface CaptureScreenProps {
  /** Called with the captured image data URL; returns false when reservation is rejected. */
  onCapture: (dataUrl: string, originalImageHash?: string) => Promise<boolean>;
  onReset?: () => void;
  captured: boolean;
  /** Optional preview URL to show after capture (e.g. from parent state). */
  previewUrl?: string | null;
  /** Optional callback to switch tabs (used by quick-action chips). */
  onNavigateTab?: (index: number) => void;
  photoUploadMessage?: string | null;
  userName?: string | null;
}

/** 40×40 thumbnail — prefers a captured photo, falls back to a deterministic
 *  gradient + emoji swatch keyed off `meal.id` so pre-existing seeded history
 *  still looks alive. The look-up is stable across renders. */
function Thumbnail({ meal, emojisByName }: { meal: MealEntry; emojisByName: Record<string, string> }) {
  const fallback = pickThumbnailStyle(meal, emojisByName);
  return (
    <div
      aria-hidden="true"
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: meal.photoUrl ? `url(${meal.photoUrl})` : undefined,
        backgroundColor: meal.photoUrl ? undefined : fallback.bg,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        boxShadow: '0 4px 10px rgba(61, 39, 29, 0.15)',
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      {!meal.photoUrl && fallback.emoji}
    </div>
  );
}

/**
 * Home / Capture screen — real camera integration.
 *
 * Flow:
 *   idle  → tap card → request camera → camera
 *   camera → tap shutter → capture frame → captured (calls onCapture)
 *   camera → tap "Use photo" button (file) → file picker → captured
 *   captured → retake → idle
 */
export default function CaptureScreen({
  onCapture,
  onReset,
  captured,
  previewUrl,
  onNavigateTab,
  photoUploadMessage,
  userName,
}: CaptureScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { foodName, language } = useLanguage();
  const isBn = language === 'bn';
  const displayName = userName?.trim() || (isBn ? 'বন্ধু' : 'Friend');
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [capturePending, setCapturePending] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [rippled, setRippled] = useState(false);
  const [pressed, setPressed] = useState(false);
  // Today summary now carries macro totals + the daily kcal target so the
  // progress bar can render without the Profile screen being open.
  const [todaySummary, setTodaySummary] = useState<TodaySummary | null>(null);
  const [recentMeals, setRecentMeals] = useState<MealEntry[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Camera lifecycle ──────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      // Prefer rear camera on mobile, fall back to any
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('camera');
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No camera found'
            : 'Camera unavailable';
      setCameraError(msg);
      // Fall back to file picker immediately
      fileInputRef.current?.click();
    }
  }, []);

  useEffect(() => {
    if (phase !== 'camera') return;

    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      if (streamRef.current !== stream) return;
      setCameraError('Camera unavailable');
      stopCamera();
      setPhase('idle');
      fileInputRef.current?.click();
    });
  }, [phase, stopCamera]);

  // Load today's summary and recent meals on mount & keep in sync with meal updates
  useEffect(() => {
    let cancelled = false;
    const refreshData = () => {
      Promise.all([getTodaySummary(), getMealHistory()]).then(([summary, history]) => {
        if (!cancelled) {
          setTodaySummary(summary);
          setTodayLoading(false);
          setRecentMeals(history.slice(0, 3));
          setHistoryLoading(false);
        }
      });
    };

    refreshData();

    const handleUpdate = () => refreshData();
    window.addEventListener('meal-history-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener('meal-history-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  // Clean up camera on unmount or reset
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // When parent resets, stop camera and return to idle
  useEffect(() => {
    if (!captured) {
      stopCamera();
      setPhase('idle');
      setAnalyzing(false);
      setAnalyzeProgress(0);
      setCameraError(null);
    }
  }, [captured, stopCamera]);

  // ── Analyze progress animation ────────────────────────────────────────

  useEffect(() => {
    if (!analyzing) {
      setAnalyzeProgress(0);
      return;
    }
    if (reduceMotion) {
      setAnalyzeProgress(100);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1600);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnalyzeProgress(eased * 100);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyzing, reduceMotion]);

  // ── Capture frame from video ──────────────────────────────────────────

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  const submitCapture = useCallback(async (dataUrl: string, originalImageHash?: string) => {
    if (capturePending) return;
    setCapturePending(true);
    setAnalyzing(true);
    try {
      const accepted = await onCapture(dataUrl, originalImageHash);
      stopCamera();
      if (accepted) {
        setPhase('captured');
      } else {
        setPhase('idle');
        setAnalyzing(false);
      }
    } finally {
      setCapturePending(false);
    }
  }, [capturePending, onCapture, stopCamera]);

  const handleShutter = useCallback(() => {
    const dataUrl = captureFrame();
    if (!dataUrl) return;

    void submitCapture(dataUrl);
  }, [captureFrame, submitCapture]);

  // ── File upload fallback ──────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      e.target.value = '';
      void file.arrayBuffer()
        .then((bytes) => getPhotoUploadHashFromBytes(bytes))
        .catch((error: unknown) => {
          console.error('Could not hash original photo bytes:', error);
          return undefined;
        })
        .then((originalImageHash) => {
          const reader = new FileReader();
          reader.onload = () => {
            const rawDataUrl = reader.result as string;
            // Optimize and downscale large camera photos client-side to ensure
            // fast transmission (~250KB payload) and sub-second upload speeds.
            const img = new Image();
            img.onload = () => {
              const maxDim = 1080;
              let width = img.width;
              let height = img.height;
              if (width > maxDim || height > maxDim) {
                if (width > height) {
                  height = Math.round((height * maxDim) / width);
                  width = maxDim;
                } else {
                  width = Math.round((width * maxDim) / height);
                  height = maxDim;
                }
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                const optimized = canvas.toDataURL('image/jpeg', 0.82);
                void submitCapture(optimized, originalImageHash);
              } else {
                void submitCapture(rawDataUrl, originalImageHash);
              }
            };
            img.onerror = () => {
              void submitCapture(rawDataUrl, originalImageHash);
            };
            img.src = rawDataUrl;
          };
          reader.onerror = () => {
            console.error('Could not read the selected photo.');
            setAnalyzing(false);
          };
          reader.readAsDataURL(file);
        });
    },
    [submitCapture],
  );

  // ── Tap to start ──────────────────────────────────────────────────────

  const handleTapCard = () => {
    if (phase !== 'idle' || captured) return;
    setPressed(true);
    setRippled(true);
    setTimeout(() => setRippled(false), 600);
    setTimeout(() => setPressed(false), 200);
    startCamera();
  };

  // ── Determine what image to show ──────────────────────────────────────

  const displayUrl = previewUrl ?? null;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <LocalizedContent>
    <div style={{ padding: '20px var(--screen-gutter, 24px) 24px' }}>
      {/* Hidden elements */}
      <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="champagne-pill"
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          marginBottom: 12,
          padding: '6px 14px',
          borderRadius: 999,
          fontFamily: 'Inter',
          fontSize: 12,
          fontWeight: 700,
          background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.82)',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
          color: isDark ? '#FAF4EC' : '#2C1A11',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {isBn ? 'শুভ দিন' : getGreeting()}, {displayName}
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 32,
          fontWeight: 700,
          color: isDark ? '#FAF4EC' : '#FFF0E2',
          margin: '8px 0 8px',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
        }}
      >
        {isBn ? 'প্রতিটি খাবারের একটি গল্প থাকে।' : 'Every bite has a story.'}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        style={{
          fontFamily: 'Inter',
          fontSize: 15,
          color: isDark ? '#D8C4B6' : 'rgba(255, 240, 226, 0.85)',
          margin: '0 0 28px',
          lineHeight: 1.4,
        }}
      >
        {isBn ? 'থালাটির ছবি তুলুন — বাকিটা আমরা দেখছি।' : "Snap your plate — we'll do the rest."}
      </motion.p>

      {photoUploadMessage && (
        <div
          role="alert"
          style={{
            margin: '0 0 16px',
            padding: '12px 14px',
            borderRadius: 14,
            background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 242, 242, 0.94)',
            border: isDark ? '1px solid rgba(252, 165, 165, 0.4)' : '1px solid rgba(220, 38, 38, 0.28)',
            color: isDark ? '#FAF4EC' : '#7F1D1D',
            fontFamily: 'Inter',
            fontSize: 13.5,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          {photoUploadMessage}
        </div>
      )}

      {/* ── Capture card ──────────────────────────────────────────── */}
      <motion.div
        className="glass-card capture-preview-card"
        style={{
          width: '100%',
          borderRadius: 24,
          aspectRatio: '4 / 3.5',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            phase === 'camera' || phase === 'captured'
              ? 'linear-gradient(160deg, #77574A, #4A3A34)'
              : T.cardBg,
          border:
            pressed || captured
              ? `2px solid ${T.primary}`
              : `2px dashed ${T.cardBorder}`,
          cursor: 'default',
          boxShadow:
            pressed || captured
              ? '0 14px 36px -14px rgba(46,37,34,0.55)'
              : '0 8px 32px rgba(46, 37, 34, 0.08)',
        }}
      >
        {/* Ripple effect on tap */}
        <AnimatePresence>
          {rippled && (
            <motion.span
              key="ripple"
              initial={{ width: 0, height: 0, opacity: 0.45 }}
              animate={{ width: 360, height: 360, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: 'absolute',
                borderRadius: '50%',
                background: T.primary,
                pointerEvents: 'none',
                zIndex: 10,
              }}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        {/* ── Phase: idle — show CTA ─────────────────────────────── */}
        {phase === 'idle' && !captured && (
          <div style={{ textAlign: 'center', position: 'relative', padding: '0 20px' }}>
            <motion.button
              type="button"
              onClick={handleTapCard}
              whileHover={!reduceMotion ? { scale: 1.005 } : {}}
              whileTap={!reduceMotion ? { scale: 0.98 } : {}}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              aria-label={isBn ? 'ক্যামেরা চালু করুন' : 'Open camera'}
              style={{
                all: 'unset',
                display: 'block',
                width: '100%',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <motion.div
                whileHover={!reduceMotion ? { scale: 1.04 } : {}}
                whileTap={!reduceMotion ? { scale: 0.92 } : {}}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: T.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                  boxShadow: '0 8px 24px rgba(46, 37, 34, 0.25)',
                }}
              >
                <Camera size={26} color="#FFFFFF" strokeWidth={2} />
              </motion.div>
              <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 18, color: isDark ? '#FAF4EC' : '#24130A' }}>
                {isBn ? 'ক্যামেরা চালু করতে চাপুন' : 'Tap to open camera'}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 14, color: isDark ? '#D8C4B6' : '#5C3A27', marginTop: 6 }}>
                {isBn ? 'থালা, উপাদান বা মেনু — যেকোনো ছবিই চলবে' : 'Plate, ingredients, or a menu — all work'}
              </div>
            </motion.button>

            {/* Upload fallback button */}
            <motion.button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              style={{
                marginTop: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 14,
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(74, 58, 52, 0.08)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(74, 58, 52, 0.18)',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 600,
                color: isDark ? '#FAF4EC' : '#2C1A11',
                cursor: 'pointer',
              }}
            >
              <Upload size={12} /> {isBn ? 'অথবা ছবি আপলোড করুন' : 'Or upload a photo'}
            </motion.button>
          </div>
        )}

        {/* ── Phase: camera — live preview + shutter ─────────────── */}
        {phase === 'camera' && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: 22,
              }}
            />

            {/* Viewfinder overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 22,
                boxShadow: 'inset 0 0 60px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />

            {/* Shutter button */}
            <motion.button
              type="button"
              disabled={capturePending}
              onClick={(e) => {
                e.stopPropagation();
                handleShutter();
              }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'ছবি তুলুন' : 'Take photo'}
              style={{
                position: 'absolute',
                bottom: 20,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: '4px solid rgba(249, 242, 228, 0.9)',
                background: 'rgba(249, 242, 228, 0.25)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                cursor: 'pointer',
                padding: 0,
                zIndex: 5,
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              }}
            >
              <motion.div
                whileTap={{ scale: 0.85 }}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
                }}
              />
            </motion.button>

            {/* Cancel / switch to upload */}
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                stopCamera();
                setPhase('idle');
              }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'ক্যামেরা বন্ধ করুন' : 'Close camera'}
              style={{
                position: 'absolute',
                top: 14,
                left: 14,
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                zIndex: 5,
              }}
            >
              <X size={16} color="#FFFFFF" strokeWidth={2} />
            </motion.button>

            {/* Upload from gallery */}
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'গ্যালারি থেকে আপলোড করুন' : 'Upload from gallery'}
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                zIndex: 5,
              }}
            >
              <Upload size={14} color="#FFFFFF" strokeWidth={2} />
            </motion.button>

            {/* Camera error fallback */}
            {cameraError && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 90,
                  left: 16,
                  right: 16,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'rgba(201, 98, 45, 0.9)',
                  color: '#FFFFFF',
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'center',
                  zIndex: 5,
                }}
              >
                {cameraError} — using file picker
              </div>
            )}
          </>
        )}

        {/* ── Phase: captured — analyzing animation ──────────────── */}
        {(phase === 'captured' || captured) && (
          <>
            {/* Background gradient */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(circle at 50% 45%, rgba(249, 242, 228, 0.22), transparent 60%)',
              }}
              aria-hidden="true"
            />

            {/* Preview image (if available) */}
            {displayUrl && (
              <motion.img
                src={displayUrl}
                alt="Captured meal"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  borderRadius: 22,
                }}
              />
            )}

            {/* Filename label */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              style={{
                position: 'absolute',
                bottom: 16,
                left: 16,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(24, 14, 10, 0.62)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: '#FAF4EC',
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                fontWeight: 600,
                zIndex: 2,
              }}
            >
              captured_photo.jpg
            </motion.div>

            {/* Progress ring */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 18, delay: 0.1 }}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(24, 14, 10, 0.5)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                zIndex: 2,
              }}
            >
              <svg width={56} height={56} style={{ transform: 'rotate(-90deg)' }}>
                <circle
                  cx={28}
                  cy={28}
                  r={24}
                  stroke="rgba(249, 242, 228, 0.25)"
                  strokeWidth={3}
                  fill="none"
                />
                <motion.circle
                  cx={28}
                  cy={28}
                  r={24}
                  stroke={T.earth6}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 24}
                  strokeDashoffset={2 * Math.PI * 24 * (1 - analyzeProgress / 100)}
                  style={{ transition: 'stroke-dashoffset 80ms linear' }}
                />
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ScanLine size={20} color={T.earth6} strokeWidth={1.8} />
              </div>
            </motion.div>

            {/* Retake button */}
            <motion.button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReset?.();
              }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'আবার ছবি তুলুন' : 'Retake photo'}
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(24, 14, 10, 0.55)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(249, 242, 228, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                zIndex: 2,
              }}
            >
              <X size={16} color="#FAF4EC" strokeWidth={2} />
            </motion.button>
          </>
        )}
      </motion.div>

      {/* ── Status / hint area ───────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {captured ? (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            role="status"
            aria-live="polite"
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'Inter',
              fontSize: 13,
              color: isDark ? '#FAF4EC' : '#FFF0E2',
              fontWeight: 600,
            }}
          >
            <motion.span
              animate={reduceMotion ? {} : { rotate: [0, 360] }}
              transition={
                reduceMotion ? {} : { duration: 2, repeat: Infinity, ease: 'linear' }
              }
              style={{ display: 'inline-flex' }}
            >
              <Sparkles size={14} color={isDark ? '#E8C49A' : '#FFD29D'} />
            </motion.span>
            <span style={{ flex: 1 }}>{isBn ? 'আপনার খাবার বিশ্লেষণ করা হচ্ছে…' : 'Analyzing your plate…'}</span>
            <motion.button
              type="button"
              onClick={onReset}
              whileHover={{ x: 1 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'পুনরায় ছবি তুলুন' : 'Retake photo'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.16)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 999,
                padding: '5px 10px',
                color: isDark ? '#FAF4EC' : '#FFF7EE',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={12} /> {isBn ? 'পুনরায় ছবি' : 'Retake'}
            </motion.button>
          </motion.div>
        ) : phase === 'camera' ? (
          <motion.div
            key="camera-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              marginTop: 16,
              fontFamily: 'Inter',
              fontSize: 12,
              color: isDark ? '#D8C4B6' : '#FFF0E2',
              textAlign: 'center',
            }}
          >
            {isBn ? 'খাবারটি ফ্রেমের মধ্যে রাখুন এবং শাটার চাপুন' : 'Line up your plate and tap the shutter'}
          </motion.div>
        ) : (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            style={{
              marginTop: 16,
              fontFamily: 'Inter',
              fontSize: 12,
              color: isDark ? '#D8C4B6' : '#FFF0E2',
              textAlign: 'center',
            }}
          >
            {isBn ? 'ক্যামেরা চালু করতে কার্ডটিতে চাপুন' : 'Tap the card to open your camera'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Quick Actions (only when idle) ─────────────────────── */}
      {phase === 'idle' && !captured && (
        <motion.div
          className="capture-quick-actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 16,
            overflowX: 'auto',
            paddingBottom: 4,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {[
            {
              icon: UtensilsCrossed,
              label: isBn ? 'খাবার যোগ' : 'Log Meal',
              color: T.primary,
              // Log Meal = primary CTA, opens camera like the capture card
              onClick: handleTapCard,
            },
            {
              icon: History,
              label: isBn ? 'সাম্প্রতিক' : 'Recent',
              color: T.accentAmber,
              // Recent = scroll-anchor to the recent-meals section. Until we
              // have a dedicated History tab, anchoring keeps the affordance
              // honest rather than faking navigation. We call onNavigateTab
              // only if a parent handler was provided (smoke testing on its
              // own).
              onClick: () => {
                const el = document.getElementById('recent-meals-section');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              },
            },
            {
              icon: ShoppingBag,
              label: isBn ? 'বাজার' : 'Grocery',
              color: T.accentGood,
              onClick: () => onNavigateTab?.(TAB_GROCERY),
            },
          ].map((a) => (
            <motion.button
              key={a.label}
              type="button"
              onClick={a.onClick}
              whileHover={{ y: -1, scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className="champagne-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 999,
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.85)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 600,
                color: isDark ? '#FAF4EC' : '#2C1A11',
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              <a.icon size={14} color={a.color} strokeWidth={2} />
              {a.label}
            </motion.button>
          ))}
        </motion.div>
      )}

      {/* ── Today's Summary Skeleton ────────────────────────── */}
      {phase === 'idle' && !captured && todayLoading && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.3 }}
          className="glass-card"
          style={{ borderRadius: 18, padding: '14px 16px', marginTop: 16 }}
        >
          <div className="skeleton" style={{ width: 90, height: 12, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 40, height: 22, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 70, height: 10 }} />
            </div>
            <div style={{ width: 1, background: T.cardBorder, alignSelf: 'stretch' }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 48, height: 22, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 80, height: 10 }} />
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Today's Revenue-Style Trajectory Chart ──────────────── */}
      {phase === 'idle' && !captured && todaySummary && (
        <div style={{ marginTop: 16 }}>
          {todaySummary.mealsLogged === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.3 }}
              className="champagne-panel"
              style={{
                borderRadius: 20,
                padding: '16px 18px',
                background: isDark
                  ? 'linear-gradient(145deg, rgba(46, 26, 17, 0.85) 0%, rgba(28, 15, 9, 0.92) 100%)'
                  : 'linear-gradient(145deg, rgba(255, 250, 244, 0.95) 0%, rgba(246, 235, 222, 0.92) 100%)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1.5px solid rgba(255, 255, 255, 0.85)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: isDark ? '#D8C4B6' : '#5C3A27', fontFamily: 'Inter', fontSize: 13, lineHeight: 1.4 }}>
                <UtensilsCrossed size={18} color={isDark ? '#E8C49A' : '#C87428'} strokeWidth={2} />
                <span>
                  {isBn ? (
                    <>আজকের কোনো খাবার এখনো যুক্ত হয়নি — ট্র্যাকিং শুরু করতে <strong style={{ color: isDark ? '#FAF4EC' : '#24130A' }}>প্রথম খাবারের ছবি তুলুন</strong>।</>
                  ) : (
                    <>No meals logged yet today — <strong style={{ color: isDark ? '#FAF4EC' : '#24130A' }}>snap your first plate</strong> to start tracking.</>
                  )}
                </span>
              </div>
            </motion.div>
          ) : (
            <RevenueCurveChart
              currentKcal={Math.round(todaySummary.totalKcal)}
              dailyTarget={todaySummary.dailyKcalTarget}
              mealsLogged={todaySummary.mealsLogged}
              macros={{
                protein: Math.round(todaySummary.totalProtein),
                carbs: Math.round(todaySummary.totalCarbs),
                fat: Math.round(todaySummary.totalFat),
              }}
              onCardClick={() => {
                const el = document.getElementById('recent-meals-section');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          )}
        </div>
      )}

      {/* ── Recent Meals Skeleton ──────────────────────────── */}
      {phase === 'idle' && !captured && historyLoading && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.35 }}
          style={{ marginTop: 18 }}
        >
          <div className="skeleton" style={{ width: 90, height: 12, marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: '10px 14px' }}>
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: `${100 - i * 15}%`, height: 14, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: 80, height: 10 }} />
                </div>
                <div className="skeleton" style={{ width: 50, height: 16, marginLeft: 8 }} />
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Recent Meals ──────────────────────────────────────── */}
      {phase === 'idle' && !captured && (
        <motion.div
          id="recent-meals-section"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.35 }}
          style={{ marginTop: 20, scrollMarginTop: 90 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 4, height: 14, borderRadius: 2, background: '#C87428' }} />
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                fontWeight: 700,
                color: isDark ? 'rgba(249, 242, 228, 0.85)' : '#FFF0E2',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {isBn ? 'সাম্প্রতিক খাবার' : 'Recent Meals'}
            </span>
          </div>

          {/* Empty state */}
          {!historyLoading && recentMeals.length === 0 && (
            <div
              className="glass-card champagne-panel"
              style={{
                borderRadius: 18,
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                color: '#684A37',
                fontFamily: 'var(--font-sans)',
                fontSize: 13.5,
                lineHeight: 1.4,
              }}
            >
              <History size={18} color="#96735B" strokeWidth={1.8} />
              <span>
                {isBn ? 'খাবার নথিভুক্ত করা হলে তা এখানে দেখা যাবে।' : 'Your last few meals will appear here once you log them.'}
              </span>
            </div>
          )}

          {recentMeals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentMeals.map((meal) => (
                <motion.div
                  key={meal.id}
                  className="glass-card champagne-panel"
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderRadius: 20,
                    padding: '10px 14px 10px 10px',
                  }}
                >
                  <Thumbnail meal={meal} emojisByName={descriptorEmojiMap} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 14,
                        fontWeight: 600,
                        color: isDark ? '#F9F2E4' : '#24130A',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {meal.items.map((item) => foodName(item.name, item.name_bn)).join(', ') || meal.label}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontFamily: 'var(--font-sans)',
                        fontSize: 11.5,
                        color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35',
                        marginTop: 3,
                      }}
                    >
                      <Clock size={12} strokeWidth={2} />
                      <span>
                        {formatRelative(meal.date, new Date(), isBn ? 'bn' : 'en')} · {isBn ? toBengaliDigits(meal.items.length) : meal.items.length} {isBn ? 'টি উপাদান' : meal.items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                  </div>

                  <div
                    className="champagne-pill"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 12px',
                      borderRadius: 20,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      className="tnum"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: isDark ? '#F9F2E4' : '#24130A',
                      }}
                    >
                      {isBn ? toBengaliDigits(Math.round(meal.totals.kcal)) : Math.round(meal.totals.kcal)}
                      <span style={{ fontSize: 10, fontWeight: 500, color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35' }}> {isBn ? 'কিলোক্যালরি' : 'kcal'}</span>
                    </span>
                    <ChevronRight size={14} color={isDark ? '#E8C49A' : '#6E4A35'} strokeWidth={2.4} />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
    </LocalizedContent>
  );
}

/** Map of food name → emoji glyph from MOCK_NUTRITION_DB. Built once at
 *  module load — cheap (4 entries today), no re-computation per render. */
const descriptorEmojiMap: Record<string, string> = Object.fromEntries(
  Object.entries(NUTRITION_DB).map(([k, v]) => [k, v.emoji]),
);
