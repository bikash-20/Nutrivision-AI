import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LogOut, LayoutDashboard, Users as UsersIcon, Trophy, AlertTriangle, ChevronDown, Database } from 'lucide-react';
import type { AuthSession } from '../../types/schemas';
import { logout } from '../../lib/auth';
import { getStorageHealth, type StorageHealthInfo } from '../../lib/api';
import LanguageToggle from '../../i18n/LanguageToggle';
import ThemeToggle from '../ThemeToggle';
import { useTokens } from '../../theme/useTokens';
import { LocalizedContent, useLanguage } from '../../i18n/LanguageContext';
import AdminOverview from './AdminOverview';
import AdminUsersView from './AdminUsersView';
import AdminPopularFoodsView from './AdminPopularFoodsView';
import AdminReviewQueueView from './AdminReviewQueueView';

export type AdminTab = 'overview' | 'users' | 'popular' | 'review';

interface AdminLayoutProps {
  session: AuthSession;
  children?: React.ReactNode;
  onLogoClick?: () => void;
}

/**
 * Responsive shell for the admin dashboard.
 * Supports Overview, Users, Popular Foods, and Review Queue tabs.
 * Dark mode and light mode are seamlessly supported with earth-tone palettes.
 */
export default function AdminLayout({ session, onLogoClick }: AdminLayoutProps) {
  useTokens();
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const reduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [storageHealth, setStorageHealth] = useState<StorageHealthInfo | null>(null);

  useEffect(() => {
    getStorageHealth().then(setStorageHealth).catch(() => {});
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleLogout = () => {
    logout();
    window.location.reload();
  };

  const navItems: Array<{ id: AdminTab; labelEn: string; labelBn: string; icon: React.ReactNode }> = [
    { id: 'overview', labelEn: 'Overview', labelBn: 'সারসংক্ষেপ', icon: <LayoutDashboard size={14} /> },
    { id: 'users', labelEn: 'Users', labelBn: 'ব্যবহারকারীরা', icon: <UsersIcon size={14} /> },
    { id: 'popular', labelEn: 'Popular Foods', labelBn: 'জনপ্রিয় খাবার', icon: <Trophy size={14} /> },
    { id: 'review', labelEn: 'Review Queue', labelBn: 'পর্যালোচনা তালিকা', icon: <AlertTriangle size={14} /> },
  ];

  const currentTabLabel = navItems.find((item) => item.id === activeTab);

  // ── Mobile layout ──────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <LocalizedContent>
        <div
          style={{
            minHeight: '100dvh',
            background: 'linear-gradient(180deg, #1B1411 0%, #2A201B 100%)',
            color: '#F9F2E4',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {/* Mobile top bar */}
          <header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 20,
              padding: '14px 18px',
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)',
              background: 'rgba(20, 14, 11, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderBottom: '1px solid rgba(249, 242, 228, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={onLogoClick}
              aria-label={isBn ? 'হোম পেজে যান' : 'Go to landing page'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 0,
                border: 'none',
                background: 'transparent',
                textAlign: 'left',
                cursor: onLogoClick ? 'pointer' : 'default',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #D0AE92, #77574A)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#2E2522',
                }}
              >
                N
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#F9F2E4', lineHeight: 1.1 }}>
                  NutriVision Admin
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'rgba(249, 242, 228, 0.55)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginTop: 2,
                  }}
                >
                  {isBn ? currentTabLabel?.labelBn : currentTabLabel?.labelEn}
                </div>
              </div>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeToggle />
              <LanguageToggle />
              <motion.button
                type="button"
                onClick={() => setNavOpen((s) => !s)}
                whileTap={{ scale: 0.94 }}
                aria-label={navOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={navOpen}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '7px 11px',
                  borderRadius: 10,
                  background: 'rgba(249, 242, 228, 0.08)',
                  border: '1px solid rgba(249, 242, 228, 0.10)',
                  color: '#F9F2E4',
                  fontFamily: 'Inter',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Menu
                <ChevronDown
                  size={13}
                  strokeWidth={2.5}
                  style={{
                    transform: navOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: reduceMotion ? undefined : 'transform 200ms ease',
                  }}
                />
              </motion.button>
            </div>
          </header>

          {/* Dropdown menu */}
          <AnimatePresence>
            {navOpen && (
              <motion.nav
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                aria-label={isBn ? 'অ্যাডমিন নেভিগেশন' : 'Admin navigation'}
                style={{
                  padding: '8px 14px 12px',
                  background: 'rgba(20, 14, 11, 0.95)',
                  borderBottom: '1px solid rgba(249, 242, 228, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {navItems.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setNavOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: active ? 'rgba(249, 242, 228, 0.10)' : 'transparent',
                        border: active ? '1px solid rgba(249, 242, 228, 0.14)' : '1px solid transparent',
                        color: active ? '#F9F2E4' : 'rgba(249, 242, 228, 0.65)',
                        fontFamily: 'Inter',
                        fontSize: 13,
                        fontWeight: active ? 700 : 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                      }}
                    >
                      <span style={{ color: active ? '#D0AE92' : 'inherit' }}>{item.icon}</span>
                      {isBn ? item.labelBn : item.labelEn}
                    </button>
                  );
                })}

                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 10,
                    borderTop: '1px solid rgba(249, 242, 228, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#F9F2E4',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.name || session.email}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'rgba(249, 242, 228, 0.5)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        marginTop: 2,
                      }}
                    >
                      Admin
                    </div>
                    {storageHealth && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 10,
                          color: 'rgba(249, 242, 228, 0.75)',
                          marginTop: 4,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: storageHealth.db_connected ? '#22C55E' : '#F59E0B',
                            display: 'inline-block',
                          }}
                        />
                        <Database size={10} style={{ flexShrink: 0 }} />
                        <span>{storageHealth.storage_backend === 'postgres' ? (storageHealth.host ? `Postgres (${storageHealth.host})` : 'Postgres') : 'JSON Store'}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label={isBn ? 'সাইন আউট' : 'Sign out'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: 'rgba(201, 98, 45, 0.18)',
                      border: '1px solid rgba(201, 98, 45, 0.32)',
                      color: '#F0B79A',
                      fontFamily: 'Inter',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <LogOut size={12} strokeWidth={2.5} />
                    Sign out
                  </button>
                </div>
              </motion.nav>
            )}
          </AnimatePresence>

          {/* Main Content Pane */}
          <main style={{ padding: '20px 18px 40px' }}>
            {activeTab === 'overview' && <AdminOverview session={session} />}
            {activeTab === 'users' && <AdminUsersView />}
            {activeTab === 'popular' && <AdminPopularFoodsView />}
            {activeTab === 'review' && <AdminReviewQueueView />}
          </main>
        </div>
      </LocalizedContent>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────

  return (
    <LocalizedContent>
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          gridTemplateColumns: '240px 1fr',
          background: 'linear-gradient(180deg, #1B1411 0%, #2A201B 100%)',
          color: '#F9F2E4',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <aside
          style={{
            background: 'rgba(20, 14, 11, 0.65)',
            borderRight: '1px solid rgba(249, 242, 228, 0.06)',
            padding: '20px 16px 18px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            position: 'sticky',
            top: 0,
          }}
        >
          {/* Brand header */}
          <button
            type="button"
            onClick={onLogoClick}
            aria-label={isBn ? 'হোম পেজে যান' : 'Go to landing page'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              padding: 0,
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              cursor: onLogoClick ? 'pointer' : 'default',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #D0AE92, #77574A)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                color: '#2E2522',
                boxShadow: '0 4px 12px -4px rgba(208, 174, 146, 0.45)',
              }}
            >
              N
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#F9F2E4', lineHeight: 1.1 }}>
                NutriVision
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'rgba(249, 242, 228, 0.5)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginTop: 2,
                }}
              >
                Admin
              </div>
            </div>
          </button>

          {/* Theme & Language Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <ThemeToggle />
            <LanguageToggle />
          </div>

          {/* Navigation Links */}
          <nav
            aria-label={isBn ? 'অ্যাডমিন বিভাগ' : 'Admin sections'}
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: active ? 'rgba(249, 242, 228, 0.10)' : 'transparent',
                    border: active ? '1px solid rgba(249, 242, 228, 0.14)' : '1px solid transparent',
                    color: active ? '#F9F2E4' : 'rgba(249, 242, 228, 0.65)',
                    fontFamily: 'Inter',
                    fontSize: 13,
                    fontWeight: active ? 700 : 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'background 140ms ease, color 140ms ease',
                  }}
                >
                  <span style={{ color: active ? '#D0AE92' : 'inherit', display: 'inline-flex' }}>
                    {item.icon}
                  </span>
                  {isBn ? item.labelBn : item.labelEn}
                </button>
              );
            })}
          </nav>

          <div style={{ flex: 1 }} />

          {/* User Badge & Logout */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(249, 242, 228, 0.04)',
              border: '1px solid rgba(249, 242, 228, 0.08)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'rgba(249, 242, 228, 0.85)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={session.email}
            >
              {session.name || session.email}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'rgba(249, 242, 228, 0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginTop: 2,
              }}
            >
              Admin Verified
            </div>

            {/* Storage Backend Badge */}
            {storageHealth && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: 10,
                  fontFamily: 'Inter',
                  color: 'rgba(249, 242, 228, 0.75)',
                  marginTop: 8,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: storageHealth.db_connected ? '#22C55E' : '#F59E0B',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <Database size={11} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {storageHealth.storage_backend === 'postgres'
                    ? (storageHealth.host ? `Postgres (${storageHealth.host})` : 'Postgres')
                    : 'JSON Store'}
                </span>
              </div>
            )}
            <motion.button
              type="button"
              onClick={handleLogout}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label={isBn ? 'অ্যাডমিন থেকে সাইন আউট' : 'Sign out of admin'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '8px 12px',
                borderRadius: 10,
                background: 'rgba(201, 98, 45, 0.20)',
                border: '1px solid rgba(201, 98, 45, 0.36)',
                color: '#F0B79A',
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                justifyContent: 'center',
                marginTop: 10,
              }}
            >
              <LogOut size={12} strokeWidth={2.5} />
              Sign out
            </motion.button>
          </div>
        </aside>

        <main
          style={{
            padding: '32px 40px 64px',
            minWidth: 0,
            maxWidth: 1200,
            width: '100%',
            margin: '0 auto',
          }}
        >
          {activeTab === 'overview' && <AdminOverview session={session} />}
          {activeTab === 'users' && <AdminUsersView />}
          {activeTab === 'popular' && <AdminPopularFoodsView />}
          {activeTab === 'review' && <AdminReviewQueueView />}
        </main>
      </div>
    </LocalizedContent>
  );
}
