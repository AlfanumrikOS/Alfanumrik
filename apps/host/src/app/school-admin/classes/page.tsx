'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import SchoolAdminPageHeader from '../_components/SchoolAdminPageHeader';
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
  SheetModal,
} from '@alfanumrik/ui/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface ClassTeacher {
  id: string;
  name: string;
}

interface SchoolClass {
  id: string;
  name: string;
  /** Always a string "6"–"12" per P5 */
  grade: string;
  section: string | null;
  subject: string | null;
  student_count: number;
  teacher_count: number;
  avg_mastery: number;
  teachers: ClassTeacher[];
  class_code: string | null;
  created_at: string;
}

/* ─────────────────────────────────────────────────────────────
   GRADE OPTIONS (strings — P5)
───────────────────────────────────────────────────────────── */
const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

const GRADE_SELECT_OPTIONS_EN = GRADE_VALUES.map((g) => ({
  value: g,
  label: `Grade ${g}`,
}));

const GRADE_SELECT_OPTIONS_HI = GRADE_VALUES.map((g) => ({
  value: g,
  label: `कक्षा ${g}`,
}));

/* ─────────────────────────────────────────────────────────────
   MASTERY COLOR HELPER
───────────────────────────────────────────────────────────── */
function masteryColor(value: number): string {
  if (value < 40) return 'var(--danger)';
  if (value <= 70) return 'var(--orange)';
  return 'var(--green)';
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function ClassCardSkeleton() {
  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-2 flex-1">
            <Skeleton variant="title" height={18} width="65%" />
            <div className="flex gap-1.5">
              <Skeleton variant="rect" height={20} width={64} rounded="rounded-full" />
              <Skeleton variant="rect" height={20} width={48} rounded="rounded-full" />
            </div>
          </div>
          <Skeleton variant="rect" height={20} width={52} rounded="rounded-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton variant="text" height={11} width="30%" />
          <Skeleton variant="rect" height={6} rounded="rounded-full" />
        </div>
        <div className="flex gap-4">
          <Skeleton variant="text" height={12} width="35%" />
          <Skeleton variant="text" height={12} width="35%" />
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   CLASS CARD
───────────────────────────────────────────────────────────── */
interface ClassCardProps {
  cls: SchoolClass;
  isHi: boolean;
  onOpenDetail: (cls: SchoolClass) => void;
}

function ClassCard({ cls, isHi, onOpenDetail }: ClassCardProps) {
  const color = masteryColor(cls.avg_mastery);

  return (
    <Card
      hoverable
      onClick={() => onOpenDetail(cls)}
      className="p-4"
    >
      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Class name */}
          <h2
            className="text-sm font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {cls.name}
          </h2>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {/* Grade badge — grade is always a string (P5) */}
            <Badge color="var(--purple)" size="sm">
              {t(isHi, `Grade ${cls.grade}`, `कक्षा ${cls.grade}`)}
            </Badge>

            {/* Section */}
            {cls.section && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                }}
              >
                {t(isHi, 'Sec', 'सेक')} {cls.section}
              </span>
            )}

            {/* Subject */}
            {cls.subject && (
              <Badge color="var(--teal)" size="sm">
                {cls.subject}
              </Badge>
            )}
          </div>
        </div>

        {/* Class code chip */}
        {cls.class_code && (
          <span
            className="text-xs font-mono font-bold px-2 py-1 rounded-lg flex-shrink-0"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              letterSpacing: '0.05em',
            }}
          >
            {cls.class_code}
          </span>
        )}
      </div>

      {/* ── Avg mastery bar ── */}
      <div className="mt-3">
        <ProgressBar
          value={cls.avg_mastery}
          color={color}
          height={6}
          label={t(isHi, 'Avg Mastery', 'औसत महारत')}
          showPercent
        />
      </div>

      {/* ── Student + Teacher counts ── */}
      <div className="flex items-center gap-4 mt-3">
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          👥{' '}
          <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
            {cls.student_count}
          </span>{' '}
          {t(isHi, 'students', 'छात्र')}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          👩‍🏫{' '}
          <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
            {cls.teacher_count}
          </span>{' '}
          {t(isHi, 'teachers', 'शिक्षक')}
        </span>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   CREATE CLASS FORM (inside SheetModal)
───────────────────────────────────────────────────────────── */
interface CreateClassFormProps {
  isHi: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

function CreateClassForm({ isHi, onSuccess, onClose }: CreateClassFormProps) {
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState('6');
  const [section, setSection] = useState('');
  const [subject, setSubject] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; section?: string }>({});

  const gradeOptions = isHi ? GRADE_SELECT_OPTIONS_HI : GRADE_SELECT_OPTIONS_EN;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation — POST /api/school-admin/classes requires
    // name, grade AND section.
    const errors: { name?: string; section?: string } = {};
    if (!className.trim()) {
      errors.name = t(isHi, 'Class name is required', 'कक्षा का नाम आवश्यक है');
    }
    if (!section.trim()) {
      errors.section = t(isHi, 'Section is required', 'सेक्शन आवश्यक है');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      // School admins have SELECT-only RLS on `classes` — a client-side insert
      // is silently blocked. Creation must go through the server route
      // (service role + audit log). school_id is derived server-side from the
      // authenticated admin.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new Error(
          t(isHi, 'Session expired. Please log in again.', 'सत्र समाप्त हो गया। कृपया फिर से लॉगिन करें।')
        );
      }

      const res = await fetch('/api/school-admin/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: className.trim(),
          grade, // string "6"–"12" per P5 — never integer
          section: section.trim(),
          subject: subject.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(
          typeof json?.error === 'string' && json.error
            ? json.error
            : t(isHi, 'Failed to create class', 'कक्षा बनाने में विफल')
        );
      }

      onSuccess();
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : t(isHi, 'Failed to create class', 'कक्षा बनाने में विफल')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">
      {/* Class name */}
      <Input
        label={t(isHi, 'Class Name', 'कक्षा का नाम')}
        value={className}
        onChange={(e) => {
          setClassName(e.target.value);
          if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
        }}
        placeholder={t(isHi, 'e.g. Class 8A Science', 'उदा. कक्षा 8A विज्ञान')}
        error={fieldErrors.name}
        autoFocus
        style={{ minHeight: 48 }}
      />

      {/* Grade select */}
      <Select
        label={t(isHi, 'Grade', 'ग्रेड')}
        value={grade}
        onChange={setGrade}
        options={gradeOptions}
      />

      {/* Section (required by the API) */}
      <Input
        label={t(isHi, 'Section', 'सेक्शन')}
        value={section}
        onChange={(e) => {
          setSection(e.target.value);
          if (fieldErrors.section) setFieldErrors((prev) => ({ ...prev, section: undefined }));
        }}
        placeholder={t(isHi, 'e.g. A, B, C', 'उदा. A, B, C')}
        maxLength={10}
        error={fieldErrors.section}
        style={{ minHeight: 48 }}
      />

      {/* Subject (optional) */}
      <Input
        label={t(isHi, 'Subject (optional)', 'विषय (वैकल्पिक)')}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t(isHi, 'e.g. Mathematics, Science', 'उदा. गणित, विज्ञान')}
        style={{ minHeight: 48 }}
      />

      {/* Form-level error */}
      {formError && (
        <p
          className="text-xs font-medium px-1"
          style={{ color: 'var(--danger)' }}
          role="alert"
        >
          {formError}
        </p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        variant="primary"
        fullWidth
        disabled={submitting}
        style={{ minHeight: 52 }}
      >
        {submitting
          ? t(isHi, 'Creating…', 'बना रहे हैं…')
          : t(isHi, 'Create Class / कक्षा बनाएं', 'कक्षा बनाएं')}
      </Button>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   CLASS DETAIL PANEL (inside SheetModal)
───────────────────────────────────────────────────────────── */
interface ClassDetailPanelProps {
  cls: SchoolClass;
  isHi: boolean;
}

function ClassDetailPanel({ cls, isHi }: ClassDetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const color = masteryColor(cls.avg_mastery);

  const handleCopy = async () => {
    if (!cls.class_code) return;
    try {
      await navigator.clipboard.writeText(cls.class_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available (older browsers); silently ignore
    }
  };

  return (
    <div className="space-y-5 pt-1">
      {/* ── Class header info ── */}
      <div>
        <h3
          className="text-lg font-bold text-[var(--text-1)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {cls.name}
        </h3>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {/* Grade — always a string (P5) */}
          <Badge color="var(--purple)" size="sm">
            {t(isHi, `Grade ${cls.grade}`, `कक्षा ${cls.grade}`)}
          </Badge>
          {cls.section && (
            <span
              className="text-xs font-medium px-2.5 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
            >
              {t(isHi, 'Section', 'सेक्शन')} {cls.section}
            </span>
          )}
          {cls.subject && (
            <Badge color="var(--teal)" size="sm">
              {cls.subject}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Stats row ── */}
      <div
        className="grid grid-cols-2 gap-3 rounded-xl p-4"
        style={{ background: 'var(--surface-2)' }}
      >
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: 'var(--orange)' }}>
            {cls.student_count}
          </p>
          <p className="text-xs text-[var(--text-3)] mt-0.5 font-medium">
            {t(isHi, 'Students', 'छात्र')}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color }}>
            {Math.round(cls.avg_mastery)}%
          </p>
          <p className="text-xs text-[var(--text-3)] mt-0.5 font-medium">
            {t(isHi, 'Avg Mastery', 'औसत महारत')}
          </p>
        </div>
      </div>

      {/* ── Teacher list ── */}
      {cls.teachers && cls.teachers.length > 0 && (
        <div>
          <p
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            {t(isHi, 'Teachers', 'शिक्षक')}
          </p>
          <div className="space-y-2">
            {cls.teachers.map((teacher) => (
              <div key={teacher.id} className="flex items-center gap-3">
                <Avatar name={teacher.name} size={36} />
                <span className="text-sm font-semibold text-[var(--text-1)]">
                  {teacher.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Class code ── */}
      {cls.class_code && (
        <div>
          <p
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            {t(isHi, 'Class Code', 'कक्षा कोड')}
          </p>
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span
              className="text-xl font-mono font-bold tracking-widest"
              style={{ color: 'var(--text-1)', letterSpacing: '0.12em' }}
            >
              {cls.class_code}
            </span>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
              style={{
                background: copied ? 'color-mix(in srgb, var(--success) 9%, transparent)' : 'var(--surface-1)',
                border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
                color: copied ? 'var(--success)' : 'var(--text-2)',
                minHeight: 36,
                minWidth: 64,
              }}
              aria-label={t(isHi, 'Copy class code', 'कक्षा कोड कॉपी करें')}
            >
              {copied ? '✓' : t(isHi, 'Copy', 'कॉपी')}
            </button>
          </div>
        </div>
      )}

      {/* ── View Students link ── */}
      <a
        href={`/school-admin/students?class_id=${cls.id}`}
        className="flex items-center justify-center gap-2 w-full rounded-xl py-3.5 text-sm font-semibold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--teal)',
          minHeight: 52,
          textDecoration: 'none',
        }}
      >
        👩‍🎓 {t(isHi, 'View Students', 'छात्र देखें')} →
      </a>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminClassesPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [rpcError, setRpcError] = useState<string | null>(null);

  /* Modal state */
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailClass, setDetailClass] = useState<SchoolClass | null>(null);

  /* Success toast */
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  /* ── Step 2: Fetch classes via RPC ── */
  const fetchClasses = useCallback(async (sid: string) => {
    setLoadingClasses(true);
    setRpcError(null);

    // get_school_classes(p_school_id uuid) is SECURITY DEFINER over the real
    // `classes` table (with an is_school_admin_of guard). The previous call
    // passed the wrong argument name (`school_id`), which PostgREST rejects as
    // a missing function — the list never loaded.
    const { data, error } = await supabase.rpc('get_school_classes', {
      p_school_id: sid,
    });

    if (error) {
      setRpcError(error.message);
    } else {
      // RPC row shape: id, name, grade, section, subject, class_code,
      // is_active, created_at, student_count, teachers[]. It does not return
      // teacher_count (derived) or avg_mastery (no source yet — defaults to 0).
      const rows = Array.isArray(data) ? data : [];
      setClasses(
        rows.map((row: any): SchoolClass => ({
          id: row.id,
          name: row.name,
          grade: String(row.grade), // P5: string "6"–"12"
          section: row.section ?? null,
          subject: row.subject ?? null,
          student_count: typeof row.student_count === 'number' ? row.student_count : 0,
          teacher_count: Array.isArray(row.teachers) ? row.teachers.length : 0,
          avg_mastery: typeof row.avg_mastery === 'number' ? row.avg_mastery : 0,
          teachers: Array.isArray(row.teachers) ? row.teachers : [],
          class_code: row.class_code ?? null,
          created_at: row.created_at,
        }))
      );
    }

    setLoadingClasses(false);
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

  /* ── Fetch classes once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchClasses(schoolId);
    }
  }, [schoolId, fetchClasses]);

  /* ── Auto-dismiss success message ── */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3500);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /* ── On class created: show success, reload ── */
  const handleClassCreated = useCallback(() => {
    setSuccessMsg(t(isHi, 'Class created!', 'कक्षा बनाई गई!'));
    if (schoolId) {
      fetchClasses(schoolId);
    }
  }, [isHi, schoolId, fetchClasses]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  /* ══════════════════════════════════════════════════════════
     FULL PAGE LOADING SKELETON
  ══════════════════════════════════════════════════════════ */
  if (isPageLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <ClassCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     ERROR STATE
  ══════════════════════════════════════════════════════════ */
  if (rpcError) {
    return (
      <>
        <SchoolAdminPageHeader
          title="Classes"
          titleHi="कक्षाएं"
          isHi={isHi}
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateModalOpen(true)}
              style={{ minHeight: 44, flexShrink: 0 }}
              aria-label={t(isHi, 'Create Class', 'कक्षा बनाएं')}
            >
              + {t(isHi, 'Create Class', 'कक्षा बनाएं')}
            </Button>
          }
        />
        <div className="space-y-4 max-w-4xl">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{rpcError}</p>
            <Button
              variant="primary"
              onClick={() => schoolId && fetchClasses(schoolId)}
            >
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </div>
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════
     LOADED STATE
  ══════════════════════════════════════════════════════════ */
  return (
    <>
      <SchoolAdminPageHeader
        title="Classes"
        titleHi="कक्षाएं"
        isHi={isHi}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            style={{ minHeight: 44, flexShrink: 0 }}
            aria-label={t(isHi, 'Create Class', 'कक्षा बनाएं')}
          >
            + {t(isHi, 'Create Class', 'कक्षा बनाएं')}
          </Button>
        }
      />

      <div className="space-y-4 max-w-4xl">

        {/* ── Class list loading skeleton ── */}
        {loadingClasses && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <ClassCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* ── Class grid ── */}
        {!loadingClasses && classes.length > 0 && (
          <section
            aria-label={t(isHi, 'Class list', 'कक्षाओं की सूची')}
            className="grid grid-cols-2 gap-3"
          >
            {classes.map((cls) => (
              <ClassCard
                key={cls.id}
                cls={cls}
                isHi={isHi}
                onOpenDetail={setDetailClass}
              />
            ))}
          </section>
        )}

        {/* ── Empty state: no classes yet ── */}
        {!loadingClasses && classes.length === 0 && (
          <EmptyState
            icon="🏫"
            title={t(isHi, 'No classes yet', 'अभी कोई कक्षा नहीं')}
            description={t(
              isHi,
              'Create your first class to get started.',
              'पहली कक्षा बनाएं और शुरुआत करें।'
            )}
            action={
              <Button
                variant="primary"
                onClick={() => setCreateModalOpen(true)}
                style={{ minHeight: 48 }}
              >
                + {t(isHi, 'Create your first class', 'पहली कक्षा बनाएं')}
              </Button>
            }
          />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          CREATE CLASS MODAL
      ══════════════════════════════════════════════════════ */}
      <SheetModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={t(isHi, 'Create Class / कक्षा बनाएं', 'कक्षा बनाएं')}
      >
        {schoolId && (
          <CreateClassForm
            isHi={isHi}
            onSuccess={handleClassCreated}
            onClose={() => setCreateModalOpen(false)}
          />
        )}
      </SheetModal>

      {/* ══════════════════════════════════════════════════════
          CLASS DETAIL MODAL
      ══════════════════════════════════════════════════════ */}
      <SheetModal
        open={detailClass !== null}
        onClose={() => setDetailClass(null)}
        title={detailClass?.name ?? ''}
      >
        {detailClass && (
          <ClassDetailPanel cls={detailClass} isHi={isHi} />
        )}
      </SheetModal>

      {/* ══════════════════════════════════════════════════════
          SUCCESS TOAST
      ══════════════════════════════════════════════════════ */}
      {successMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl text-sm font-semibold text-on-accent shadow-lg pointer-events-none animate-fade-in"
          style={{
            background: 'color-mix(in srgb, var(--success) 92%, transparent)',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
          role="status"
          aria-live="polite"
        >
          ✓ {successMsg}
        </div>
      )}


    </>
  );
}
