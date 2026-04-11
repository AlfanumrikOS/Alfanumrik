'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  StatCard,
  MasteryRing,
  Skeleton,
  SectionHeader,
  EmptyState,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface SchoolAdminRecord {
  school_id: string;
  name: string;
  email: string;
  role: string;
}

interface ActivityEntry {
  type: string;
  student_name: string;
  description: string;
  created_at: string;
}

interface DashboardStats {
  total_students: number;
  total_teachers: number;
  total_classes: number;
  active_today: number;
  avg_mastery: number;
  quizzes_today: number;
  recent_activity: ActivityEntry[];
}

/* ─────────────────────────────────────────────────────────────
   RELATIVE TIME HELPER
───────────────────────────────────────────────────────────── */
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 5) return 'Just now';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

function activityIcon(type: string): string {
  if (type === 'signup' || type === 'enroll') return '🎓';
  if (type === 'quiz' || type === 'assessment') return '✅';
  if (type === 'join') return '🙋';
  return '📌';
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function PageSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-2">
        <Skeleton variant="title" height={28} width="55%" />
        <Skeleton variant="rect" height={32} width={64} rounded="rounded-xl" />
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rect" height={80} rounded="rounded-xl" />
        ))}
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 gap-3">
        <Skeleton variant="rect" height={120} rounded="rounded-2xl" />
        <Skeleton variant="rect" height={120} rounded="rounded-2xl" />
      </div>

      {/* Quick actions */}
      <div>
        <Skeleton variant="text" height={16} width="40%" className="mb-3" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="rect" height={80} rounded="rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <Skeleton variant="text" height={16} width="45%" className="mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rect" height={64} rounded="rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   QUICK ACTION TILE
   (inline — lighter than importing ActionTile to keep control)
───────────────────────────────────────────────────────────── */
interface ActionTileProps {
  icon: string;
  label: string;
  color: string;
  onClick: () => void;
}

function ActionTile({ icon, label, color, onClick }: ActionTileProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="rounded-2xl p-3 flex flex-col items-center gap-1.5 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
        minHeight: '72px',
      }}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-semibold leading-tight text-center" style={{ color }}>
        {label}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminPage() {
  const router = useRouter();
  const auth = useAuth();
  const { authUserId, isLoading: authLoading, isHi, signOut } = auth;

  /* ── local state ── */
  const [adminRecord, setAdminRecord] = useState<SchoolAdminRecord | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Step 1: Fetch school_admin record and guard auth ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;

    setLoadingAdmin(true);
    setError(null);

    const { data, error: dbErr } = await supabase
      .from('school_admins')
      .select('school_id, name, email, role')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (dbErr) {
      setError(dbErr.message);
      setLoadingAdmin(false);
      return;
    }

    if (!data) {
      // Not a school admin or inactive — redirect to login
      router.replace('/login');
      return;
    }

    setAdminRecord(data as SchoolAdminRecord);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Step 2: Fetch dashboard stats once school_id is known ── */
  const fetchStats = useCallback(async (schoolId: string) => {
    setLoadingStats(true);

    const { data, error: rpcErr } = await supabase.rpc('get_school_dashboard_stats', {
      school_id: schoolId,
    });

    if (rpcErr) {
      setError(rpcErr.message);
    } else {
      setStats(data as DashboardStats);
    }

    setLoadingStats(false);
  }, []);

  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  useEffect(() => {
    if (adminRecord?.school_id) {
      fetchStats(adminRecord.school_id);
    }
  }, [adminRecord, fetchStats]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin || loadingStats;

  if (isPageLoading) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        {/* Sticky header placeholder */}
        <div
          className="sticky top-0 z-10 px-4 py-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="title" height={24} width="50%" />
        </div>
        <PageSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh flex items-center justify-center px-4">
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{error}</p>
          <Button variant="primary" onClick={() => fetchAdminRecord()}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  if (!adminRecord) return null;

  /* ── Derived values (with safe defaults when stats not yet loaded) ── */
  const totalStudents = stats?.total_students ?? 0;
  const totalTeachers = stats?.total_teachers ?? 0;
  const totalClasses = stats?.total_classes ?? 0;
  const activeToday = stats?.active_today ?? 0;
  const avgMastery = stats?.avg_mastery ?? 0;
  const quizzesToday = stats?.quizzes_today ?? 0;
  const recentActivity = stats?.recent_activity ?? [];
  const adminFirstName = adminRecord.name.split(' ')[0] ?? adminRecord.name;

  /* ── Navigation handlers ── */
  const navTo = (path: string) => router.push(path);

  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {/* ═══════════════════════════════════════
          STICKY HEADER
      ═══════════════════════════════════════ */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h1
            className="text-base font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]"
          >
            {t(isHi, 'School Dashboard', 'स्कूल डैशबोर्ड')}
          </h1>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {t(isHi, `Hi, ${adminFirstName}`, `नमस्ते, ${adminFirstName}`)} 👋
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Language toggle */}
          <button
            onClick={() => auth.setLanguage && auth.setLanguage(isHi ? 'en' : 'hi')}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              minHeight: '36px',
            }}
            aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
          >
            {isHi ? 'EN' : 'हि'}
          </button>

          {/* Sign out */}
          <button
            onClick={() => signOut()}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-3)',
              minHeight: '36px',
            }}
            aria-label={t(isHi, 'Sign out', 'साइन आउट')}
          >
            {t(isHi, 'Sign Out', 'साइन आउट')}
          </button>
        </div>
      </header>

      {/* ═══════════════════════════════════════
          PAGE BODY
      ═══════════════════════════════════════ */}
      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">

        {/* ── ROW 1: 4 Stat Cards ── */}
        <section aria-label={t(isHi, 'Key metrics', 'मुख्य आंकड़े')}>
          <div className="grid grid-cols-4 gap-2">
            <StatCard
              value={totalStudents}
              label={t(isHi, 'Students', 'छात्र')}
              color="#F97316"
              icon="👩‍🎓"
            />
            <StatCard
              value={totalTeachers}
              label={t(isHi, 'Teachers', 'शिक्षक')}
              color="#0891B2"
              icon="👩‍🏫"
            />
            <StatCard
              value={totalClasses}
              label={t(isHi, 'Classes', 'कक्षाएं')}
              color="#7C3AED"
              icon="🏫"
            />
            <StatCard
              value={activeToday}
              label={t(isHi, 'Active Today', 'आज सक्रिय')}
              color="#16A34A"
              icon="⚡"
            />
          </div>
        </section>

        {/* ── ROW 2: Mastery Ring + Quizzes Today ── */}
        <section aria-label={t(isHi, 'Learning stats', 'सीखने के आंकड़े')}>
          <div className="grid grid-cols-2 gap-3">
            {/* Left: Mastery Ring */}
            <Card accent="#7C3AED">
              <div className="flex flex-col items-center justify-center py-3 gap-2">
                <MasteryRing value={avgMastery} size={72} strokeWidth={6} />
                <p
                  className="text-xs font-semibold text-center"
                  style={{ color: 'var(--text-2)' }}
                >
                  {t(isHi, 'Avg Mastery', 'औसत महारत')}
                </p>
              </div>
            </Card>

            {/* Right: Quizzes Today */}
            <Card accent="#F97316">
              <div className="flex flex-col items-center justify-center py-3 gap-1 h-full">
                <span className="text-3xl" aria-hidden="true">✨</span>
                <span
                  className="text-3xl font-bold font-['Sora',system-ui,sans-serif]"
                  style={{ color: '#F97316' }}
                >
                  {quizzesToday}
                </span>
                <p
                  className="text-xs font-semibold text-center"
                  style={{ color: 'var(--text-2)' }}
                >
                  {t(isHi, 'Quizzes Today', 'आज की क्विज़')}
                </p>
              </div>
            </Card>
          </div>
        </section>

        {/* ── QUICK ACTIONS 2×2 Grid ── */}
        <section aria-label={t(isHi, 'Quick actions', 'त्वरित कार्य')}>
          <SectionHeader icon="⚡">
            {t(isHi, 'Quick Actions', 'त्वरित कार्य')}
          </SectionHeader>

          <div className="grid grid-cols-4 gap-2">
            <ActionTile
              icon="👩‍🏫"
              label={t(isHi, 'Add Teacher', 'शिक्षक जोड़ें')}
              color="#0891B2"
              onClick={() => navTo('/school-admin/teachers/new')}
            />
            <ActionTile
              icon="👩‍🎓"
              label={t(isHi, 'Add Student', 'छात्र जोड़ें')}
              color="#F97316"
              onClick={() => navTo('/school-admin/students/new')}
            />
            <ActionTile
              icon="🏫"
              label={t(isHi, 'Create Class', 'कक्षा बनाएं')}
              color="#7C3AED"
              onClick={() => navTo('/school-admin/classes/new')}
            />
            <ActionTile
              icon="🔑"
              label={t(isHi, 'Generate Code', 'कोड बनाएं')}
              color="#F5A623"
              onClick={() => navTo('/school-admin/invite-codes')}
            />
          </div>
        </section>

        {/* ── RECENT ACTIVITY ── */}
        <section aria-label={t(isHi, 'Recent activity', 'हाल की गतिविधि')}>
          <SectionHeader icon="📋">
            {t(isHi, 'Recent Activity', 'हाल की गतिविधि')}
          </SectionHeader>

          {recentActivity.length === 0 ? (
            <EmptyState
              icon="📭"
              title={t(isHi, 'No recent activity yet', 'अभी कोई गतिविधि नहीं')}
              description={t(
                isHi,
                'Activity from your school will appear here.',
                'आपके स्कूल की गतिविधियाँ यहाँ दिखेंगी।'
              )}
            />
          ) : (
            <Card>
              <ul className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
                {recentActivity.slice(0, 10).map((entry, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    {/* Activity icon */}
                    <span
                      className="text-lg flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                      aria-hidden="true"
                      style={{ background: 'var(--surface-2)', fontSize: '14px' }}
                    >
                      {activityIcon(entry.type)}
                    </span>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-1)] truncate">
                        {entry.student_name}
                      </p>
                      <p className="text-xs text-[var(--text-3)] truncate mt-0.5">
                        {entry.description}
                      </p>
                    </div>

                    {/* Relative time */}
                    <span className="text-xs text-[var(--text-3)] flex-shrink-0 pt-0.5">
                      {relativeTime(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </main>

      {/* ═══════════════════════════════════════
          BOTTOM NAV
      ═══════════════════════════════════════ */}
      <BottomNav />
    </div>
  );
}
