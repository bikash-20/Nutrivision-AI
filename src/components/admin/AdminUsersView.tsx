import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, UserCheck, Shield, Zap, X, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { getAdminUsers, getAdminUserDetail } from '../../lib/api';
import type { AdminUserDetail, AdminUserSummary } from '../../types/schemas';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatRelative, toBengaliDigits } from '../../lib/format';

export default function AdminUsersView() {
  const { language } = useLanguage();
  const isBn = language === 'bn';

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('lastActive');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const loadUsers = useCallback((showSpinner = true) => {
    if (showSpinner) setLoading(true);
    getAdminUsers(search, sortBy, order)
      .then((data) => {
        setUsers(data || []);
      })
      .catch((err) => {
        console.error('Failed to load users:', err);
      })
      .finally(() => {
        if (showSpinner) setLoading(false);
      });
  }, [search, sortBy, order]);

  useEffect(() => {
    loadUsers(true);
    const interval = setInterval(() => {
      loadUsers(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadUsers]);

  // Handle row click for user detail modal
  const handleSelectUser = (email: string) => {
    setSelectedUserEmail(email);
    setDetailLoading(true);
    getAdminUserDetail(email)
      .then((data) => setDetail(data))
      .catch((err) => {
        console.error('Failed to load user detail:', err);
        setDetail(null);
      })
      .finally(() => setDetailLoading(false));
  };

  const handleCloseDetail = () => {
    setSelectedUserEmail(null);
    setDetail(null);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setOrder('desc');
    }
  };

  // Pagination calculation
  const totalUsers = users.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  const paginatedUsers = users.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'Inter',
              fontSize: 24,
              fontWeight: 700,
              color: '#F9F2E4',
              margin: 0,
            }}
          >
            {isBn ? 'ব্যবহারকারীদের তালিকা' : 'Registered Users'}
          </h1>
          <p
            style={{
              fontFamily: 'Inter',
              fontSize: 13,
              color: 'rgba(249, 242, 228, 0.65)',
              margin: '4px 0 0',
            }}
          >
            {isBn
              ? `মোট ${toBengaliDigits(totalUsers)} জন নিবন্ধিত অ্যাকাউন্ট`
              : `${totalUsers} verified accounts in database`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => loadUsers(true)}
            disabled={loading}
            aria-label={isBn ? 'তালিকা রিফ্রেশ করুন' : 'Refresh user list'}
            title={isBn ? 'তালিকা রিফ্রেশ করুন' : 'Refresh user list'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 12,
              padding: '8px 12px',
              color: '#F9F2E4',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              transition: 'background 150ms ease',
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>{isBn ? 'রিফ্রেশ' : 'Refresh'}</span>
          </button>

          {/* Search Input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              borderRadius: 12,
              padding: '8px 14px',
              minWidth: 240,
            }}
          >
            <Search size={16} color="rgba(249, 242, 228, 0.45)" />
            <input
              type="text"
              placeholder={isBn ? 'ব্যবহারকারী খুঁজুন...' : 'Search users...'}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#F9F2E4',
                fontSize: 13,
                fontFamily: 'Inter',
                width: '100%',
              }}
            />
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 18,
          overflow: 'hidden',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  color: 'rgba(249, 242, 228, 0.55)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                <th
                  onClick={() => handleSort('name')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'ব্যবহারকারী' : 'User'}
                </th>
                <th
                  onClick={() => handleSort('role')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'রোল' : 'Role'}
                </th>
                <th
                  onClick={() => handleSort('mealsCount')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'খাবার' : 'Meals'}
                </th>
                <th
                  onClick={() => handleSort('streakDays')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'ধারা' : 'Streak'}
                </th>
                <th
                  onClick={() => handleSort('joinedDate')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'যুক্ত হয়েছেন' : 'Joined'}
                </th>
                <th
                  onClick={() => handleSort('lastActive')}
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                >
                  {isBn ? 'সর্বশেষ সক্রিয়' : 'Last Active'}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(249, 242, 228, 0.55)' }}>
                    <div className="skeleton" style={{ width: 140, height: 20, margin: '0 auto', borderRadius: 8 }} />
                  </td>
                </tr>
              ) : paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: 'rgba(249, 242, 228, 0.55)' }}>
                    {isBn ? 'কোনো ব্যবহারকারী পাওয়া যায়নি' : 'No users found'}
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const initial = (u.name || u.email).charAt(0).toUpperCase();
                  const isUserAdmin = u.role === 'admin';

                  return (
                    <tr
                      key={u.email}
                      onClick={() => handleSelectUser(u.email)}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        cursor: 'pointer',
                        transition: 'background 160ms ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt={u.name || u.email}
                              style={{ width: 32, height: 32, borderRadius: 999, objectFit: 'cover' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 999,
                                background: 'linear-gradient(135deg, #77574A, #D0AE92)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                color: '#1B1411',
                                fontSize: 13,
                              }}
                            >
                              {initial}
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600, color: '#F9F2E4' }}>
                              {u.name || u.email.split('@')[0]}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(249, 242, 228, 0.5)' }}>
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: isUserAdmin ? 'rgba(232, 196, 154, 0.16)' : 'rgba(255, 255, 255, 0.06)',
                            color: isUserAdmin ? '#E8C49A' : 'rgba(249, 242, 228, 0.75)',
                            border: `1px solid ${isUserAdmin ? 'rgba(232, 196, 154, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                          }}
                        >
                          {isUserAdmin ? <Shield size={10} /> : <UserCheck size={10} />}
                          {isUserAdmin ? (isBn ? 'অ্যাডমিন' : 'Admin') : (isBn ? 'ইউজার' : 'User')}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#F9F2E4' }}>
                        {isBn ? toBengaliDigits(u.mealsCount) : u.mealsCount}
                      </td>

                      <td style={{ padding: '14px 16px', fontWeight: 600, color: u.streakDays > 0 ? '#E8C49A' : 'rgba(249, 242, 228, 0.4)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {u.streakDays > 0 && <Zap size={12} fill="#E8C49A" />}
                          {isBn ? toBengaliDigits(u.streakDays) : u.streakDays}
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', color: 'rgba(249, 242, 228, 0.65)' }}>
                        {formatRelative(u.joinedDate, new Date(), language)}
                      </td>

                      <td style={{ padding: '14px 16px', color: 'rgba(249, 242, 228, 0.65)' }}>
                        {formatRelative(u.lastActive, new Date(), language)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'rgba(249, 242, 228, 0.65)',
            }}
          >
            <div>
              {isBn
                ? `পৃষ্ঠা ${toBengaliDigits(page)} এর ${toBengaliDigits(totalPages)}`
                : `Page ${page} of ${totalPages}`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: page <= 1 ? 'rgba(249, 242, 228, 0.25)' : '#F9F2E4',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronLeft size={14} />
                {isBn ? 'আগের' : 'Prev'}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: page >= totalPages ? 'rgba(249, 242, 228, 0.25)' : '#F9F2E4',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                {isBn ? 'পরের' : 'Next'}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Slide-Over Modal */}
      <AnimatePresence>
        {selectedUserEmail && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              background: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
            onClick={handleCloseDetail}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              style={{
                width: '100%',
                maxWidth: 480,
                height: '100%',
                background: '#1F1815',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F9F2E4', margin: 0 }}>
                  {isBn ? 'ব্যবহারকারীর বিস্তারিত' : 'User Detail'}
                </h2>
                <button
                  type="button"
                  onClick={handleCloseDetail}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: 'none',
                    borderRadius: 8,
                    padding: 6,
                    color: '#F9F2E4',
                    cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {detailLoading || !detail ? (
                <div style={{ padding: '60px 0', textAlign: 'center', color: 'rgba(249, 242, 228, 0.55)' }}>
                  <div className="skeleton" style={{ width: 160, height: 24, margin: '0 auto', borderRadius: 8 }} />
                </div>
              ) : (
                <>
                  {/* Identity Box */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 14,
                      padding: 16,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    {detail.user.avatarUrl ? (
                      <img
                        src={detail.user.avatarUrl}
                        alt={detail.user.name || detail.user.email}
                        style={{ width: 48, height: 48, borderRadius: 999, objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 999,
                          background: 'linear-gradient(135deg, #77574A, #D0AE92)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          color: '#1B1411',
                          fontSize: 18,
                        }}
                      >
                        {(detail.user.name || detail.user.email).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#F9F2E4' }}>
                        {detail.user.name || detail.user.email.split('@')[0]}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(249, 242, 228, 0.55)' }}>
                        {detail.user.email}
                      </div>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 12, borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: 'rgba(249, 242, 228, 0.55)' }}>{isBn ? 'নথিভুক্ত খাবার' : 'Total Meals'}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#F9F2E4', marginTop: 4 }}>
                        {isBn ? toBengaliDigits(detail.user.mealsCount) : detail.user.mealsCount}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 12, borderRadius: 12 }}>
                      <div style={{ fontSize: 11, color: 'rgba(249, 242, 228, 0.55)' }}>{isBn ? 'টানা ধারা' : 'Streak'}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#E8C49A', marginTop: 4 }}>
                        {isBn ? `${toBengaliDigits(detail.user.streakDays)} দিন` : `${detail.user.streakDays} days`}
                      </div>
                    </div>
                  </div>

                  {/* Profile Settings */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#E8C49A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                      {isBn ? 'স্বাস্থ্য ও ডায়েট প্রোফাইল' : 'Health & Diet Profile'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(249, 242, 228, 0.7)' }}>
                        <span>{isBn ? 'দৈনিক ক্যালরি লক্ষ্য:' : 'Daily Kcal Target:'}</span>
                        <strong style={{ color: '#F9F2E4' }}>
                          {detail.profile.dailyKcalTarget != null && detail.profile.dailyKcalTarget > 0
                            ? `${isBn ? toBengaliDigits(Math.round(detail.profile.dailyKcalTarget)) : Math.round(detail.profile.dailyKcalTarget)} kcal`
                            : (isBn ? 'ডিফল্ট (২০০০ ক্যালরি)' : 'Default (2000 kcal)')}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(249, 242, 228, 0.7)' }}>
                        <span>{isBn ? 'দৈনিক বাজার বাজেট:' : 'Daily Grocery Budget:'}</span>
                        <strong style={{ color: '#F9F2E4' }}>
                          {detail.profile.budget != null && detail.profile.budget > 0
                            ? `৳${isBn ? toBengaliDigits(detail.profile.budget) : detail.profile.budget}`
                            : (isBn ? 'নির্ধারিত নয়' : 'Not set')}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(249, 242, 228, 0.7)' }}>
                        <span>{isBn ? 'ডায়েট ধরন:' : 'Diet Type:'}</span>
                        <strong style={{ color: '#F9F2E4' }}>
                          {detail.profile.dietType
                            ? detail.profile.dietType.charAt(0).toUpperCase() + detail.profile.dietType.slice(1)
                            : (isBn ? 'নির্ধারিত নয়' : 'Not set')}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Recent Meals List */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#F9F2E4', marginBottom: 10 }}>
                      {isBn ? 'সাম্প্রতিক খাবারসমূহ' : 'Recent Logged Meals'}
                    </div>
                    {detail.recentMeals.length === 0 ? (
                      <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(249, 242, 228, 0.45)', fontSize: 12 }}>
                        {isBn ? 'কোনো খাবার নথিভুক্ত করা হয়নি' : 'No meals recorded yet'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {detail.recentMeals.map((m) => (
                          <div
                            key={m.id}
                            style={{
                              background: 'rgba(255, 255, 255, 0.04)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: 12,
                              padding: '10px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: '#F9F2E4', fontSize: 13 }}>{m.label}</div>
                              <div style={{ fontSize: 11, color: 'rgba(249, 242, 228, 0.5)' }}>
                                {formatRelative(m.date, new Date(), language)}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700, color: '#D0AE92', fontSize: 13 }}>
                                {isBn ? toBengaliDigits(Math.round(m.totals.kcal)) : Math.round(m.totals.kcal)} kcal
                              </div>
                              <div style={{ fontSize: 10, color: 'rgba(249, 242, 228, 0.5)' }}>
                                P: {Math.round(m.totals.protein)}g · C: {Math.round(m.totals.carbs)}g
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
