'use client';

/**
 * StaffManagement — Phase 3B Wave C. The lazy-loaded client component behind
 * /school-admin/staff. Renders the staff table, invite form, inline role change,
 * and revoke flow against /api/school-admin/staff.
 *
 * It is rendered ONLY when `ff_school_admin_rbac` is ON (the page wrapper gates
 * on useSchoolAdminRbac before importing this), so every fetch here is safe: the
 * API 404s while the flag is OFF and this component is never mounted then.
 *
 * 409 LAST_PRINCIPAL_LOCKOUT handling: the API refuses to revoke or demote the
 * last active principal. We surface that as a clear, blocking inline message
 * ("Can't remove the last principal — assign another principal first") rather
 * than a generic error, and we do NOT mutate local state on that branch.
 *
 * P7 bilingual throughout. P13: no PII (email/name) is logged anywhere.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import { useSchoolAdminRole, type SchoolAdminRole } from '@alfanumrik/lib/use-school-admin-role';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
  EmptyState,
  SheetModal,
  Avatar,
} from '@alfanumrik/ui/ui';

/* ── Bilingual helper (P7) ─────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ── Types (mirror the GET contract) ───────────────────────────────────── */
interface StaffMember {
  id: string;
  name: string | null;
  email: string;
  role: SchoolAdminRole;
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

const ROLE_ORDER: ReadonlyArray<SchoolAdminRole> = [
  'principal',
  'vice_principal',
  'academic_coordinator',
  'institution_admin',
];

/** Bilingual role labels. Role keys are technical; labels are translated (P7). */
function roleLabel(isHi: boolean, role: SchoolAdminRole): string {
  switch (role) {
    case 'principal':
      return t(isHi, 'Principal', 'प्रधानाचार्य');
    case 'vice_principal':
      return t(isHi, 'Vice Principal', 'उप-प्रधानाचार्य');
    case 'academic_coordinator':
      return t(isHi, 'Academic Coordinator', 'शैक्षणिक समन्वयक');
    case 'institution_admin':
      return t(isHi, 'Institution Admin', 'संस्थान प्रशासक');
    default:
      return role;
  }
}

function roleColor(role: SchoolAdminRole): string {
  switch (role) {
    case 'principal':
      return 'var(--purple)';
    case 'vice_principal':
      return 'var(--orange)';
    case 'academic_coordinator':
      return 'var(--teal)';
    case 'institution_admin':
      return '#0EA5E9';
    default:
      return 'var(--text-3)';
  }
}

function roleOptions(isHi: boolean): Array<{ value: string; label: string }> {
  return ROLE_ORDER.map((r) => ({ value: r, label: roleLabel(isHi, r) }));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Skeleton row ──────────────────────────────────────────────────────── */
function StaffRowSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="rect" height={36} width={36} rounded="rounded-full" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton variant="title" height={16} width="45%" />
          <Skeleton variant="text" height={12} width="60%" />
        </div>
        <Skeleton variant="rect" height={28} width={120} rounded="rounded-xl" />
      </div>
    </Card>
  );
}

/* ── Invite form ───────────────────────────────────────────────────────── */
interface InviteFormProps {
  isHi: boolean;
  submitting: boolean;
  onSubmit: (email: string, role: SchoolAdminRole) => Promise<void>;
}

function InviteForm({ isHi, submitting, onSubmit }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SchoolAdminRole>('academic_coordinator');
  const [emailError, setEmailError] = useState('');

  async function handleSubmit() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
      setEmailError(t(isHi, 'Enter a valid email address', 'मान्य ईमेल पता दर्ज करें'));
      return;
    }
    setEmailError('');
    await onSubmit(trimmed, role);
  }

  return (
    <div className="space-y-4 pb-2">
      <Input
        label={t(isHi, 'Email address', 'ईमेल पता')}
        type="email"
        inputMode="email"
        autoComplete="off"
        placeholder={t(isHi, 'staff@school.edu', 'staff@school.edu')}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (emailError) setEmailError('');
        }}
        error={emailError}
      />
      <Select
        label={t(isHi, 'Role', 'भूमिका')}
        value={role}
        onChange={(v) => setRole(v as SchoolAdminRole)}
        options={roleOptions(isHi)}
      />
      <Button variant="primary" fullWidth size="lg" onClick={handleSubmit} disabled={submitting}>
        {submitting
          ? t(isHi, 'Inviting…', 'आमंत्रित कर रहे हैं…')
          : t(isHi, 'Send invite', 'आमंत्रण भेजें')}
      </Button>
    </div>
  );
}

/* ── Staff row ─────────────────────────────────────────────────────────── */
interface StaffRowProps {
  member: StaffMember;
  isSelf: boolean;
  isHi: boolean;
  busy: boolean;
  onChangeRole: (id: string, role: SchoolAdminRole) => void;
  onRevoke: (id: string) => void;
}

function StaffRow({ member, isSelf, isHi, busy, onChangeRole, onRevoke }: StaffRowProps) {
  return (
    <Card className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Identity */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar name={member.name || member.email} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-1)] truncate">
              {member.name || member.email}
              {isSelf && (
                <span className="ml-2 text-[10px] font-medium text-[var(--text-3)]">
                  {t(isHi, '(you)', '(आप)')}
                </span>
              )}
            </p>
            <p className="text-xs text-[var(--text-3)] truncate">{member.email}</p>
            <p className="text-[10px] text-[var(--text-3)] mt-0.5">
              {member.accepted_at
                ? `${t(isHi, 'Joined', 'शामिल हुए')} ${formatDate(member.accepted_at)}`
                : `${t(isHi, 'Invited', 'आमंत्रित')} ${formatDate(member.invited_at || member.created_at)}`}
            </p>
          </div>
        </div>

        {/* Role control + revoke */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {member.accepted_at ? null : (
            <Badge color="var(--text-3)" size="sm">
              {t(isHi, 'Pending', 'लंबित')}
            </Badge>
          )}
          <div className="w-[170px]">
            <Select
              value={member.role}
              onChange={(v) => onChangeRole(member.id, v as SchoolAdminRole)}
              options={roleOptions(isHi)}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            onClick={() => onRevoke(member.id)}
            disabled={busy}
            className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              minWidth: '40px',
              minHeight: '40px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--danger)',
              opacity: busy ? 0.6 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
            aria-label={t(isHi, `Revoke ${member.email}`, `${member.email} को हटाएं`)}
          >
            {busy ? '…' : '🚫'}
          </button>
        </div>
      </div>
      {/* Current role chip (for at-a-glance scanning) */}
      <div className="mt-2 sm:hidden">
        <Badge color={roleColor(member.role)} size="sm">
          {roleLabel(isHi, member.role)}
        </Badge>
      </div>
    </Card>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */
export default function StaffManagement() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  // The caller's own school_admins.id — used to mark their own row "(you)" with
  // a precise id match (no PII needed). RLS self-read; null = unknown.
  const { selfAdminId } = useSchoolAdminRole(authUserId);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Blocking lockout message (rendered prominently, not as a transient toast).
  const [lockoutMsg, setLockoutMsg] = useState<string | null>(null);
  // Generic non-blocking action error (invite/role-change/revoke).
  const [actionError, setActionError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /* ── auth guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) router.replace('/login');
  }, [authLoading, authUserId, router]);

  /* ── load staff list ── */
  const loadStaff = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await authedFetch('/api/school-admin/staff');
      if (res.status === 404) {
        // Flag turned OFF mid-session (or feature not available).
        setPageError(
          t(isHi, 'Staff management is not available.', 'स्टाफ प्रबंधन उपलब्ध नहीं है।'),
        );
        setStaff([]);
        return;
      }
      if (res.status === 403) {
        setPageError(
          t(
            isHi,
            'Your school-admin role does not permit managing staff.',
            'आपकी स्कूल-प्रशासक भूमिका स्टाफ प्रबंधन की अनुमति नहीं देती।',
          ),
        );
        setStaff([]);
        return;
      }
      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load staff');
      }
      const list = (body.data?.staff ?? []) as StaffMember[];
      // Stable display order: by role rank, then by created_at.
      list.sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(a.role);
        const rb = ROLE_ORDER.indexOf(b.role);
        if (ra !== rb) return ra - rb;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
      setStaff(list);
    } catch (err) {
      setPageError(
        err instanceof Error
          ? err.message
          : t(isHi, 'Failed to load staff.', 'स्टाफ लोड करने में विफल।'),
      );
    } finally {
      setLoading(false);
    }
  }, [isHi]);

  useEffect(() => {
    if (!authLoading && authUserId) loadStaff();
  }, [authLoading, authUserId, loadStaff]);

  /* ── invite ── */
  async function handleInvite(email: string, role: SchoolAdminRole) {
    setInviting(true);
    setActionError(null);
    setLockoutMsg(null);
    try {
      const res = await authedFetch('/api/school-admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setActionError(
          typeof body?.error === 'string'
            ? body.error
            : t(isHi, 'Failed to send invite.', 'आमंत्रण भेजने में विफल।'),
        );
        return;
      }
      setInviteOpen(false);
      await loadStaff();
    } catch {
      setActionError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setInviting(false);
    }
  }

  /* ── change role ── */
  async function handleChangeRole(id: string, role: SchoolAdminRole) {
    const current = staff.find((s) => s.id === id);
    if (!current || current.role === role) return;
    setBusyId(id);
    setActionError(null);
    setLockoutMsg(null);
    try {
      const res = await authedFetch('/api/school-admin/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, role }),
      });
      const body = await res.json();
      if (res.status === 409 && body?.code === 'LAST_PRINCIPAL_LOCKOUT') {
        setLockoutMsg(
          t(
            isHi,
            "Can't change this role — assign another principal first. A school must always have at least one principal.",
            'यह भूमिका नहीं बदल सकते — पहले किसी और को प्रधानाचार्य बनाएं। स्कूल में हमेशा कम से कम एक प्रधानाचार्य होना चाहिए।',
          ),
        );
        return; // do NOT mutate local state
      }
      if (!res.ok || !body?.success) {
        setActionError(
          typeof body?.error === 'string'
            ? body.error
            : t(isHi, 'Failed to change role.', 'भूमिका बदलने में विफल।'),
        );
        return;
      }
      // Optimistic local update then reconcile.
      setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, role } : s)));
      await loadStaff();
    } catch {
      setActionError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setBusyId(null);
    }
  }

  /* ── revoke ── */
  async function handleRevoke(id: string) {
    const target = staff.find((s) => s.id === id);
    if (!target) return;
    const confirmed = window.confirm(
      t(
        isHi,
        `Revoke ${target.name || target.email} from this school's admin team?`,
        `${target.name || target.email} को इस स्कूल की प्रशासन टीम से हटाएं?`,
      ),
    );
    if (!confirmed) return;

    setBusyId(id);
    setActionError(null);
    setLockoutMsg(null);
    try {
      const res = await authedFetch(`/api/school-admin/staff?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (res.status === 409 && body?.code === 'LAST_PRINCIPAL_LOCKOUT') {
        setLockoutMsg(
          t(
            isHi,
            "Can't remove the last principal — assign another principal first. A school must always have at least one principal.",
            'अंतिम प्रधानाचार्य को नहीं हटा सकते — पहले किसी और को प्रधानाचार्य बनाएं। स्कूल में हमेशा कम से कम एक प्रधानाचार्य होना चाहिए।',
          ),
        );
        return; // blocking — do NOT mutate local state
      }
      if (res.status === 404) {
        setActionError(
          t(isHi, 'Staff member not found in your school.', 'इस स्कूल में स्टाफ सदस्य नहीं मिला।'),
        );
        await loadStaff();
        return;
      }
      if (!res.ok || !body?.success) {
        setActionError(
          typeof body?.error === 'string'
            ? body.error
            : t(isHi, 'Failed to revoke staff member.', 'स्टाफ सदस्य को हटाने में विफल।'),
        );
        return;
      }
      // Active list only — drop the revoked row optimistically then reconcile.
      setStaff((prev) => prev.filter((s) => s.id !== id));
      await loadStaff();
    } catch {
      setActionError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setBusyId(null);
    }
  }

  /* ── loading state ── */
  if (authLoading || loading) {
    return (
      <div className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]" style={{ background: 'var(--bg)' }}>
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 space-y-3">
          <Skeleton variant="title" height={26} width="40%" />
          <Skeleton variant="text" height={13} width="60%" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <StaffRowSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── error state ── */
  if (pageError) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-sm w-full text-center py-8">
          <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{pageError}</p>
          <Button variant="primary" onClick={loadStaff}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  /* ── main render ── */
  return (
    <div className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.push('/school-admin')}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95"
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
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Staff management', 'स्टाफ प्रबंधन')}
          </h1>
        </div>
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
        <button
          onClick={() => {
            setActionError(null);
            setLockoutMsg(null);
            setInviteOpen(true);
          }}
          className="btn-primary rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
          style={{ minHeight: '40px' }}
          aria-label={t(isHi, 'Invite staff member', 'स्टाफ सदस्य आमंत्रित करें')}
        >
          <span aria-hidden="true">+</span>
          {t(isHi, 'Invite', 'आमंत्रित करें')}
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 pb-24">
        <p className="text-sm text-[var(--text-3)] mb-4">
          {t(
            isHi,
            'Manage the administrators for your school. Principals and institution admins can invite staff, change roles, and revoke access.',
            'अपने स्कूल के प्रशासकों का प्रबंधन करें। प्रधानाचार्य और संस्थान प्रशासक स्टाफ को आमंत्रित कर सकते हैं, भूमिकाएँ बदल सकते हैं, और पहुँच हटा सकते हैं।',
          )}
        </p>

        {/* Blocking lockout message */}
        {lockoutMsg && (
          <div
            role="alert"
            className="mb-4 rounded-2xl p-4 flex items-start gap-3"
            style={{ background: '#FEF2F2', border: '1.5px solid #DC262633' }}
          >
            <span aria-hidden="true" className="text-xl leading-none">⛔</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#B91C1C' }}>
                {t(isHi, 'Action blocked', 'कार्रवाई अवरुद्ध')}
              </p>
              <p className="text-xs mt-1" style={{ color: '#B91C1C' }}>
                {lockoutMsg}
              </p>
            </div>
          </div>
        )}

        {/* Non-blocking action error */}
        {actionError && (
          <div
            role="alert"
            className="mb-4 rounded-xl p-3 text-xs font-medium"
            style={{ background: '#FFF7ED', border: '1px solid #E8581C33', color: '#9A3412' }}
          >
            {actionError}
          </div>
        )}

        {staff.length === 0 ? (
          <EmptyState
            icon="👥"
            title={t(isHi, 'No staff yet', 'अभी कोई स्टाफ नहीं')}
            description={t(
              isHi,
              'Invite your first administrator to help manage this school.',
              'इस स्कूल के प्रबंधन में मदद के लिए अपने पहले प्रशासक को आमंत्रित करें।',
            )}
            action={
              <Button variant="primary" onClick={() => setInviteOpen(true)}>
                {t(isHi, '+ Invite staff', '+ स्टाफ आमंत्रित करें')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {staff.map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={selfAdminId !== null && member.id === selfAdminId}
                isHi={isHi}
                busy={busyId === member.id}
                onChangeRole={handleChangeRole}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        )}
      </main>

      {/* Invite sheet */}
      <SheetModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t(isHi, 'Invite staff', 'स्टाफ आमंत्रित करें')}
      >
        <InviteForm isHi={isHi} submitting={inviting} onSubmit={handleInvite} />
      </SheetModal>
    </div>
  );
}
