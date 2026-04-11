'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Skeleton,
  EmptyState,
  SheetModal,
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
type RoleType = 'teacher' | 'student';

interface InviteCode {
  id: string;
  code: string;
  role_type: RoleType;
  class_id: string | null;
  max_uses: number;
  uses_count: number;
  expires_at: string;
  is_active: boolean;
  created_at: string;
}

interface SchoolClass {
  id: string;
  name: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
}

type TabFilter = 'active' | 'all';

/* ─────────────────────────────────────────────────────────────
   DATE HELPERS
───────────────────────────────────────────────────────────── */
function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function expiryInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/* ─────────────────────────────────────────────────────────────
   SKELETON ROWS
───────────────────────────────────────────────────────────── */
function CodeRowSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton variant="title" height={22} width="60%" />
          <Skeleton variant="text" height={12} width="40%" />
        </div>
        <Skeleton variant="rect" height={24} width={64} rounded="rounded-full" />
      </div>
      <div className="mt-3 space-y-1.5">
        <Skeleton variant="text" height={11} width="35%" />
        <Skeleton variant="rect" height={6} rounded="rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton variant="rect" height={36} width={80} rounded="rounded-xl" />
        <Skeleton variant="rect" height={36} width={96} rounded="rounded-xl" />
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   NEWLY GENERATED CODE DISPLAY
───────────────────────────────────────────────────────────── */
interface NewCodeDisplayProps {
  code: string;
  isHi: boolean;
}

function NewCodeDisplay({ code, isHi }: NewCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text
    }
  }

  return (
    <div
      className="rounded-2xl p-4 text-center mt-4 mb-2"
      style={{
        background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)',
        border: '1.5px solid #16A34A30',
      }}
    >
      <p className="text-xs font-semibold mb-2" style={{ color: '#16A34A' }}>
        {t(isHi, '✅ Code generated!', '✅ कोड बन गया!')}
      </p>
      <p
        className="text-3xl font-bold tracking-widest select-all"
        style={{
          fontFamily: 'monospace',
          color: 'var(--text-1)',
          letterSpacing: '0.2em',
        }}
        aria-label={`Invite code: ${code}`}
      >
        {code}
      </p>
      <button
        onClick={handleCopy}
        className="mt-3 px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
        style={{
          background: copied ? '#16A34A' : 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: copied ? '#fff' : 'var(--text-2)',
          minHeight: '40px',
        }}
      >
        {copied
          ? t(isHi, 'Copied!', 'कॉपी हो गया!')
          : t(isHi, 'Copy', 'कॉपी')}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   INDIVIDUAL CODE CARD
───────────────────────────────────────────────────────────── */
interface CodeCardProps {
  code: InviteCode;
  className: string | undefined;
  isHi: boolean;
  onCopy: (code: string) => void;
  copiedId: string | null;
  onDeactivate: (id: string) => void;
  deactivatingId: string | null;
}

function CodeCard({
  code,
  className,
  isHi,
  onCopy,
  copiedId,
  onDeactivate,
  deactivatingId,
}: CodeCardProps) {
  const expired = isExpired(code.expires_at);
  const usePct = code.max_uses > 0 ? (code.uses_count / code.max_uses) * 100 : 0;

  /* Status: deactivated > expired > active */
  const statusLabel = !code.is_active
    ? t(isHi, 'Deactivated', 'निष्क्रिय')
    : expired
      ? t(isHi, 'Expired', 'समाप्त हो गया')
      : t(isHi, 'Active', 'सक्रिय');

  const statusColor = !code.is_active
    ? '#7D7264'
    : expired
      ? '#DC2626'
      : '#16A34A';

  const roleColor =
    code.role_type === 'teacher' ? 'var(--purple)' : 'var(--teal)';
  const roleLabel =
    code.role_type === 'teacher'
      ? t(isHi, 'Teacher', 'शिक्षक')
      : t(isHi, 'Student', 'छात्र');

  const isCopied = copiedId === code.id;
  const isDeactivating = deactivatingId === code.id;
  const canDeactivate = code.is_active && !expired;

  return (
    <Card>
      {/* Top row: code + role badge */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p
            className="text-2xl font-bold tracking-widest"
            style={{
              fontFamily: 'monospace',
              color: 'var(--text-1)',
              letterSpacing: '0.18em',
              lineHeight: 1.2,
            }}
            aria-label={`Invite code: ${code.code}`}
          >
            {code.code}
          </p>
          {/* Class info */}
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            {className
              ? `${t(isHi, 'Bound to:', 'बाधित:')} ${className}`
              : t(isHi, 'Any class', 'कोई भी कक्षा')}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <Badge color={roleColor}>{roleLabel}</Badge>
          <Badge color={statusColor}>{statusLabel}</Badge>
        </div>
      </div>

      {/* Uses progress */}
      <div className="mt-3">
        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-3)' }}>
          <span>
            {code.uses_count}/{code.max_uses}{' '}
            {t(isHi, 'uses', 'उपयोग')}
          </span>
          <span style={{ color: expired ? '#DC2626' : 'var(--text-3)' }}>
            {expired
              ? t(isHi, 'Expired', 'समाप्त हो गया')
              : `${t(isHi, 'Expires', 'समाप्त')} ${formatDate(code.expires_at)}`}
          </span>
        </div>
        <ProgressBar
          value={usePct}
          color={
            usePct >= 100
              ? '#DC2626'
              : usePct >= 80
                ? 'var(--orange)'
                : 'var(--teal)'
          }
          height={6}
        />
      </div>

      {/* Actions row */}
      <div className="mt-3 flex gap-2">
        {/* Copy button */}
        <button
          onClick={() => onCopy(code.id)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{
            background: isCopied ? '#16A34A' : 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: isCopied ? '#fff' : 'var(--text-2)',
            minHeight: '36px',
          }}
          aria-label={t(isHi, 'Copy code', 'कोड कॉपी करें')}
        >
          <span aria-hidden="true">{isCopied ? '✓' : '📋'}</span>
          {isCopied
            ? t(isHi, 'Copied!', 'कॉपी हो गया!')
            : t(isHi, 'Copy', 'कॉपी')}
        </button>

        {/* Deactivate button */}
        {canDeactivate && (
          <button
            onClick={() => onDeactivate(code.id)}
            disabled={isDeactivating}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: '#DC2626',
              minHeight: '36px',
              opacity: isDeactivating ? 0.6 : 1,
              cursor: isDeactivating ? 'not-allowed' : 'pointer',
            }}
            aria-label={t(isHi, 'Deactivate code', 'कोड निष्क्रिय करें')}
          >
            {isDeactivating ? '…' : '🚫'}{' '}
            {t(isHi, 'Deactivate', 'निष्क्रिय करें')}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   GENERATE CODE MODAL FORM
───────────────────────────────────────────────────────────── */
interface GenerateFormProps {
  classes: SchoolClass[];
  isHi: boolean;
  onSubmit: (values: {
    roleType: RoleType;
    classId: string;
    maxUses: number;
    expiryDays: number;
  }) => Promise<void>;
  submitting: boolean;
  newCode: string | null;
}

function GenerateForm({ classes, isHi, onSubmit, submitting, newCode }: GenerateFormProps) {
  const [roleType, setRoleType] = useState<RoleType>('student');
  const [classId, setClassId] = useState<string>('');
  const [maxUses, setMaxUses] = useState<number>(50);
  const [expiryDays, setExpiryDays] = useState<number>(30);
  const [maxUsesError, setMaxUsesError] = useState<string>('');

  /* When role changes, reset max uses to sensible default */
  function handleRoleChange(val: string) {
    const r = val as RoleType;
    setRoleType(r);
    setMaxUses(r === 'teacher' ? 1 : 50);
    setMaxUsesError('');
  }

  function handleMaxUsesChange(val: string) {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1) {
      setMaxUsesError(t(isHi, 'Minimum 1', 'न्यूनतम 1'));
      setMaxUses(1);
    } else if (n > 100) {
      setMaxUsesError(t(isHi, 'Maximum 100', 'अधिकतम 100'));
      setMaxUses(100);
    } else {
      setMaxUsesError('');
      setMaxUses(n);
    }
  }

  const classOptions = [
    { value: '', label: t(isHi, 'Any class', 'कोई भी कक्षा') },
    ...classes.map((c) => ({
      value: c.id,
      label: `${c.name} (Grade ${c.grade})`,
    })),
  ];

  const expiryOptions = [
    { value: '7', label: t(isHi, '7 days', '7 दिन') },
    { value: '30', label: t(isHi, '30 days', '30 दिन') },
    { value: '90', label: t(isHi, '90 days', '90 दिन') },
  ];

  async function handleSubmit() {
    if (maxUsesError) return;
    await onSubmit({ roleType, classId, maxUses, expiryDays });
  }

  return (
    <div className="space-y-4 pb-2">
      {/* Show the newly generated code at top when present */}
      {newCode && <NewCodeDisplay code={newCode} isHi={isHi} />}

      <Select
        label={t(isHi, 'Role / भूमिका', 'Role / भूमिका')}
        value={roleType}
        onChange={handleRoleChange}
        options={[
          { value: 'student', label: t(isHi, 'Student / छात्र', 'Student / छात्र') },
          { value: 'teacher', label: t(isHi, 'Teacher / शिक्षक', 'Teacher / शिक्षक') },
        ]}
      />

      {/* Class dropdown — only for student */}
      {roleType === 'student' && (
        <Select
          label={t(isHi, 'Class / कक्षा', 'Class / कक्षा')}
          value={classId}
          onChange={setClassId}
          options={classOptions}
        />
      )}

      <Input
        label={t(isHi, 'Max uses / अधिकतम उपयोग', 'Max uses / अधिकतम उपयोग')}
        type="number"
        inputMode="numeric"
        min={1}
        max={100}
        value={maxUses}
        onChange={(e) => handleMaxUsesChange(e.target.value)}
        error={maxUsesError}
      />

      <Select
        label={t(isHi, 'Expiry / समाप्ति', 'Expiry / समाप्ति')}
        value={String(expiryDays)}
        onChange={(v) => setExpiryDays(parseInt(v, 10))}
        options={expiryOptions}
      />

      <Button
        variant="primary"
        fullWidth
        size="lg"
        onClick={handleSubmit}
        disabled={submitting || !!maxUsesError}
      >
        {submitting
          ? t(isHi, 'Generating…', 'बना रहे हैं…')
          : t(isHi, 'Generate / बनाएं', 'Generate / बनाएं')}
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   TAB SWITCHER
───────────────────────────────────────────────────────────── */
interface TabSwitcherProps {
  active: TabFilter;
  onChange: (tab: TabFilter) => void;
  isHi: boolean;
}

function TabSwitcher({ active, onChange, isHi }: TabSwitcherProps) {
  const tabs: { key: TabFilter; en: string; hi: string }[] = [
    { key: 'active', en: 'Active', hi: 'सक्रिय' },
    { key: 'all', en: 'All', hi: 'सभी' },
  ];

  return (
    <div
      className="flex rounded-xl p-1 mb-4"
      role="tablist"
      aria-label={t(isHi, 'Filter codes', 'कोड फ़िल्टर करें')}
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {tabs.map((tab) => {
        const isSelected = active === tab.key;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(tab.key)}
            className="flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: isSelected ? 'var(--surface-1)' : 'transparent',
              color: isSelected ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: isSelected ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              minHeight: '40px',
            }}
          >
            {t(isHi, tab.en, tab.hi)}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE COMPONENT
───────────────────────────────────────────────────────────── */
export default function InviteCodesPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── state ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabFilter>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  /* ── auth guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── initial data load ── */
  const loadData = useCallback(
    async (sid: string) => {
      const [codesRes, classesRes] = await Promise.all([
        supabase
          .from('school_invite_codes')
          .select(
            'id, code, role_type, class_id, max_uses, uses_count, expires_at, is_active, created_at'
          )
          .eq('school_id', sid)
          .order('created_at', { ascending: false }),
        supabase
          .from('school_classes')
          .select('id, name, grade')
          .eq('school_id', sid),
      ]);

      if (codesRes.error) throw new Error(codesRes.error.message);
      if (classesRes.error) throw new Error(classesRes.error.message);

      setCodes((codesRes.data ?? []) as InviteCode[]);
      setClasses((classesRes.data ?? []) as SchoolClass[]);
    },
    []
  );

  const bootstrap = useCallback(async () => {
    if (!authUserId) return;

    setLoadingPage(true);
    setPageError(null);

    try {
      const { data: adminRecord, error: adminErr } = await supabase
        .from('school_admins')
        .select('school_id, name')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (adminErr) throw new Error(adminErr.message);

      if (!adminRecord) {
        router.replace('/login');
        return;
      }

      setSchoolId(adminRecord.school_id);
      await loadData(adminRecord.school_id);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingPage(false);
    }
  }, [authUserId, router, loadData]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      bootstrap();
    }
  }, [authLoading, authUserId, bootstrap]);

  /* ── generate code ── */
  async function handleGenerate(values: {
    roleType: RoleType;
    classId: string;
    maxUses: number;
    expiryDays: number;
  }) {
    if (!schoolId) return;

    setSubmitting(true);
    setNewCode(null);

    const { data, error: insertErr } = await supabase
      .from('school_invite_codes')
      .insert({
        school_id: schoolId,
        role_type: values.roleType,
        class_id: values.classId || null,
        max_uses: values.maxUses,
        expires_at: expiryInDays(values.expiryDays),
      })
      .select('id, code, role_type, max_uses, expires_at')
      .single();

    setSubmitting(false);

    if (insertErr || !data) {
      setPageError(insertErr?.message ?? 'Failed to generate code');
      return;
    }

    setNewCode(data.code);

    /* Refresh the codes list */
    if (schoolId) {
      await loadData(schoolId);
    }
  }

  /* ── copy code ── */
  async function handleCopy(codeId: string) {
    const found = codes.find((c) => c.id === codeId);
    if (!found) return;

    try {
      await navigator.clipboard.writeText(found.code);
      setCopiedId(codeId);
      setTimeout(() => setCopiedId((prev) => (prev === codeId ? null : prev)), 2000);
    } catch {
      // silently ignore clipboard permission errors
    }
  }

  /* ── deactivate code ── */
  async function handleDeactivate(codeId: string) {
    const confirmed = window.confirm(
      isHi ? 'इस कोड को निष्क्रिय करें?' : 'Deactivate this code?'
    );
    if (!confirmed) return;

    setDeactivatingId(codeId);

    const { error: updateErr } = await supabase
      .from('school_invite_codes')
      .update({ is_active: false })
      .eq('id', codeId);

    setDeactivatingId(null);

    if (updateErr) {
      setPageError(updateErr.message);
      return;
    }

    /* Optimistic update then refresh */
    setCodes((prev) =>
      prev.map((c) => (c.id === codeId ? { ...c, is_active: false } : c))
    );
  }

  /* ── filtered codes ── */
  const filteredCodes =
    tab === 'active'
      ? codes.filter((c) => c.is_active && !isExpired(c.expires_at))
      : codes;

  /* ── class lookup map ── */
  const classMap = new Map(classes.map((c) => [c.id, `${c.name} (Grade ${c.grade})`]));

  /* ─── LOADING STATE ─────────────────────────────────────── */
  if (authLoading || loadingPage) {
    return (
      <div
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        {/* Sticky header placeholder */}
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" height={36} width={36} rounded="rounded-xl" />
          <Skeleton variant="title" height={22} width="45%" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-3">
          {[1, 2, 3].map((i) => (
            <CodeRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ─── ERROR STATE ───────────────────────────────────────── */
  if (pageError) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{pageError}</p>
          <Button
            variant="primary"
            onClick={() => {
              setPageError(null);
              bootstrap();
            }}
          >
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  /* ─── MAIN RENDER ───────────────────────────────────────── */
  return (
    <div
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      style={{ background: 'var(--bg)' }}
    >
      {/* ══════════════════════════════════════
          STICKY HEADER
      ══════════════════════════════════════ */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Back button */}
        <button
          onClick={() => router.push('/school-admin')}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '18px',
          }}
          aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')}
        >
          ←
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Invite Codes', 'आमंत्रण कोड')}
          </h1>
        </div>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
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

        {/* New Code CTA */}
        <button
          onClick={() => {
            setNewCode(null);
            setModalOpen(true);
          }}
          className="btn-primary rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
          style={{ minHeight: '40px' }}
          aria-label={t(isHi, 'Generate new invite code', 'नया आमंत्रण कोड बनाएं')}
        >
          <span aria-hidden="true">+</span>
          {t(isHi, 'New Code', 'नया कोड')}
        </button>
      </header>

      {/* ══════════════════════════════════════
          PAGE BODY
      ══════════════════════════════════════ */}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">
        {/* Tab switcher */}
        <TabSwitcher active={tab} onChange={setTab} isHi={isHi} />

        {/* Codes list */}
        {filteredCodes.length === 0 ? (
          <EmptyState
            icon="🔑"
            title={t(isHi, 'No invite codes yet', 'अभी कोई आमंत्रण कोड नहीं')}
            description={
              tab === 'active'
                ? t(
                    isHi,
                    'No active codes. Generate one to invite teachers or students.',
                    'कोई सक्रिय कोड नहीं। शिक्षकों या छात्रों को आमंत्रित करने के लिए एक बनाएं।'
                  )
                : t(
                    isHi,
                    'No codes have been generated for this school.',
                    'इस स्कूल के लिए कोई कोड नहीं बनाया गया।'
                  )
            }
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setNewCode(null);
                  setModalOpen(true);
                }}
              >
                {t(isHi, '+ New Code', '+ नया कोड')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredCodes.map((code) => (
              <CodeCard
                key={code.id}
                code={code}
                className={code.class_id ? classMap.get(code.class_id) : undefined}
                isHi={isHi}
                onCopy={handleCopy}
                copiedId={copiedId}
                onDeactivate={handleDeactivate}
                deactivatingId={deactivatingId}
              />
            ))}
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════
          GENERATE CODE SHEET MODAL
      ══════════════════════════════════════ */}
      <SheetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t(isHi, 'New Code / नया कोड', 'New Code / नया कोड')}
      >
        <GenerateForm
          classes={classes}
          isHi={isHi}
          onSubmit={handleGenerate}
          submitting={submitting}
          newCode={newCode}
        />
      </SheetModal>

      {/* ══════════════════════════════════════
          BOTTOM NAV
      ══════════════════════════════════════ */}
      <BottomNav />
    </div>
  );
}
