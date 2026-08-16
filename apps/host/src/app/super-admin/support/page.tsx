'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard, StatusBadge } from '@alfanumrik/ui/admin-ui';
import { ConfirmDialog } from '@alfanumrik/ui/ui/primitives';
import { useAuth } from '@alfanumrik/lib/AuthContext';

/* ── Types ─────────────────────────────────────────── */

interface FailedJob {
  id: string;
  task_type: string;
  status: string;
  attempts: number;
  error_message: string | null;
  created_at: string;
}

interface QuizSession {
  id: string;
  subject: string;
  score_percent: number;
  total_questions: number;
  created_at: string;
}

interface ChatSession {
  id: string;
  topic: string;
  message_count: number;
  created_at: string;
}

interface DailyUsage {
  date: string;
  quizzes: number;
  chats: number;
  minutes: number;
}

interface UserActivity {
  quiz_sessions: QuizSession[];
  chat_sessions: ChatSession[];
  daily_usage: DailyUsage[];
}

interface ParentLink {
  /** guardian_student_links.id — the row's own primary key (used by fix_relationship). */
  id: string;
  guardian_id: string;
  guardian_email: string;
  status: string;
  linked_at: string;
}

interface ClassMapping {
  /** class_enrollments.id — the row's own primary key (used by fix_relationship). Distinct from class_id. */
  id: string;
  class_id: string;
  class_name: string;
  teacher_name: string;
  enrolled_at: string;
}

/** Fields the API allows fix_relationship to update, keyed by record type
 *  (mirrors ALLOWED_FIELDS in api/super-admin/support/route.ts — keep in sync). */
const FIX_RELATIONSHIP_FIELDS: Record<'parent_link' | 'class_enrollment', string[]> = {
  parent_link: ['status', 'relationship', 'guardian_id', 'student_id'],
  class_enrollment: ['status', 'student_id', 'class_id', 'is_active'],
};

type ActionResult = { ok: boolean; message: string } | null;

/* ── Helpers ───────────────────────────────────────── */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short',
  });
}

/* ── Main Content ──────────────────────────────────── */

function SupportContent() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();

  // Section 1 & 2: Failed Jobs
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // Section 3: User Lookup
  const [userQuery, setUserQuery] = useState('');
  const [userActivity, setUserActivity] = useState<UserActivity | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');

  // Section 3.5: User Actions (reset password / resend invite / fix relationship)
  // POST-only support interventions — see api/super-admin/support/route.ts.
  const [actionEmail, setActionEmail] = useState('');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<ActionResult>(null);

  const [inviteType, setInviteType] = useState<'student' | 'teacher' | 'parent'>('student');
  const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<ActionResult>(null);

  const [fixType, setFixType] = useState<'parent_link' | 'class_enrollment'>('parent_link');
  const [fixId, setFixId] = useState('');
  const [fixField, setFixField] = useState<string>(FIX_RELATIONSHIP_FIELDS.parent_link[0]);
  const [fixValue, setFixValue] = useState('');
  const [fixConfirmOpen, setFixConfirmOpen] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixResult, setFixResult] = useState<ActionResult>(null);

  // Prefill the action email from the lookup box whenever a lookup succeeds
  // and the query looks like an email — reset_password / resend_invite need
  // an email, but the lookup box also accepts a bare student ID.
  useEffect(() => {
    if (userActivity && userQuery.includes('@')) {
      setActionEmail(userQuery.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userActivity]);

  // Section 4: Relationship Integrity
  const [studentIdForRel, setStudentIdForRel] = useState('');
  const [parentLinks, setParentLinks] = useState<ParentLink[] | null>(null);
  const [classMappings, setClassMappings] = useState<ClassMapping[] | null>(null);
  const [relLoading, setRelLoading] = useState<'parent' | 'class' | null>(null);
  const [relError, setRelError] = useState('');

  /* ── Fetch failed jobs ──────────────────────────── */
  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/support?action=failed_jobs');
      if (res.ok) {
        const d = await res.json();
        setFailedJobs(d.data || []);
      }
    } catch {
      // silent
    }
    setJobsLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const failedCount = failedJobs.filter(j => j.status === 'failed').length;
  const pendingCount = failedJobs.filter(j => j.status === 'pending').length;

  /* ── User lookup ────────────────────────────────── */
  const lookUpUser = async () => {
    if (!userQuery.trim()) return;
    setUserLoading(true);
    setUserError('');
    setUserActivity(null);
    try {
      const res = await apiFetch(`/api/super-admin/support?action=user_activity&user_id=${encodeURIComponent(userQuery.trim())}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUserError(d.error || 'User not found or lookup failed');
      } else {
        const d = await res.json();
        setUserActivity(d.data || null);
      }
    } catch {
      setUserError('Network error');
    }
    setUserLoading(false);
  };

  /* ── User actions (reset password / resend invite / fix relationship) ── */
  const doResetPassword = async () => {
    if (!actionEmail.trim()) return;
    setResetLoading(true);
    setResetResult(null);
    try {
      const res = await apiFetch('/api/super-admin/support', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_password', email: actionEmail.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setResetResult({ ok: true, message: d.message || (isHi ? 'रीसेट ईमेल भेजा गया।' : 'Reset email sent.') });
      } else {
        setResetResult({ ok: false, message: d.error || (isHi ? 'रीसेट विफल रहा।' : 'Reset failed.') });
      }
    } catch {
      setResetResult({ ok: false, message: isHi ? 'नेटवर्क त्रुटि।' : 'Network error.' });
    }
    setResetLoading(false);
    setResetConfirmOpen(false);
  };

  const doResendInvite = async () => {
    if (!actionEmail.trim()) return;
    setInviteLoading(true);
    setInviteResult(null);
    try {
      const res = await apiFetch('/api/super-admin/support', {
        method: 'POST',
        body: JSON.stringify({ action: 'resend_invite', email: actionEmail.trim(), type: inviteType }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setInviteResult({ ok: true, message: isHi ? 'आमंत्रण कतार में जोड़ा गया।' : 'Invite queued.' });
      } else {
        setInviteResult({ ok: false, message: d.error || (isHi ? 'आमंत्रण विफल रहा।' : 'Invite failed.') });
      }
    } catch {
      setInviteResult({ ok: false, message: isHi ? 'नेटवर्क त्रुटि।' : 'Network error.' });
    }
    setInviteLoading(false);
    setInviteConfirmOpen(false);
  };

  const doFixRelationship = async () => {
    if (!fixId.trim() || !fixField || !fixValue.trim()) return;
    setFixLoading(true);
    setFixResult(null);
    try {
      const res = await apiFetch('/api/super-admin/support', {
        method: 'POST',
        body: JSON.stringify({
          action: 'fix_relationship',
          type: fixType,
          id: fixId.trim(),
          updates: { [fixField]: fixField === 'is_active' ? fixValue.trim() === 'true' : fixValue.trim() },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setFixResult({ ok: true, message: isHi ? 'संबंध अपडेट किया गया।' : 'Relationship updated.' });
      } else {
        setFixResult({ ok: false, message: d.error || (isHi ? 'सुधार विफल रहा।' : 'Fix failed.') });
      }
    } catch {
      setFixResult({ ok: false, message: isHi ? 'नेटवर्क त्रुटि।' : 'Network error.' });
    }
    setFixLoading(false);
    setFixConfirmOpen(false);
  };

  /* ── Relationship checks ────────────────────────── */
  const checkParentLinks = async () => {
    if (!studentIdForRel.trim()) return;
    setRelLoading('parent');
    setRelError('');
    setParentLinks(null);
    try {
      const res = await apiFetch(`/api/super-admin/support?action=parent_links&student_id=${encodeURIComponent(studentIdForRel.trim())}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRelError(d.error || 'Lookup failed');
      } else {
        const d = await res.json();
        setParentLinks(d.data || []);
      }
    } catch {
      setRelError('Network error');
    }
    setRelLoading(null);
  };

  const checkClassMappings = async () => {
    if (!studentIdForRel.trim()) return;
    setRelLoading('class');
    setRelError('');
    setClassMappings(null);
    try {
      const res = await apiFetch(`/api/super-admin/support?action=class_mappings&student_id=${encodeURIComponent(studentIdForRel.trim())}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRelError(d.error || 'Lookup failed');
      } else {
        const d = await res.json();
        setClassMappings(d.data || []);
      }
    } catch {
      setRelError('Network error');
    }
    setRelLoading(null);
  };

  /* ── Render ─────────────────────────────────────── */

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Support &amp; Operations Center</h1>
        <p className="m-0 text-[13px] text-muted-foreground">
          Investigate user issues, monitor background jobs, and verify data integrity
        </p>
        {/* Known gap: this page shows user-activity/diagnostics lookups, not the actual support ticket queue.
            The operator console for ticket content is at /internal/admin (SupportTab).
            Ref: .claude/CLAUDE.md line 88; F12 audit 2026-08-12.
            CORRECTION 2026-08-16 (frontend, Phase 0 super-admin overhaul): the gap itself is
            unchanged (still true — this page has no ticket content and never will until the
            Phase-2 console merge), but it is now cross-linked from both directions: AdminShell's
            nav carries a dedicated "Support Tickets" entry to /internal/admin (with a
            "opens legacy console" hint), and the banner below is the reciprocal, bilingual,
            prominent link back. Neither is a redirect — both are Phase-0 stopgaps. */}
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-400/40 bg-blue-500/10 p-3.5 text-sm text-blue-900"
        >
          <span>
            <strong>{isHi ? 'सहायता टिकट खोज रहे हैं?' : 'Looking for support tickets?'}</strong>{' '}
            {isHi
              ? 'यह पृष्ठ केवल निदान और संबंध जाँच दिखाता है — थ्रेड, उत्तर और स्थिति इतिहास टिकट कंसोल में हैं।'
              : 'This page only shows diagnostics and relationship checks — threads, replies, and status history live in the ticket console.'}
          </span>
          <Link
            href="/internal/admin"
            className="shrink-0 rounded-md border border-blue-500 bg-white px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-50"
          >
            {isHi ? 'टिकट कंसोल खोलें' : 'Open the ticket console'} →
          </Link>
        </div>
      </div>

      {/* ── SECTION 1: Operations Summary ─────────── */}
      <h2 className="mt-0 mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operations Summary</h2>
      <div className="mb-7 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <StatCard
          label="Failed Jobs"
          value={jobsLoading ? '...' : failedCount}
          icon="!"
          accentColor={failedCount > 0 ? '#DC2626' : '#16A34A'}
          subtitle={failedCount === 0 ? 'All clear' : `${failedCount} failed`}
        />
        <StatCard
          label="Pending Tasks"
          value={jobsLoading ? '...' : pendingCount}
          icon="~"
          accentColor={pendingCount > 0 ? '#D97706' : '#16A34A'}
          subtitle={pendingCount === 0 ? 'None queued' : `${pendingCount} pending`}
        />
        <div className="flex flex-col justify-center gap-1.5 rounded-lg border border-surface-3 bg-surface-1 p-4">
          <div className="flex items-center gap-2">
            <span className="text-[22px] opacity-70">*</span>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                System Status
              </div>
              <div className="mt-1">
                <StatusBadge label="Operational" variant="success" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Failed Jobs Table ──────────── */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Failed Jobs</h2>
      <div className="mb-7 overflow-hidden rounded-lg border border-surface-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Task Type</th>
              <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attempts</th>
              <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Error Message</th>
              <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Created At</th>
            </tr>
          </thead>
          <tbody>
            {jobsLoading && (
              <tr><td colSpan={5} className="border-b border-surface-2 px-3.5 py-6 text-center text-[13px] text-muted-foreground">Loading...</td></tr>
            )}
            {!jobsLoading && failedJobs.length === 0 && (
              <tr><td colSpan={5} className="border-b border-surface-2 px-3.5 py-6 text-center text-[13px] text-muted-foreground">No failed or pending jobs</td></tr>
            )}
            {!jobsLoading && failedJobs.map(j => (
              <tr key={j.id}>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">
                  <code className="rounded bg-surface-2 px-2 py-0.5 text-xs font-semibold text-foreground">
                    {j.task_type}
                  </code>
                </td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">
                  <StatusBadge
                    label={j.status}
                    variant={j.status === 'failed' ? 'danger' : j.status === 'pending' ? 'warning' : 'neutral'}
                  />
                </td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground tabular-nums">{j.attempts}</td>
                <td className="max-w-[300px] overflow-hidden text-ellipsis border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">
                  {j.error_message || '—'}
                </td>
                <td className="whitespace-nowrap border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{fmtDate(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 3: User Lookup ────────────────── */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User Lookup (Support Investigation)</h2>
      <div className="mb-7 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookUpUser(); }}
            placeholder="Student ID or email..."
            className="min-w-[200px] flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={lookUpUser}
            disabled={userLoading || !userQuery.trim()}
            className={[
              'rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90',
              userLoading || !userQuery.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {userLoading ? 'Looking up...' : 'Look Up'}
          </button>
        </div>

        {userError && (
          <div className="mb-3 text-[13px] text-danger">{userError}</div>
        )}

        {userActivity && (
          <>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {/* Recent Quiz Sessions */}
              <div className="rounded-lg border border-surface-3 bg-surface-2 p-4">
                <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent Quiz Sessions
                </div>
                {userActivity.quiz_sessions.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No recent quizzes</div>
                ) : (
                  userActivity.quiz_sessions.map(q => (
                    <div key={q.id} className="flex justify-between border-b border-surface-3 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{q.subject}</span>
                      <span className="text-muted-foreground">{q.score_percent}% ({q.total_questions}Q)</span>
                      <span className="text-[11px] text-muted-foreground">{fmtShortDate(q.created_at)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Recent Chat Sessions */}
              <div className="rounded-lg border border-surface-3 bg-surface-2 p-4">
                <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent Chat Sessions
                </div>
                {userActivity.chat_sessions.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No recent chats</div>
                ) : (
                  userActivity.chat_sessions.map(c => (
                    <div key={c.id} className="flex justify-between border-b border-surface-3 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{c.topic}</span>
                      <span className="text-muted-foreground">{c.message_count} msgs</span>
                      <span className="text-[11px] text-muted-foreground">{fmtShortDate(c.created_at)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Daily Usage */}
              <div className="rounded-lg border border-surface-3 bg-surface-2 p-4">
                <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Daily Usage (Last 7 Days)
                </div>
                {userActivity.daily_usage.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No usage data</div>
                ) : (
                  userActivity.daily_usage.map(d => (
                    <div key={d.date} className="flex justify-between border-b border-surface-3 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{fmtShortDate(d.date)}</span>
                      <span className="text-muted-foreground">{d.quizzes}Q / {d.chats}C</span>
                      <span className="text-muted-foreground">{d.minutes} min</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            {userQuery.trim() && (
              <Link href={`/super-admin/students/${encodeURIComponent(userQuery.trim())}`} className="text-sm text-blue-600 hover:underline mt-2 inline-block">
                View Full Profile &rarr;
              </Link>
            )}
          </>
        )}
      </div>

      {/* ── SECTION 3.5: User Actions ─────────────── */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {isHi ? 'उपयोगकर्ता क्रियाएँ' : 'User Actions'}
      </h2>
      <div className="mb-7 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* Reset Password */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #DC2626' }}>
          <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'पासवर्ड रीसेट करें' : 'Reset Password'}
          </div>
          <input
            value={actionEmail}
            onChange={e => setActionEmail(e.target.value)}
            placeholder={isHi ? 'उपयोगकर्ता ईमेल...' : 'User email...'}
            className="mb-2 w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setResetConfirmOpen(true)}
            disabled={resetLoading || !actionEmail.trim()}
            className={[
              'w-full rounded-md border border-danger bg-transparent px-3 py-2 text-sm font-medium text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
              resetLoading || !actionEmail.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {resetLoading ? (isHi ? 'भेजा जा रहा है...' : 'Sending...') : (isHi ? 'रीसेट ईमेल भेजें' : 'Send Reset Email')}
          </button>
          {resetResult && (
            <div role={resetResult.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${resetResult.ok ? 'text-green-700' : 'text-danger'}`}>
              {resetResult.message}
            </div>
          )}
        </div>

        {/* Resend Invite */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #2563EB' }}>
          <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'आमंत्रण पुनः भेजें' : 'Resend Invite'}
          </div>
          <div className="mb-2 flex gap-2">
            <input
              value={actionEmail}
              onChange={e => setActionEmail(e.target.value)}
              placeholder={isHi ? 'उपयोगकर्ता ईमेल...' : 'User email...'}
              className="min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <select
              value={inviteType}
              onChange={e => setInviteType(e.target.value as 'student' | 'teacher' | 'parent')}
              className="rounded-md border border-surface-3 bg-surface-1 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="student">{isHi ? 'छात्र' : 'Student'}</option>
              <option value="teacher">{isHi ? 'शिक्षक' : 'Teacher'}</option>
              <option value="parent">{isHi ? 'अभिभावक' : 'Parent'}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setInviteConfirmOpen(true)}
            disabled={inviteLoading || !actionEmail.trim()}
            className={[
              'w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-surface-1 hover:opacity-90',
              inviteLoading || !actionEmail.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {inviteLoading ? (isHi ? 'भेजा जा रहा है...' : 'Sending...') : (isHi ? 'आमंत्रण पुनः भेजें' : 'Resend Invite')}
          </button>
          {inviteResult && (
            <div role={inviteResult.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${inviteResult.ok ? 'text-green-700' : 'text-danger'}`}>
              {inviteResult.message}
            </div>
          )}
        </div>

        {/* Fix Relationship */}
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #D97706' }}>
          <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isHi ? 'संबंध ठीक करें' : 'Fix Relationship'}
          </div>
          <div className="mb-2 flex gap-2">
            <select
              value={fixType}
              onChange={e => {
                const next = e.target.value as 'parent_link' | 'class_enrollment';
                setFixType(next);
                setFixField(FIX_RELATIONSHIP_FIELDS[next][0]);
              }}
              className="rounded-md border border-surface-3 bg-surface-1 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="parent_link">{isHi ? 'पैरेंट लिंक' : 'Parent Link'}</option>
              <option value="class_enrollment">{isHi ? 'कक्षा नामांकन' : 'Class Enrollment'}</option>
            </select>
            <input
              value={fixId}
              onChange={e => setFixId(e.target.value)}
              placeholder={isHi ? 'रिकॉर्ड ID...' : 'Record ID...'}
              className="min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            {isHi
              ? `ID का प्रकार: ${fixType === 'parent_link' ? 'guardian_student_links.id' : 'class_enrollments.id'} — नीचे "ID का उपयोग करें" बटन से भरें।`
              : `ID type: ${fixType === 'parent_link' ? 'guardian_student_links.id' : 'class_enrollments.id'} — fill via a "Use ID" button below.`}
          </p>
          <div className="mb-2 flex gap-2">
            <select
              value={fixField}
              onChange={e => setFixField(e.target.value)}
              className="rounded-md border border-surface-3 bg-surface-1 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {FIX_RELATIONSHIP_FIELDS[fixType].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            {fixField === 'is_active' ? (
              <select
                value={fixValue}
                onChange={e => setFixValue(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">{isHi ? 'चुनें...' : 'Select...'}</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                value={fixValue}
                onChange={e => setFixValue(e.target.value)}
                placeholder={isHi ? 'नया मान...' : 'New value...'}
                className="min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setFixConfirmOpen(true)}
            disabled={fixLoading || !fixId.trim() || !fixValue.trim()}
            className={[
              'w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-2',
              fixLoading || !fixId.trim() || !fixValue.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {fixLoading ? (isHi ? 'लागू हो रहा है...' : 'Applying...') : (isHi ? 'सुधार लागू करें' : 'Apply Fix')}
          </button>
          {fixResult && (
            <div role={fixResult.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${fixResult.ok ? 'text-green-700' : 'text-danger'}`}>
              {fixResult.message}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 4: Relationship Integrity ─────── */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Relationship Integrity Check</h2>
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={studentIdForRel}
            onChange={e => setStudentIdForRel(e.target.value)}
            placeholder="Student ID..."
            className="min-w-[200px] flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={checkParentLinks}
            disabled={relLoading !== null || !studentIdForRel.trim()}
            className={[
              'rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2',
              relLoading !== null || !studentIdForRel.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {relLoading === 'parent' ? 'Checking...' : 'Check Parent Links'}
          </button>
          <button
            onClick={checkClassMappings}
            disabled={relLoading !== null || !studentIdForRel.trim()}
            className={[
              'rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2',
              relLoading !== null || !studentIdForRel.trim() ? 'opacity-50' : '',
            ].join(' ')}
          >
            {relLoading === 'class' ? 'Checking...' : 'Check Class Mappings'}
          </button>
        </div>

        {relError && (
          <div className="mb-3 text-[13px] text-danger">{relError}</div>
        )}

        {/* Parent Links Results */}
        {parentLinks !== null && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parent Links
            </div>
            {parentLinks.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">No parent links found</div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-surface-3">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Guardian ID</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linked At</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isHi ? 'क्रिया' : 'Action'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parentLinks.map(pl => (
                      <tr key={pl.id}>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[11px] text-foreground"><code className="text-muted-foreground">{pl.guardian_id.slice(0, 12)}...</code></td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{pl.guardian_email}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">
                          <StatusBadge
                            label={pl.status}
                            variant={pl.status === 'approved' ? 'success' : pl.status === 'pending' ? 'warning' : 'neutral'}
                          />
                        </td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{fmtDate(pl.linked_at)}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => { setFixType('parent_link'); setFixId(pl.id); setFixField(FIX_RELATIONSHIP_FIELDS.parent_link[0]); }}
                            className="rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface-2"
                          >
                            {isHi ? 'ID का उपयोग करें →' : 'Use ID →'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Class Mappings Results */}
        {classMappings !== null && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Class Mappings
            </div>
            {classMappings.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">No class enrollments found</div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-surface-3">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Class ID</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Class Name</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Teacher</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Enrolled At</th>
                      <th className="sticky top-0 z-[1] border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isHi ? 'क्रिया' : 'Action'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {classMappings.map(cm => (
                      <tr key={cm.id}>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[11px] text-foreground"><code className="text-muted-foreground">{cm.class_id.slice(0, 12)}...</code></td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{cm.class_name}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{cm.teacher_name}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{fmtDate(cm.enrolled_at)}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => { setFixType('class_enrollment'); setFixId(cm.id); setFixField(FIX_RELATIONSHIP_FIELDS.class_enrollment[0]); }}
                            className="rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface-2"
                          >
                            {isHi ? 'ID का उपयोग करें →' : 'Use ID →'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Confirmation dialogs (accessible — no browser confirm()) ─── */}
      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={doResetPassword}
        loading={resetLoading}
        title={isHi ? 'पासवर्ड रीसेट करें?' : 'Reset this password?'}
        description={
          isHi
            ? `${actionEmail} को एक पासवर्ड रीसेट ईमेल भेजा जाएगा।`
            : `A password reset email will be sent to ${actionEmail}.`
        }
        confirmLabel={isHi ? 'भेजें' : 'Send'}
        cancelLabel={isHi ? 'रद्द करें' : 'Cancel'}
      />
      <ConfirmDialog
        open={inviteConfirmOpen}
        onClose={() => setInviteConfirmOpen(false)}
        onConfirm={doResendInvite}
        loading={inviteLoading}
        title={isHi ? 'आमंत्रण पुनः भेजें?' : 'Resend this invite?'}
        description={
          isHi
            ? `${actionEmail} (${inviteType}) के लिए एक नया आमंत्रण ईमेल कतार में जोड़ा जाएगा।`
            : `A new invite email will be queued for ${actionEmail} (${inviteType}).`
        }
        confirmLabel={isHi ? 'भेजें' : 'Send'}
        cancelLabel={isHi ? 'रद्द करें' : 'Cancel'}
      />
      <ConfirmDialog
        open={fixConfirmOpen}
        onClose={() => setFixConfirmOpen(false)}
        onConfirm={doFixRelationship}
        loading={fixLoading}
        destructive
        title={isHi ? 'यह सुधार लागू करें?' : 'Apply this relationship fix?'}
        description={
          isHi
            ? `${fixType} रिकॉर्ड ${fixId} पर ${fixField} = ${fixValue} सेट किया जाएगा। यह क्रिया वापस नहीं की जा सकती।`
            : `This sets ${fixField} = ${fixValue} on the ${fixType} record ${fixId}. This cannot be undone.`
        }
        confirmLabel={isHi ? 'लागू करें' : 'Apply'}
        cancelLabel={isHi ? 'रद्द करें' : 'Cancel'}
      />
    </div>
  );
}

export default function SupportPage() {
  return <AdminShell><SupportContent /></AdminShell>;
}
