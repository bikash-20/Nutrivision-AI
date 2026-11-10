import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Trash2,
  Users,
  UtensilsCrossed,
  Wifi,
  X,
} from 'lucide-react';
import {
  cancelRoom,
  clearRoomHistoryRemote,
  createRoom,
  getMealHistory,
  getMyRoom,
  getRoomWsUrl,
  joinRoom,
  leaveRoom,
  pollRoom,
  sendRoomMessage,
} from '../../lib/api';
import { getApiBase } from '../../lib/config';
import { getEffectiveNutrition, mealTotals } from '../../lib/personalize';
import {
  clearDailyRoomKey,
  clearRoomSession,
  loadDailyRoomKey,
  loadRoomSession,
  saveDailyRoomKey,
  saveRoomSession,
  type SavedDailyRoomKey,
  type StoredRoomSession,
} from '../../lib/roomSession';
import { toBengaliDigits } from '../../lib/format';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import { useTokens } from '../../theme/useTokens';
import type {
  DetectedItem,
  MealEntry,
  MealTotals,
  RoomMember,
  RoomMessage,
  RoomSharedDish,
} from '../../types/schemas';

interface RoomScreenProps {
  sessionKey: string;
  defaultDisplayName: string;
  detected: DetectedItem[];
  capturedImage: string | null;
  onClose: () => void;
  onGoToCapture: () => void;
  onActiveRoomChange?: (roomCode: string | null) => void;
}

function buildPlateTotals(items: DetectedItem[]): MealTotals {
  const resolved = items.map((item) => ({
    grams: item.grams,
    nutrition: getEffectiveNutrition(item.name),
  }));
  const raw = mealTotals(resolved);
  return {
    kcal: Math.round(raw.kcal),
    protein: Math.round(raw.protein),
    carbs: Math.round(raw.carbs),
    fat: Math.round(raw.fat),
    fiber: Math.round(raw.fiber),
    sodium: Math.round(raw.sodium),
    sugar: Math.round(raw.sugar),
  };
}

function mergeMessages(prev: RoomMessage[], incoming: RoomMessage[]): RoomMessage[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const next = [...prev];
  for (const msg of incoming) {
    if (!seen.has(msg.id)) {
      seen.add(msg.id);
      next.push(msg);
    }
  }
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function RoomScreen({
  sessionKey,
  defaultDisplayName,
  detected,
  capturedImage,
  onClose,
  onGoToCapture,
  onActiveRoomChange,
}: RoomScreenProps) {
  const { theme } = useTokens();
  const isDark = theme === 'dark';
  const { language, translate } = useLanguage();
  const isBn = language === 'bn';

  const initialStored = useMemo(
    () => loadRoomSession(sessionKey, { clearOnReload: true }),
    [sessionKey],
  );

  const [displayName, setDisplayName] = useState<string>(
    initialStored?.displayName || defaultDisplayName || 'Guest',
  );
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(initialStored?.roomCode ?? null);
  const [participantId, setParticipantId] = useState<string | null>(
    initialStored?.participantId ?? null,
  );
  const [members, setMembers] = useState<RoomMember[]>(initialStored?.members ?? []);
  const [messages, setMessages] = useState<RoomMessage[]>(initialStored?.messages ?? []);
  const [lastSeq, setLastSeq] = useState<number>(initialStored?.lastSeq ?? 0);

  const [composerText, setComposerText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [showRoomInfoCard, setShowRoomInfoCard] = useState(true);
  const [recentMeals, setRecentMeals] = useState<MealEntry[]>([]);
  const [savedKey, setSavedKey] = useState<SavedDailyRoomKey | null>(() =>
    loadDailyRoomKey(sessionKey),
  );

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef<number>(lastSeq);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const tabClientIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  useEffect(() => {
    if (!roomCode && defaultDisplayName && displayName === 'Guest') {
      setDisplayName(defaultDisplayName);
    }
  }, [defaultDisplayName, displayName, roomCode]);

  useEffect(() => {
    lastSeqRef.current = lastSeq;
  }, [lastSeq]);

  useEffect(() => {
    onActiveRoomChange?.(roomCode);
  }, [roomCode, onActiveRoomChange]);

  // Persist active room messages strictly to sessionStorage on this device.
  useEffect(() => {
    if (!roomCode || !participantId) return;
    const snapshot: StoredRoomSession = {
      roomCode,
      participantId,
      displayName,
      members,
      lastSeq,
      messages,
    };
    saveRoomSession(sessionKey, snapshot);
  }, [sessionKey, roomCode, participantId, displayName, members, lastSeq, messages]);

  // Vanish chat from sessionStorage & notify room when browser refreshes or closes.
  useEffect(() => {
    const handleUnload = () => {
      clearRoomSession(sessionKey);
      if (roomCode && participantId && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const url = `${getApiBase()}/api/rooms/${encodeURIComponent(cleanCode)}/leave`;
        const blob = new Blob(
          [
            JSON.stringify({
              participant_id: participantId,
              client_id: tabClientIdRef.current,
              force: false,
            }),
          ],
          {
            type: 'application/json',
          },
        );
        navigator.sendBeacon(url, blob);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionKey, roomCode, participantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!sharePickerOpen) return;
    getMealHistory()
      .then((meals) => setRecentMeals(meals.slice(0, 6)))
      .catch(() => setRecentMeals([]));
  }, [sharePickerOpen]);

  const resetLocalRoom = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
    setRoomCode(null);
    setParticipantId(null);
    setMembers([]);
    setMessages([]);
    setLastSeq(0);
    setSharePickerOpen(false);
    clearRoomSession(sessionKey);
  }, [sessionKey]);

  // Re-verify existing sessionStorage room on mount; if server restarted or room expired, clear cleanly.
  useEffect(() => {
    if (!roomCode || !participantId) return;
    let cancelled = false;
    joinRoom(roomCode, displayName, participantId, {
      accountId: sessionKey,
      clientId: tabClientIdRef.current,
    })
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
      })
      .catch(() => {
        if (cancelled) return;
        resetLocalRoom();
      });
    return () => {
      cancelled = true;
    };
    // Only validate once for the restored roomCode/participantId pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, participantId]);

  // Sync saved 24-hour room key from backend so user doesn't need to generate a new key after refresh.
  useEffect(() => {
    if (roomCode) return;
    let cancelled = false;
    getMyRoom(sessionKey).then((remote) => {
      if (cancelled) return;
      if (remote && remote.room_code) {
        saveDailyRoomKey(sessionKey, remote.room_code, remote.expires_at);
        setSavedKey({
          roomCode: remote.room_code,
          expiresAt: remote.expires_at || new Date(Date.now() + 86_400_000).toISOString(),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode, sessionKey]);

  // Real-time relay: direct WebSocket when backend URL supports WS + HTTP polling fallback.
  useEffect(() => {
    if (!roomCode || !participantId) return;
    let active = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;

    const runPoll = async () => {
      if (!active) return;
      try {
        const res = await pollRoom(
          roomCode,
          participantId,
          lastSeqRef.current,
          tabClientIdRef.current,
        );
        if (!active) return;
        setMembers(res.members);
        if (res.messages.length > 0) {
          setMessages((prev) => mergeMessages(prev, res.messages));
        }
        if (res.latest_seq > lastSeqRef.current) {
          setLastSeq(res.latest_seq);
        }
      } catch (err) {
        if (!active) return;
        if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 404) {
          resetLocalRoom();
          setError(isBn ? 'রুমটির মেয়াদ শেষ হয়েছে বা বন্ধ হয়ে গেছে।' : 'Room expired or closed.');
        }
      }
    };

    const startPolling = () => {
      if (pollTimer !== null) return;
      void runPoll();
      pollTimer = setInterval(() => {
        void runPoll();
      }, 1800);
    };

    const wsUrl = getRoomWsUrl(roomCode, participantId, displayName, {
      accountId: sessionKey,
      clientId: tabClientIdRef.current,
    });
    if (wsUrl && typeof WebSocket !== 'undefined') {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          if (!active) return;
          setWsConnected(true);
          if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          void runPoll();
        };
        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data) as {
              type?: string;
              message?: RoomMessage;
              members?: RoomMember[];
            };
            if (Array.isArray(data.members)) {
              setMembers(data.members);
            }
            if (data.type === 'message' && data.message) {
              const incoming = data.message;
              setMessages((prev) => mergeMessages(prev, [incoming]));
              if (incoming.seq > lastSeqRef.current) {
                setLastSeq(incoming.seq);
              }
            } else if (data.type === 'cleared') {
              setMessages([]);
            } else if (data.type === 'closed') {
              clearDailyRoomKey(sessionKey);
              setSavedKey(null);
              resetLocalRoom();
              setError(isBn ? 'রুমটি বাতিল বা বন্ধ করা হয়েছে।' : 'Room was closed.');
            }
          } catch {
            // Ignore malformed WS frame.
          }
        };
        ws.onerror = () => {
          if (!active) return;
          setWsConnected(false);
          startPolling();
        };
        ws.onclose = () => {
          if (!active) return;
          setWsConnected(false);
          startPolling();
        };
      } catch {
        setWsConnected(false);
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      active = false;
      setWsConnected(false);
      if (pollTimer !== null) clearInterval(pollTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [roomCode, participantId, displayName, isBn, resetLocalRoom]);

  const enterRoomFromResponse = (res: {
    room_code: string;
    participant_id: string;
    display_name: string;
    members: RoomMember[];
    latest_seq: number;
    expires_at?: string | null;
  }) => {
    saveDailyRoomKey(sessionKey, res.room_code, res.expires_at);
    setSavedKey({
      roomCode: res.room_code,
      expiresAt: res.expires_at || new Date(Date.now() + 86_400_000).toISOString(),
    });
    setRoomCode(res.room_code);
    setParticipantId(res.participant_id);
    setDisplayName(res.display_name);
    setMembers(res.members);
    setMessages([]);
    setLastSeq(res.latest_seq);
  };

  const handleCreateRoom = async (forceNew = false) => {
    setError(null);
    setBusy(true);
    try {
      const name = displayName.trim() || defaultDisplayName || 'Guest';
      const res = await createRoom(name, {
        accountId: sessionKey,
        clientId: tabClientIdRef.current,
        forceNew,
      });
      enterRoomFromResponse(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isBn
          ? 'নতুন রুম তৈরি করা যায়নি।'
          : 'Could not create room.',
      );
    } finally {
      setBusy(false);
    }
  };

  const joinSpecificCode = async (rawCode: string) => {
    const cleaned = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 4) {
      setError(isBn ? 'সঠিক রুম কোড লিখুন।' : 'Enter a valid room code.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const name = displayName.trim() || defaultDisplayName || 'Guest';
      const res = await joinRoom(cleaned, name, null, {
        accountId: sessionKey,
        clientId: tabClientIdRef.current,
      });
      enterRoomFromResponse(res);
      setJoinCodeInput('');
    } catch (err) {
      if (savedKey && savedKey.roomCode === cleaned) {
        clearDailyRoomKey(sessionKey);
        setSavedKey(null);
      }
      setError(
        err instanceof Error
          ? err.message
          : isBn
          ? 'রুম কোডটি পাওয়া যায়নি বা মেয়াদ শেষ হয়েছে।'
          : 'Room not found or cancelled.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleJoinRoom = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await joinSpecificCode(joinCodeInput);
  };

  const handleLeaveRoom = async () => {
    const code = roomCode;
    const pid = participantId;
    resetLocalRoom();
    if (code && pid) {
      await leaveRoom(code, pid, {
        clientId: tabClientIdRef.current,
        force: true,
      });
    }
  };

  const handleCancelRoom = async (targetCode?: string | null) => {
    const code = targetCode ?? roomCode;
    clearDailyRoomKey(sessionKey);
    setSavedKey(null);
    if (code && code === roomCode) {
      resetLocalRoom();
    }
    if (code) {
      await cancelRoom(code);
    }
  };

  const handleClearHistory = async () => {
    setMessages([]);
    if (roomCode && participantId) {
      saveRoomSession(sessionKey, {
        roomCode,
        participantId,
        displayName,
        members,
        lastSeq,
        messages: [],
      });
      await clearRoomHistoryRemote(roomCode);
    }
  };

  const dispatchMessage = async (
    kind: 'text' | 'meal_card',
    text: string,
    dishCard?: RoomSharedDish | null,
  ) => {
    if (!roomCode || !participantId) return;
    setError(null);
    setSending(true);
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            kind,
            text,
            dish_card: dishCard ?? null,
          }),
        );
      } else {
        const msg = await sendRoomMessage(roomCode, {
          participant_id: participantId,
          sender_name: displayName,
          kind,
          text,
          dish_card: dishCard ?? null,
        });
        setMessages((prev) => mergeMessages(prev, [msg]));
        if (msg.seq > lastSeqRef.current) {
          setLastSeq(msg.seq);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isBn
          ? 'বার্তা পাঠানো যায়নি।'
          : 'Failed to send message.',
      );
    } finally {
      setSending(false);
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = composerText.trim();
    if (!trimmed || sending) return;
    setComposerText('');
    await dispatchMessage('text', trimmed);
  };

  const handleShareCurrentPlate = async () => {
    if (detected.length === 0) return;
    setSharePickerOpen(false);
    const title = detected
      .slice(0, 3)
      .map((item) => (isBn && item.name_bn ? item.name_bn : translate(item.name)))
      .join(', ');
    const card: RoomSharedDish = {
      title: detected.length > 3 ? `${title} +${detected.length - 3}` : title,
      kind: 'meal',
      items: detected.map((d) => ({
        name: d.name,
        name_bn: d.name_bn ?? null,
        grams: Math.round(d.grams),
      })),
      totals: buildPlateTotals(detected),
      photo_url: capturedImage && capturedImage.length < 280_000 ? capturedImage : null,
    };
    await dispatchMessage('meal_card', card.title, card);
  };

  const handleShareSingleDish = async (item: DetectedItem) => {
    setSharePickerOpen(false);
    const title = isBn && item.name_bn ? item.name_bn : translate(item.name);
    const card: RoomSharedDish = {
      title,
      kind: 'dish',
      items: [{ name: item.name, name_bn: item.name_bn ?? null, grams: Math.round(item.grams) }],
      totals: buildPlateTotals([item]),
      photo_url: null,
    };
    await dispatchMessage('meal_card', title, card);
  };

  const handleShareLoggedMeal = async (meal: MealEntry) => {
    setSharePickerOpen(false);
    const card: RoomSharedDish = {
      title: meal.label,
      kind: 'meal',
      items: meal.items.map((d) => ({
        name: d.name,
        name_bn: d.name_bn ?? null,
        grams: Math.round(d.grams),
      })),
      totals: {
        kcal: Math.round(meal.totals.kcal),
        protein: Math.round(meal.totals.protein),
        carbs: Math.round(meal.totals.carbs),
        fat: Math.round(meal.totals.fat),
        fiber: Math.round(meal.totals.fiber),
        sodium: Math.round(meal.totals.sodium),
        sugar: Math.round(meal.totals.sugar),
      },
      photo_url: meal.photoUrl && meal.photoUrl.length < 280_000 ? meal.photoUrl : null,
    };
    await dispatchMessage('meal_card', card.title, card);
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted browser context.
    }
  };

  const handleNativeShare = async () => {
    if (!roomCode) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'NutriVision Room',
          text: isBn
            ? `আমার নিউট্রিশন রুমে যোগ দিন! কোড: ${roomCode}`
            : `Join my NutriVision room! Code: ${roomCode}`,
        });
      } catch {
        // User cancelled share sheet.
      }
    } else {
      await handleCopyCode();
    }
  };

  return (
    <LocalizedContent>
      <div style={{ padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Top Back Bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <motion.button
            type="button"
            onClick={onClose}
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.96 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 245, 235, 0.22)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(255, 255, 255, 0.45)',
              borderRadius: 999,
              padding: '6px 12px',
              color: isDark ? '#FAF4EC' : '#FFF7EE',
              fontFamily: 'Inter',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <ArrowLeft size={14} /> {isBn ? 'ফিরে যান' : 'Back'}
          </motion.button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {roomCode && !showRoomInfoCard && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setShowRoomInfoCard(true)}
                aria-label={isBn ? 'রুম তথ্য দেখান' : 'Show room details'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 245, 235, 0.24)',
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.18)' : '1px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: 999,
                  padding: '5px 10px',
                  color: isDark ? '#FAF4EC' : '#FFF7EE',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: wsConnected ? '#22C55E' : '#FBBF24',
                  }}
                />
                <span>{roomCode}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 10.5, opacity: 0.85 }}>
                  ({Math.max(1, members.length)})
                </span>
              </motion.button>
            )}
            <span
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? '#FAF4EC' : '#FFF7EE',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <Users size={17} /> {isBn ? 'লাইভ রুম চ্যাট' : 'Live Room Chat'}
            </span>
          </div>
        </div>

        {/* ── Lobby (No Active Room) ── */}
        {!roomCode ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="champagne-panel"
            style={{
              padding: '22px 20px',
              borderRadius: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-serif)',
                  fontSize: 22,
                  fontWeight: 700,
                  color: isDark ? '#FAF4EC' : '#24130A',
                }}
              >
                {isBn ? 'রুম তৈরি বা যোগ দিন' : 'Create or Join a Room'}
              </h2>
              <p
                style={{
                  margin: '6px 0 0',
                  fontFamily: 'Inter',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: isDark ? '#D8C4B6' : '#5C3A27',
                }}
              >
                {isBn
                  ? 'বন্ধুদের সাথে কোড শেয়ার করে সরাসরি চ্যাট করুন এবং আপনার খাবার ও ডিশ কার্ড শেয়ার করুন।'
                  : 'Share a room code to chat live and swap meal & dish cards.'}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label
                htmlFor="room-display-name"
                style={{
                  fontFamily: 'Inter',
                  fontSize: 12,
                  fontWeight: 700,
                  color: isDark ? '#FAF4EC' : '#24130A',
                }}
              >
                {isBn ? 'আপনার নাম' : 'Your Name'}
              </label>
              <input
                id="room-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={32}
                placeholder={isBn ? 'যেমন: রাকিব' : 'e.g. Alex'}
                className="coach-chat-input"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 14,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(92, 58, 39, 0.22)',
                  background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.78)',
                  color: isDark ? '#FAF4EC' : '#24130A',
                  fontFamily: 'Inter',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            {savedKey ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: 16,
                  background: isDark ? 'rgba(232, 196, 154, 0.12)' : 'rgba(255, 250, 244, 0.85)',
                  border: isDark ? '1px solid rgba(232, 196, 154, 0.35)' : '1px solid rgba(92, 58, 39, 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <KeyRound size={16} color={isDark ? '#E8C49A' : '#9C4D11'} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? '#E8C49A' : '#7C5A44' }}>
                        {isBn ? 'আপনার ২৪ ঘণ্টার সক্রিয় রুম কোড' : 'Saved 24h Room Key'}
                      </div>
                      <div
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 20,
                          fontWeight: 800,
                          letterSpacing: '0.1em',
                          color: isDark ? '#FAF4EC' : '#24130A',
                        }}
                      >
                        {savedKey.roomCode}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelRoom(savedKey.roomCode)}
                    title={isBn ? 'রুম কোড বাতিল করুন' : 'Cancel key'}
                    aria-label={isBn ? 'রুম কোড বাতিল করুন' : 'Cancel key'}
                    style={{
                      background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 226, 226, 0.9)',
                      border: 'none',
                      borderRadius: 999,
                      padding: '5px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      color: isDark ? '#FCA5A5' : '#991B1B',
                      cursor: 'pointer',
                    }}
                  >
                    {isBn ? 'বাতিল' : 'Cancel'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <motion.button
                    type="button"
                    disabled={busy}
                    onClick={() => joinSpecificCode(savedKey.roomCode)}
                    whileTap={{ scale: 0.98 }}
                    style={{
                      flex: 1,
                      padding: '11px 14px',
                      borderRadius: 14,
                      border: 'none',
                      background: isDark
                        ? '#E8C49A'
                        : 'linear-gradient(145deg, #3D271D 0%, #24130A 100%)',
                      color: isDark ? '#24130A' : '#FFFFFF',
                      fontFamily: 'Inter',
                      fontSize: 13.5,
                      fontWeight: 700,
                      cursor: busy ? 'wait' : 'pointer',
                    }}
                  >
                    {isBn ? `পুনরায় যোগ দিন (${savedKey.roomCode})` : `Use Key (${savedKey.roomCode})`}
                  </motion.button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleCreateRoom(true)}
                    style={{
                      padding: '11px 12px',
                      borderRadius: 14,
                      border: isDark ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(36,19,10,0.2)',
                      background: isDark ? 'rgba(255,255,255,0.1)' : '#FFF8F0',
                      color: isDark ? '#FAF4EC' : '#24130A',
                      fontFamily: 'Inter',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: busy ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <RefreshCw size={13} />
                    {isBn ? 'নতুন কোড' : 'New Key'}
                  </button>
                </div>
              </div>
            ) : (
              <motion.button
                type="button"
                disabled={busy}
                onClick={() => handleCreateRoom(false)}
                whileTap={{ scale: 0.98 }}
                style={{
                  width: '100%',
                  padding: '13px 16px',
                  borderRadius: 16,
                  border: 'none',
                  background: isDark
                    ? '#E8C49A'
                    : 'linear-gradient(145deg, #3D271D 0%, #24130A 100%)',
                  color: isDark ? '#24130A' : '#FFFFFF',
                  fontFamily: 'Inter',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 8px 20px rgba(36, 19, 10, 0.25)',
                }}
              >
                <Plus size={16} />
                {busy
                  ? isBn
                    ? 'রুম তৈরি হচ্ছে…'
                    : 'Creating room…'
                  : isBn
                  ? 'নতুন রুম তৈরি করুন (২৪ ঘণ্টার কোড)'
                  : 'Create Room (24h Key)'}
              </motion.button>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 11.5,
                fontWeight: 600,
                color: isDark ? 'rgba(250, 244, 236, 0.55)' : '#7C5A44',
              }}
            >
              <span style={{ flex: 1, height: 1, background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(92,58,39,0.15)' }} />
              <span>{isBn ? 'অথবা কোড দিয়ে যোগ দিন' : 'OR JOIN WITH CODE'}</span>
              <span style={{ flex: 1, height: 1, background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(92,58,39,0.15)' }} />
            </div>

            <form onSubmit={handleJoinRoom} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                maxLength={10}
                placeholder={isBn ? 'রুম কোড (যেমন: K8M4P2)' : 'Room code (e.g. K8M4P2)'}
                aria-label={isBn ? 'রুম কোড' : 'Room code'}
                className="coach-chat-input"
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  borderRadius: 14,
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.16)' : '1px solid rgba(92, 58, 39, 0.22)',
                  background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.78)',
                  color: isDark ? '#FAF4EC' : '#24130A',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={busy || joinCodeInput.trim().length < 4}
                style={{
                  padding: '11px 18px',
                  borderRadius: 14,
                  border: isDark ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(36,19,10,0.2)',
                  background: isDark ? 'rgba(255,255,255,0.14)' : '#FFF8F0',
                  color: isDark ? '#FAF4EC' : '#24130A',
                  fontFamily: 'Inter',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {isBn ? 'যোগ দিন' : 'Join'}
              </button>
            </form>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 242, 242, 0.94)',
                  border: isDark ? '1px solid rgba(252, 165, 165, 0.35)' : '1px solid rgba(220, 38, 38, 0.25)',
                  color: isDark ? '#FCA5A5' : '#991B1B',
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(46, 99, 51, 0.08)',
                color: isDark ? '#B8C68A' : '#2E6333',
                fontSize: 11.5,
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              {isBn
                ? 'সেশন-ভিত্তিক চ্যাট: কোনো বার্তা সার্ভারে সংরক্ষিত হয় না। পেজ রিফ্রেশ করলে, ইতিহাস মুছলে বা অ্যাপ বন্ধ করলে চ্যাট মুছে যাবে।'
                : 'Session-only chat: Nothing is saved on the server. Messages stay in session storage and vanish if you refresh, delete history, or close the app.'}
            </div>
          </motion.div>
        ) : (
          /* ── Active Room View ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Collapsible / Dismissible Room Info Header Card */}
            <AnimatePresence initial={false}>
              {showRoomInfoCard && (
                <motion.div
                  key="room-info-card"
                  initial={{ opacity: 0, height: 0, scale: 0.98 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    className="champagne-panel"
                    style={{
                      padding: '14px 16px',
                      borderRadius: 20,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div>
                          <div
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                              color: isDark ? '#D8C4B6' : '#684A37',
                            }}
                          >
                            {isBn ? 'রুম কোড' : 'Room Code'}
                          </div>
                          <div
                            style={{
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              fontSize: 22,
                              fontWeight: 800,
                              letterSpacing: '0.1em',
                              color: isDark ? '#FAF4EC' : '#24130A',
                            }}
                          >
                            {roomCode}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          aria-label={isBn ? 'কোড কপি করুন' : 'Copy room code'}
                          className="champagne-pill"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#FAF4EC' : '#24130A',
                            cursor: 'pointer',
                          }}
                        >
                          {copied ? <Check size={13} color="#16A34A" /> : <Copy size={13} />}
                          {copied ? (isBn ? 'কপি হয়েছে' : 'Copied') : (isBn ? 'কপি' : 'Copy')}
                        </button>
                        <button
                          type="button"
                          onClick={handleNativeShare}
                          aria-label={isBn ? 'শেয়ার করুন' : 'Share room'}
                          className="champagne-pill"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#FAF4EC' : '#24130A',
                            cursor: 'pointer',
                          }}
                        >
                          <Share2 size={13} />
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          onClick={handleClearHistory}
                          title={isBn ? 'ইতিহাস মুছুন' : 'Delete history'}
                          aria-label={isBn ? 'ইতিহাস মুছুন' : 'Delete history'}
                          className="champagne-pill"
                          style={{
                            padding: '7px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#FCA5A5' : '#991B1B',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={13} />
                          <span>{isBn ? 'মুছুন' : 'Clear'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleLeaveRoom}
                          title={isBn ? 'চ্যাট থেকে বের হন (কোড থাকবে)' : 'Exit chat (keeps 24h key)'}
                          aria-label={isBn ? 'রুম ছাড়ুন' : 'Leave room'}
                          className="champagne-pill"
                          style={{
                            padding: '7px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#FAF4EC' : '#24130A',
                            cursor: 'pointer',
                          }}
                        >
                          <LogOut size={13} />
                          <span>{isBn ? 'বের হন' : 'Leave'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelRoom()}
                          title={isBn ? 'রুম কোড স্থায়ীভাবে বাতিল করুন' : 'Cancel 24h room key'}
                          aria-label={isBn ? 'রুম বাতিল করুন' : 'Cancel room'}
                          className="champagne-pill"
                          style={{
                            padding: '7px 10px',
                            borderRadius: 999,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#FCA5A5' : '#991B1B',
                            cursor: 'pointer',
                          }}
                        >
                          <span>{isBn ? 'বাতিল' : 'End'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRoomInfoCard(false)}
                          title={isBn ? 'কার্ড লুকান' : 'Hide room card'}
                          aria-label={isBn ? 'কার্ড লুকান' : 'Hide room card'}
                          className="champagne-pill"
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: '50%',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isDark ? '#FAF4EC' : '#3D271D',
                            cursor: 'pointer',
                          }}
                        >
                          <X size={14} strokeWidth={2.4} />
                        </button>
                      </div>
                    </div>

                    {/* Online Members + Transport Status */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isDark ? '#86EFAC' : '#15803D',
                          }}
                        >
                          <Wifi size={12} />
                          {wsConnected
                            ? isBn
                              ? 'লাইভ'
                              : 'Live WS'
                            : isBn
                            ? 'সিঙ্ক চালু'
                            : 'Live Sync'}
                        </span>
                        <span style={{ color: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(92,58,39,0.25)' }}>•</span>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: isDark ? '#D8C4B6' : '#5C3A27' }}>
                          {isBn
                            ? `${toBengaliDigits(Math.max(1, members.length))} জন অনলাইন:`
                            : `${Math.max(1, members.length)} online:`}{' '}
                          {members.map((m) => m.name).join(', ') || displayName}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chat Stream */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minHeight: showRoomInfoCard ? 'calc(100dvh - 390px)' : 'calc(100dvh - 265px)',
                maxHeight: showRoomInfoCard ? '48vh' : '64vh',
                overflowY: 'auto',
                padding: '4px 2px',
              }}
            >
              {messages.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '28px 16px',
                    color: isDark ? '#D8C4B6' : '#FFF0E2',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {isBn
                    ? 'রুম প্রস্তুত! উপরের কোডটি শেয়ার করুন অথবা নিচ থেকে বার্তা ও খাবারের কার্ড পাঠান।'
                    : 'Room is live! Share the code above or send a message or dish card below.'}
                </div>
              ) : (
                messages.map((msg) => {
                  if (msg.kind === 'system') {
                    return (
                      <div
                        key={msg.id}
                        style={{
                          textAlign: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                          color: isDark ? 'rgba(250, 244, 236, 0.72)' : 'rgba(255, 240, 226, 0.85)',
                          padding: '2px 8px',
                        }}
                      >
                        {msg.text}
                      </div>
                    );
                  }

                  const mine = msg.sender_id === participantId;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: mine ? 'flex-end' : 'flex-start',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: isDark ? '#E5D3C3' : '#FFF0E2',
                          paddingInline: 6,
                        }}
                      >
                        {mine ? (isBn ? 'আপনি' : 'You') : msg.sender_name} · {formatTime(msg.created_at)}
                      </span>

                      {msg.kind === 'meal_card' && msg.dish_card ? (
                        <div
                          className="champagne-panel"
                          style={{
                            maxWidth: '88%',
                            width: 300,
                            padding: 14,
                            borderRadius: 20,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {msg.dish_card.photo_url ? (
                              <img
                                src={msg.dish_card.photo_url}
                                alt={msg.dish_card.title}
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 12,
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 12,
                                  background: isDark ? 'rgba(232, 196, 154, 0.16)' : 'rgba(200, 116, 40, 0.14)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: isDark ? '#E8C49A' : '#9C4D11',
                                  flexShrink: 0,
                                }}
                              >
                                <UtensilsCrossed size={20} />
                              </div>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  color: isDark ? '#E8C49A' : '#9C4D11',
                                }}
                              >
                                {msg.dish_card.kind === 'dish'
                                  ? isBn
                                    ? 'ডিশ কার্ড'
                                    : 'Dish Card'
                                  : isBn
                                  ? 'মিল কার্ড'
                                  : 'Meal Card'}
                              </div>
                              <div
                                style={{
                                  fontFamily: 'var(--font-serif)',
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: isDark ? '#FAF4EC' : '#24130A',
                                  lineHeight: 1.25,
                                }}
                              >
                                {msg.dish_card.title}
                              </div>
                            </div>
                          </div>

                          {/* Macro summary pills */}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 999,
                                background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(36, 19, 10, 0.08)',
                                color: isDark ? '#FAF4EC' : '#24130A',
                                fontSize: 11.5,
                                fontWeight: 700,
                              }}
                            >
                              🔥 {isBn ? toBengaliDigits(msg.dish_card.totals.kcal) : msg.dish_card.totals.kcal} kcal
                            </span>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 999,
                                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)',
                                color: isDark ? '#E5D3C3' : '#4A2E1F',
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              P {isBn ? toBengaliDigits(msg.dish_card.totals.protein) : msg.dish_card.totals.protein}g · C{' '}
                              {isBn ? toBengaliDigits(msg.dish_card.totals.carbs) : msg.dish_card.totals.carbs}g · F{' '}
                              {isBn ? toBengaliDigits(msg.dish_card.totals.fat) : msg.dish_card.totals.fat}g
                            </span>
                          </div>

                          {/* Item list */}
                          {msg.dish_card.items.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {msg.dish_card.items.map((item, idx) => (
                                <span
                                  key={`${item.name}-${idx}`}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: 8,
                                    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)',
                                    color: isDark ? '#FAF4EC' : '#3D271D',
                                  }}
                                >
                                  {isBn && item.name_bn ? item.name_bn : translate(item.name)} ·{' '}
                                  {isBn ? toBengaliDigits(item.grams) : item.grams}g
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          className={mine ? undefined : 'champagne-panel'}
                          style={
                            mine
                              ? {
                                  maxWidth: '85%',
                                  padding: '10px 15px',
                                  borderRadius: '18px 18px 4px 18px',
                                  background: 'linear-gradient(145deg, #3D271D 0%, #24140D 100%)',
                                  color: '#FFF8F0',
                                  fontSize: 14,
                                  lineHeight: 1.5,
                                  wordBreak: 'break-word',
                                  boxShadow: '0 6px 16px rgba(36, 20, 13, 0.25)',
                                }
                              : {
                                  maxWidth: '85%',
                                  padding: '10px 15px',
                                  borderRadius: '18px 18px 18px 4px',
                                  color: isDark ? '#FAF4EC' : '#24130A',
                                  fontSize: 14,
                                  lineHeight: 1.5,
                                  wordBreak: 'break-word',
                                }
                          }
                        >
                          {msg.text}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Share Meal / Dish Picker Drawer */}
            <AnimatePresence>
              {sharePickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="champagne-panel"
                  style={{
                    padding: 14,
                    borderRadius: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-serif)',
                        fontSize: 15,
                        fontWeight: 700,
                        color: isDark ? '#FAF4EC' : '#24130A',
                      }}
                    >
                      {isBn ? 'খাবার বা ডিশ কার্ড শেয়ার করুন' : 'Share a Meal or Dish Card'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSharePickerOpen(false)}
                      aria-label={isBn ? 'বন্ধ করুন' : 'Close'}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: isDark ? '#FAF4EC' : '#5C3A27',
                        padding: 4,
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {detected.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? '#E8C49A' : '#7C5A44' }}>
                        {isBn ? 'বর্তমান প্লেট' : 'Current Plate'}
                      </div>
                      <button
                        type="button"
                        onClick={handleShareCurrentPlate}
                        style={{
                          padding: '9px 12px',
                          borderRadius: 12,
                          border: isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(36,19,10,0.16)',
                          background: isDark ? 'rgba(232,196,154,0.16)' : '#FFF8F0',
                          color: isDark ? '#FAF4EC' : '#24130A',
                          fontSize: 12.5,
                          fontWeight: 700,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>
                          🍽️ {isBn ? 'সম্পূর্ণ প্লেট শেয়ার করুন' : 'Share Full Current Plate'} ({detected.length})
                        </span>
                        <span>{buildPlateTotals(detected).kcal} kcal</span>
                      </button>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {detected.map((item, idx) => (
                          <button
                            key={`${item.name}-${idx}`}
                            type="button"
                            onClick={() => handleShareSingleDish(item)}
                            className="champagne-pill"
                            style={{
                              padding: '5px 10px',
                              borderRadius: 999,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: isDark ? '#FAF4EC' : '#24130A',
                              cursor: 'pointer',
                            }}
                          >
                            🥘 {isBn && item.name_bn ? item.name_bn : translate(item.name)} ({Math.round(item.grams)}g)
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {recentMeals.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? '#E8C49A' : '#7C5A44' }}>
                        {isBn ? 'সাম্প্রতিক খাবার' : 'Recent Meals'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                        {recentMeals.map((meal) => (
                          <button
                            key={meal.id}
                            type="button"
                            onClick={() => handleShareLoggedMeal(meal)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 12,
                              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(92,58,39,0.14)',
                              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.6)',
                              color: isDark ? '#FAF4EC' : '#24130A',
                              fontSize: 12,
                              fontWeight: 600,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {meal.label}
                            </span>
                            <span style={{ flexShrink: 0, opacity: 0.8 }}>{Math.round(meal.totals.kcal)} kcal</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {detected.length === 0 && recentMeals.length === 0 && (
                    <div style={{ fontSize: 12.5, color: isDark ? '#D8C4B6' : '#5C3A27', lineHeight: 1.5 }}>
                      {isBn
                        ? 'শেয়ার করার জন্য এখনো কোনো খাবার স্ক্যান করা হয়নি।'
                        : 'No scanned plate or recent meal found yet.'}{' '}
                      <button
                        type="button"
                        onClick={onGoToCapture}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: isDark ? '#E8C49A' : '#9C4D11',
                          fontWeight: 700,
                          textDecoration: 'underline',
                          cursor: 'pointer',
                        }}
                      >
                        {isBn ? 'প্রথমে একটি ছবি তুলুন' : 'Snap a meal first'}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '9px 12px',
                  borderRadius: 12,
                  background: isDark ? 'rgba(239, 68, 68, 0.16)' : 'rgba(254, 242, 242, 0.94)',
                  border: isDark ? '1px solid rgba(252, 165, 165, 0.35)' : '1px solid rgba(220, 38, 38, 0.25)',
                  color: isDark ? '#FCA5A5' : '#991B1B',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}

            {/* Message & Share Composer */}
            <form
              onSubmit={handleSendText}
              className="champagne-panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
              }}
            >
              <button
                type="button"
                onClick={() => setSharePickerOpen((v) => !v)}
                aria-label={isBn ? 'খাবার বা ডিশ কার্ড শেয়ার করুন' : 'Share meal or dish card'}
                title={isBn ? 'খাবার বা ডিশ কার্ড শেয়ার করুন' : 'Share meal or dish card'}
                style={{
                  background: sharePickerOpen
                    ? isDark
                      ? 'rgba(232, 196, 154, 0.2)'
                      : 'rgba(200, 116, 40, 0.16)'
                    : 'transparent',
                  border: 'none',
                  borderRadius: '50%',
                  width: 34,
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isDark ? '#E8C49A' : '#3D271D',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <UtensilsCrossed size={17} />
              </button>

              <input
                type="text"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                maxLength={1000}
                placeholder={isBn ? 'রুমে বার্তা লিখুন…' : 'Type a message in the room…'}
                className="coach-chat-input"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'Inter',
                  fontSize: 14,
                  color: isDark ? '#FAF4EC' : '#24130A',
                  padding: '6px 4px',
                }}
              />

              <button
                type="submit"
                disabled={sending || !composerText.trim()}
                aria-label={isBn ? 'পাঠান' : 'Send message'}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    !composerText.trim() || sending
                      ? isDark
                        ? 'rgba(255,255,255,0.12)'
                        : 'rgba(74, 58, 52, 0.2)'
                      : isDark
                      ? '#E8C49A'
                      : 'linear-gradient(145deg, #3D271D 0%, #24140D 100%)',
                  color: !composerText.trim() || sending ? '#FFFFFF' : isDark ? '#24130A' : '#FFFFFF',
                  cursor: !composerText.trim() || sending ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        )}
      </div>
    </LocalizedContent>
  );
}
