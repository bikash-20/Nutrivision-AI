import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Leaf, Settings, Users } from 'lucide-react';
import { T, TABS } from './data';
import {
  getProfile,
  saveMeal,
  updateLatestMeal,
  analyzeMeal,
  resolveNutrition,
  reservePhotoUpload,
  getPhotoUploadHash,
  logoutRoomsRemote,
  ApiError,
} from './lib/api';
import { analyzeImageLocally, LocalAIError } from './lib/localAI';
import { analyzeCapturedPhoto } from './lib/photoAnalysis';
import { getEffectiveNutrition } from './lib/personalize';
import { getSession, logout } from './lib/auth';
import { ThemeProvider } from './theme/ThemeContext';
import { useTokens } from './theme/useTokens';
import type { AuthSession, DetectedItem, PipelineTrace, UserProfile } from './types/schemas';
import PhoneFrame from './components/PhoneFrame';
import BottomNav from './components/BottomNav';
import CaptureScreen from './components/screens/CaptureScreen';
import ResultsScreen from './components/screens/ResultsScreen';
import NutrientsScreen from './components/screens/NutrientsScreen';
import ProfileScreen from './components/screens/ProfileScreen';
import GroceryScreen from './components/screens/GroceryScreen';
import CoachScreen from './components/screens/CoachScreen';
import SettingsScreen from './components/screens/SettingsScreen';
import RoomScreen from './components/screens/RoomScreen';
import {
  clearAllRoomSessionsFromStorage,
  loadRoomSession,
  wasPageReloaded,
} from './lib/roomSession';
import PwaInstallBanner from './components/PwaInstallBanner';
import LoginScreen from './components/auth/LoginScreen';
import AdminLayout from './components/admin/AdminLayout';
import AdminOverview from './components/admin/AdminOverview';
import LanguageToggle from './i18n/LanguageToggle';
import { LanguageProvider, LocalizedContent, useLanguage } from './i18n/LanguageContext';

export default function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </LanguageProvider>
  );
}

/**
 * Auth-gated shell, lifted out of the default export so the ThemeProvider
 * can stay at the top of the tree.
 */
function AppShell() {
  useTokens();
  const [session, setSession] = useState<AuthSession | null>(null);
  // Tracks whether we've finished reading localStorage so we don't flash
  // the login screen on every page reload while restoring a session.
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    setSession(getSession());
    setAuthReady(true);

    const handleAuthChanged = (e: Event) => {
      const customEvent = e as CustomEvent<AuthSession | null>;
      setSession(customEvent.detail ?? null);
    };

    window.addEventListener('auth-changed', handleAuthChanged);
    return () => {
      window.removeEventListener('auth-changed', handleAuthChanged);
    };
  }, []);

  // While restoring, render a quiet placeholder so the page doesn't flash
  // a login screen to someone who is actually signed in.
  if (!authReady) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: T.cardBg,
          fontFamily: 'Inter',
        }}
      />
    );
  }

  if (!session) {
    return <LoginScreen onSignedIn={setSession} />;
  }

  if (session.role === 'admin') {
    return (
      <>
        <PwaInstallBanner />
        <AdminLayout session={session}>
          <AdminOverview session={session} />
        </AdminLayout>
      </>
    );
  }

  return (
    <UserApp
      key={session.email}
      session={session}
      onSignOut={() => {
        void logoutRoomsRemote(session.email);
        logout();
        setSession(null);
      }}
    />
  );
}

/**
 * Existing user-facing PWA, lifted out of the default export so the auth
 * gate above can stay readable. Same tabs, same screens, same phone-frame
 * styling — just wrapped in a typed component now.
 */
function UserApp({ session, onSignOut }: { session: AuthSession; onSignOut: () => void }) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language, translate } = useLanguage();
  const [tab, setTab] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(() => {
    if (wasPageReloaded()) {
      clearAllRoomSessionsFromStorage();
      return null;
    }
    return loadRoomSession(session.email)?.roomCode ?? null;
  });
  const [direction, setDirection] = useState(1);
  const [captured, setCaptured] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedItem[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [pipeline, setPipeline] = useState<PipelineTrace[]>([]);
  const [pipelineToast, setPipelineToast] = useState<string | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [photoUploadMessage, setPhotoUploadMessage] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<import('./types/schemas').AnalyzeResult | null>(null);
  const resultsNavigationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();

  const clearResultsNavigationTimeout = () => {
    if (resultsNavigationTimeout.current !== null) {
      clearTimeout(resultsNavigationTimeout.current);
      resultsNavigationTimeout.current = null;
    }
    setPipelineToast(null);
  };

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setProfileLoadFailed(false);
    getProfile().then((p) => {
      if (!cancelled) setProfile(p);
    }).catch((error: unknown) => {
      console.error('Profile load failed:', error);
      if (!cancelled) setProfileLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.email, profileRetry]);

  const goToTab = (next: number) => {
    clearResultsNavigationTimeout();
    setSettingsOpen(false);
    setRoomOpen(false);
    if (next === tab) return;
    setDirection(next > tab ? 1 : -1);
    setTab(next);
  };

  const handleCapture = async (imageDataUrl: string, originalImageHash?: string): Promise<boolean> => {
    const uploadId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setPhotoUploadMessage(null);
    let imageHash: string;
    try {
      imageHash = await getPhotoUploadHash(imageDataUrl);
      await reservePhotoUpload(uploadId, imageHash);
    } catch (error) {
      console.error('Photo upload reservation failed:', error);
      setPhotoUploadMessage(
        error instanceof ApiError
          ? error.message
          : translate('Could not verify your photo upload limit. Please try again.')
      );
      return false;
    }

    void processCapture(imageDataUrl, uploadId, imageHash, originalImageHash);
    return true;
  };

  const processCapture = async (
    imageDataUrl: string,
    uploadId: string,
    imageHash: string,
    originalImageHash?: string,
  ) => {
    clearResultsNavigationTimeout();
    setCaptured(true);
    setAnalysisMessage(null);
    setAnalysisResult(null);
    setCapturedImage(imageDataUrl);
    setDirection(1);
    setPipelineToast(translate('Analyzing photo…'));

    let next: DetectedItem[] = [];
    let trace: PipelineTrace[] = [];
    try {
      const outcome = await analyzeCapturedPhoto(
        {
          imageDataUrl,
          originalImageHash,
          uploadId,
          imageHash,
          profile: profile ?? undefined,
          localOnly: session.localOnly === true,
          online: typeof navigator === 'undefined' || navigator.onLine,
        },
        analyzeImageLocally,
        analyzeMeal,
      );
      const { result } = outcome;
      if (outcome.method === 'precomputed_reference') {
        const referenceLabel = result.pipeline.find((entry) => entry.stage === 'vision-id')?.label;
        setPipelineToast(translate(referenceLabel ?? 'Using a precomputed image reference.'));
      } else if (outcome.method === 'on_device') {
        setPipelineToast(translate(`Analyzed on-device with ${outcome.model}`));
      }
      setAnalysisResult(result);
      next = result.detected;
      trace = result.pipeline;
      if (result.is_food === false) {
        setAnalysisMessage(
          result.rejection_reason_bn || result.rejection_reason_en || translate('No food was detected. Try a clearer photo.')
        );
      } else if (next.length === 0) {
        setAnalysisMessage(translate('No food was detected. Try a clearer photo.'));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Meal analysis failed:', err);
      setAnalysisMessage(
        err instanceof LocalAIError
          ? err.message
          : translate('Could not analyze this photo. Check your connection and provider setup.')
      );
      setPipelineToast(translate('Analysis unavailable — no sample results shown.'));
    }
    setDetected(next);
    setPipeline(trace);

    let resolvedFactsMap: Record<string, import('./types/schemas').NutritionFacts> = {};
    if (next.length > 0) {
      try {
        const res = await resolveNutrition(next, profile ?? undefined);
        for (const item of res.resolved) {
          if (item.nutrition) {
            resolvedFactsMap[item.name.toLowerCase().trim()] = item.nutrition;
          }
        }
      } catch {
        // Fall back to local estimation
      }
    }

    const totals = next.reduce(
      (acc, it) => {
        const n = getEffectiveNutrition(it.name, resolvedFactsMap[it.name.toLowerCase().trim()]);
        const factor = it.grams / 100;
        return {
          kcal: acc.kcal + n.kcal * factor,
          protein: acc.protein + n.protein * factor,
          carbs: acc.carbs + n.carbs * factor,
          fat: acc.fat + n.fat * factor,
          fiber: acc.fiber + n.fiber * factor,
          sodium: acc.sodium + n.sodium * factor,
          sugar: acc.sugar + n.sugar * factor,
        };
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 },
    );
    const label = next.map((i) => i.name).join(', ') || 'Meal';
    if (next.length > 0) {
      void saveMeal({
        label,
        items: next,
        totals,
        photoUrl: imageDataUrl ?? null,
        activeGoals: profile?.goals ?? { diabetic: false, protein: false, budget: false, mediter: false },
      });
    }

    setCaptured(false);
    resultsNavigationTimeout.current = setTimeout(() => {
      resultsNavigationTimeout.current = null;
      setPipelineToast(null);
      goToTab(1);
    }, 1400);
  };

  const handleRetake = () => {
    clearResultsNavigationTimeout();
    setCaptured(false);
    setCapturedImage(null);
    setDetected([]);
    setPipeline([]);
    setAnalysisMessage(null);
    setAnalysisResult(null);
  };

  useEffect(() => {
    const handleBeforeUnload = () => {
      clearAllRoomSessionsFromStorage();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (resultsNavigationTimeout.current !== null) {
        clearTimeout(resultsNavigationTimeout.current);
      }
    };
  }, []);

  const handleDetectedChange = (newItems: DetectedItem[]) => {
    setDetected(newItems);
    const totals = newItems.reduce(
      (acc, it) => {
        const n = getEffectiveNutrition(it.name);
        const factor = it.grams / 100;
        return {
          kcal: acc.kcal + n.kcal * factor,
          protein: acc.protein + n.protein * factor,
          carbs: acc.carbs + n.carbs * factor,
          fat: acc.fat + n.fat * factor,
          fiber: acc.fiber + n.fiber * factor,
          sodium: acc.sodium + n.sodium * factor,
          sugar: acc.sugar + n.sugar * factor,
        };
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 },
    );
    void updateLatestMeal({
      label: newItems.map((i) => i.name).join(', ') || 'Meal',
      items: newItems,
      totals,
    });
  };

  if (!profile) {
    return (
      <main
        className="profile-loading-page"
        role="status"
        aria-live="polite"
        aria-busy={!profileLoadFailed}
      >
        {profileLoadFailed ? (
          <>
            <p role="alert" className="profile-loading-error">
              {language === 'bn'
                ? 'প্রোফাইল লোড করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'
                : 'Could not load your profile. Check your connection and try again.'}
            </p>
            <button
              type="button"
              onClick={() => setProfileRetry((attempt) => attempt + 1)}
              style={{
                minHeight: 44,
                padding: '10px 18px',
                border: 'none',
                borderRadius: 12,
                background: T.primary,
                color: '#FFFFFF',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {language === 'bn' ? 'আবার চেষ্টা করুন' : 'Retry'}
            </button>
          </>
        ) : (
          <section className="profile-loading-card" aria-label={language === 'bn' ? 'প্রোফাইল লোড হচ্ছে' : 'Loading profile'}>
            <div className="profile-loading-visual" aria-hidden="true">
              <span className="profile-loading-orbit" />
              <span className="profile-loading-orbit profile-loading-orbit-reverse" />
              <span className="profile-loading-leaf">
                <Leaf size={30} strokeWidth={1.8} />
              </span>
            </div>
            <p className="profile-loading-eyebrow">
              {language === 'bn' ? 'সার্ভারের সাথে সংযোগ করা হচ্ছে' : 'CONNECTING TO SERVER'}
            </p>
            <h1 className="profile-loading-title">
              {language === 'bn' ? 'আপনার প্রোফাইল লোড হচ্ছে' : 'Loading your profile'}
            </h1>
            <p className="profile-loading-message">
              {language === 'bn'
                ? 'Render-এর free-tier সার্ভিস ঘুম থেকে জেগে উঠতে পারে। প্রথমবার উত্তর পেতে ৪০ সেকেন্ড বা তারও বেশি লাগতে পারে—দয়া করে পেজটি খোলা রাখুন।'
                : 'Render’s free-tier service may be waking from sleep. The first response can take 40 seconds or more—please keep this page open.'}
            </p>
            <div className="profile-loading-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <>
      <PwaInstallBanner />
      <PhoneFrame
        headerRight={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LanguageToggle />
            <button
              type="button"
              onClick={() => {
                setRoomOpen(false);
                setSettingsOpen(true);
              }}
              aria-label={translate('Settings')}
              title={translate('Settings')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: isDark ? '1.2px solid rgba(255, 255, 255, 0.2)' : '1.2px solid rgba(255, 255, 255, 0.55)',
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.25)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: isDark
                  ? '0 4px 14px rgba(0, 0, 0, 0.4)'
                  : '0 4px 14px rgba(0, 0, 0, 0.15), inset 0 1px 1.5px rgba(255, 255, 255, 0.6)',
                color: isDark ? '#F9F2E4' : '#FFF7EE',
                cursor: 'pointer',
                transition: 'transform 160ms ease, box-shadow 160ms ease',
              }}
            >
              <Settings size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                setRoomOpen((open) => !open);
              }}
              aria-pressed={roomOpen}
              aria-label={language === 'bn' ? 'রুম চ্যাট' : 'Room Chat'}
              title={language === 'bn' ? 'রুম চ্যাট' : 'Room Chat'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 38,
                padding: '0 12px',
                borderRadius: 999,
                border: roomOpen
                  ? '1.2px solid rgba(255, 255, 255, 0.85)'
                  : isDark
                  ? '1.2px solid rgba(255, 255, 255, 0.2)'
                  : '1.2px solid rgba(255, 255, 255, 0.55)',
                background: roomOpen
                  ? isDark
                    ? '#FAF4EC'
                    : '#24130A'
                  : isDark
                  ? 'rgba(255, 255, 255, 0.08)'
                  : 'rgba(255, 245, 235, 0.25)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: isDark
                  ? '0 4px 14px rgba(0, 0, 0, 0.4)'
                  : '0 4px 14px rgba(0, 0, 0, 0.15), inset 0 1px 1.5px rgba(255, 255, 255, 0.6)',
                color: roomOpen ? (isDark ? '#24130A' : '#FFF7EE') : isDark ? '#F9F2E4' : '#FFF7EE',
                fontFamily: 'Inter',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'transform 160ms ease, background 160ms ease, color 160ms ease',
              }}
            >
              <Users size={15} strokeWidth={2.2} />
              <span>{activeRoomCode || (language === 'bn' ? 'রুম' : 'Room')}</span>
              {activeRoomCode && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow: '0 0 8px rgba(34, 197, 94, 0.8)',
                  }}
                />
              )}
            </button>
          </div>
        }
        footer={<BottomNav active={tab} onChange={goToTab} />}
      >
        <LocalizedContent>
        {settingsOpen ? (
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        ) : roomOpen ? (
          <RoomScreen
            sessionKey={session.email}
            defaultDisplayName={
              profile?.name || session.name || session.email.split('@')[0] || 'Guest'
            }
            detected={detected}
            capturedImage={capturedImage}
            onClose={() => setRoomOpen(false)}
            onGoToCapture={() => goToTab(0)}
            onActiveRoomChange={setActiveRoomCode}
          />
        ) : <motion.div
          key={tab}
          custom={direction}
          initial={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: 24 * direction }
          }
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'relative',
            zIndex: 1,
          }}
          id={`panel-${TABS[tab].id}`}
          role="tabpanel"
          aria-labelledby={`tab-${TABS[tab].id}`}
        >
          {tab === 0 && (
            <CaptureScreen
              onCapture={handleCapture}
              onReset={handleRetake}
              captured={captured}
              previewUrl={capturedImage}
              onNavigateTab={goToTab}
              photoUploadMessage={photoUploadMessage}
              userName={profile?.name || session?.name || (session?.email ? session.email.split('@')[0] : null)}
            />
          )}
          {tab === 1 && (
            <ResultsScreen
              detected={detected}
              onChangeDetected={handleDetectedChange}
              onViewNutrients={() => goToTab(2)}
              onNavigateToGrocery={() => goToTab(4)}
              profile={profile}
              capturedImage={capturedImage}
              analysisMessage={analysisMessage}
              analysisResult={analysisResult}
              onRetake={() => {
                handleRetake();
                goToTab(0);
              }}
            />
          )}
          {tab === 2 && (
            <NutrientsScreen
              detected={detected}
              profile={profile}
              onBack={() => goToTab(1)}
              onNavigateToGrocery={() => goToTab(4)}
            />
          )}
          {tab === 3 && (
            <ProfileScreen
              profile={profile}
              onProfileChange={setProfile}
              session={session}
              onSignOut={onSignOut}
            />
          )}
          {tab === 4 && <GroceryScreen profile={profile} />}
          {tab === 5 && (
            <CoachScreen
              profile={profile}
              sessionKey={session.email}
              imageContext={capturedImage}
              localOnly={session.localOnly}
            />
          )}
        </motion.div>
        }
        </LocalizedContent>

        <AnimatePresence>
          {pipelineToast && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25 }}
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                top: 110,
                padding: '10px 14px',
                borderRadius: 14,
                background: 'rgba(46, 37, 34, 0.92)',
                color: '#FFFFFF',
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                zIndex: 30,
                boxShadow: '0 8px 24px rgba(46, 37, 34, 0.30)',
              }}
            >
              <motion.span
                animate={reduceMotion ? {} : { rotate: 360 }}
                transition={reduceMotion ? {} : { duration: 1.6, repeat: Infinity, ease: 'linear' }}
                style={{ display: 'inline-flex', width: 14, height: 14 }}
              >
                <svg width={14} height={14} viewBox="0 0 14 14">
                  <circle cx={7} cy={7} r={5} stroke="rgba(249, 242, 228, 0.4)" strokeWidth={2} fill="none" />
                  <motion.circle
                    cx={7}
                    cy={7}
                    r={5}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray={2 * Math.PI * 5}
                    strokeDashoffset={2 * Math.PI * 5 * 0.7}
                    style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                  />
                </svg>
              </motion.span>
              <span style={{ flex: 1 }}>{pipelineToast}</span>
              {pipeline.length > 0 && (
                <span
                  className="tnum"
                  style={{
                    fontSize: 9.5,
                    color: 'rgba(249, 242, 228, 0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {pipeline.length} stages
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div
          role="status"
          aria-live="polite"
          className="sr-only"
          style={{ position: 'absolute', left: -9999 }}
        >
          {translate('Viewing')} {translate(TABS[tab].label)}
        </div>
      </PhoneFrame>
    </>
  );
}