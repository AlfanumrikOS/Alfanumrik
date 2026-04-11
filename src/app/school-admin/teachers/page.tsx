'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Badge,
  Avatar,
  Skeleton,
  EmptyState,
  SheetModal,
  BottomNav,
  SectionHeader,
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
interface Teacher {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  subjects_taught: string[];
  grades_taught: string[];
  class_count: number;
  student_count: number;
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function TeacherCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="title" height={16} width="50%" />
          <Skeleton variant="text" height={12} width="70%" />
        </div>
      </div>
      <div className="mt-3 flex gap-1.5 flex-wrap">
        <Skeleton variant="rect" height={20} width={64} rounded="rounded-full" />
        <Skeleton variant="rect" height={20} width={56} rounded="rounded-full" />
      </div>
      <div className="mt-2">
        <Skeleton variant="text" height={12} width="45%" />
      </div>
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-3">
      {/* Search bar skeleton */}
      <Skeleton variant="rect" height={44} rounded="rounded-xl" />
      {/* Teacher cards */}
      {[1, 2, 3].map((i) => (
        <TeacherCardSkeleton key={i} />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   INVITE MODAL CONTENT
───────────────────────────────────────────────────────────── */
interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  isHi: boolean;
}

function InviteModal({ open, onClose, schoolId, isHi }: InviteModalProps) {
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setCode(null);
      setCopied(false);
      setGenError(null);
    }
  }, [open]);

  const generateCode = useCallback(async () => {
    setGenerating(true);
    setGenError(null);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('school_invite_codes')
      .insert({
        school_id: schoolId,
        role_type: 'teacher',
        max_uses: 1,
        expires_at: expiresAt,
      })
      .select('code')
      .single();

    if (error) {
      setGenError(error.message);
    } else if (data?.code) {
      setCode(data.code as string);
    }

    setGenerating(false);
  }, [schoolId]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard not available — silently ignore
    }
  }, [code]);

  return (
    <SheetModal
      open={open}
      onClose={onClose}
      title={t(isHi, 'Invite Teacher', 'शिक्षक आमंत्रित करें')}
    >
      <div className="py-2 space-y-4">
        <p className="text-sm text-[var(--text-2)]">
          {t(
            isHi,
            'Generate a one-time invite code for a new teacher to join your school.',
            'नए शिक्षक के लिए एक बार उपयोग होने वाला आमंत्रण कोड बनाएं।'
          )}
        </p>

        {!code && (
          <Button
            variant="primary"
            fullWidth
            onClick={generateCode}
            disabled={generating}
            aria-busy={generating}
          >
            {generating
              ? t(isHi, 'Generating…', 'बन रहा है…')
              : t(isHi, 'Generate Invite Code', 'आमंत्रण कोड बनाएं')}
          </Button>
        )}

        {genError && (
          <p
            className="text-sm font-medium px-3 py-2 rounded-xl"
            style={{ background: 'rgba(220,38,38,0.07)', color: '#DC2626' }}
            role="alert"
          >
            {genError}
          </p>
        )}

        {code && (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{
              background: 'rgba(232,88,28,0.05)',
              border: '1.5px solid rgba(232,88,28,0.18)',
            }}
          >
            {/* Label */}
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)]">
              {t(isHi, 'Invite Code', 'आमंत्रण कोड')}
            </p>

            {/* Code display */}
            <div
              className="text-2xl font-bold tracking-[0.18em] text-center py-3 rounded-xl select-all"
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--orange)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                letterSpacing: '0.18em',
              }}
              aria-label={t(isHi, `Invite code: ${code}`, `आमंत्रण कोड: ${code}`)}
            >
              {code}
            </div>

            {/* Expiry notice */}
            <p className="text-xs text-center text-[var(--text-3)]">
              🕐 {t(isHi, 'Expires in 7 days', '7 दिनों में समाप्त')} &nbsp;·&nbsp;{' '}
              {t(isHi, '1 use only', 'केवल 1 बार')}
            </p>

            {/* Copy button */}
            <Button
              variant={copied ? 'soft' : 'primary'}
              fullWidth
              onClick={handleCopy}
              color={copied ? 'var(--green)' : undefined}
            >
              {copied
                ? t(isHi, 'Code copied!', 'कोड कॉपी हो गया!')
                : t(isHi, 'Copy Code', 'कोड कॉपी करें')}
            </Button>

            {/* Generate another */}
            <button
              onClick={() => { setCode(null); setCopied(false); }}
              className="w-full text-xs text-center py-1 text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
            >
              {t(isHi, 'Generate another code', 'दूसरा कोड बनाएं')}
            </button>
          </div>
        )}
      </div>
    </SheetModal>
  );
}

/* ─────────────────────────────────────────────────────────────
   TEACHER CARD
───────────────────────────────────────────────────────────── */
interface TeacherCardProps {
  teacher: Teacher;
  isHi: boolean;
}

function TeacherCard({ teacher, isHi }: TeacherCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Sort grades as strings "6"–"12" numerically for display
  const sortedGrades = [...teacher.grades_taught].sort(
    (a, b) => Number(a) - Number(b)
  );

  const toggleExpand = () => setExpanded((prev) => !prev);

  return (
    <Card
      hoverable
      onClick={toggleExpand}
      className="p-4"
    >
      {/* ── Main row ── */}
      <div className="flex items-center gap-3">
        <Avatar name={teacher.name} size={40} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--text-1)] truncate">{teacher.name}</p>
          <p className="text-xs text-[var(--text-3)] truncate mt-0.5">{teacher.email}</p>
        </div>

        {/* Expand chevron */}
        <span
          className="text-[var(--text-3)] transition-transform duration-200 flex-shrink-0"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          ▾
        </span>
      </div>

      {/* ── Subjects ── */}
      {teacher.subjects_taught.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t(isHi, 'Subjects', 'विषय')}>
          {teacher.subjects_taught.map((subj) => (
            <Badge key={subj} color="var(--orange)" size="sm">
              {subj}
            </Badge>
          ))}
        </div>
      )}

      {/* ── Grades + counts row ── */}
      <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
        {sortedGrades.length > 0 && (
          <p className="text-xs text-[var(--text-3)]">
            <span className="font-semibold text-[var(--text-2)]">
              {t(isHi, 'Grades', 'ग्रेड')}:
            </span>{' '}
            {sortedGrades.join(', ')}
          </p>
        )}
        <p className="text-xs text-[var(--text-3)] ml-auto">
          <span className="font-medium">{teacher.class_count}</span>{' '}
          {t(isHi, 'Classes', 'कक्षाएं')} &nbsp;·&nbsp;{' '}
          <span className="font-medium">{teacher.student_count}</span>{' '}
          {t(isHi, 'Students', 'छात्र')}
        </p>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div
          className="mt-4 pt-4 space-y-3 animate-fade-in"
          style={{ borderTop: '1px solid var(--border)' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="region"
          aria-label={t(isHi, 'Teacher details', 'शिक्षक विवरण')}
        >
          {/* Contact info */}
          <div className="space-y-1.5">
            <p
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, 'Contact', 'संपर्क')}
            </p>

            <div className="flex items-center gap-2">
              <span className="text-base" aria-hidden="true">✉️</span>
              <span className="text-sm text-[var(--text-2)] break-all">{teacher.email}</span>
            </div>

            {teacher.phone ? (
              <div className="flex items-center gap-2">
                <span className="text-base" aria-hidden="true">📞</span>
                <span className="text-sm text-[var(--text-2)]">{teacher.phone}</span>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-3)] ml-6">
                {t(isHi, 'No phone on record', 'फ़ोन नहीं')}
              </p>
            )}
          </div>

          {/* Summary stats */}
          <div
            className="grid grid-cols-2 gap-2 rounded-xl p-3"
            style={{ background: 'var(--surface-2)' }}
          >
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: 'var(--purple)' }}>
                {teacher.class_count}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {t(isHi, 'Classes', 'कक्षाएं')}
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: 'var(--teal)' }}>
                {teacher.student_count}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {t(isHi, 'Students', 'छात्र')}
              </p>
            </div>
          </div>

          {/* All grades */}
          {sortedGrades.length > 0 && (
            <div>
              <p
                className="text-xs font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-3)' }}
              >
                {t(isHi, 'Grades Taught', 'पढ़ाए जाने वाले ग्रेड')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sortedGrades.map((g) => (
                  <Badge key={g} color="var(--teal)" size="sm">
                    {t(isHi, `Grade ${g}`, `कक्षा ${g}`)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminTeachersPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

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
      // Not an active school admin — redirect to login
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Step 2: Fetch teachers via RPC ── */
  const fetchTeachers = useCallback(async (sid: string) => {
    setLoadingTeachers(true);
    setRpcError(null);

    const { data, error } = await supabase.rpc('get_school_teachers', {
      school_id: sid,
    });

    if (error) {
      setRpcError(error.message);
    } else {
      setTeachers((data as Teacher[]) ?? []);
    }

    setLoadingTeachers(false);
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

  /* ── Fetch teachers once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchTeachers(schoolId);
    }
  }, [schoolId, fetchTeachers]);

  /* ── Client-side search filter ── */
  const query = searchQuery.trim().toLowerCase();
  const filteredTeachers = query
    ? teachers.filter(
        (tc) =>
          tc.name.toLowerCase().includes(query) ||
          tc.subjects_taught.some((s) => s.toLowerCase().includes(query))
      )
    : teachers;

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ── Sticky header component (shared between loading + loaded states) ── */
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
          {t(isHi, 'Teachers', 'शिक्षक')}
        </h1>
        {!isPageLoading && !loadingTeachers && teachers.length > 0 && (
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {teachers.length}{' '}
            {t(isHi, teachers.length === 1 ? 'teacher' : 'teachers', 'शिक्षक')}
          </p>
        )}
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

      {/* Invite Teacher button */}
      {schoolId && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setInviteOpen(true)}
          style={{ minHeight: 40 }}
        >
          + {t(isHi, 'Invite', 'आमंत्रित करें')}
        </Button>
      )}
    </header>
  );

  /* ── Full page loading skeleton ── */
  if (isPageLoading) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {/* Render header in skeleton form */}
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
          <Skeleton variant="rect" width={80} height={40} rounded="rounded-xl" />
        </header>
        <PageSkeleton />
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
              onClick={() => schoolId && fetchTeachers(schoolId)}
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

        {/* ── Invite Teacher (prominent CTA when no teachers yet and fully loaded) ── */}
        {!loadingTeachers && teachers.length === 0 && schoolId && (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{
              background: 'linear-gradient(135deg, rgba(232,88,28,0.06), rgba(255,122,61,0.04))',
              border: '1.5px dashed rgba(232,88,28,0.25)',
            }}
          >
            <span className="text-3xl flex-shrink-0" aria-hidden="true">👩‍🏫</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-1)]">
                {t(isHi, 'Add your first teacher', 'पहला शिक्षक जोड़ें')}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {t(isHi, 'Share an invite code', 'आमंत्रण कोड शेयर करें')}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setInviteOpen(true)}
            >
              {t(isHi, 'Invite', 'आमंत्रित करें')}
            </Button>
          </div>
        )}

        {/* ── Search bar ── */}
        {(teachers.length > 0 || loadingTeachers) && (
          <Input
            placeholder={t(isHi, 'Search teachers / शिक्षक खोजें', 'शिक्षक खोजें / Search teachers')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t(isHi, 'Search teachers', 'शिक्षक खोजें')}
            style={{ minHeight: 48 }}
          />
        )}

        {/* ── Loading teachers skeleton ── */}
        {loadingTeachers && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <TeacherCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* ── Teacher list ── */}
        {!loadingTeachers && teachers.length > 0 && (
          <section aria-label={t(isHi, 'Teacher list', 'शिक्षकों की सूची')}>
            {filteredTeachers.length === 0 ? (
              <Card className="py-8 text-center">
                <p className="text-3xl mb-2" aria-hidden="true">🔍</p>
                <p className="text-sm font-semibold text-[var(--text-2)]">
                  {t(isHi, 'No results for', 'कोई परिणाम नहीं:')} &quot;{searchQuery}&quot;
                </p>
                <p className="text-xs text-[var(--text-3)] mt-1">
                  {t(isHi, 'Try a different name or subject', 'दूसरा नाम या विषय खोजें')}
                </p>
              </Card>
            ) : (
              <>
                {query && (
                  <SectionHeader>
                    {filteredTeachers.length}{' '}
                    {t(isHi, 'result(s) found', 'परिणाम मिले')}
                  </SectionHeader>
                )}
                <div className="space-y-3">
                  {filteredTeachers.map((teacher) => (
                    <TeacherCard key={teacher.id} teacher={teacher} isHi={isHi} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Empty state: no teachers at all ── */}
        {!loadingTeachers && teachers.length === 0 && (
          <EmptyState
            icon="👩‍🏫"
            title={t(isHi, 'No teachers yet', 'अभी कोई शिक्षक नहीं')}
            description={t(
              isHi,
              'Invite your first teacher using the button above.',
              'ऊपर दिए बटन से अपना पहला शिक्षक आमंत्रित करें।'
            )}
            action={
              schoolId ? (
                <Button variant="primary" onClick={() => setInviteOpen(true)}>
                  {t(isHi, 'Invite Teacher', 'शिक्षक आमंत्रित करें')}
                </Button>
              ) : undefined
            }
          />
        )}
      </main>

      {/* ── Invite code modal ── */}
      {schoolId && (
        <InviteModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          schoolId={schoolId}
          isHi={isHi}
        />
      )}

      <BottomNav />
    </div>
  );
}
