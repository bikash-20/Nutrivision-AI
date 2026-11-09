import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Share2, Trash2, X, ShoppingBag, Trash, Sparkles } from 'lucide-react';
import { T, MOCK_NUTRITION_DB } from '../../data';
import { useTokens } from '../../theme/useTokens';
import type { GroceryItem, GroceryList, UserProfile } from '../../types/schemas';
import {
  addGroceryItem as apiAddItem,
  getGroceryList,
  removeGroceryItem as apiRemoveItem,
  toggleGroceryItem as apiToggle,
  updateGroceryPrice as apiUpdatePrice,
  clearGroceryList,
  getMealHistory,
} from '../../lib/api';
import ConfidenceRing from '../ConfidenceRing';
import SectionLabel from '../SectionLabel';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { toBengaliDigits } from '../../lib/format';
import { resolveMarketPrice } from '../../lib/marketPrices';
import { fetchLivePrice } from '../../lib/priceScraper';
import { triggerHaptic } from '../../lib/haptics';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const group: import('framer-motion').Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as unknown as 'easeOut' } },
};

interface DisplayGroup {
  cat: string;
  items: GroceryItem[];
}

interface GroceryScreenProps {
  profile: UserProfile;
}

export default function GroceryScreen({ profile }: GroceryScreenProps) {
  useTokens();
  const { foodName, language } = useLanguage();
  const isBn = language === 'bn';
  const [groups, setGroups] = useState<DisplayGroup[]>([]);
  const [budget, setBudget] = useState(profile.budget ?? 500);
  const [toast, setToast] = useState<string | null>(null);
  const [addingAt, setAddingAt] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [mealCount, setMealCount] = useState<number | null>(null);
  const [livePriceMap, setLivePriceMap] = useState<Record<string, boolean>>({});
  const nextIdRef = useRef(100);
  const probedRef = useRef<Set<string>>(new Set());

  // Probe live market prices asynchronously with 3s timeout and update item price
  useEffect(() => {
    let isCurrent = true;
    const probeLive = async () => {
      let pricesUpdated = false;
      const statusMap: Record<string, boolean> = {};
      const updatedGroups = groups.map((g) => ({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));

      for (const g of updatedGroups) {
        for (const it of g.items) {
          const itemKey = `${it.id}:${it.name}`;
          if (probedRef.current.has(itemKey)) continue;

          try {
            const res = await fetchLivePrice(it.name);
            if (res.is_live_price && res.price_bdt > 0) {
              probedRef.current.add(itemKey);
              statusMap[it.id] = true;
              if (it.price !== res.price_bdt) {
                it.price = res.price_bdt;
                pricesUpdated = true;
                apiUpdatePrice(it.id, res.price_bdt).catch(() => {});
              }
            }
          } catch {
            // graceful fallback
          }
        }
      }
      if (!isCurrent) return;
      if (Object.keys(statusMap).length > 0) {
        setLivePriceMap((prev) => ({ ...prev, ...statusMap }));
      }
      if (pricesUpdated) {
        setGroups(updatedGroups);
      }
    };
    if (groups.length > 0) {
      probeLive();
    }
    return () => {
      isCurrent = false;
    };
  }, [groups]);

  // Load data on mount and whenever grocery list is updated (from pivots, meals, etc.)
  useEffect(() => {
    let cancelled = false;

    const loadData = () => {
      getGroceryList(profile).then((list: GroceryList) => {
        if (cancelled) return;
        setGroups(list.groups.map((g) => ({ cat: g.category, items: g.items })));
        setBudget(list.budget);
        setLoading(false);
      });
      getMealHistory().then((h) => {
        if (!cancelled) setMealCount(h.length);
      });
    };

    loadData();

    const handleGroceryUpdated = () => {
      loadData();
    };

    window.addEventListener('grocery-updated', handleGroceryUpdated);
    window.addEventListener('storage', handleGroceryUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener('grocery-updated', handleGroceryUpdated);
      window.removeEventListener('storage', handleGroceryUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to budget changes only — keeps the ring in sync without wiping items.
  useEffect(() => {
    setBudget(profile.budget ?? 500);
  }, [profile.budget]);

  const totalSpent = groups.reduce(
    (sum, g) => sum + g.items.filter((i) => i.checked).reduce((s, i) => s + i.price, 0),
    0,
  );
  // The Profile screen stores a *daily* grocery budget (৳500 default fallback). The
  // Grocery view is a *weekly* list, so the cap the user is shopping against
  // is daily × 7. We compute this once per render so the ring, remaining,
  // and over-budget toast all agree on the same number.
  const weeklyCap = (budget ?? 500) * 7;
  const remaining = Math.max(0, weeklyCap - totalSpent);
  const pct = Math.min(100, Math.round((totalSpent / weeklyCap) * 100));
  const overBudget = totalSpent > weeklyCap;

  useEffect(() => {
    if (overBudget) {
      setToast(
        isBn
          ? `সাপ্তাহিক বাজেটের চেয়ে ৳${toBengaliDigits(totalSpent - weeklyCap)} বেশি খরচ হয়েছে`
          : `Over weekly budget by ৳${totalSpent - weeklyCap}`,
      );
      const t = setTimeout(() => setToast(null), 1800);
      return () => clearTimeout(t);
    }
  }, [overBudget, totalSpent, weeklyCap, isBn]);

  // Clear All uses a two-tap confirm — first tap arms, second tap fires.
  // Auto-cancels after 3 s so the destructive state can't get stuck.
  useEffect(() => {
    if (!confirmingClear) return;
    const t = setTimeout(() => setConfirmingClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingClear]);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const toggle = async (gid: string) => {
    triggerHaptic('toggle');
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        items: g.items.map((i) =>
          i.id === gid ? { ...i, checked: !i.checked } : i,
        ),
      })),
    );
    await apiToggle(gid);
  };

  const remove = async (gid: string) => {
    triggerHaptic('warning');
    setGroups((gs) =>
      gs.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== gid) })),
    );
    await apiRemoveItem(gid);
  };

  const updatePrice = async (gid: string, price: number) => {
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        items: g.items.map((i) =>
          i.id === gid ? { ...i, price: Math.max(0, Math.min(9999, price)) } : i,
        ),
      })),
    );
    await apiUpdatePrice(gid, price);
  };

  const addItem = async (gi: number, name: string, price: number) => {
    triggerHaptic('success');
    const localId = `custom-${nextIdRef.current++}`;
    const optimistic: GroceryItem = { id: localId, name, price, checked: false };
    // Capture the category name from the SAME render state we just updated,
    // not from a stale closure — the form may have been opened from a previous
    // render after profile/state updates.
    let category = 'Other';
    setGroups((gs) => {
      const target = gs[gi];
      if (target) category = target.cat;
      return gs.map((g, idx) =>
        idx === gi ? { ...g, items: [...g.items, optimistic] } : g,
      );
    });
    setAddingAt(null);
    triggerToast(isBn ? `${foodName(name)} তালিকায় যোগ করা হয়েছে` : `Added ${name}`);
    // Backend reconciliation (mocked)
    await apiAddItem(category, name, price);
  };

  const shareList = () => {
    const lines = groups
      .flatMap((g) => g.items.map((i) => `${i.checked ? '✓' : '○'} ${foodName(i.name)} — ৳${isBn ? toBengaliDigits(i.price) : i.price}`))
      .join('\n');
    if (navigator?.clipboard) navigator.clipboard.writeText(lines).catch(() => {});
    triggerToast(isBn ? 'তালিকা ক্লিপবোর্ডে কপি করা হয়েছে' : 'List copied to clipboard');
  };

  return (
    <LocalizedContent>
    <div style={{ padding: '20px var(--screen-gutter, 24px) 24px' }}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 24,
            fontWeight: 600,
            color: '#2C1A11',
            letterSpacing: '-0.015em',
          }}
        >
          {isBn ? 'এই সপ্তাহের বাজার তালিকা' : "This week's list"}
        </h2>
        <ConfidenceRing
          value={pct}
          size={48}
          stroke={4}
          color={overBudget ? '#C87428' : '#2D6A4F'}
          delay={0.15}
        >
          <span
            className="tnum"
            style={{ fontSize: 9, fontFamily: 'Inter', fontWeight: 700 }}
          >
            {isBn ? toBengaliDigits(pct) : pct}%
          </span>
        </ConfidenceRing>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        style={{
          fontFamily: 'Inter',
          fontSize: 13,
          color: '#684A37',
          margin: '0 0 12px',
          lineHeight: 1.4,
          fontWeight: 500,
        }}
      >
        <span className="tnum" style={{ fontWeight: 700, color: '#2C1A11' }}>
          ৳{isBn ? toBengaliDigits(totalSpent) : totalSpent}
        </span>{' '}
        {isBn ? 'খরচ · ' : 'spent · '}
        <span
          className="tnum"
          style={{
            fontWeight: 700,
            color: overBudget ? '#C87428' : '#2C1A11',
          }}
        >
          ৳{isBn ? toBengaliDigits(remaining) : remaining}
        </span>{' '}
        {isBn ? 'বাকি আছে মোট ' : 'left of '}
        <span className="tnum" style={{ fontWeight: 700, color: '#2C1A11' }}>
          ৳{isBn ? toBengaliDigits(weeklyCap) : weeklyCap}
        </span>{' '}
        <span style={{ color: '#8E674F' }}>
          {isBn ? `(৳${toBengaliDigits(budget)}/দিন × ৭ দিন)` : `(৳${budget}/day × 7 days)`}
        </span>
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginBottom: 4,
        }}
      >
        <motion.button
          type="button"
          onClick={shareList}
          whileHover={{ y: -1, scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          aria-label={isBn ? 'বাজারের তালিকা শেয়ার করুন' : 'Share grocery list'}
          className="champagne-pill"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(255, 250, 244, 0.72)',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
            padding: '5px 12px',
            borderRadius: 999,
            fontFamily: 'Inter',
            fontSize: 11.5,
            fontWeight: 600,
            color: '#3D271D',
            cursor: 'pointer',
          }}
        >
          <Share2 size={12} color="#8E674F" /> {isBn ? 'তালিকা শেয়ার করুন' : 'Share list'}
        </motion.button>
      </motion.div>

      {/* ── Action toolbar ── */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12 }}
        className="champagne-panel"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 16,
          padding: 10,
          borderRadius: 20,
          background: 'rgba(255, 248, 240, 0.65)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85), 0 8px 24px -8px rgba(61, 39, 29, 0.1)',
        }}
      >
        {mealCount !== null && mealCount > 0 && (
          <motion.button
            type="button"
            onClick={async () => {
              const history = await getMealHistory();
              const ingredients = new Set<string>();
              history.forEach((m) => {
                m.items.forEach((it) => {
                  if (MOCK_NUTRITION_DB[it.name]) {
                    MOCK_NUTRITION_DB[it.name].pairings.forEach((p) => ingredients.add(p));
                  }
                });
              });
              if (ingredients.size === 0) {
                triggerToast(isBn ? 'খাবারের ইতিহাসে কোনো উপাদান পাওয়া যায়নি' : 'No pairings found in meal history');
                return;
              }
              let added = 0;
              const list = await getGroceryList(profile);
              const existing = new Set(list.groups.flatMap((g) => g.items.map((i) => i.name)));
              for (const name of ingredients) {
                if (existing.has(name)) continue;
                const priceInfo = resolveMarketPrice(name);
                let finalPrice = priceInfo.estimatedCost;
                try {
                  const live = await fetchLivePrice(name);
                  if (live && live.is_live_price && live.price_bdt > 0) {
                    finalPrice = live.price_bdt;
                  }
                } catch {
                  // Fallback
                }
                await apiAddItem('Produce', name, finalPrice);
                existing.add(name);
                added++;
              }
              if (added > 0) {
                const fresh = await getGroceryList(profile);
                setGroups(fresh.groups.map((g) => ({ cat: g.category, items: g.items })));
                triggerToast(isBn ? `খাবার থেকে ${toBengaliDigits(added)}টি উপাদান যোগ করা হয়েছে` : `Added ${added} item${added !== 1 ? 's' : ''} from meals`);
              } else {
                triggerToast(isBn ? 'প্রস্তাবিত সব উপাদান ইতিমধ্যেই তালিকায় রয়েছে' : 'All suggested items already in list');
              }
            }}
            whileHover={{ y: -1, scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            aria-label={isBn ? 'সাম্প্রতিক খাবারের তালিকা থেকে বাজারের উপাদান তৈরি করুন' : 'Generate grocery items from recent meal pairings'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 18px',
              borderRadius: 999,
              background: 'linear-gradient(145deg, #42291E 0%, #24140D 100%)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 700,
              color: '#FAF4EC',
              cursor: 'pointer',
              boxShadow: '0 8px 22px -3px rgba(36, 20, 13, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
              letterSpacing: '0.01em',
            }}
          >
            <Sparkles size={13} color="#C87428" /> {isBn ? 'খাবার থেকে তৈরি করুন' : 'Generate from meals'}
          </motion.button>
        )}

        {groups.some((g) => g.items.length > 0) && (
          <motion.button
            type="button"
            onClick={async () => {
              if (!confirmingClear) {
                setConfirmingClear(true);
                triggerToast(isBn ? 'সব মুছে ফেলতে আবার চাপুন' : 'Tap again to confirm — clearing all items');
                return;
              }
              setConfirmingClear(false);
              setGroups([]);
              await clearGroceryList();
              triggerToast(isBn ? 'তালিকা মুছে ফেলা হয়েছে' : 'List cleared');
            }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            aria-label={confirmingClear ? (isBn ? 'নিশ্চিত করতে আবার চাপুন' : 'Tap again to confirm clear all') : (isBn ? 'সব মুছে ফেলুন' : 'Clear all grocery items')}
            className="champagne-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 18px',
              borderRadius: 999,
              background: confirmingClear ? '#A8361A' : 'rgba(254, 226, 226, 0.72)',
              border: `1px solid ${confirmingClear ? '#7A2412' : 'rgba(239, 68, 68, 0.35)'}`,
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 700,
              color: confirmingClear ? '#FFFFFF' : '#991B1B',
              cursor: 'pointer',
              letterSpacing: '0.01em',
              boxShadow: confirmingClear
                ? '0 6px 16px -4px rgba(168, 54, 26, 0.55)'
                : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
              transition: 'background 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
            }}
          >
            <Trash size={13} color={confirmingClear ? '#FFFFFF' : '#DC2626'} />{' '}
            {confirmingClear ? (isBn ? 'নিশ্চিত করতে চাপুন' : 'Tap to confirm') : (isBn ? 'সব মুছুন' : 'Clear all')}
          </motion.button>
        )}
      </motion.div>

      {/* ── Empty state ──────────────────────────────────────── */}
      {groups.every((g) => g.items.length === 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass-card"
          style={{
            borderRadius: 20,
            padding: '32px 24px',
            textAlign: 'center',
            marginTop: 20,
          }}
        >
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(74, 58, 52, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <ShoppingBag size={24} color={T.inkMuted} />
          </div>
          <div style={{ fontFamily: 'Inter', fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 8 }}>
            {isBn ? 'আপনার বাজারের তালিকা খালি' : 'Your grocery list is empty'}
          </div>
          <div style={{ fontFamily: 'Inter', fontSize: 13, color: T.inkSoft, lineHeight: 1.4 }}>
            {isBn ? 'খাবারের ছবি তুলুন অথবা সরাসরি উপাদান যোগ করুন' : 'Snap a meal or add items manually'}
          </div>
        </motion.div>
      )}

      {/* ── Skeleton Loader ────────────────────────────────────── */}
      {loading && (
        <div style={{ marginTop: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ marginBottom: 18 }}>
              <div className="skeleton" style={{ width: 80, height: 12, marginBottom: 10 }} />
              {[0, 1].map((j) => (
                <div key={j} className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: '10px 14px', marginBottom: 8 }}>
                  <div className="skeleton" style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: `${70 - i * 10 - j * 5}%`, height: 14, marginBottom: 4 }} />
                  </div>
                  <div className="skeleton" style={{ width: 40, height: 14 }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <motion.div variants={container} initial="hidden" animate="show" layout>
        {groups.map((g, gi) => (
          <motion.div key={g.cat} variants={group} layout style={{ marginBottom: 18 }}>
            <SectionLabel
              action={addingAt === gi ? undefined : (isBn ? '+ যোগ করুন' : '+ Add')}
              onAction={() => setAddingAt(gi)}
            >
              {foodName(g.cat)}
            </SectionLabel>

            <AnimatePresence initial={false}>
              {g.items.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -40, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                    className="champagne-panel"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderRadius: 18,
                      padding: '12px 16px',
                      marginBottom: 10,
                      background: 'rgba(255, 248, 240, 0.72)',
                      backdropFilter: 'blur(20px)',
                      WebkitBackdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.85)',
                      boxShadow: 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85), 0 6px 18px -6px rgba(61, 39, 29, 0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                      <motion.button
                        type="button"
                        onClick={() => toggle(item.id)}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                        aria-label={
                          item.checked
                            ? (isBn ? `${foodName(item.name)} প্রয়োজন হিসেবে চিহ্নিত করুন` : `Mark ${foodName(item.name)} as needed`)
                            : (isBn ? `${foodName(item.name)} কেনা হয়েছে হিসেবে চিহ্নিত করুন` : `Mark ${foodName(item.name)} as bought`)
                        }
                        aria-pressed={item.checked}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 7,
                          background: item.checked
                            ? 'linear-gradient(145deg, #42291E 0%, #24140D 100%)'
                            : 'rgba(255, 250, 244, 0.85)',
                          border: item.checked
                            ? '1px solid rgba(255, 255, 255, 0.4)'
                            : '1px solid rgba(92, 60, 46, 0.28)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          cursor: 'pointer',
                          padding: 0,
                          boxShadow: item.checked
                            ? '0 3px 10px -2px rgba(36, 20, 13, 0.5), inset 0 1px 1px rgba(255,255,255,0.4)'
                            : 'inset 0 1px 1.5px rgba(255, 255, 255, 0.85)',
                        }}
                      >
                        <AnimatePresence>
                          {item.checked && (
                            <motion.span
                              key="check"
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              style={{ display: 'inline-flex' }}
                            >
                              <Check size={13} color="#FFFFFF" strokeWidth={3} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>

                      <span
                        style={{
                          fontFamily: 'Inter',
                          fontSize: 14.5,
                          color: item.checked ? '#96735B' : '#2C1A11',
                          fontWeight: item.checked ? 500 : 600,
                          textDecoration: item.checked ? 'line-through' : 'none',
                          textDecorationColor: '#96735B',
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          transition: 'color 200ms ease',
                        }}
                      >
                        {foodName(item.name)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isEditing ? (
                        <input
                          autoFocus
                          type="number"
                          value={item.price}
                          onChange={(e) => updatePrice(item.id, Number(e.target.value || 0))}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingId(null);
                          }}
                          aria-label={isBn ? `${foodName(item.name)}-এর দাম পরিবর্তন করুন` : `Edit price for ${foodName(item.name)}`}
                          style={{
                            width: 64,
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#2C1A11',
                            background: 'rgba(255, 250, 244, 0.9)',
                            border: '1.5px solid #C87428',
                            borderRadius: 8,
                            padding: '4px 8px',
                            outline: 'none',
                            textAlign: 'right',
                          }}
                        />
                      ) : (
                        <motion.button
                          type="button"
                          onClick={() => setEditingId(item.id)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.94 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                          aria-label={isBn ? `${foodName(item.name)}-এর দাম পরিবর্তন করুন, বর্তমান দাম ৳${toBengaliDigits(item.price)}` : `Edit price of ${foodName(item.name)}, currently ৳${item.price}`}
                          className="tnum champagne-pill"
                          style={{
                            background: 'rgba(255, 250, 244, 0.65)',
                            border: '1px solid rgba(255, 255, 255, 0.85)',
                            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 13,
                            color: item.checked ? '#96735B' : '#3D271D',
                            fontWeight: 700,
                            cursor: 'pointer',
                            minHeight: 28,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <span>৳{isBn ? toBengaliDigits(item.price) : item.price}</span>
                          {livePriceMap[item.id] && (
                            <span
                              title={isBn ? 'লাইভ বাজারদর (Chaldal)' : 'Live Market Price (Chaldal)'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 9.5,
                                fontWeight: 700,
                                color: '#15803D',
                                background: 'rgba(34, 197, 94, 0.14)',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                padding: '1px 6px',
                                borderRadius: 6,
                              }}
                            >
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  background: '#22C55E',
                                  display: 'inline-block',
                                }}
                              />
                              ⚡ {isBn ? 'লাইভ' : 'Live'}
                            </span>
                          )}
                        </motion.button>
                      )}

                      <motion.button
                        type="button"
                        onClick={() => remove(item.id)}
                        whileHover={{ scale: 1.15, rotate: 90 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                        aria-label={isBn ? `${foodName(item.name)} মুছে ফেলুন` : `Remove ${foodName(item.name)}`}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'rgba(255, 250, 244, 0.72)',
                          border: '1px solid rgba(255, 255, 255, 0.85)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          padding: 0,
                          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.8)',
                        }}
                      >
                        <Trash2 size={12} color="#8E674F" strokeWidth={2} />
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            <AnimatePresence>
              {addingAt === gi && (
                <AddItemForm
                  onSubmit={(name, price) => addItem(gi, name, price)}
                  onCancel={() => setAddingAt(null)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </motion.div>

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
              left: 24,
              right: 24,
              bottom: 110,
              padding: '10px 14px',
              borderRadius: 14,
              background: overBudget ? T.accentWarn : T.primary,
              color: '#FFFFFF',
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 600,
              textAlign: 'center',
              boxShadow: '0 8px 24px rgba(46, 37, 34, 0.25)',
              zIndex: 5,
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

interface AddItemFormProps {
  onSubmit: (name: string, price: number) => void;
  onCancel: () => void;
}

function AddItemForm({ onSubmit, onCancel }: AddItemFormProps) {
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const [name, setName] = useState('');
  const [price, setPrice] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!name.trim()) {
      setError(isBn ? 'অনুগ্রহ করে উপাদানের নাম লিখুন' : 'Please enter an item name');
      setShake((n) => n + 1);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit(name.trim(), Math.max(0, Math.min(9999, price)));
  };

  return (
    <motion.div
      role="form"
      aria-label={isBn ? 'নিজে উপাদান যোগ করুন' : 'Add custom grocery item'}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={
        error
          ? { opacity: 1, y: 0, scale: 1, x: [0, -6, 6, -4, 4, 0] }
          : { opacity: 1, y: 0, scale: 1 }
      }
      // Re-trigger shake whenever error is re-set
      key={shake}
      transition={{ type: 'spring', stiffness: 320, damping: 22, x: { duration: 0.35 } }}
      className="glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 14,
        padding: '8px 10px',
        marginBottom: 8,
        border: `1px dashed ${error ? T.accentWarn : T.primary}`,
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => {
          const val = e.target.value;
          setName(val);
          if (error) setError(null);
          const market = resolveMarketPrice(val);
          if (market.matched) {
            setPrice(market.estimatedCost);
          }
          if (val.trim().length >= 3) {
            fetchLivePrice(val).then((live) => {
              if (live.is_live_price && live.price_bdt > 0) {
                setPrice(live.price_bdt);
              }
            }).catch(() => {});
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={isBn ? 'উপাদানের নাম' : 'Item name'}
        aria-label={isBn ? 'নতুন উপাদানের নাম' : 'New item name'}
        aria-invalid={!!error}
        aria-describedby={error ? 'add-item-error' : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'Inter',
          fontSize: 13,
          color: T.ink,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: '6px 4px',
        }}
      />
      <input
        type="number"
        value={price}
        onChange={(e) => setPrice(Number(e.target.value || 0))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        aria-label={isBn ? 'টাকায় মূল্য' : 'Price in taka'}
        className="tnum"
        style={{
          width: 56,
          fontFamily: 'Inter',
          fontSize: 12,
          fontWeight: 600,
          color: T.ink,
          background: T.cardBg,
          border: '1px solid rgba(74, 58, 52, 0.15)',
          borderRadius: 8,
          padding: '4px 6px',
          outline: 'none',
          textAlign: 'right',
        }}
      />
      <motion.button
        type="button"
        onClick={submit}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        aria-label={isBn ? 'উপাদান যোগ করুন' : 'Add item'}
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: T.primary,
          border: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          boxShadow: '0 4px 10px -3px rgba(46,37,34,0.45)',
          flexShrink: 0,
        }}
      >
        <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
      </motion.button>
      <motion.button
        type="button"
        onClick={onCancel}
        whileHover={{ scale: 1.1, rotate: 90 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        aria-label={isBn ? 'বাতিল' : 'Cancel'}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'rgba(74, 58, 52, 0.08)',
          border: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={12} color={T.inkSoft} strokeWidth={2.5} />
      </motion.button>
      </div>
      {error && (
        <div
          id="add-item-error"
          role="alert"
          aria-live="assertive"
          style={{
            fontFamily: 'Inter',
            fontSize: 11,
            fontWeight: 600,
            color: T.accentWarn,
            alignSelf: 'flex-start',
            paddingLeft: 4,
          }}
        >
          {error}
        </div>
      )}
    </motion.div>
  );
}