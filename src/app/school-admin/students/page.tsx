'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  ProgressBar,
  Avatar,
  Skeleton,
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
interface SchoolStudent {
  id: string;
  name: string;
  email: string;
  /** Always a string "6"–"12" per P5 */
  grade: string;
  class_name: string | null;
  class_id: string | null;
  subscription_plan: 'free' | 'basic' | 'premium';
  avg_mastery: number;
  quiz_count: number;
  xp_total: number;
  streak_days: number;
}

/* ─────────────────────────────────────────────────────────────
   MASTERY COLOR HELPER
───────────────────────────────────────────────────────────── */
function masteryColor(value: number): string {
  if (value < 40) return '#DC2626';
  if (value <= 70) return 'var(--orange)';
  return 'var(--green)';
}

/* ─────────────────────────────────────────────────────────────
   PLAN BADGE HELPER
───────────────────────────────────────────────────────────── */
function planBadgeColor(plan: SchoolStudent['subscription_plan']): string {
  if (plan === 'premium') return 'var(--orange)';
  if (plan === 'basic') return 'var(--teal)';
  return '#7D7264'; // free — gray
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function StudentCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="title" height={15} width="55%" />
          <Skeleton variant="text" height={11} width="35%" />
        </div>
        <Skeleton variant="rect" height={20} width={52} rounded="rounded-full" />
      </div>
      <div className="mt-3 space-y-1.5">
        <Skeleton variant="text" height={11} width="30%" />
        <Skeleton variant="rect" height={6} rounded="rounded-full" />
      </div>
    </Card>
  );
}

function FilterBarSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Skeleton variant="rect" height={44} rounded="rounded-xl" className="flex-1" />
        <Skeleton variant="rect" height={44} rounded="rounded-xl" className="flex-1" />
      </div>
      <Skeleton variant="rect" height={44} rounded="rounded-xl" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STUDENT CARD
───────────────────────────────────────────────────────────── */
interface StudentCardProps {
  student: SchoolStudent;
  isHi: boolean;
}

function StudentCard({ student, isHi }: StudentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = masteryColor(student.avg_mastery);

  return (
    <Card
      hoverable
      onClick={() => setExpanded((prev) => !prev)}
    >
      {/* ── Main row ── */}
      <div className="flex items-center gap-3">
        <Avatar name={student.name} size={40} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-[var(--text-1)] truncate">
              {student.name}
            </p>
            {/* Grade badge — always renders grade as string per P5 */}
            <Badge color="var(--purple)" size="sm">
              {t(isHi, `Grade ${student.grade}`, `कक्षा ${student.grade}`)}
            </Badge>
          </div>
          {student.class_name && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {student.class_name}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {/* Plan badge */}
          <Badge color={planBadgeColor(student.subscription_plan)} size="sm">
            {student.subscription_plan === 'free'
              ? t(isHi, 'Free', 'मुफ़्त')
              : student.subscription_plan === 'basic'
              ? 'Basic'
              : 'Premium'}
          </Badge>

          {/* Expand chevron */}
          <span
            className="text-[var(--text-3)] transition-transform duration-200 text-xs"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          >
            ▾
          </span>
        </div>
      </div>

      {/* ── Mastery bar ── */}
      <div className="mt-3">
        <ProgressBar
          value={student.avg_mastery}
          color={color}
          height={6}
          label={`${t(isHi, 'Mastery', 'महारत')} ${Math.round(student.avg_mastery)}%`}
          showPercent={false}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          <span className="font-semibold" style={{ color }}>
            {Math.round(student.avg_mastery)}%
          </span>{' '}
          {t(isHi, 'Mastery', 'महारत')} &nbsp;·&nbsp;{' '}
          <span className="font-medium text-[var(--text-2)]">{student.quiz_count}</span>{' '}
          {t(isHi, 'Quizzes', 'क्विज़')}
        </p>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div
          className="mt-4 pt-4 animate-fade-in"
          style={{ borderTop: '1px solid var(--border)' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="region"
          aria-label={t(isHi, 'Student details', 'छात्र विवरण')}
        >
          {/* Stats row */}
          <div
            className="grid grid-cols-3 gap-2 rounded-xl p-3"
            style={{ background: 'var(--surface-2)' }}
          >
            {/* XP */}
            <div className="text-center">
              <p className="text-base font-bold" style={{ color: 'var(--orange)' }}>
                {student.xp_total.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">XP</p>
            </div>

            {/* Streak */}
            <div className="text-center">
              <p className="text-base font-bold" style={{ color: '#EA580C' }}>
                🔥 {student.streak_days}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {t(isHi, 'Streak', 'स्ट्रीक')}
              </p>
            </div>

            {/* Quizzes */}
            <div className="text-center">
              <p className="text-base font-bold" style={{ color: 'var(--teal)' }}>
                {student.quiz_count}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {t(isHi, 'Quizzes', 'क्विज़')}
              </p>
            </div>
          </div>

          {/* Plan + Mastery detail */}
          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p
                className="text-xs font-bold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-3)' }}
              >
                {t(isHi, 'Plan', 'प्लान')}
              </p>
              <Badge color={planBadgeColor(student.subscription_plan)} size="sm">
                {student.subscription_plan === 'free'
                  ? t(isHi, 'Free', 'मुफ़्त')
                  : student.subscription_plan === 'basic'
                  ? 'Basic'
                  : 'Premium'}
              </Badge>
            </div>
            <div className="text-right">
              <p
                className="text-xs font-bold uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-3)' }}
              >
                {t(isHi, 'Mastery', 'महारत')}
              </p>
              <p className="text-sm font-bold" style={{ color }}>
                {Math.round(student.avg_mastery)}%
              </p>
            </div>
          </div>

          {/* Email */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm" aria-hidden="true">✉️</span>
            <span
              className="text-xs break-all"
              style={{ color: 'var(--text-3)' }}
            >
              {student.email}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   GRADE SELECT OPTIONS
───────────────────────────────────────────────────────────── */
const GRADE_OPTIONS_EN = [
  { value: '', label: 'All Grades' },
  ...(['6', '7', '8', '9', '10', '11', '12'] as const).map((g) => ({
    value: g,
    label: `Grade ${g}`,
  })),
];
const GRADE_OPTIONS_HI = [
  { value: '', label: 'सभी ग्रेड' },
  ...(['6', '7', '8', '9', '10', '11', '12'] as const).map((g) => ({
    value: g,
    label: `कक्षा ${g}`,
  })),
];

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminStudentsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);

  /* Filter state */
  const [gradeFilter, setGradeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  /* Toast state for "Coming soon" */
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  /* ── Derived: unique class names from student data ── */
  const classOptions = useMemo(() => {
    const names = new Set<string>();
    for (const s of students) {
      if (s.class_name) names.add(s.class_name);
    }
    const sorted = Array.from(names).sort();
    return [
      { value: '', label: t(isHi, 'All Classes', 'सभी कक्षाएं') },
      ...sorted.map((cn) => ({ value: cn, label: cn })),
    ];
  }, [students, isHi]);

  /* ── Step 1: Auth guard — fetch school_admins record ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;

    setLoadingAdmin(true);

    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id, name')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Step 2: Fetch students via RPC ── */
  const fetchStudents = useCallback(async (sid: string) => {
    setLoadingStudents(true);
    setRpcError(null);

    const { data, error } = await supabase.rpc('get_school_students', {
      school_id: sid,
    });

    if (error) {
      setRpcError(error.message);
    } else {
      setStudents((data as SchoolStudent[]) ?? []);
    }

    setLoadingStudents(false);
  }, []);

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record once auth is ready ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ── Fetch students once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchStudents(schoolId);
    }
  }, [schoolId, fetchStudents]);

  /* ── Auto-dismiss toast ── */
  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  /* ── Client-side filtering ── */
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (gradeFilter && s.grade !== gradeFilter) return false;
      if (classFilter && s.class_name !== classFilter) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, gradeFilter, classFilter, searchQuery]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ── Page header — rendered in both skeleton and loaded states ── */
  const PageHeader = (
    <header
      className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
      style={{
        background: 'rgba(251,248,244,0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Back button */}
      <button
        onClick={() => router.push('/school-admin')}
        className="flex items-center justify-center rounded-xl transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          minWidth: 40,
          minHeight: 40,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          fontSize: '18px',
        }}
        aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस')}
      >
        ←
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Students', 'छात्र')}
        </h1>
      </div>

      {/* Language toggle */}
      <button
        onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
        className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          minWidth: 40,
          minHeight: 40,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}
        aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
      >
        {isHi ? 'EN' : 'हि'}
      </button>
    </header>
  );

  /* ── Full page loading skeleton ── */
  if (isPageLoading) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(251,248,244,0.94)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="circle" width={40} height={40} />
          <Skeleton variant="title" height={20} width="40%" className="flex-1" />
          <Skeleton variant="rect" width={40} height={40} rounded="rounded-xl" />
        </header>
        <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-3">
          <FilterBarSkeleton />
          {[1, 2, 3, 4].map((i) => (
            <StudentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (rpcError) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-2xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{rpcError}</p>
            <Button
              variant="primary"
              onClick={() => schoolId && fetchStudents(schoolId)}
            >
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  /* ── Loaded state ── */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {PageHeader}

      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-4">

        {/* ── Filter bar ── */}
        <section aria-label={t(isHi, 'Filters', 'फ़िल्टर')}>
          {/* Grade + Class selects row */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <Select
                label={t(isHi, 'Grade / ग्रेड', 'ग्रेड')}
                value={gradeFilter}
                onChange={setGradeFilter}
                options={isHi ? GRADE_OPTIONS_HI : GRADE_OPTIONS_EN}
              />
            </div>
            <div className="flex-1">
              <Select
                label={t(isHi, 'Class', 'कक्षा')}
                value={classFilter}
                onChange={setClassFilter}
                options={classOptions}
              />
            </div>
          </div>

          {/* Search + Bulk Upload row */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                placeholder={t(isHi, 'Search students / छात्र खोजें', 'छात्र खोजें')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t(isHi, 'Search students', 'छात्र खोजें')}
                style={{ minHeight: 48 }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setToastMsg(t(isHi, 'Coming soon', 'जल्द आ रहा है'))
              }
              style={{ minHeight: 48, whiteSpace: 'nowrap', flexShrink: 0 }}
              aria-label={t(isHi, 'Bulk Upload', 'बल्क अपलोड')}
            >
              📤 {t(isHi, 'Bulk Upload', 'बल्क अपलोड')}
            </Button>
          </div>
        </section>

        {/* ── Summary row ── */}
        {!loadingStudents && (
          <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {filteredStudents.length}{' '}
            {t(
              isHi,
              filteredStudents.length === 1 ? 'student' : 'students',
              'छात्र'
            )}
            {(gradeFilter || classFilter || searchQuery.trim()) && (
              <span>
                {' '}
                {t(isHi, '(filtered)', '(फ़िल्टर किए गए)')}
              </span>
            )}
          </p>
        )}

        {/* ── Loading students skeleton ── */}
        {loadingStudents && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <StudentCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* ── Student list ── */}
        {!loadingStudents && filteredStudents.length > 0 && (
          <section aria-label={t(isHi, 'Student list', 'छात्रों की सूची')}>
            <div className="space-y-3">
              {filteredStudents.map((student) => (
                <StudentCard key={student.id} student={student} isHi={isHi} />
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state: no students match filters ── */}
        {!loadingStudents && students.length > 0 && filteredStudents.length === 0 && (
          <Card className="py-2">
            <EmptyState
              icon="🔍"
              title={t(isHi, 'No students found', 'कोई छात्र नहीं मिला')}
              description={t(
                isHi,
                'Try adjusting your filters or search term.',
                'फ़िल्टर या खोज बदलकर देखें।'
              )}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setGradeFilter('');
                    setClassFilter('');
                    setSearchQuery('');
                  }}
                >
                  {t(isHi, 'Clear filters', 'फ़िल्टर हटाएं')}
                </Button>
              }
            />
          </Card>
        )}

        {/* ── Empty state: no students at all ── */}
        {!loadingStudents && students.length === 0 && (
          <EmptyState
            icon="👩‍🎓"
            title={t(isHi, 'No students yet', 'अभी कोई छात्र नहीं')}
            description={t(
              isHi,
              'Share an invite code so students can join your school.',
              'छात्रों को जोड़ने के लिए आमंत्रण कोड शेयर करें।'
            )}
          />
        )}
      </main>

      {/* ── Toast ── */}
      {toastMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl text-sm font-semibold text-white shadow-lg pointer-events-none animate-fade-in"
          style={{
            background: 'rgba(26,18,7,0.85)',
            backdropFilter: 'blur(8px)',
          }}
          role="status"
          aria-live="polite"
        >
          {toastMsg}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
