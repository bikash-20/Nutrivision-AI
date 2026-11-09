import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Edit3, LogOut, Minus, Plus, RotateCcw, Zap } from 'lucide-react';
import { T } from '../../data';
import { useTokens } from '../../theme/useTokens';
import type {
  ActivityLevel,
  Allergen,
  AuthSession,
  DietType,
  DietaryPreference,
  GoalType,
  HealthGoals,
  HeightUnit,
  MedicalCondition,
  Sex,
  UserProfile,
  UserStats,
  WeightUnit,
} from '../../types/schemas';
import { DAILY_KCAL_TARGET_DEFAULT } from '../../types/schemas';
import { DEFAULT_PROFILE, updateProfile, getUserStats } from '../../lib/api';
import { logout } from '../../lib/auth';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from '../../lib/units';
import { toBengaliDigits } from '../../lib/format';
import { calculateBiometricsBreakdown } from '../../lib/personalize';
import Pill from '../Pill';
import Chip from '../Chip';
import SectionLabel from '../SectionLabel';
import ThemeToggle from '../ThemeToggle';

interface UnifiedDietRule {
  key: DietType;
  label: string;
  labelBn: string;
  prefKey: DietaryPreference;
}

const UNIFIED_DIET_RULES: UnifiedDietRule[] = [
  { key: 'halal', label: 'Halal', labelBn: 'হালাল', prefKey: 'Halal' },
  { key: 'vegetarian', label: 'Vegetarian', labelBn: 'নিরামিষভোজী', prefKey: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan', labelBn: 'ভেগান', prefKey: 'Vegan' },
  { key: 'pescatarian', label: 'Pescatarian', labelBn: 'মাছসহ নিরামিষভোজী', prefKey: 'Pescatarian' },
];

const UNIFIED_CLINICAL_GOALS = [
  {
    id: 'diabetic',
    label: 'Diabetic Friendly',
    labelBn: 'ডায়াবেটিস নিয়ন্ত্রণ',
    isActive: (g: HealthGoals, c: MedicalCondition[]) => !!g.diabetic || c.includes('diabetes_t2') || c.includes('prediabetes'),
    toggle: (
      setG: React.Dispatch<React.SetStateAction<HealthGoals>>,
      setC: React.Dispatch<React.SetStateAction<MedicalCondition[]>>,
    ) => {
      setG((prev) => ({ ...prev, diabetic: !prev.diabetic }));
      setC((prev) => {
        const without = prev.filter((x) => x !== 'diabetes_t2' && x !== 'prediabetes' && x !== 'none');
        if (prev.includes('diabetes_t2') || prev.includes('prediabetes')) {
          return without.length === 0 ? ['none'] : without;
        }
        return [...without, 'diabetes_t2'];
      });
    },
  },
  {
    id: 'hypertension',
    label: 'Hypertension / Low Sodium',
    labelBn: 'উচ্চ রক্তচাপ নিয়ন্ত্রণ',
    isActive: (_g: HealthGoals, c: MedicalCondition[]) => c.includes('hypertension'),
    toggle: (
      _setG: React.Dispatch<React.SetStateAction<HealthGoals>>,
      setC: React.Dispatch<React.SetStateAction<MedicalCondition[]>>,
    ) => {
      setC((prev) => {
        const without = prev.filter((x) => x !== 'hypertension' && x !== 'none');
        if (prev.includes('hypertension')) {
          return without.length === 0 ? ['none'] : without;
        }
        return [...without, 'hypertension'];
      });
    },
  },
  {
    id: 'protein',
    label: 'High Protein',
    labelBn: 'উচ্চ প্রোটিন',
    isActive: (g: HealthGoals) => !!g.protein,
    toggle: (setG: React.Dispatch<React.SetStateAction<HealthGoals>>) => {
      setG((prev) => ({ ...prev, protein: !prev.protein }));
    },
  },
  {
    id: 'budget',
    label: 'Budget Conscious',
    labelBn: 'সাশ্রয়ী বাজেট',
    isActive: (g: HealthGoals) => !!g.budget,
    toggle: (setG: React.Dispatch<React.SetStateAction<HealthGoals>>) => {
      setG((prev) => ({ ...prev, budget: !prev.budget }));
    },
  },
];

const UNIFIED_ALLERGENS: Array<{ key: Allergen; label: string; labelBn: string }> = [
  { key: 'Peanuts', label: 'Peanuts', labelBn: 'চিনাবাদাম' },
  { key: 'Dairy', label: 'Dairy', labelBn: 'দুগ্ধজাত খাবার' },
  { key: 'Gluten', label: 'Gluten', labelBn: 'গ্লুটেন' },
  { key: 'Shellfish', label: 'Shellfish', labelBn: 'শেলফিশ' },
  { key: 'Soy', label: 'Soy', labelBn: 'সয়া' },
  { key: 'Eggs', label: 'Eggs', labelBn: 'ডিম' },
];

const PREFS: Array<{ key: DietaryPreference; label: string; labelBn: string }> = [
  { key: 'Halal', label: 'Halal', labelBn: 'হালাল' },
  { key: 'Vegetarian', label: 'Vegetarian', labelBn: 'নিরামিষভোজী' },
  { key: 'Vegan', label: 'Vegan', labelBn: 'ভেগান' },
  { key: 'Pescatarian', label: 'Pescatarian', labelBn: 'মাছসহ নিরামিষভোজী' },
  { key: 'Gluten-free', label: 'Gluten-free', labelBn: 'গ্লুটেনমুক্ত' },
  { key: 'Dairy-free', label: 'Dairy-free', labelBn: 'দুগ্ধজাত খাবারমুক্ত' },
  { key: 'Kosher', label: 'Kosher', labelBn: 'কোশার' },
];

const ALLERGENS = UNIFIED_ALLERGENS;

const SEX_OPTIONS: Array<{ key: Sex; label: string; labelBn: string }> = [
  { key: 'male', label: 'Male', labelBn: 'পুরুষ' },
  { key: 'female', label: 'Female', labelBn: 'নারী' },
  { key: 'other', label: 'Other', labelBn: 'অন্যান্য' },
];

const ACTIVITY_LEVELS: Array<{ key: ActivityLevel; label: string; labelBn: string; desc: string }> = [
  { key: 'sedentary', label: 'Sedentary', labelBn: 'বসে কাজ (কম পরিশ্রম)', desc: '1.2×' },
  { key: 'light', label: 'Light', labelBn: 'হালকা ব্যায়াম (১-২ দিন/সপ্তাহ)', desc: '1.375×' },
  { key: 'moderate', label: 'Moderate', labelBn: 'মাঝারি ব্যায়াম (৩-৫ দিন/সপ্তাহ)', desc: '1.55×' },
  { key: 'active', label: 'Active', labelBn: 'খুব সক্রিয় (৬-৭ দিন/সপ্তাহ)', desc: '1.725×' },
  { key: 'very_active', label: 'Very active', labelBn: 'অতিরিক্ত সক্রিয় (ভারী পরিশ্রম)', desc: '1.9×' },
];

const PRIMARY_GOALS: Array<{ key: GoalType; label: string; labelBn: string }> = [
  { key: 'maintain', label: 'Maintain weight', labelBn: 'বর্তমান ওজন বজায় রাখা' },
  { key: 'lose', label: 'Lose weight', labelBn: 'ওজন কমানো' },
  { key: 'gain', label: 'Gain weight', labelBn: 'ওজন বৃদ্ধি' },
];

const TARGET_RATES = [
  { value: 0.25, label: '0.25 kg/wk', labelBn: '০.২৫ কেজি/সপ্তাহ' },
  { value: 0.5, label: '0.5 kg/wk', labelBn: '০.৫ কেজি/সপ্তাহ (প্রস্তাবিত)' },
  { value: 0.75, label: '0.75 kg/wk', labelBn: '০.৭৫ কেজি/সপ্তাহ' },
  { value: 1.0, label: '1.0 kg/wk', labelBn: '১.০ কেজি/সপ্তাহ (সর্বোচ্চ)' },
];

const toggleIn = (setState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>) =>
  (k: string) => setState((s) => ({ ...s, [k]: !s[k] }));

interface ProfileScreenProps {
  profile: UserProfile;
  onProfileChange?: (p: UserProfile) => void;
  session?: AuthSession;
  onSignOut?: () => void;
}

export default function ProfileScreen({ profile, onProfileChange, session, onSignOut }: ProfileScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language } = useLanguage();
  const isBn = language === 'bn';

  // Biometrics & demographics state
  const [sex, setSex] = useState<Sex>(profile.sex ?? 'male');
  const [age, setAge] = useState<number>(profile.age ?? 28);
  const [heightCm, setHeightCm] = useState<number>(profile.heightCm ?? 172);
  const [weightKg, setWeightKg] = useState<number>(profile.weightKg ?? 70);
  const [heightUnit, setHeightUnit] = useState<HeightUnit>(profile.heightUnit ?? 'cm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(profile.weightUnit ?? 'kg');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(profile.activityLevel ?? 'moderate');
  const [goal, setGoal] = useState<GoalType>(profile.goal ?? 'maintain');
  const [targetRate, setTargetRate] = useState<number>(profile.targetRateKgPerWeek ?? 0.5);
  const [dietType, setDietType] = useState<DietType | null>(profile.dietType ?? null);
  const [medicalConditions, setMedicalConditions] = useState<MedicalCondition[]>(
    profile.medicalConditions && profile.medicalConditions.length > 0 ? profile.medicalConditions : ['none'],
  );
  const [mealsPerDay, setMealsPerDay] = useState<number>(profile.mealsPerDay ?? 3);

  // Health goals & preferences
  const [goals, setGoals] = useState<HealthGoals>(profile.goals);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(
    Object.fromEntries(profile.preferences.map((p) => [p, true])),
  );
  const [allergens, setAllergens] = useState<Record<string, boolean>>(
    Object.fromEntries(
      profile.allergens.map((allergen) => [
        allergen === 'Shell shellfish' ? 'Shellfish' : allergen,
        true,
      ]),
    ),
  );
  const [budget, setBudget] = useState<number | null>(profile.budget ?? null);
  const [serving, setServing] = useState(profile.serving);
  const [dailyKcalTarget, setDailyKcalTarget] = useState<number>(
    typeof profile.dailyKcalTarget === 'number' && profile.dailyKcalTarget > 0
      ? profile.dailyKcalTarget
      : DAILY_KCAL_TARGET_DEFAULT,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile.name);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Track the last JSON-serialized profile state we committed/synced, so
  // echoes coming back down from onProfileChange(saved) -> App.tsx -> profile
  // are detected as identical and do not trigger duplicate state resets or flickers.
  const lastCommittedJsonRef = useRef<string>(JSON.stringify(profile));

  const [manualKcalOverride, setManualKcalOverride] = useState(false);

  // Dynamic BMR, TDEE, and safe recommendation breakdown
  const breakdown = useMemo(() => {
    return calculateBiometricsBreakdown(
      {
        age,
        sex,
        heightCm,
        weightKg,
        activityLevel,
        goal,
        targetRateKgPerWeek: targetRate,
      },
      language,
    );
  }, [age, sex, heightCm, weightKg, activityLevel, goal, targetRate, language]);

  // Keep daily target strictly synchronized with Mifflin-St Jeor recommendation
  // unless user manually overrides via stepper.
  useEffect(() => {
    if (!manualKcalOverride && breakdown.recommendedKcal > 500) {
      setDailyKcalTarget(breakdown.recommendedKcal);
    }
  }, [breakdown.recommendedKcal, manualKcalOverride]);

  // Synchronize local states ONLY when an actual external profile change arrives
  useEffect(() => {
    const incomingJson = JSON.stringify(profile);
    if (incomingJson === lastCommittedJsonRef.current) {
      return;
    }
    lastCommittedJsonRef.current = incomingJson;
    setGoals(profile.goals);
    setBudget(profile.budget ?? null);
    setServing(profile.serving);
    setName(profile.name);
    if (profile.sex) setSex(profile.sex);
    if (typeof profile.age === 'number') setAge(profile.age);
    if (typeof profile.heightCm === 'number') setHeightCm(profile.heightCm);
    if (typeof profile.weightKg === 'number') setWeightKg(profile.weightKg);
    if (profile.heightUnit) setHeightUnit(profile.heightUnit);
    if (profile.weightUnit) setWeightUnit(profile.weightUnit);
    if (profile.activityLevel) setActivityLevel(profile.activityLevel);
    if (profile.goal) setGoal(profile.goal);
    if (typeof profile.targetRateKgPerWeek === 'number') setTargetRate(profile.targetRateKgPerWeek);
    setDietType(profile.dietType ?? null);
    if (profile.medicalConditions && profile.medicalConditions.length > 0) {
      setMedicalConditions(profile.medicalConditions);
    } else {
      setMedicalConditions(['none']);
    }
    if (typeof profile.mealsPerDay === 'number') setMealsPerDay(profile.mealsPerDay);
    if (profile.preferences) {
      setPrefs(Object.fromEntries(profile.preferences.map((p) => [p, true])));
    }
    if (profile.allergens) {
      setAllergens(
        Object.fromEntries(
          profile.allergens.map((allergen) => [
            allergen === 'Shell shellfish' ? 'Shellfish' : allergen,
            true,
          ]),
        ),
      );
    }
    if (typeof profile.dailyKcalTarget === 'number' && profile.dailyKcalTarget > 0) {
      setDailyKcalTarget(profile.dailyKcalTarget);
    }
  }, [profile]);

  const fetchStats = useCallback(() => {
    setStatsLoading(true);
    getUserStats()
      .then((s) => {
        setStats({
          totalMeals: Number(s?.totalMeals ?? 0),
          totalDaysActive: Number(s?.totalDaysActive ?? 0),
          avgDailyKcal: Number(s?.avgDailyKcal ?? 0),
          streakDays: Number(s?.streakDays ?? 0),
        });
      })
      .catch(() => {
        setStats({ totalMeals: 0, totalDaysActive: 0, avgDailyKcal: 0, streakDays: 0 });
      })
      .finally(() => {
        setStatsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchStats();
    const handleMealUpdate = () => fetchStats();
    window.addEventListener('meal-history-updated', handleMealUpdate);
    return () => {
      window.removeEventListener('meal-history-updated', handleMealUpdate);
    };
  }, [fetchStats]);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const adjustBudget = (delta: number) => {
    setBudget((b) => Math.min(2000, Math.max(100, (b ?? 500) + delta)));
  };

  const adjustServing = (delta: number) => {
    setServing((s) => Math.min(8, Math.max(1, s + delta)));
  };

  const adjustDailyKcal = (delta: number) => {
    setManualKcalOverride(true);
    setDailyKcalTarget((v) => Math.min(4000, Math.max(1000, v + delta)));
  };

  const resetAll = async () => {
    const fresh = structuredClone(DEFAULT_PROFILE);
    setGoals(fresh.goals);
    setBudget(fresh.budget ?? null);
    setServing(fresh.serving);
    setName(fresh.name);
    setDailyKcalTarget(DAILY_KCAL_TARGET_DEFAULT);
    setPrefs({});
    setAllergens({ Peanuts: true });
    setSex(fresh.sex ?? 'male');
    setAge(fresh.age ?? 28);
    setHeightCm(fresh.heightCm ?? 172);
    setWeightKg(fresh.weightKg ?? 70);
    setHeightUnit(fresh.heightUnit ?? 'cm');
    setWeightUnit(fresh.weightUnit ?? 'kg');
    setActivityLevel(fresh.activityLevel ?? 'moderate');
    setGoal(fresh.goal ?? 'maintain');
    setTargetRate(fresh.targetRateKgPerWeek ?? 0.5);
    setDietType(fresh.dietType ?? null);
    setMedicalConditions(fresh.medicalConditions ?? ['none']);
    setMealsPerDay(fresh.mealsPerDay ?? 3);
    lastCommittedJsonRef.current = JSON.stringify(fresh);
    await updateProfile(fresh);
    onProfileChange?.(fresh);
    triggerToast(isBn ? 'প্রোফাইল ডিফল্ট সেটিংসে ফিরিয়ে নেওয়া হয়েছে' : 'Profile reset to defaults');
  };

  // Persist all fields to storage/API (debounced to prevent rapid fire)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // Avoid saving on initial component mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const next: UserProfile = {
      name,
      age,
      sex,
      heightCm,
      weightKg,
      heightUnit,
      weightUnit,
      activityLevel,
      goal,
      targetRateKgPerWeek: targetRate,
      dietType,
      medicalConditions,
      mealsPerDay,
      goals,
      preferences: PREFS.map((p) => p.key).filter((p) => prefs[p]),
      allergens: ALLERGENS.map((a) => a.key).filter((a) => allergens[a]),
      budget,
      serving,
      dailyKcalTarget,
    };

    const nextJson = JSON.stringify(next);
    // If state hasn't changed compared to what was already committed, do nothing
    if (nextJson === lastCommittedJsonRef.current) {
      return;
    }

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      lastCommittedJsonRef.current = nextJson;
      updateProfile(next).then((saved) => {
        lastCommittedJsonRef.current = JSON.stringify(saved);
        onProfileChange?.(saved);
      });
    }, 200);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    name,
    age,
    sex,
    heightCm,
    weightKg,
    heightUnit,
    weightUnit,
    activityLevel,
    goal,
    targetRate,
    dietType,
    medicalConditions,
    mealsPerDay,
    goals,
    prefs,
    allergens,
    budget,
    serving,
    dailyKcalTarget,
  ]);

  const commitName = () => {
    setEditingName(false);
    if (name.trim() && name !== profile.name) {
      triggerToast(isBn ? `স্বাগতম, ${name}` : `Welcome, ${name}`);
    }
  };

  const handleSignOut = () => {
    logout();
    onSignOut?.();
  };

  // Height display & step helpers
  const { feet: heightFeet, inches: heightInches } = cmToFtIn(heightCm);
  const heightDisplay = heightUnit === 'cm'
    ? `${isBn ? toBengaliDigits(heightCm) : heightCm} ${isBn ? 'সেমি' : 'cm'}`
    : `${isBn ? toBengaliDigits(heightFeet) : heightFeet} ${isBn ? 'ফুট' : 'ft'} ${isBn ? toBengaliDigits(heightInches) : heightInches} ${isBn ? 'ইঞ্চি' : 'in'}`;

  const adjustHeight = (delta: number) => {
    if (heightUnit === 'cm') {
      setHeightCm((h) => Math.min(250, Math.max(50, h + delta)));
    } else {
      const nextCm = ftInToCm(heightFeet, heightInches + delta);
      setHeightCm(Math.min(250, Math.max(50, nextCm)));
    }
  };

  // Weight display & step helpers
  const weightDisplay = weightUnit === 'kg'
    ? `${isBn ? toBengaliDigits(weightKg.toFixed(1)) : weightKg.toFixed(1)} ${isBn ? 'কেজি' : 'kg'}`
    : `${isBn ? toBengaliDigits(kgToLb(weightKg).toFixed(1)) : kgToLb(weightKg).toFixed(1)} ${isBn ? 'পাউন্ড' : 'lb'}`;

  const adjustWeight = (delta: number) => {
    if (weightUnit === 'kg') {
      setWeightKg((w) => Math.min(300, Math.max(15, Math.round((w + delta * 0.5) * 10) / 10)));
    } else {
      const curLb = kgToLb(weightKg);
      const nextKg = lbToKg(curLb + delta);
      setWeightKg(Math.min(300, Math.max(15, nextKg)));
    }
  };

  return (
    <LocalizedContent>
      <div className="profile-screen" style={{ padding: '20px var(--screen-gutter, 24px) 24px' }}>
        {session && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="glass-soft profile-signed-in"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 999,
              marginBottom: 10,
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: 600,
              color: T.inkSoft,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: T.accentGood,
              }}
            />
            {isBn ? `সাইন ইন করেছেন: ${session.email}` : `Signed in as ${session.email}`}
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="profile-heading-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 24,
              fontWeight: 600,
              color: isDark ? '#FAF4EC' : '#FFF7EE',
              letterSpacing: '-0.015em',
            }}
          >
            {isBn ? 'আপনার স্বাস্থ্য প্রোফাইল' : 'Your health profile'}
          </h2>
          <div className="profile-heading-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ThemeToggle />
            <motion.button
              type="button"
              onClick={resetAll}
              whileHover={{ y: -1, scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'প্রোফাইলের ডিফল্ট সেটিংস ফিরিয়ে আনুন' : 'Reset profile to defaults'}
              className="champagne-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                borderRadius: 999,
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.75)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
                boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 700,
                color: isDark ? '#FAF4EC' : '#3D271D',
                cursor: 'pointer',
                minHeight: 28,
              }}
            >
              <RotateCcw size={12} strokeWidth={2.5} /> {isBn ? 'রিসেট' : 'Reset'}
            </motion.button>
            {onSignOut && (
              <motion.button
                type="button"
                onClick={handleSignOut}
                whileHover={{ y: -1, scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                aria-label={isBn ? 'নিউট্রিভিশন থেকে সাইন আউট করুন' : 'Sign out of NutriVision'}
                className="champagne-pill"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: 'rgba(254, 226, 226, 0.75)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#991B1B',
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  minHeight: 28,
                  boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                }}
              >
                <LogOut size={12} strokeWidth={2.5} /> {isBn ? 'সাইন আউট' : 'Sign out'}
              </motion.button>
            )}
          </div>
        </motion.div>

        <p
          style={{
            fontFamily: 'Inter',
            fontSize: 13,
            color: isDark ? '#D8C4B6' : '#684A37',
            margin: '4px 0 16px',
            lineHeight: 1.4,
            fontWeight: 500,
          }}
        >
          {isBn ? `হ্যালো ${name} — এগুলো আপনার দেখা প্রতিটি সতর্কতা ও পরামর্শ নির্ধারণ করে।` : `Hi ${name} — these shape every flag and swap you see.`}
        </p>

        {/* Profile Header Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="champagne-panel"
          style={{
            borderRadius: 22,
            padding: '16px 18px',
            marginBottom: 22,
            background: isDark ? 'rgba(42, 32, 27, 0.92)' : 'rgba(255, 248, 240, 0.72)',
            border: isDark ? '1px solid rgba(255, 255, 255, 0.14)' : '1.5px solid rgba(255, 255, 255, 0.85)',
            boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.4)' : 'inset 0 1.5px 2px rgba(255, 255, 255, 0.85), 0 16px 40px -10px rgba(61, 39, 29, 0.16)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {session?.avatarUrl ? (
              <img
                src={session.avatarUrl}
                alt={name || session.name || 'User'}
                referrerPolicy="no-referrer"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: `2px solid ${T.primary}`,
                  flexShrink: 0,
                }}
              />
            ) : (
              <motion.button
                type="button"
                onClick={() => setEditingName((v) => !v)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                aria-label={isBn ? 'প্রোফাইলের নাম সম্পাদনা করুন' : 'Edit profile name'}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: T.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow:
                    '0 6px 14px -4px rgba(46, 37, 34, 0.45), inset 0 1.5px 0 rgba(255,255,255,0.35)',
                  fontFamily: 'Inter',
                  fontWeight: 700,
                  fontSize: 14,
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  border: 'none',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                {(name || session?.name || session?.email || 'U')
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </motion.button>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <AnimatePresence mode="wait" initial={false}>
                {editingName ? (
                  <motion.input
                    key="edit"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitName();
                      if (e.key === 'Escape') {
                        setName(profile.name);
                        setEditingName(false);
                      }
                    }}
                    aria-label={isBn ? 'প্রোফাইলের নাম' : 'Profile name'}
                    style={{
                      width: '100%',
                      fontFamily: 'Inter',
                      fontSize: 14,
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
                  <motion.div
                    key="text"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: 'Inter',
                      fontWeight: 600,
                      fontSize: 14,
                      color: T.ink,
                    }}
                  >
                    <span>{name || session?.name || 'User'}</span>
                    <Edit3
                      size={11}
                      color={T.inkSoft}
                      style={{ opacity: 0.6 }}
                      aria-hidden="true"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <div
                style={{
                  fontFamily: 'Inter',
                  fontSize: 12,
                  color: T.inkSoft,
                  marginTop: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                {session?.email ? (
                  <span style={{ fontWeight: 500, color: T.ink }}>{session.email}</span>
                ) : null}
                <span>·</span>
                <span>
                  {isBn
                    ? `টানা ${toBengaliDigits(stats?.streakDays ?? 0)} দিনের ধারা`
                    : `${stats?.streakDays ?? 0}-day streak`}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* User Stats Card */}
        <SectionLabel>{isBn ? 'আপনার পরিসংখ্যান' : 'Your Stats'}</SectionLabel>
        {statsLoading ? (
          <div
            className="glass-card skeleton"
            style={{
              borderRadius: 18,
              height: 72,
              marginBottom: 22,
            }}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="champagne-panel"
            style={{
              borderRadius: 22,
              padding: '16px 18px',
              marginBottom: 22,
              display: 'flex',
              gap: 12,
              background: isDark ? 'rgba(42, 32, 27, 0.92)' : 'rgba(255, 248, 240, 0.72)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.14)' : '1.5px solid rgba(255, 255, 255, 0.85)',
              boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.4)' : 'inset 0 1.5px 2px rgba(255, 255, 255, 0.85), 0 16px 40px -10px rgba(61, 39, 29, 0.16)',
            }}
          >
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: isDark ? '#FAF4EC' : '#2C1A11' }}>
                {isBn ? toBengaliDigits(stats?.totalMeals ?? 0) : (stats?.totalMeals ?? 0)}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10.5, fontWeight: 600, color: isDark ? '#D8C4B6' : '#8E674F', marginTop: 2 }}>
                {isBn ? 'নথিভুক্ত খাবার' : 'meals logged'}
              </div>
            </div>
            <div style={{ width: 1, background: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(92, 60, 46, 0.15)', alignSelf: 'stretch' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: isDark ? '#FAF4EC' : '#2C1A11' }}>
                {isBn ? toBengaliDigits(stats?.totalDaysActive ?? 0) : (stats?.totalDaysActive ?? 0)}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10.5, fontWeight: 600, color: isDark ? '#D8C4B6' : '#8E674F', marginTop: 2 }}>
                {isBn ? 'সক্রিয় দিন' : 'days active'}
              </div>
            </div>
            <div style={{ width: 1, background: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(92, 60, 46, 0.15)', alignSelf: 'stretch' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: isDark ? '#E8C49A' : '#C87428' }}>
                {isBn ? toBengaliDigits(stats?.streakDays ?? 0) : (stats?.streakDays ?? 0)}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10.5, fontWeight: 600, color: isDark ? '#D8C4B6' : '#8E674F', marginTop: 2 }}>
                {isBn ? 'টানা ধারা (দিন)' : 'streak days'}
              </div>
            </div>
            <div style={{ width: 1, background: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(92, 60, 46, 0.15)', alignSelf: 'stretch' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: isDark ? '#D0AE92' : '#3D271D' }}>
                {isBn ? toBengaliDigits(stats?.avgDailyKcal ?? 0) : (stats?.avgDailyKcal ?? 0)}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10.5, fontWeight: 600, color: isDark ? '#D8C4B6' : '#8E674F', marginTop: 2 }}>
                {isBn ? 'গড় ক্যালরি/দিন' : 'avg kcal/day'}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── 1. Biological Sex ─────────────────────────────────── */}
        <SectionLabel>{isBn ? 'জৈবিক লিঙ্গ' : 'Biological Sex'}</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {SEX_OPTIONS.map((opt) => (
            <Pill
              key={opt.key}
              active={sex === opt.key}
              onClick={() => setSex(opt.key)}
              ariaLabel={`Select ${opt.label}`}
            >
              {isBn ? opt.labelBn : opt.label}
            </Pill>
          ))}
        </div>

        {/* ── 2. Age ────────────────────────────────────────────── */}
        <SectionLabel>{isBn ? 'বয়স' : 'Age'}</SectionLabel>
        <StepperRow
          valueLabel={`${isBn ? toBengaliDigits(age) : age} ${isBn ? 'বছর' : 'years'}`}
          onDec={() => setAge((a) => Math.max(1, a - 1))}
          onInc={() => setAge((a) => Math.min(100, a + 1))}
          decLabel={isBn ? 'বয়স ১ বছর কমান' : 'Decrease age by 1 year'}
          incLabel={isBn ? 'বয়স ১ বছর বাড়ান' : 'Increase age by 1 year'}
          hint={isBn ? 'মিফলিন-সেন্ট জিওর বিএমআর গণনা ও শিশু পুষ্টি সুরক্ষায় ব্যবহৃত হয়' : 'Used for Mifflin-St Jeor BMR calculation and pediatric safety rules'}
        />

        {/* ── 3. Height (with cm / ft-in toggle) ─────────────────── */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <SectionLabel>{isBn ? 'উচ্চতা' : 'Height'}</SectionLabel>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setHeightUnit('cm')}
                style={{
                  fontSize: 11,
                  fontFamily: 'Inter',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  background: heightUnit === 'cm'
                    ? (isDark ? '#FAF4EC' : '#24130A')
                    : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
                  color: heightUnit === 'cm'
                    ? (isDark ? '#1F1008' : '#FFFFFF')
                    : (isDark ? '#D8C4B6' : '#FFF0E2'),
                  boxShadow: heightUnit === 'cm' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                {isBn ? 'সেমি' : 'cm'}
              </button>
              <button
                type="button"
                onClick={() => setHeightUnit('ft_in')}
                style={{
                  fontSize: 11,
                  fontFamily: 'Inter',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  background: heightUnit === 'ft_in'
                    ? (isDark ? '#FAF4EC' : '#24130A')
                    : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
                  color: heightUnit === 'ft_in'
                    ? (isDark ? '#1F1008' : '#FFFFFF')
                    : (isDark ? '#D8C4B6' : '#FFF0E2'),
                  boxShadow: heightUnit === 'ft_in' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                {isBn ? 'ফুট · ইঞ্চি' : 'ft · in'}
              </button>
            </div>
          </div>
          <StepperRow
            valueLabel={heightDisplay}
            onDec={() => adjustHeight(-1)}
            onInc={() => adjustHeight(1)}
            decLabel={isBn ? 'উচ্চতা কমান' : 'Decrease height'}
            incLabel={isBn ? 'উচ্চতা বাড়ান' : 'Increase height'}
            hint={isBn ? `স্বাভাবিক উচ্চতা: ${toBengaliDigits(heightCm)} সেমি — বিএমআর গণনায় ব্যবহৃত হয়` : `Normalized: ${heightCm} cm — used to calculate BMR`}
          />
        </div>

        {/* ── 4. Weight (with kg / lb toggle) ───────────────────── */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <SectionLabel>{isBn ? 'ওজন' : 'Weight'}</SectionLabel>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setWeightUnit('kg')}
                style={{
                  fontSize: 11,
                  fontFamily: 'Inter',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  background: weightUnit === 'kg'
                    ? (isDark ? '#FAF4EC' : '#24130A')
                    : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
                  color: weightUnit === 'kg'
                    ? (isDark ? '#1F1008' : '#FFFFFF')
                    : (isDark ? '#D8C4B6' : '#FFF0E2'),
                  boxShadow: weightUnit === 'kg' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                {isBn ? 'কেজি' : 'kg'}
              </button>
              <button
                type="button"
                onClick={() => setWeightUnit('lb')}
                style={{
                  fontSize: 11,
                  fontFamily: 'Inter',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.45)',
                  cursor: 'pointer',
                  background: weightUnit === 'lb'
                    ? (isDark ? '#FAF4EC' : '#24130A')
                    : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
                  color: weightUnit === 'lb'
                    ? (isDark ? '#1F1008' : '#FFFFFF')
                    : (isDark ? '#D8C4B6' : '#FFF0E2'),
                  boxShadow: weightUnit === 'lb' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                {isBn ? 'পাউন্ড' : 'lb'}
              </button>
            </div>
          </div>
          <StepperRow
            valueLabel={weightDisplay}
            onDec={() => adjustWeight(-1)}
            onInc={() => adjustWeight(1)}
            decLabel={isBn ? 'ওজন কমান' : 'Decrease weight'}
            incLabel={isBn ? 'ওজন বাড়ান' : 'Increase weight'}
            hint={isBn ? `স্বাভাবিক ওজন: ${toBengaliDigits(weightKg.toFixed(1))} কেজি — দৈনিক ক্যালরি ব্যয়ের হিসাবে ব্যবহৃত হয়` : `Normalized: ${weightKg.toFixed(1)} kg — used for daily caloric expenditure`}
          />
        </div>

        {/* ── 5. Activity Level ─────────────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <SectionLabel>{isBn ? 'দৈনিক শারীরিক সক্রিয়তা' : 'Activity Level'}</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {ACTIVITY_LEVELS.map((act) => (
              <Pill
                key={act.key}
                active={activityLevel === act.key}
                onClick={() => setActivityLevel(act.key)}
                ariaLabel={`Select ${act.label} activity level`}
              >
                {isBn ? act.labelBn : act.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* ── 6. Primary Goal ───────────────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <SectionLabel>{isBn ? 'প্রধান স্বাস্থ্য লক্ষ্য' : 'Primary Goal'}</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {PRIMARY_GOALS.map((g) => (
              <Pill
                key={g.key}
                active={goal === g.key}
                onClick={() => setGoal(g.key)}
                ariaLabel={`Select ${g.label}`}
              >
                {isBn ? g.labelBn : g.label}
              </Pill>
            ))}
          </div>

          {goal !== 'maintain' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: isDark ? '#D8C4B6' : '#FFF0E2', marginBottom: 6 }}>
                {isBn ? 'সাপ্তাহিক পরিবর্তনের হার (কেজি/সপ্তাহ)' : 'Target rate (kg/wk)'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TARGET_RATES.map((rate) => (
                  <button
                    key={rate.value}
                    type="button"
                    onClick={() => setTargetRate(rate.value)}
                    style={{
                      fontSize: 11,
                      fontFamily: 'Inter',
                      fontWeight: 700,
                      padding: '5px 10px',
                      borderRadius: 8,
                      border: targetRate === rate.value
                        ? (isDark ? '1px solid rgba(255, 255, 255, 0.45)' : '1px solid rgba(255, 255, 255, 0.65)')
                        : (isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.35)'),
                      background: targetRate === rate.value
                        ? (isDark ? '#FAF4EC' : '#24130A')
                        : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
                      color: targetRate === rate.value
                        ? (isDark ? '#1F1008' : '#FFFFFF')
                        : (isDark ? '#D8C4B6' : '#FFF0E2'),
                      cursor: 'pointer',
                    }}
                  >
                    {isBn ? rate.labelBn : rate.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 7. Dynamic Metabolic Estimate Card ────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
          className="champagne-panel"
          style={{
            borderRadius: 20,
            padding: '16px',
            marginTop: 18,
            marginBottom: 24,
            background: isDark
              ? 'linear-gradient(145deg, rgba(46, 26, 17, 0.85) 0%, rgba(28, 15, 9, 0.92) 100%)'
              : 'linear-gradient(145deg, rgba(255, 250, 244, 0.95) 0%, rgba(246, 235, 222, 0.92) 100%)',
            border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1.5px solid rgba(255, 255, 255, 0.85)',
            boxShadow: isDark
              ? '0 6px 20px rgba(0, 0, 0, 0.4)'
              : 'inset 0 1.5px 2px rgba(255, 255, 255, 0.85), 0 8px 24px -8px rgba(61, 39, 29, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 14, fontWeight: 700, color: isDark ? '#FAF4EC' : '#24130A' }}>
              {isBn ? 'বিপাকীয় হিসাব (মিফলিন-সেন্ট জিওর)' : 'Metabolic Estimate (Mifflin-St Jeor)'}
            </span>
            <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, color: isDark ? 'rgba(250, 244, 236, 0.75)' : '#6E4A35' }}>
              {isBn ? 'টিডিইই = বিএমআর × সক্রিয়তা' : 'TDEE = BMR × Activity'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.75)', border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(210, 185, 160, 0.35)' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700, color: isDark ? '#FAF4EC' : '#24130A' }}>
                {isBn ? toBengaliDigits(breakdown.bmr) : breakdown.bmr}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: isDark ? '#D8C4B6' : '#5C3A27', marginTop: 2 }}>
                {isBn ? 'বিশ্রামরত ব্যয় (বিএমআর)' : 'Resting burn (BMR)'}
              </div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.75)', border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(210, 185, 160, 0.35)' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700, color: '#C87428' }}>
                {isBn ? toBengaliDigits(breakdown.tdee) : breakdown.tdee}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: isDark ? '#D8C4B6' : '#5C3A27', marginTop: 2 }}>
                {isBn ? 'দৈনিক মোট ব্যয় (টিডিইই)' : 'Daily burn (TDEE)'}
              </div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.75)', border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(210, 185, 160, 0.35)' }}>
              <div className="tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700, color: isDark ? '#4ADE80' : '#1C6635' }}>
                {isBn ? toBengaliDigits(breakdown.recommendedKcal) : breakdown.recommendedKcal}
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: isDark ? '#D8C4B6' : '#5C3A27', marginTop: 2 }}>
                {isBn ? 'নিরাপদ দৈনিক লক্ষ্য' : 'Safe Target'}
              </div>
            </div>
          </div>

          <div style={{ fontFamily: 'Inter', fontSize: 11, color: isDark ? 'rgba(250, 244, 236, 0.85)' : '#42281A', marginBottom: 12, lineHeight: 1.45 }}>
            {breakdown.explanation}
          </div>

          <motion.button
            type="button"
            onClick={() => {
              setDailyKcalTarget(breakdown.recommendedKcal);
              triggerToast(isBn ? `দৈনিক লক্ষ্য ${toBengaliDigits(breakdown.recommendedKcal)} কিলোক্যালরি নির্ধারণ করা হয়েছে` : `Daily target updated to ${breakdown.recommendedKcal} kcal`);
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #8E431B 0%, #5C270C 100%)',
              color: '#FAF4EC',
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 700,
              border: '1px solid rgba(255, 255, 255, 0.25)',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(92, 39, 12, 0.35)',
            }}
          >
            <Zap size={13} fill="#FAF4EC" />
            {isBn
              ? `⚡ হিসাবকৃত লক্ষ্য প্রয়োগ করুন (${toBengaliDigits(breakdown.recommendedKcal)} কিলোক্যালরি)`
              : `⚡ Apply calculated target (${breakdown.recommendedKcal} kcal)`}
          </motion.button>
        </motion.div>

        {/* ── 8. Consolidated Dietary Rules, Clinical Goals & Allergens ── */}
        <div style={{ marginTop: 22, marginBottom: 20 }}>
          <SectionLabel>{isBn ? 'খাদ্যাভ্যাস, ক্লিনিক্যাল লক্ষ্য ও অ্যালার্জি' : 'Dietary, Clinical Goals & Allergens'}</SectionLabel>

          {/* Subgroup A: Dietary Rules */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: isDark ? '#D8C4B6' : '#FFF0E2', marginBottom: 8 }}>
              {isBn ? 'খাদ্যাভ্যাসের বিধি (Dietary Rules)' : 'Dietary Rules'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {UNIFIED_DIET_RULES.map((rule) => (
                <Pill
                  key={rule.key}
                  active={dietType === rule.key}
                  onClick={() => {
                    if (dietType === rule.key) {
                      setDietType(null);
                    } else {
                      setDietType(rule.key);
                      setPrefs((prev) => ({ ...prev, [rule.prefKey]: true }));
                    }
                  }}
                  ariaLabel={`Select ${rule.label} diet`}
                >
                  {isBn ? rule.labelBn : rule.label}
                </Pill>
              ))}
            </div>
          </div>

          {/* Subgroup B: Clinical / Health Goals */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: isDark ? '#D8C4B6' : '#FFF0E2', marginBottom: 8 }}>
              {isBn ? 'ক্লিনিক্যাল ও স্বাস্থ্য লক্ষ্য (Clinical & Health Goals)' : 'Clinical & Health Goals'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {UNIFIED_CLINICAL_GOALS.map((g) => {
                const active = g.isActive(goals, medicalConditions);
                return (
                  <Chip
                    key={g.id}
                    label={isBn ? g.labelBn : g.label}
                    active={active}
                    onClick={() => g.toggle(setGoals, setMedicalConditions)}
                  />
                );
              })}
            </div>
          </div>

          {/* Subgroup C: Allergens to Avoid */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: isDark ? '#D8C4B6' : '#FFF0E2', marginBottom: 8 }}>
              {isBn ? 'যেসব অ্যালার্জি এড়াবেন (Allergens to Avoid)' : 'Allergens to Avoid'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {UNIFIED_ALLERGENS.map((a) => (
                <Chip
                  key={a.key}
                  label={isBn ? a.labelBn : a.label}
                  active={!!allergens[a.key]}
                  onClick={() => toggleIn(setAllergens)(a.key)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── 9. Meals per day ──────────────────────────────────── */}
        <SectionLabel>{isBn ? 'দৈনিক খাবারের সংখ্যা' : 'Meals per day'}</SectionLabel>
        <StepperRow
          valueLabel={`${isBn ? toBengaliDigits(mealsPerDay) : mealsPerDay} ${isBn ? 'বেলা' : 'meals'}`}
          onDec={() => setMealsPerDay((m) => Math.max(1, m - 1))}
          onInc={() => setMealsPerDay((m) => Math.min(6, m + 1))}
          decLabel={isBn ? 'দৈনিক খাবারের সংখ্যা কমান' : 'Decrease meals per day'}
          incLabel={isBn ? 'দৈনিক খাবারের সংখ্যা বাড়ান' : 'Increase meals per day'}
          hint={isBn ? 'প্রতি বেলার খাবারে দৈনিক ক্যালরি ও গ্লাইসেমিক বাজেট বণ্টন করে' : 'Divides daily calorie and glycemic budget across your meals'}
        />

        {/* ── 14. Daily kcal target ─────────────────────────────── */}
        <SectionLabel>{isBn ? 'দৈনিক ক্যালরি লক্ষ্য' : 'Daily kcal target'}</SectionLabel>
        <StepperRow
          valueLabel={`${isBn ? toBengaliDigits(dailyKcalTarget) : dailyKcalTarget} ${isBn ? 'কিলোক্যালরি' : 'kcal'}${!profile.age || !profile.weightKg ? (isBn ? ' (ডিফল্ট)' : ' (Default)') : ''}`}
          onDec={() => adjustDailyKcal(-50)}
          onInc={() => adjustDailyKcal(50)}
          decLabel={isBn ? 'দৈনিক ক্যালরির লক্ষ্য ৫০ কমান' : 'Decrease daily kcal target by 50'}
          incLabel={isBn ? 'দৈনিক ক্যালরির লক্ষ্য ৫০ বাড়ান' : 'Increase daily kcal target by 50'}
          hint={
            !profile.age || !profile.weightKg
              ? (isBn ? 'ডিফল্ট মান—উপরে আপনার বয়স ও ওজন পূরণ করে সুনির্দিষ্ট লক্ষ্য হিসাব করুন' : 'Default estimate — fill in age & weight above to calculate a personalized target')
              : (isBn ? 'হোমের অগ্রগতি বার চালায়—নিজে অথবা উপরের ক্যালকুলেটর দিয়ে নির্ধারণ করুন' : 'Powers the Home progress bar — can be set manually or via the calculator above')
          }
        />

        {/* ── 15. Daily grocery budget ──────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <SectionLabel>{isBn ? 'দৈনিক বাজারের বাজেট' : 'Daily grocery budget'}</SectionLabel>
          <StepperRow
            valueLabel={
              budget != null && budget > 0
                ? `৳${isBn ? toBengaliDigits(budget) : budget}`
                : (isBn ? 'নির্ধারিত নয়' : 'Not set')
            }
            onDec={() => adjustBudget(-50)}
            onInc={() => adjustBudget(50)}
            decLabel={isBn ? 'বাজেট ৫০ টাকা কমান' : 'Decrease budget by 50 taka'}
            incLabel={isBn ? 'বাজেট ৫০ টাকা বাড়ান' : 'Increase budget by 50 taka'}
            hint={
              budget != null && budget > 0
                ? (isBn ? `প্রতিদিন—বাজারের পর্দায় এটি সাপ্তাহিক সীমা হিসেবে প্রয়োগ হয়: ৳${toBengaliDigits(budget * 7)} (×৭ দিন)` : `per day — the Grocery screen applies this as a weekly cap of ৳${budget * 7} (×7 days)`)
                : (isBn ? 'দৈনিক বাজারের বাজেট এখনো নির্ধারিত হয়নি' : 'Daily grocery budget not set yet')
            }
          />
        </div>

        {/* ── 16. Servings on this plate ────────────────────────── */}
        <div style={{ marginTop: 16 }}>
          <SectionLabel>{isBn ? 'এই প্লেটের পরিবেশনের সংখ্যা' : 'Servings on this plate'}</SectionLabel>
          <StepperRow
            valueLabel={`${isBn ? toBengaliDigits(serving) : serving}×`}
            onDec={() => adjustServing(-1)}
            onInc={() => adjustServing(1)}
            decLabel={isBn ? 'পরিবেশন সংখ্যা কমান' : 'Decrease servings'}
            incLabel={isBn ? 'পরিবেশন সংখ্যা বাড়ান' : 'Increase servings'}
            hint={isBn ? 'পুষ্টি বিভাগে ম্যাক্রোর মান সমন্বয়ে ব্যবহৃত হয়' : 'used to scale macro values across Nutrients'}
          />
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.22 }}
              role="status"
              aria-live="polite"
              style={{
                position: 'fixed',
                left: 24,
                right: 24,
                bottom: 110,
                padding: '10px 14px',
                borderRadius: 14,
                background: T.primary,
                color: '#FFFFFF',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 600,
                textAlign: 'center',
                boxShadow: '0 8px 24px rgba(46, 37, 34, 0.25)',
                zIndex: 99,
              }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </LocalizedContent>
  );
}

interface StepperRowProps {
  valueLabel: string;
  onDec: () => void;
  onInc: () => void;
  decLabel: string;
  incLabel: string;
  hint: string;
}

function StepperRow({ valueLabel, onDec, onInc, decLabel, incLabel, hint }: StepperRowProps) {
  const reduceMotion = useReducedMotion();
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  return (
    <LocalizedContent>
      <>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="champagne-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderRadius: 20,
            padding: '12px 18px',
            background: isDark ? 'rgba(42, 32, 27, 0.92)' : 'rgba(255, 248, 240, 0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1.5px solid rgba(255, 255, 255, 0.85)',
            boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.3)' : 'inset 0 1.5px 2px rgba(255, 255, 255, 0.85), 0 8px 24px -8px rgba(61, 39, 29, 0.12)',
          }}
        >
          <motion.button
            type="button"
            className="profile-stepper-button champagne-pill"
            onClick={onDec}
            aria-label={decLabel}
            whileHover={!reduceMotion ? { scale: 1.08 } : {}}
            whileTap={!reduceMotion ? { scale: 0.88 } : {}}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.85)',
              boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Minus size={14} color={isDark ? '#F9F2E4' : '#3D271D'} strokeWidth={2.4} />
          </motion.button>

          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: 'var(--font-serif)',
              fontSize: 20,
              fontWeight: 700,
              color: isDark ? '#FAF4EC' : '#24130A',
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              minHeight: 28,
              position: 'relative',
            }}
            aria-live="polite"
            aria-atomic="true"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={valueLabel}
                initial={reduceMotion ? { opacity: 0 } : { y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { y: -8, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                style={{ display: 'inline-block' }}
                className="tnum"
              >
                {valueLabel}
              </motion.span>
            </AnimatePresence>
          </div>

          <motion.button
            type="button"
            className="profile-stepper-button champagne-pill"
            onClick={onInc}
            aria-label={incLabel}
            whileHover={!reduceMotion ? { scale: 1.08 } : {}}
            whileTap={!reduceMotion ? { scale: 0.88 } : {}}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.85)',
              boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Plus size={14} color={isDark ? '#F9F2E4' : '#3D271D'} strokeWidth={2.4} />
          </motion.button>
        </motion.div>
        <div
          style={{
            fontFamily: 'Inter',
            fontSize: 11,
            color: isDark ? 'rgba(249, 242, 228, 0.78)' : '#E8D4C1',
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          {hint}
        </div>
      </>
    </LocalizedContent>
  );
}
