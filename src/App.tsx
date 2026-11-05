import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { T, TABS } from './data';
import { getProfile, saveMeal, updateLatestMeal, analyzeMeal, resolveNutrition } from './lib/api';
import { analyzeImageLocally, LocalAIError } from './lib/localAI';
import { getEffectiveNutrition } from './lib/personalize';
import { getSession, logout } from './lib/auth';
import { ThemeProvider } from './theme/ThemeContext';
import { useTokens } from './theme/useTokens';
import type { AuthSession, DetectedItem, PipelineTrace, UserProfile } from './types/schemas';
import PhoneFrame from './components/PhoneFrame';
import BottomNav from './components/BottomNav';
import StepDots from './components/StepDots';
import CaptureScreen from './components/screens/CaptureScreen';
import ResultsScreen from './components/screens/ResultsScreen';
import NutrientsScreen from './components/screens/NutrientsScreen';
import ProfileScreen from './components/screens/ProfileScreen';
import GroceryScreen from './components/screens/GroceryScreen';
import CoachScreen from './components/screens/CoachScreen';
import SettingsScreen from './components/screens/SettingsScreen';
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
  useTokens();
  const { language, translate } = useLanguage();
  const [tab, setTab] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    if (next === tab) return;
    setDirection(next > tab ? 1 : -1);
    setTab(next);
  };

  const handleCapture = async (imageDataUrl?: string) => {
    clearResultsNavigationTimeout();
    setCaptured(true);
    setAnalysisMessage(null);
    setAnalysisResult(null);
    if (imageDataUrl) setCapturedImage(imageDataUrl);
    setDirection(1);
    setPipelineToast(translate('Analyzing photo…'));

    let next: DetectedItem[] = [];
    let trace: PipelineTrace[] = [];
    try {
      if (!imageDataUrl) throw new Error('A photo is required to analyze a meal');
      let result: import('./types/schemas').AnalyzeResult;
      try {
        const local = await analyzeImageLocally(imageDataUrl, profile);
        result = local.result;
        setPipelineToast(translate(`Analyzed on-device with ${local.model}`));
      } catch (localError) {
        if (session.localOnly || (typeof navigator !== 'undefined' && !navigator.onLine)) throw localError;
        result = await analyzeMeal(imageDataUrl);
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

  useEffect(() => () => {
    if (resultsNavigationTimeout.current !== null) {
      clearTimeout(resultsNavigationTimeout.current);
    }
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
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: T.inkSoft,
          fontFamily: 'Inter',
          fontSize: 16,
          textAlign: 'center',
        }}
      >
        {profileLoadFailed ? (
          <>
            <p role="alert" style={{ margin: 0 }}>
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
          language === 'bn' ? 'প্রোফাইল লোড হচ্ছে…' : 'Loading profile…'
        )}
      </div>
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
              onClick={() => setSettingsOpen(true)}
              aria-label={translate('Settings')}
              title={translate('Settings')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: `1px solid ${T.cardBorderSoft}`,
                background: T.cardBg,
                color: T.ink,
                cursor: 'pointer',
              }}
            >
              <Settings size={17} />
            </button>
            <StepDots active={tab} onChange={goToTab} />
          </div>
        }
        footer={<BottomNav active={tab} onChange={goToTab} />}
      >
        <LocalizedContent>
        {settingsOpen ? (
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
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
          {tab === 5 && <CoachScreen profile={profile} imageContext={capturedImage} localOnly={session.localOnly} />}
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