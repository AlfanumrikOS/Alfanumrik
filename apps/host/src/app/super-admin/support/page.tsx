'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard, StatusBadge } from '@alfanumrik/ui/admin-ui';

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
  guardian_id: string;
  guardian_email: string;
  status: string;
  linked_at: string;
}

interface ClassMapping {
  class_id: string;
  class_name: string;
  teacher_name: string;
  enrolled_at: string;
}

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

  // Section 1 & 2: Failed Jobs
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // Section 3: User Lookup
  const [userQuery, setUserQuery] = useState('');
  const [userActivity, setUserActivity] = useState<UserActivity | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');

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
                    </tr>
                  </thead>
                  <tbody>
                    {parentLinks.map(pl => (
                      <tr key={pl.guardian_id}>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[11px] text-foreground"><code className="text-muted-foreground">{pl.guardian_id.slice(0, 12)}...</code></td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{pl.guardian_email}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">
                          <StatusBadge
                            label={pl.status}
                            variant={pl.status === 'approved' ? 'success' : pl.status === 'pending' ? 'warning' : 'neutral'}
                          />
                        </td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{fmtDate(pl.linked_at)}</td>
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
                    </tr>
                  </thead>
                  <tbody>
                    {classMappings.map(cm => (
                      <tr key={cm.class_id}>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[11px] text-foreground"><code className="text-muted-foreground">{cm.class_id.slice(0, 12)}...</code></td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{cm.class_name}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{cm.teacher_name}</td>
                        <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{fmtDate(cm.enrolled_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SupportPage() {
  return <AdminShell><SupportContent /></AdminShell>;
}
