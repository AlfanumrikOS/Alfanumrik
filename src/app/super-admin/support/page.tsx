'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';

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
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.h1}>Support &amp; Operations Center</h1>
        <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
          Investigate user issues, monitor background jobs, and verify data integrity
        </p>
      </div>

      {/* ── SECTION 1: Operations Summary ─────────── */}
      <h2 style={{ ...S.h2, marginTop: 0 }}>Operations Summary</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatCard
          label="Failed Jobs"
          value={jobsLoading ? '...' : failedCount}
          icon="!"
          accentColor={failedCount > 0 ? colors.danger : colors.success}
          subtitle={failedCount === 0 ? 'All clear' : `${failedCount} failed`}
        />
        <StatCard
          label="Pending Tasks"
          value={jobsLoading ? '...' : pendingCount}
          icon="~"
          accentColor={pendingCount > 0 ? colors.warning : colors.success}
          subtitle={pendingCount === 0 ? 'None queued' : `${pendingCount} pending`}
        />
        <div style={{
          ...S.card,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22, opacity: 0.7 }}>*</span>
            <div>
              <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                System Status
              </div>
              <div style={{ marginTop: 4 }}>
                <StatusBadge label="Operational" variant="success" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Failed Jobs Table ──────────── */}
      <h2 style={S.h2}>Failed Jobs</h2>
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 28 }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Task Type</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Attempts</th>
              <th style={S.th}>Error Message</th>
              <th style={S.th}>Created At</th>
            </tr>
          </thead>
          <tbody>
            {jobsLoading && (
              <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>Loading...</td></tr>
            )}
            {!jobsLoading && failedJobs.length === 0 && (
              <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>No failed or pending jobs</td></tr>
            )}
            {!jobsLoading && failedJobs.map(j => (
              <tr key={j.id}>
                <td style={S.td}>
                  <code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                    {j.task_type}
                  </code>
                </td>
                <td style={S.td}>
                  <StatusBadge
                    label={j.status}
                    variant={j.status === 'failed' ? 'danger' : j.status === 'pending' ? 'warning' : 'neutral'}
                  />
                </td>
                <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{j.attempts}</td>
                <td style={{ ...S.td, fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: colors.text2 }}>
                  {j.error_message || '\u2014'}
                </td>
                <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap', color: colors.text2 }}>{fmtDate(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 3: User Lookup ────────────────── */}
      <h2 style={S.h2}>User Lookup (Support Investigation)</h2>
      <div style={{ ...S.card, marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookUpUser(); }}
            placeholder="Student ID or email..."
            style={{ ...S.searchInput, flex: 1, minWidth: 200 }}
          />
          <button
            onClick={lookUpUser}
            disabled={userLoading || !userQuery.trim()}
            style={{ ...S.primaryBtn, opacity: userLoading || !userQuery.trim() ? 0.5 : 1 }}
          >
            {userLoading ? 'Looking up...' : 'Look Up'}
          </button>
        </div>

        {userError && (
          <div style={{ fontSize: 13, color: colors.danger, marginBottom: 12 }}>{userError}</div>
        )}

        {userActivity && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {/* Recent Quiz Sessions */}
            <div style={S.cardSurface}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Recent Quiz Sessions
              </div>
              {userActivity.quiz_sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.text3 }}>No recent quizzes</div>
              ) : (
                userActivity.quiz_sessions.map(q => (
                  <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                    <span style={{ color: colors.text1, fontWeight: 500 }}>{q.subject}</span>
                    <span style={{ color: colors.text2 }}>{q.score_percent}% ({q.total_questions}Q)</span>
                    <span style={{ color: colors.text3, fontSize: 11 }}>{fmtShortDate(q.created_at)}</span>
                  </div>
                ))
              )}
            </div>

            {/* Recent Chat Sessions */}
            <div style={S.cardSurface}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Recent Chat Sessions
              </div>
              {userActivity.chat_sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.text3 }}>No recent chats</div>
              ) : (
                userActivity.chat_sessions.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                    <span style={{ color: colors.text1, fontWeight: 500 }}>{c.topic}</span>
                    <span style={{ color: colors.text2 }}>{c.message_count} msgs</span>
                    <span style={{ color: colors.text3, fontSize: 11 }}>{fmtShortDate(c.created_at)}</span>
                  </div>
                ))
              )}
            </div>

            {/* Daily Usage */}
            <div style={S.cardSurface}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Daily Usage (Last 7 Days)
              </div>
              {userActivity.daily_usage.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.text3 }}>No usage data</div>
              ) : (
                userActivity.daily_usage.map(d => (
                  <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                    <span style={{ color: colors.text1, fontWeight: 500 }}>{fmtShortDate(d.date)}</span>
                    <span style={{ color: colors.text2 }}>{d.quizzes}Q / {d.chats}C</span>
                    <span style={{ color: colors.text3 }}>{d.minutes} min</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 4: Relationship Integrity ─────── */}
      <h2 style={S.h2}>Relationship Integrity Check</h2>
      <div style={S.card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={studentIdForRel}
            onChange={e => setStudentIdForRel(e.target.value)}
            placeholder="Student ID..."
            style={{ ...S.searchInput, flex: 1, minWidth: 200 }}
          />
          <button
            onClick={checkParentLinks}
            disabled={relLoading !== null || !studentIdForRel.trim()}
            style={{ ...S.secondaryBtn, opacity: relLoading !== null || !studentIdForRel.trim() ? 0.5 : 1 }}
          >
            {relLoading === 'parent' ? 'Checking...' : 'Check Parent Links'}
          </button>
          <button
            onClick={checkClassMappings}
            disabled={relLoading !== null || !studentIdForRel.trim()}
            style={{ ...S.secondaryBtn, opacity: relLoading !== null || !studentIdForRel.trim() ? 0.5 : 1 }}
          >
            {relLoading === 'class' ? 'Checking...' : 'Check Class Mappings'}
          </button>
        </div>

        {relError && (
          <div style={{ fontSize: 13, color: colors.danger, marginBottom: 12 }}>{relError}</div>
        )}

        {/* Parent Links Results */}
        {parentLinks !== null && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Parent Links
            </div>
            {parentLinks.length === 0 ? (
              <div style={{ fontSize: 12, color: colors.text3, padding: 8 }}>No parent links found</div>
            ) : (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Guardian ID</th>
                      <th style={S.th}>Email</th>
                      <th style={S.th}>Status</th>
                      <th style={S.th}>Linked At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parentLinks.map(pl => (
                      <tr key={pl.guardian_id}>
                        <td style={{ ...S.td, fontSize: 11 }}><code style={{ color: colors.text2 }}>{pl.guardian_id.slice(0, 12)}...</code></td>
                        <td style={S.td}>{pl.guardian_email}</td>
                        <td style={S.td}>
                          <StatusBadge
                            label={pl.status}
                            variant={pl.status === 'approved' ? 'success' : pl.status === 'pending' ? 'warning' : 'neutral'}
                          />
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: colors.text2 }}>{fmtDate(pl.linked_at)}</td>
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
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Class Mappings
            </div>
            {classMappings.length === 0 ? (
              <div style={{ fontSize: 12, color: colors.text3, padding: 8 }}>No class enrollments found</div>
            ) : (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Class ID</th>
                      <th style={S.th}>Class Name</th>
                      <th style={S.th}>Teacher</th>
                      <th style={S.th}>Enrolled At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classMappings.map(cm => (
                      <tr key={cm.class_id}>
                        <td style={{ ...S.td, fontSize: 11 }}><code style={{ color: colors.text2 }}>{cm.class_id.slice(0, 12)}...</code></td>
                        <td style={S.td}>{cm.class_name}</td>
                        <td style={S.td}>{cm.teacher_name}</td>
                        <td style={{ ...S.td, fontSize: 12, color: colors.text2 }}>{fmtDate(cm.enrolled_at)}</td>
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
