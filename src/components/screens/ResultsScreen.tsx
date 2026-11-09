import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Edit3,
  Plus,
  Share2,
  AlertTriangle,
  AlertOctagon,
  ShoppingBag,
  Sparkles,
  CheckCircle2,
  Check,
  Loader2,
  BookOpen,
  SlidersHorizontal,
} from 'lucide-react';
import {
  T, NUTRITION_DB,
} from '../../data';
import { useTokens } from '../../theme/useTokens';
import { getEffectiveNutrition, getDynamicTargets } from '../../lib/personalize';
import { getContextAwarePairings } from '../../lib/foodAliases';
import { addGroceryItem, addGroceryItemsBatch, getGroceryList, removeGroceryItem, updateLatestMeal } from '../../lib/api';
import { resolveMarketPrice } from '../../lib/marketPrices';
import { triggerHaptic } from '../../lib/haptics';
import { checkDietConflicts, CLINICAL_DISCLAIMER_BN, CLINICAL_DISCLAIMER_EN } from '../../lib/dietConflict';
import type { DetectedItem, UserProfile, AnalyzeResult } from '../../types/schemas';
import PhotoThumb from '../PhotoThumb';
import StepIndicator from '../StepIndicator';
import SummaryCard from '../SummaryCard';
import SortMenu, { SORT_OPTIONS } from '../SortMenu';
import ExpandableRow from '../ExpandableRow';
import BulkActionBar from '../BulkActionBar';
import SmartActionSheet from '../SmartActionSheet';
import AddCustomModal from '../AddCustomModal';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { toBengaliDigits } from '../../lib/format';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

interface Totals {
  protein: number; carbs: number; fat: number; kcal: number;
  fiber: number; sodium: number; sugar: number;
}

function totalsFor(detected: DetectedItem[]): Totals {
  return detected.reduce(
    (acc, it) => {
      const n = getEffectiveNutrition(it.name);
      const factor = it.grams / 100;
      return {
        protein: acc.protein + n.protein * factor,
        carbs: acc.carbs + n.carbs * factor,
        fat: acc.fat + n.fat * factor,
        kcal: acc.kcal + n.kcal * factor,
        fiber: acc.fiber + n.fiber * factor,
        sodium: acc.sodium + n.sodium * factor,
        sugar: acc.sugar + n.sugar * factor,
      };
    },
    { protein: 0, carbs: 0, fat: 0, kcal: 0, fiber: 0, sodium: 0, sugar: 0 },
  );
}

interface ResultsScreenProps {
  detected?: DetectedItem[];
  onChangeDetected?: (next: DetectedItem[]) => void;
  onViewNutrients?: () => void;
  onNavigateToGrocery?: () => void;
  profile?: UserProfile;
  capturedImage?: string | null;
  analysisMessage?: string | null;
  analysisResult?: AnalyzeResult | null;
  onRetake?: () => void;
}

export default function ResultsScreen({
  detected: detectedProp,
  onChangeDetected,
  onViewNutrients,
  onNavigateToGrocery,
  profile,
  capturedImage,
  analysisMessage,
  analysisResult,
  onRetake,
}: ResultsScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { foodName, language } = useLanguage();
  const isBn = language === 'bn';
  const [detected, setDetected] = useState(detectedProp ?? []);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [addedGroceryIds, setAddedGroceryIds] = useState<Record<string, boolean>>({});
  const [addedDetectedToGrocery, setAddedDetectedToGrocery] = useState(false);
  const [isAddingDetectedGrocery, setIsAddingDetectedGrocery] = useState(false);
  const [isAddingMissingGrocery, setIsAddingMissingGrocery] = useState<Record<number, boolean>>({});
  const [groceryItemMap, setGroceryItemMap] = useState<Record<string, string>>({}); // item name (lowercase) -> item ID

  const dietConflicts = useMemo(() => {
    if (!profile) return [];
    return checkDietConflicts(detected, profile);
  }, [detected, profile]);
  const [sortKey, setSortKey] = useState<typeof SORT_OPTIONS[number]['key']>('conf');
  const [step, setStep] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ msg: string; action?: { label: string; onClick: () => void } } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addCustomOpen, setAddCustomOpen] = useState(false);

  const diabeticMode = !!profile?.goals.diabetic;
  const targets = useMemo(() => getDynamicTargets(profile), [profile]);
  const mealsPerDay = Math.max(1, profile?.mealsPerDay ?? 3);
  const maxProtein = Math.max(15, Math.round(targets.protein / mealsPerDay));
  const maxCarbs = Math.max(25, Math.round(targets.carbs / mealsPerDay));
  const maxFat = Math.max(10, Math.round(targets.fat / mealsPerDay));

  const contextPairings = useMemo(() => {
    return getContextAwarePairings(detected, 6);
  }, [detected]);

  // Sync local → parent so Nutrients recomputes when grams change
  const updateDetected = (updater: DetectedItem[] | ((prev: DetectedItem[]) => DetectedItem[])) => {
    setDetected((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: DetectedItem[]) => DetectedItem[])(prev) : updater;
      onChangeDetected?.(next);
      return next;
    });
  };

  // Sync prop in case App resets (e.g. retake)
  useEffect(() => {
    if (detectedProp && JSON.stringify(detectedProp) !== JSON.stringify(detected)) {
      setDetected(detectedProp);
      setConfirmed({});
      setStep(0);
      setEditMode(false);
      setMultiSelect(false);
      setSelected({});
      setSheetOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(detectedProp)]);

  // Check and sync grocery list status
  useEffect(() => {
    let active = true;
    const checkGrocery = async () => {
      if (!profile) return;
      try {
        const list = await getGroceryList(profile);
        if (!active || !list?.groups) return;
        const allItems = list.groups.flatMap((g) => g.items || []);
        const map: Record<string, string> = {};
        for (const item of allItems) {
          map[item.name.toLowerCase().trim()] = item.id;
        }
        setGroceryItemMap(map);
        if (detected.length > 0) {
          const allIn = detected.every((d) => !!map[d.name.toLowerCase().trim()]);
          setAddedDetectedToGrocery(allIn);
        }
      } catch {
        // Silently ignore if offline
      }
    };

    checkGrocery();

    const handleGroceryUpdated = () => {
      checkGrocery();
    };

    window.addEventListener('grocery-updated', handleGroceryUpdated);
    window.addEventListener('storage', handleGroceryUpdated);
    return () => {
      active = false;
      window.removeEventListener('grocery-updated', handleGroceryUpdated);
      window.removeEventListener('storage', handleGroceryUpdated);
    };
  }, [profile, detected]);

  const totals = useMemo(() => totalsFor(detected), [detected]);

  const sorted = useMemo(() => {
    const arr = [...detected];
    arr.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'grams') return b.grams - a.grams;
      if (sortKey === 'kcal') {
        const ka = getEffectiveNutrition(a.name).kcal * (a.grams / 100);
        const kb = getEffectiveNutrition(b.name).kcal * (b.grams / 100);
        return kb - ka;
      }
      return b.confidence - a.confidence;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, sortKey]);

  const allConfirmed =
    detected.length > 0 && detected.every((d) => confirmed[d.name]);
  const sheetShownRef = useRef(false);
  useEffect(() => {
    if (allConfirmed && !sheetShownRef.current) {
      sheetShownRef.current = true;
      setSheetOpen(true);
    }
    if (!allConfirmed) sheetShownRef.current = false;
  }, [allConfirmed]);

  const triggerToast = (msg: string, action?: { label: string; onClick: () => void }) => {
    setToast({ msg, ...(action ? { action } : {}) });
    setTimeout(() => setToast(null), 2200);
  };

  const confirm = (name: string) => {
    setConfirmed((c) => ({ ...c, [name]: true }));
    triggerToast(`Confirmed ${name}`);
  };

  const remove = (name: string) => {
    const removed = detected.find((d) => d.name === name);
    updateDetected((rows) => rows.filter((r) => r.name !== name));
    setConfirmed((c) => {
      const next = { ...c };
      delete next[name];
      return next;
    });
    triggerToast(`Removed ${name}`, {
      label: 'Undo',
      onClick: () => {
        if (!removed) return;
        updateDetected((rows) => [...rows, removed]);
      },
    });
  };

  const setGrams = (name: string, deltaOrAbsolute: number, absolute?: boolean) => {
    updateDetected((rows) =>
      rows.map((r) => {
        if (r.name !== name) return r;
        const next = absolute ? deltaOrAbsolute : r.grams + deltaOrAbsolute;
        return { ...r, grams: Math.max(5, Math.min(800, next)) };
      }),
    );
  };

  const replaceName = (oldName: string, newName: string) => {
    if (!newName || newName === oldName) return;
    updateDetected((rows) =>
      rows.map((r) => (r.name === oldName ? { ...r, name: newName } : r)),
    );
    setConfirmed((c) => {
      const next = { ...c };
      if (next[oldName]) {
        next[newName] = next[oldName];
        delete next[oldName];
      }
      return next;
    });
  };

  const addPairing = (_existingName: string, pairingName: string) => {
    const meta = contextPairings.find((h) => h.name.toLowerCase() === pairingName.toLowerCase());
    if (!meta) return;
    if (detected.some((d) => d.name.toLowerCase() === meta.name.toLowerCase())) {
      triggerToast(isBn ? `${isBn ? meta.name_bn : meta.name} ইতিমধ্যে তালিকায় রয়েছে` : `${meta.name} already in list`);
      return;
    }
    updateDetected((rows) => [
      ...rows,
      { name: meta.name, name_bn: meta.name_bn, confidence: meta.confidence, grams: meta.grams, note: null },
    ]);
    triggerToast(isBn ? `${isBn ? meta.name_bn : meta.name} যোগ করা হয়েছে` : `Added ${meta.name}`);
  };

  const openAddCustom = () => setAddCustomOpen(true);
  const closeAddCustom = () => setAddCustomOpen(false);

  // Inline modal replaces window.prompt() — prompt() is blocked on many
  // desktop browsers (Chrome 92+, embedded webviews, PWA contexts) and
  // doesn't match the app's design language.
  const submitAddCustom = (name: string, grams: number) => {
    if (detected.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      triggerToast(`${name} already in list`);
      return;
    }
    updateDetected((rows) => [
      ...rows,
      { name, confidence: 100, grams, note: null },
    ]);
    triggerToast(`Added ${name}`);
    setAddCustomOpen(false);
  };

  const onLongPressRow = (name: string) => {
    if (editMode) return;
    setMultiSelect(true);
    setSelected({ [name]: true });
  };

  const onConfirmAllSelected = () => {
    const next = { ...confirmed };
    Object.keys(selected).forEach((n) => {
      const item = detected.find((d) => d.name === n);
      if (item && item.confidence >= 60) next[n] = true;
    });
    setConfirmed(next);
    triggerToast('Confirmed selected');
    setMultiSelect(false);
    setSelected({});
  };

  const onReviewAllSelected = () => {
    setStep(1);
    setMultiSelect(false);
    setSelected({});
  };

  const onCancelMulti = () => {
    setMultiSelect(false);
    setSelected({});
  };

  const onShare = () => {
    triggerHaptic('light');
    const lines = detected
      .map((d, i) => `${i + 1}. ${foodName(d.name, d.name_bn)} — ${d.grams}g (${d.confidence}%)`)
      .join('\n');
    if (navigator?.clipboard) navigator.clipboard.writeText(lines).catch(() => {});
    triggerToast(isBn ? 'ক্লিপবোর্ডে কপি করা হয়েছে' : 'Copied to clipboard');
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const hasHighConfSelected = Object.keys(selected).some((n) => {
    const it = detected.find((d) => d.name === n);
    return it && it.confidence >= 60;
  });

  const handleAddMissingToGrocery = async (recipeIdx: number, items: string[]) => {
    if (items.length === 0) return;
    try {
      setIsAddingMissingGrocery((prev) => ({ ...prev, [recipeIdx]: true }));
      triggerHaptic('light');
      const itemsToSync = items.map((item) => {
        const market = resolveMarketPrice(item);
        return {
          category: 'Pantry',
          name: item,
          price: market.matched ? market.unitPrice : 60,
        };
      });
      await addGroceryItemsBatch(itemsToSync);
      setAddedGroceryIds((prev) => ({ ...prev, [recipeIdx]: true }));
      triggerHaptic('success');
      triggerToast(
        isBn
          ? `${toBengaliDigits(items.length)}টি উপাদান বাজারে যুক্ত হয়েছে!`
          : `Added ${items.length} items to Grocery List!`,
        onNavigateToGrocery
          ? {
              label: isBn ? 'বাজার দেখুন' : 'View in Grocery',
              onClick: onNavigateToGrocery,
            }
          : undefined,
      );
    } catch {
      triggerHaptic('warning');
      triggerToast(isBn ? 'বাজারে যোগ করতে ব্যর্থ হয়েছে' : 'Failed to add items');
    } finally {
      setIsAddingMissingGrocery((prev) => ({ ...prev, [recipeIdx]: false }));
    }
  };

  const handleToggleDetectedGrocery = async () => {
    if (detected.length === 0) return;

    if (addedDetectedToGrocery) {
      triggerHaptic('toggle');
      triggerToast(
        isBn
          ? 'উপাদানগুলো ইতিমধ্যে আপনার বাজারের তালিকায় আছে'
          : 'Items are already in your Grocery list',
        onNavigateToGrocery
          ? {
              label: isBn ? 'বাজার দেখুন' : 'View in Grocery',
              onClick: onNavigateToGrocery,
            }
          : undefined,
      );
      return;
    }

    triggerHaptic('light');
    setIsAddingDetectedGrocery(true);

    try {
      const itemsToSync = detected.map((item) => {
        const market = resolveMarketPrice(item.name);
        return {
          category: NUTRITION_DB[item.name]?.category || 'Produce',
          name: item.name,
          price: market.matched ? market.unitPrice : 60,
        };
      });

      const created = await addGroceryItemsBatch(itemsToSync);
      const newMap = { ...groceryItemMap };
      for (const c of created) {
        newMap[c.name.toLowerCase().trim()] = c.id;
      }
      setGroceryItemMap(newMap);
      setAddedDetectedToGrocery(true);
      triggerHaptic('success');

      triggerToast(
        isBn
          ? `${toBengaliDigits(detected.length)}টি উপাদান বাজারে যুক্ত হয়েছে!`
          : `Added ${detected.length} items to Grocery List!`,
        onNavigateToGrocery
          ? {
              label: isBn ? 'বাজার দেখুন' : 'View in Grocery',
              onClick: onNavigateToGrocery,
            }
          : undefined,
      );
    } catch {
      triggerHaptic('warning');
      triggerToast(isBn ? 'বাজারে যোগ করতে ব্যর্থ হয়েছে' : 'Failed to add items');
    } finally {
      setIsAddingDetectedGrocery(false);
    }
  };

  const handleToggleSingleItemGrocery = async (name: string) => {
    const key = name.toLowerCase().trim();
    const existingId = groceryItemMap[key];

    if (existingId) {
      triggerHaptic('toggle');
      try {
        await removeGroceryItem(existingId);
        setGroceryItemMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        triggerToast(
          isBn ? `${foodName(name)} বাজার থেকে সরানো হয়েছে` : `Removed ${name} from Grocery`,
        );
      } catch {
        triggerHaptic('warning');
        triggerToast(isBn ? 'মুছতে ব্যর্থ হয়েছে' : 'Failed to remove');
      }
    } else {
      triggerHaptic('light');
      try {
        const market = resolveMarketPrice(name);
        const item = await addGroceryItem(
          NUTRITION_DB[name]?.category || 'Produce',
          name,
          market.matched ? market.unitPrice : 60,
        );
        setGroceryItemMap((prev) => ({ ...prev, [key]: item.id }));
        triggerHaptic('success');
        triggerToast(
          isBn ? `${foodName(name)} বাজারে যোগ করা হয়েছে` : `Added ${name} to Grocery`,
          onNavigateToGrocery
            ? {
                label: isBn ? 'বাজার দেখুন' : 'View Grocery',
                onClick: onNavigateToGrocery,
              }
            : undefined,
        );
      } catch {
        triggerHaptic('warning');
        triggerToast(isBn ? 'যোগ করতে ব্যর্থ হয়েছে' : 'Failed to add');
      }
    }
  };

  const isNonFoodRejection = analysisResult?.is_food === false;
  const rejectionReason = (analysisResult?.rejection_reason_en || '').toLowerCase();
  const isServiceUnavailable =
    isNonFoodRejection &&
    (rejectionReason.includes('unavailable') ||
      rejectionReason.includes('busy') ||
      rejectionReason.includes('connection') ||
      rejectionReason.includes('service') ||
      (analysisResult?.overall_confidence === 0 && (!analysisResult?.detected || analysisResult.detected.length === 0)));

  const visibleItems = useMemo(() => {
    if (step === 1) {
      // In Adjust step, show all items but prioritize items needing attention first
      return [...sorted].sort((a, b) => a.confidence - b.confidence);
    }
    return sorted;
  }, [sorted, step]);

  return (
    <LocalizedContent>
    <div style={{ padding: '12px 16px 24px', position: 'relative' }}>
      <div
        style={{
          position: 'sticky',
          top: -8,
          zIndex: 10,
          paddingTop: 6,
          paddingBottom: 8,
          background: isDark
            ? 'linear-gradient(180deg, rgba(27, 20, 17, 0.92) 0%, rgba(27, 20, 17, 0.4) 75%, rgba(27, 20, 17, 0) 100%)'
            : 'linear-gradient(180deg, rgba(72, 43, 27, 0.92) 0%, rgba(72, 43, 27, 0.4) 75%, rgba(72, 43, 27, 0) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          marginInline: -16,
          paddingInline: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {!isNonFoodRejection && <StepIndicator step={step} onStep={setStep} />}
        </div>
        <PhotoThumb src={capturedImage} />
      </div>

      {/* ── Non-Food Rejection Safety Gate View ── */}
      {isNonFoodRejection && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="glass-card"
          style={{
            marginTop: 16,
            padding: '36px 20px',
            textAlign: 'center',
            borderRadius: 22,
            background: 'rgba(239, 68, 68, 0.07)',
            border: '1.5px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 8px 32px rgba(239, 68, 68, 0.08)',
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              margin: '0 auto 16px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.14)',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertOctagon size={36} strokeWidth={2.2} />
          </div>
          <h3
            style={{
              fontFamily: 'Inter',
              fontSize: 19,
              fontWeight: 700,
              color: T.ink,
              margin: '0 0 8px',
            }}
          >
            {isServiceUnavailable
              ? (isBn ? 'ভিশন সার্ভিস সংযোগ সমস্যা' : 'Vision Service Temporarily Unavailable')
              : (isBn ? 'খাবার হিসেবে শনাক্ত করা যায়নি' : 'Non-Food Item Detected')}
          </h3>
          <p
            style={{
              fontFamily: 'Inter',
              fontSize: 13,
              color: T.inkSoft,
              lineHeight: 1.5,
              maxWidth: 320,
              margin: '0 auto 24px',
            }}
          >
            {isBn
              ? (analysisResult.rejection_reason_bn || 'এই ছবিতে কোনো খাবার বা উপাদান শনাক্ত করা যায়নি। অনুগ্রহ করে কোনো খাবার বা উপাদানের ছবি তুলুন।')
              : (analysisResult.rejection_reason_en || 'No food items were detected in this image. Please take a clear photo of a meal or ingredient.')}
          </p>
          {onRetake && (
            <motion.button
              type="button"
              onClick={onRetake}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              style={{
                background: T.primary,
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 999,
                padding: '12px 28px',
                fontFamily: 'Inter',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(201, 98, 45, 0.35)',
              }}
            >
              {isServiceUnavailable
                ? (isBn ? 'আবার চেষ্টা করুন' : 'Retry Analysis')
                : (isBn ? 'পুনরায় ছবি তুলুন' : 'Retake Photo')}
            </motion.button>
          )}
        </motion.div>
      )}

      {/* ── Diet-Conflict Alert Banner ── */}
      {!isNonFoodRejection && dietConflicts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          style={{
            marginBottom: 14,
            padding: '14px 16px',
            borderRadius: 16,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1.5px solid rgba(239, 68, 68, 0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={17} color="#DC2626" />
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>
              {isBn ? '⚠️ খাদ্য নিরাপত্তা সতর্কতা' : '⚠️ Dietary Conflict Alert'}
            </h4>
          </div>
          {dietConflicts.map((c) => (
            <div key={c.id} style={{ marginTop: 6, fontSize: 12, color: T.ink, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700, color: '#991B1B' }}>{isBn ? c.title_bn : c.title_en}:</span>{' '}
              {isBn ? c.detail_bn : c.detail_en}
              {c.recommendation_bn && (
                <div style={{ marginTop: 4, color: T.primary, fontSize: 11.5, fontWeight: 600 }}>
                  💡 {isBn ? c.recommendation_bn : c.recommendation_en}
                </div>
              )}
            </div>
          ))}
          <div
            style={{
              marginTop: 10,
              paddingTop: 6,
              borderTop: '1px solid rgba(239, 68, 68, 0.15)',
              fontSize: 10.5,
              color: T.inkSoft,
            }}
          >
            {isBn ? CLINICAL_DISCLAIMER_BN : CLINICAL_DISCLAIMER_EN}
          </div>
        </motion.div>
      )}

      {/* ── Inferred Hidden Ingredients Culinary Strip ── */}
      {!isNonFoodRejection && analysisResult?.inferred_hidden_ingredients && analysisResult.inferred_hidden_ingredients.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 12,
            background: T.cardBg,
            border: '1px solid rgba(74, 58, 52, 0.12)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: T.inkSoft }}>
            🍳 {isBn ? 'অনুমানকৃত রান্নার উপাদান:' : 'Inferred Cooking Media:'}
          </span>
          {analysisResult.inferred_hidden_ingredients.map((ing, idx) => (
            <span
              key={idx}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(201, 98, 45, 0.12)',
                color: T.primary,
              }}
            >
              {foodName(ing)}
            </span>
          ))}
        </div>
      )}

      {/* ── Mode 2: Raw Ingredients & Recipe Suggestions Card ── */}
      {!isNonFoodRejection && analysisResult?.input_mode === 'raw_ingredients' && analysisResult.recipe_suggestions && analysisResult.recipe_suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
          style={{
            marginBottom: 16,
            padding: '16px',
            borderRadius: 20,
            background: 'rgba(255, 255, 255, 0.75)',
            border: '1.5px solid rgba(201, 98, 45, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: T.primary,
                color: '#FFFFFF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={14} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.ink }}>
                {isBn ? '🥬 কাঁচা উপাদান ও রেসিপি অনুপ্রেরণা' : '🥬 Raw Produce & Recipe Inspiration'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: T.inkSoft }}>
                {isBn ? 'শনাক্তকৃত উপাদান দিয়ে তৈরি স্বাস্থ্যকর রান্না' : 'Healthy dishes you can cook with these ingredients'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {analysisResult.recipe_suggestions.map((recipe, rIdx) => {
              const alreadyAdded = addedGroceryIds[rIdx];
              return (
                <div
                  key={rIdx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'rgba(249, 242, 228, 0.65)',
                    border: '1px solid rgba(74, 58, 52, 0.1)',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 4 }}>
                    {isBn ? recipe.title_bn : recipe.title_en}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.4, marginBottom: 8 }}>
                    {isBn ? recipe.description_bn : recipe.description_en}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {recipe.matched_ingredients.map((m, mIdx) => (
                      <span
                        key={mIdx}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: 'rgba(46, 125, 50, 0.12)',
                          color: '#2E7D32',
                        }}
                      >
                        ✓ {foodName(m)}
                      </span>
                    ))}
                    {recipe.missing_ingredients.map((miss, missIdx) => (
                      <span
                        key={missIdx}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: 'rgba(201, 98, 45, 0.12)',
                          color: T.primary,
                        }}
                      >
                        + {foodName(miss)}
                      </span>
                    ))}
                  </div>

                  {recipe.missing_ingredients.length > 0 && (
                    <motion.button
                      type="button"
                      onClick={() => handleAddMissingToGrocery(rIdx, recipe.missing_ingredients)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={alreadyAdded || isAddingMissingGrocery[rIdx]}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 999,
                        background: alreadyAdded ? '#2E7D32' : T.primary,
                        color: '#FFFFFF',
                        border: 'none',
                        fontFamily: 'Inter',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: alreadyAdded ? 'default' : isAddingMissingGrocery[rIdx] ? 'wait' : 'pointer',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                      }}
                    >
                      {isAddingMissingGrocery[rIdx] ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          <span>{isBn ? 'যোগ হচ্ছে...' : 'Adding...'}</span>
                        </>
                      ) : alreadyAdded ? (
                        <>
                          <CheckCircle2 size={12} /> {isBn ? 'বাজারে যোগ করা হয়েছে' : 'Added to Grocery'}
                        </>
                      ) : (
                        <>
                          <ShoppingBag size={12} /> {isBn ? 'মুদির তালিকায় বাকি উপাদান যোগ করুন' : 'Add Missing to Grocery'}
                        </>
                      )}
                    </motion.button>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Mode 3: Restaurant Menu Analyzer Card ── */}
      {!isNonFoodRejection && analysisResult?.input_mode === 'restaurant_menu' && analysisResult.menu_analysis && analysisResult.menu_analysis.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
          style={{
            marginBottom: 16,
            padding: '16px',
            borderRadius: 20,
            background: 'rgba(255, 255, 255, 0.75)',
            border: '1.5px solid rgba(74, 58, 52, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#2E7D32',
                color: '#FFFFFF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BookOpen size={14} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.ink }}>
                {isBn ? '📋 রেস্তোরাঁর মেনু স্বাস্থ্য বিশ্লেষক' : '📋 Restaurant Menu Health Analyzer'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: T.inkSoft }}>
                {isBn ? 'আপনার প্রোফাইল অনুযায়ী সর্বোত্তম পছন্দ' : 'Ranked choices tailored to your health profile'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {analysisResult.menu_analysis.map((dish, dIdx) => (
              <div
                key={dIdx}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: dish.is_healthy_pick
                    ? 'rgba(46, 125, 50, 0.08)'
                    : dish.is_ultra_processed
                    ? 'rgba(239, 68, 68, 0.08)'
                    : 'rgba(249, 242, 228, 0.6)',
                  border: `1px solid ${
                    dish.is_healthy_pick
                      ? 'rgba(46, 125, 50, 0.25)'
                      : dish.is_ultra_processed
                      ? 'rgba(239, 68, 68, 0.25)'
                      : 'rgba(74, 58, 52, 0.1)'
                  }`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
                    {isBn ? dish.dish_name_bn : dish.dish_name_en}
                  </span>
                  {dish.is_healthy_pick && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: '#DCFCE7',
                        color: '#166534',
                      }}
                    >
                      ★ {isBn ? 'স্বাস্থ্যকর পছন্দ' : 'Healthy Pick'}
                    </span>
                  )}
                  {dish.is_ultra_processed && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: '#FEE2E2',
                        color: '#991B1B',
                      }}
                    >
                      ⚠️ {isBn ? 'প্রক্রিয়াজাত' : 'Ultra-Processed'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.4 }}>
                  {isBn ? dish.notes_bn : dish.notes_en}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Main Detected List & Totals (Hidden if Non-Food Rejection) ── */}
      {!isNonFoodRejection && (
        <>
          {analysisMessage && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                margin: '0 0 12px',
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(201, 98, 45, 0.12)',
                border: '1px solid rgba(201, 98, 45, 0.3)',
                color: T.ink,
                fontFamily: 'Inter',
                fontSize: 12,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{analysisMessage}</span>
              {onRetake && (
                <button
                  type="button"
                  onClick={onRetake}
                  style={{
                    flexShrink: 0,
                    border: 0,
                    borderRadius: 999,
                    padding: '8px 12px',
                    background: T.primary,
                    color: '#FFFFFF',
                    font: 'inherit',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isBn ? 'আবার চেষ্টা করুন' : 'Try again'}
                </button>
              )}
            </div>
          )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 24,
              fontWeight: 600,
              color: '#2C1A11',
              letterSpacing: '-0.015em',
              margin: 0,
            }}
          >
            {isBn ? 'শনাক্তকৃত খাবার' : 'Detected items'}
          </h2>
          <p
            style={{
              fontFamily: 'Inter',
              fontSize: 12,
              color: '#684A37',
              margin: '3px 0 0',
              fontWeight: 500,
            }}
          >
            {isBn ? toBengaliDigits(detected.length) : detected.length} {isBn ? 'টি খাবার' : detected.length === 1 ? 'item' : 'items'} · {isBn ? toBengaliDigits(Math.round(totals.kcal)) : Math.round(totals.kcal)} {isBn ? 'কিলোক্যালরি' : 'kcal'}
          </p>
        </div>
        <motion.button
          type="button"
          onClick={() => {
            setEditMode((v) => !v);
            setMultiSelect(false);
            setSelected({});
          }}
          whileHover={{ y: -1, scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          aria-pressed={editMode}
          aria-label={editMode ? (isBn ? 'সম্পাদনা বন্ধ করুন' : 'Exit edit mode') : (isBn ? 'সম্পাদনা শুরু করুন' : 'Enter edit mode')}
          className="champagne-pill"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            borderRadius: 999,
            background: editMode
              ? 'linear-gradient(145deg, #42291E 0%, #24140D 100%)'
              : 'rgba(255, 250, 244, 0.72)',
            border: editMode ? '1px solid rgba(255, 255, 255, 0.35)' : '1px solid rgba(255, 255, 255, 0.85)',
            boxShadow: editMode
              ? '0 4px 14px -2px rgba(36, 20, 13, 0.5)'
              : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
            fontFamily: 'Inter',
            fontSize: 11.5,
            fontWeight: 600,
            color: editMode ? '#FFFFFF' : '#3D271D',
            cursor: 'pointer',
            minHeight: 32,
          }}
        >
          <Edit3 size={12} /> {editMode ? (isBn ? 'সম্পন্ন' : 'Done') : (isBn ? 'সম্পাদনা' : 'Edit')}
        </motion.button>
      </div>

      {analysisResult?.source === 'precomputed_reference' && (
        <div
          role="note"
          className="champagne-pill"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            margin: '0 0 16px',
            padding: '12px 14px',
            borderRadius: 16,
            background: isDark ? 'rgba(255, 180, 50, 0.12)' : 'rgba(255, 245, 235, 0.25)',
            border: isDark ? '1px solid rgba(255, 180, 50, 0.3)' : '1px solid rgba(255, 255, 255, 0.55)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: isDark ? '#F9F2E4' : '#FFF0E2',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
            fontFamily: 'Inter',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: isDark ? '#F59E0B' : '#FFD29D' }} />
          <span>
            {isBn
              ? 'এটি আগে থেকে প্রস্তুত ছবির রেফারেন্স—লাইভ ভিশন বিশ্লেষণ নয়। খাবারের লেবেল নির্ধারিত; পরিমাণ ও পুষ্টির মান আনুমানিক।'
              : 'Precomputed image reference—not live vision analysis. Food labels are preset; portion sizes and nutrition are estimates.'}
          </span>
        </div>
      )}

      <SummaryCard totals={totals} itemCount={detected.length} profile={profile} />

      {step === 2 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="champagne-panel"
          style={{
            marginTop: 14,
            marginBottom: 24,
            padding: '24px 20px',
            borderRadius: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'linear-gradient(145deg, #166534 0%, #0F4522 100%)',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 6px 16px -3px rgba(22, 101, 52, 0.45), inset 0 1px 1.5px rgba(255, 255, 255, 0.4)',
              }}
            >
              <CheckCircle2 size={24} strokeWidth={2.4} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: isDark ? '#F9F2E4' : '#24130A', fontFamily: 'var(--font-serif)', letterSpacing: '-0.015em' }}>
                {isBn ? 'খাবার নিশ্চিতকরণ' : 'Confirm Your Meal'}
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#684A37', fontFamily: 'Inter' }}>
                {isBn
                  ? 'সব উপাদান যাচাই সম্পন্ন হয়েছে। পুষ্টি ও বিশ্লেষণ দেখতে নিশ্চিত করুন।'
                  : 'All food items verified. Confirm to analyze nutrients and log this meal.'}
              </p>
            </div>
          </div>

          {/* Verified Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {detected.map((it) => (
              <div
                key={it.name}
                className="champagne-pill"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: 'rgba(255, 250, 244, 0.72)',
                  border: '1px solid rgba(255, 255, 255, 0.85)',
                  fontFamily: 'Inter',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #166534 0%, #0F4522 100%)',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#2C1A11' }}>
                    {foodName(it.name, it.name_bn)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#684A37' }}>
                    ~{isBn ? `${toBengaliDigits(it.grams)} গ্রাম` : `${it.grams}g`}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'rgba(34, 197, 94, 0.14)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: '#15803D',
                    }}
                  >
                    {isBn ? toBengaliDigits(it.confidence) : it.confidence}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Macro Breakdown Summary */}
          <div
            className="champagne-pill"
            style={{
              padding: '12px 14px',
              borderRadius: 16,
              marginBottom: 18,
              display: 'flex',
              justifyContent: 'space-around',
              textAlign: 'center',
              fontFamily: 'Inter',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isBn ? 'ক্যালরি' : 'Calories'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#F9F2E4' : '#24130A', marginTop: 2 }}>
                {isBn ? `${toBengaliDigits(Math.round(totals.kcal))} কিলোক্যালরি` : `${Math.round(totals.kcal)} kcal`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isBn ? 'প্রোটিন' : 'Protein'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#F9F2E4' : '#24130A', marginTop: 2 }}>
                {isBn ? `${toBengaliDigits(Math.round(totals.protein))} গ্রাম` : `${Math.round(totals.protein)}g`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isBn ? 'কার্বোহাইড্রেট' : 'Carbs'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#F9F2E4' : '#24130A', marginTop: 2 }}>
                {isBn ? `${toBengaliDigits(Math.round(totals.carbs))} গ্রাম` : `${Math.round(totals.carbs)}g`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: isDark ? 'rgba(249, 242, 228, 0.65)' : '#6E4A35', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isBn ? 'চর্বি' : 'Fat'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#F9F2E4' : '#24130A', marginTop: 2 }}>
                {isBn ? `${toBengaliDigits(Math.round(totals.fat))} গ্রাম` : `${Math.round(totals.fat)}g`}
              </div>
            </div>
          </div>

          {/* Confirmation CTA Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <motion.button
              type="button"
              onClick={() => setStep(1)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="champagne-pill"
              style={{
                flex: 1,
                padding: '13px 14px',
                borderRadius: 999,
                color: isDark ? '#F9F2E4' : '#24130A',
                fontFamily: 'Inter',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isBn ? '← পরিবর্তন করুন' : '← Adjust Items'}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => {
                const allConf: Record<string, boolean> = {};
                detected.forEach((d) => { allConf[d.name] = true; });
                setConfirmed(allConf);
                void updateLatestMeal({ reviewStatus: 'confirmed' });
                triggerToast(isBn ? 'খাবার নিশ্চিত করা হয়েছে!' : 'Meal confirmed!');
                onViewNutrients?.();
              }}
              whileHover={{ y: -1, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              style={{
                flex: 2,
                padding: '13px 18px',
                borderRadius: 999,
                background: 'linear-gradient(145deg, #1C4A2E 0%, #0D2E1C 100%)',
                color: '#FAF4EC',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                fontFamily: 'Inter',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 24px -4px rgba(22, 68, 42, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>{isBn ? 'খাবার নিশ্চিত করুন ও পুষ্টি দেখুন →' : 'Confirm Meal & View Nutrients →'}</span>
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <>
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: isDark ? 'rgba(201, 98, 45, 0.16)' : 'rgba(255, 245, 235, 0.22)',
                border: isDark ? '1px solid rgba(201, 98, 45, 0.35)' : '1px solid rgba(255, 255, 255, 0.45)',
                margin: '12px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <SlidersHorizontal size={18} color={isDark ? '#F39C12' : '#F7B074'} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: isDark ? '#FAF4EC' : '#FFF0E2', lineHeight: 1.4, fontFamily: 'Inter' }}>
                {isBn
                  ? 'খাবারের অংশ বা ওজন (গ্রাম) সমন্বয় করুন। নতুন খাবার যোগ করতে নিচে + চাপুন বা এডিট করুন।'
                  : 'Fine-tune portion sizes or item weights below. Tap Edit or + to adjust your meal.'}
              </span>
            </motion.div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              gap: 8,
            }}
          >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SortMenu value={sortKey} onChange={setSortKey} />
          {diabeticMode && (
            <span
              className="tnum"
              style={{
                fontFamily: 'Inter',
                fontSize: 10,
                fontWeight: 600,
                color: isDark ? '#FAF4EC' : '#FFF0E2',
                background: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 245, 235, 0.22)',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.45)',
                padding: '4px 8px',
                borderRadius: 999,
                letterSpacing: '0.02em',
              }}
              title={isBn ? 'আপনার প্রোফাইল অনুযায়ী পুনর্ক্রমিত' : 'Re-ranked for your diabetic profile'}
            >
              {isBn ? '✓ পুনর্ক্রমিত' : '✓ re-ranked'}
            </span>
          )}
          <motion.button
            type="button"
            onClick={onShare}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            aria-label={isBn ? 'শনাক্তকৃত খাবার শেয়ার করুন' : 'Share detected items'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: 'transparent',
              border: 'none',
              padding: '5px 6px',
              fontFamily: 'Inter',
              fontSize: 11.5,
              fontWeight: 600,
              color: isDark ? '#FAF4EC' : '#FFF0E2',
              cursor: 'pointer',
              minHeight: 32,
            }}
          >
            <Share2 size={12} /> {isBn ? 'শেয়ার' : 'Share'}
          </motion.button>
          <motion.button
            type="button"
            onClick={handleToggleDetectedGrocery}
            disabled={isAddingDetectedGrocery}
            whileHover={{ y: -1, scale: 1.02 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            aria-label={
              addedDetectedToGrocery
                ? (isBn ? 'উপাদানগুলো ইতিমধ্যে বাজারে আছে' : 'Items already in Grocery List')
                : (isBn ? 'বাজারের তালিকায় উপাদান যোগ করুন' : 'Add ingredients to Grocery List')
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: addedDetectedToGrocery
                ? (isDark ? 'rgba(76, 175, 80, 0.22)' : 'rgba(46, 125, 50, 0.12)')
                : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)'),
              border: addedDetectedToGrocery
                ? (isDark ? '1px solid rgba(76, 175, 80, 0.50)' : '1px solid rgba(46, 125, 50, 0.38)')
                : (isDark ? '1px solid rgba(255, 255, 255, 0.14)' : '1px solid rgba(255, 255, 255, 0.45)'),
              borderRadius: 8,
              padding: '4px 9px',
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: 600,
              color: addedDetectedToGrocery ? (isDark ? '#81C784' : '#2E7D32') : (isDark ? '#FAF4EC' : '#FFF0E2'),
              cursor: isAddingDetectedGrocery ? 'wait' : 'pointer',
              minHeight: 28,
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              boxShadow: addedDetectedToGrocery ? '0 2px 8px rgba(46, 125, 50, 0.18)' : 'none',
            }}
          >
            {isAddingDetectedGrocery ? (
              <>
                <Loader2 size={12} className="animate-spin" color={T.primary} />
                <span>{isBn ? 'যোগ হচ্ছে...' : 'Adding...'}</span>
              </>
            ) : addedDetectedToGrocery ? (
              <motion.span
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Check size={12} strokeWidth={2.8} />
                <span>{isBn ? 'বাজারে যুক্ত ✓' : 'In Grocery ✓'}</span>
              </motion.span>
            ) : (
              <>
                <ShoppingBag size={12} color={T.primary} />
                <span>{isBn ? 'বাজারে যোগ' : 'Add to Grocery'}</span>
              </>
            )}
          </motion.button>
        </div>

        <motion.button
          type="button"
          onClick={openAddCustom}
          whileHover={{ scale: 1.08, rotate: 90 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          aria-label={isBn ? 'কাস্টম খাবার যোগ করুন' : 'Add custom item'}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: T.primary,
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            boxShadow: `0 4px 10px -3px ${T.primary}66`,
          }}
        >
          <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
        </motion.button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        layout
        style={{
          position: 'relative',
          paddingBottom: multiSelect ? 100 : 16,
        }}
      >
        <AnimatePresence initial={false}>
          {visibleItems.map((it) => {
            const meta = NUTRITION_DB[it.name];
            const isItemInGrocery = !!groceryItemMap[it.name.toLowerCase().trim()];
            return (
              <div key={it.name} style={{ position: 'relative' }}>
                <ExpandableRow
                  item={it}
                  glycemic={diabeticMode ? meta?.glycemic : undefined}
                  isConfirmed={!!confirmed[it.name]}
                  isSelected={!!selected[it.name]}
                  multiSelect={multiSelect}
                  editMode={editMode}
                  isItemInGrocery={isItemInGrocery}
                  maxProtein={maxProtein}
                  maxCarbs={maxCarbs}
                  maxFat={maxFat}
                  onToggleGrocery={handleToggleSingleItemGrocery}
                  onConfirm={confirm}
                  onRemove={remove}
                  onGramsChange={setGrams}
                  onLongPress={onLongPressRow}
                  onRename={replaceName}
                  onReplace={(oldName, altName) => replaceName(oldName, altName)}
                  onAddPairing={addPairing}
                />
              </div>
            );
          })}
        </AnimatePresence>

        {step === 0 && !multiSelect && detected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            style={{ marginTop: 14 }}
          >
            <div
              style={{
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 600,
                color: isDark ? '#D8C4B6' : '#FFF0E2',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}
            >
              {isBn ? 'এর সাথে সাধারণত যা খাওয়া হয়' : 'Frequently eaten with this'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contextPairings.map((h) => (
                <motion.button
                  key={h.name}
                  type="button"
                  onClick={() => {
                    if (detected.some((d) => d.name.toLowerCase() === h.name.toLowerCase())) {
                      triggerToast(isBn ? `${isBn ? h.name_bn : h.name} আগেই যোগ করা হয়েছে` : `${h.name} already added`);
                      return;
                    }
                    updateDetected((rows) => [
                      ...rows,
                      { name: h.name, name_bn: h.name_bn, confidence: h.confidence, grams: h.grams, note: null },
                    ]);
                    triggerToast(isBn ? `${isBn ? h.name_bn : h.name} যোগ করা হয়েছে` : `Added ${h.name}`);
                  }}
                  whileHover={{ y: -1, scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  aria-label={isBn ? `${isBn ? h.name_bn : h.name} যোগ করুন` : `Add ${h.name}`}
                  className="champagne-pill"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 250, 244, 0.85)',
                    border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.85)',
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontWeight: 600,
                    color: isDark ? '#FAF4EC' : '#2C1A11',
                    cursor: 'pointer',
                    minHeight: 32,
                  }}
                >
                  <span aria-hidden="true">{h.emoji}</span>
                  <span>{isBn ? h.name_bn : h.name}</span>
                  <span style={{ color: isDark ? '#E8C49A' : T.primary, fontWeight: 700 }}>+</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {visibleItems.length === 0 && (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: isDark ? 'rgba(249, 242, 228, 0.78)' : '#FFF0E2',
              fontFamily: 'Inter',
              fontSize: 13,
            }}
          >
            {isBn ? 'পর্যালোচনার জন্য কোনো খাবার নেই। নতুন খাবার যোগ করতে + চাপুন।' : 'No items to review. Tap + to add a custom item.'}
          </div>
        )}

        {step === 0 && detected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginTop: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <motion.button
              type="button"
              onClick={() => setStep(1)}
              whileHover={{ y: -1, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 999,
                background: 'linear-gradient(145deg, #42291E 0%, #24140D 100%)',
                color: '#FAF4EC',
                border: '1px solid rgba(255, 255, 255, 0.28)',
                fontFamily: 'Inter',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 22px -3px rgba(36, 20, 13, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span>{isBn ? 'পরবর্তী: পরিমাণ সমন্বয় করুন (Adjust) →' : 'Next: Adjust Portions & Items →'}</span>
            </motion.button>
            <button
              type="button"
              onClick={() => setStep(2)}
              style={{
                background: 'none',
                border: 'none',
                padding: '6px',
                color: '#8E674F',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {isBn ? 'অথবা সরাসরি খাবার নিশ্চিতকরণে যান (Confirm) →' : 'Or skip directly to Confirm Meal →'}
            </button>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              marginTop: 18,
              display: 'flex',
              gap: 10,
            }}
          >
            <motion.button
              type="button"
              onClick={() => setStep(0)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="champagne-pill"
              style={{
                flex: 1,
                padding: '13px 14px',
                borderRadius: 999,
                color: isDark ? '#F9F2E4' : '#24130A',
                fontFamily: 'Inter',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isBn ? '← পর্যালোচনায় ফিরুন' : '← Back to Review'}
            </motion.button>
            <motion.button
              type="button"
              onClick={() => setStep(2)}
              whileHover={{ y: -1, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              style={{
                flex: 2,
                padding: '13px 18px',
                borderRadius: 999,
                background: 'linear-gradient(145deg, #42291E 0%, #24140D 100%)',
                color: '#FAF4EC',
                border: '1px solid rgba(255, 255, 255, 0.28)',
                fontFamily: 'Inter',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 8px 22px -3px rgba(36, 20, 13, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
              }}
            >
              {isBn ? 'নিশ্চিতকরণে যান (Confirm) →' : 'Proceed to Confirm →'}
            </motion.button>
          </motion.div>
        )}
      </motion.div>
      </>
      )}

      <AnimatePresence>
        {multiSelect && (
          <BulkActionBar
            count={selectedCount}
            hasHighConf={hasHighConfSelected}
            onConfirmAll={onConfirmAllSelected}
            onReviewAll={onReviewAllSelected}
            onAddCustom={openAddCustom}
            onCancel={onCancelMulti}
          />
        )}
      </AnimatePresence>

      <SmartActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onViewNutrients={() => {
          setSheetOpen(false);
          onViewNutrients?.();
        }}
        onEditMeal={() => {
          setSheetOpen(false);
          setEditMode(true);
        }}
        onDiscard={() => {
          setSheetOpen(false);
          setConfirmed({});
        }}
      />

      <AddCustomModal
        open={addCustomOpen}
        onClose={closeAddCustom}
        onSubmit={submitAddCustom}
        existingNames={detected.map((d) => d.name)}
      />
      </>
      )}

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
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: 100,
              padding: '10px 14px',
              borderRadius: 14,
              background: T.primary,
              color: '#FFFFFF',
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'center',
              boxShadow: '0 8px 24px rgba(46, 37, 34, 0.25)',
              zIndex: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>{toast.msg}</span>
            {toast.action && (
              <motion.button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                style={{
                  background: 'rgba(249, 242, 228, 0.2)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(249, 242, 228, 0.4)',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {toast.action.label}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LocalizedContent>
  );
}