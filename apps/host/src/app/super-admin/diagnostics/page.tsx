'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { StatCard, StatusBadge, DataTable, AdminErrorState, type Column } from '@alfanumrik/ui/admin-ui';
import { AdminDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

// Neutral palette mapped to brand tokens (was hardcoded hex). Semantic status
// hexes that have an exact brand token (success/danger) are tokenized too;
// categorical washes (blue accent, amber warning, the *Light backgrounds) stay
// literal because they encode status at a glance, not chrome.
const colors = {
  bg: 'var(--surface-1)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  border: 'var(--border)',
  borderLight: 'var(--surface-2)',
  surface: 'var(--surface-2)',
  accent: '#2563EB',
  accentLight: '#EFF6FF',
  success: 'var(--success)',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  danger: 'var(--danger)',
  dangerLight: '#FEF2F2',
} as const;

const S = {
  h2: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  } as React.CSSProperties,
  card: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
  } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as React.CSSProperties,
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    borderBottom: `2px solid ${colors.border}`,
    color: colors.text2,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    background: colors.surface,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  } as React.CSSProperties,
  td: {
    padding: '10px 14px',
    borderBottom: `1px solid ${colors.borderLight}`,
    color: colors.text1,
    fontSize: 13,
  } as React.CSSProperties,
};

interface ObsData {
  health: { status: string; checked_at: string };
  users: { students: number; teachers: number; parents: number; active_24h: number; active_7d: number };
  activity_24h: { quizzes: number; chats: number; admin_actions: number };
  content: { topics: number; questions: number };
  jobs: { failed: number; pending: number };
  feature_flags: { enabled: number; total: number };
  cache: { size: number; keys: string[] };
}

interface DeployInfo {
  app_version: string; environment: string; region: string; server_time: string; node_version: string;
  deployment: { id: string; url: string; branch: string; commit_sha: string; commit_message: string; commit_author: string };
  rollback_instructions: string[];
}

interface BackupRecord {
  id: string; backup_type: string; status: string; provider: string; coverage: string | null;
  size_bytes: number | null; completed_at: string | null; verified_at: string | null; notes: string | null; created_at: string;
}

interface DeployRecord {
  id: string; app_version: string; commit_sha: string | null; commit_message: string | null;
  commit_author: string | null; branch: string | null; environment: string; status: string; deployed_at: string; notes: string | null;
  [key: string]: unknown;
}

interface FailedJob {
  task_type: string; status: string; attempts: number; last_error: string | null; created_at: string;
}

interface FeatureFlag {
  id: string; name: string; enabled: boolean; description: string | null;
  target_roles: string[]; target_environments: string[];
}

// Item 4.3 (AI safety/readiness hardening) — IRT question-selection readiness.
// Diagnostics-only: never reads or flips ff_irt_question_selection itself.
interface IrtReadinessBreakdownRow {
  subject: string;
  grade: string;
  total_active_served: number;
  calibrated_n_ge_30: number;
  readiness_ratio: number;
}

interface IrtReadinessData {
  flag_name: string;
  total_active_served: number;
  total_calibrated_n_ge_30: number;
  overall_readiness_ratio: number;
  breakdown: IrtReadinessBreakdownRow[];
  generated_at: string;
}

// Phase F.6 follow-up (2026-05-17): pull catalog counts from /api/super-admin/stats
// so the Simulation Lab + Content Quality widgets stop showing hardcoded numbers.
interface StatsResponse {
  totals?: {
    students?: number;
    teachers?: number;
    parents?: number;
    schools?: number;
    quiz_sessions?: number;
    chat_sessions?: number;
    foxy_sessions?: number;
    simulations?: number;
    interactive_simulations?: number;
    exam_simulations?: number;
  };
}

function DiagnosticsContent() {
  const { apiFetch } = useAdmin();
  const { isHi } = useAuth();
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [irtReadiness, setIrtReadiness] = useState<IrtReadinessData | null>(null);
  const [irtReadinessError, setIrtReadinessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [obsRes, deployRes, backupRes, histRes, jobsRes, flagsRes, statsRes, irtRes] = await Promise.all([
        apiFetch('/api/super-admin/observability'),
        apiFetch('/api/super-admin/deploy'),
        apiFetch('/api/super-admin/platform-ops?action=backups'),
        apiFetch('/api/super-admin/platform-ops?action=deployments&limit=10'),
        apiFetch('/api/super-admin/support?action=failed_jobs'),
        apiFetch('/api/super-admin/feature-flags'),
        apiFetch('/api/super-admin/stats'),
        apiFetch('/api/super-admin/ai/irt-readiness'),
      ]);
      if (obsRes.ok) setObsData(await obsRes.json());
      if (deployRes.ok) setDeployInfo(await deployRes.json());
      if (backupRes.ok) { const d = await backupRes.json(); setBackups(d.data || []); }
      if (histRes.ok) { const d = await histRes.json(); setDeployHistory(d.data || []); }
      if (jobsRes.ok) { const d = await jobsRes.json(); setFailedJobs(d.data || []); }
      if (flagsRes.ok) { const d = await flagsRes.json(); setFlags(d.data || []); }
      if (statsRes.ok) setStats(await statsRes.json());
      // IRT readiness is best-effort — a failure here must never block the
      // rest of the diagnostics page (same partial-failure posture as every
      // other panel on this page).
      if (irtRes.ok) {
        const d = await irtRes.json();
        if (d.success) { setIrtReadiness(d.data); setIrtReadinessError(null); }
        else setIrtReadinessError(d.error || 'Failed to load IRT readiness');
      } else {
        setIrtReadinessError(`Request failed with status ${irtRes.status}`);
      }
      // The observability feed is the backbone of this page — if it fails the
      // page would otherwise render a blank header with no diagnostics at all.
      if (!obsRes.ok) {
        throw new Error(isHi ? 'ऑब्ज़र्वेबिलिटी डेटा लोड नहीं हो सका' : 'Observability data could not be loaded');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : (isHi ? 'डायग्नोस्टिक्स लोड करने में विफल' : 'Failed to load diagnostics'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, isHi]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading && !obsData) {
    return <AdminDashboardSkeleton label={isHi ? 'डायग्नोस्टिक्स लोड हो रहा है…' : 'Loading diagnostics…'} />;
  }

  if (error && !obsData) {
    return <AdminErrorState onRetry={fetchAll} message={error} isHi={isHi} />;
  }

  const deployHistoryColumns: Column<DeployRecord>[] = [
    { key: 'app_version', label: 'Version', render: d => <strong>{d.app_version}</strong> },
    { key: 'branch', label: 'Branch', render: d => d.branch || '—' },
    { key: 'environment', label: 'Env', render: d => <StatusBadge label={d.environment} variant={d.environment === 'production' ? 'info' : 'neutral'} /> },
    { key: 'status', label: 'Status', render: d => <StatusBadge label={d.status} variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'} /> },
    { key: 'commit_sha', label: 'Commit', render: d => <code style={{ fontSize: 11 }}>{(d.commit_sha || '').slice(0, 8)}</code> },
    { key: 'deployed_at', label: 'Deployed', sortable: true, render: d => <span style={{ fontSize: 12 }}>{new Date(d.deployed_at).toLocaleString()}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground mb-1">Operational Diagnostics</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>System health, failed jobs, deployments, and feature flags</p>
        </div>
        <button
          onClick={fetchAll}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {/* Partial-failure banner — a later refresh failed but data is still shown. */}
      {error && obsData && (
        <AdminErrorState compact onRetry={fetchAll} message={error} isHi={isHi} />
      )}

      {/* Health Status Bar */}
      {obsData && (
        <div style={{
          display: 'flex', gap: 16, alignItems: 'center', padding: '12px 16px',
          background: obsData.health.status === 'healthy' ? colors.successLight : colors.dangerLight,
          border: `1px solid ${obsData.health.status === 'healthy' ? '#BBF7D0' : '#FECACA'}`,
          borderRadius: 8, marginBottom: 20,
        }}>
          <StatusBadge label={obsData.health.status === 'healthy' ? 'All Systems Operational' : 'Degraded Performance'} variant={obsData.health.status === 'healthy' ? 'success' : 'danger'} />
          <span style={{ fontSize: 12, color: colors.text2 }}>
            Last checked: {new Date(obsData.health.checked_at).toLocaleString()}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      {obsData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Active Today" value={obsData.users.active_24h} accentColor={colors.accent} />
          <StatCard label="Active 7d" value={obsData.users.active_7d} accentColor={colors.success} />
          <StatCard label="Failed Jobs" value={obsData.jobs.failed} accentColor={obsData.jobs.failed > 0 ? colors.danger : colors.success} />
          <StatCard label="Pending Jobs" value={obsData.jobs.pending} accentColor={colors.warning} />
          <StatCard label="Flags Enabled" value={`${obsData.feature_flags.enabled}/${obsData.feature_flags.total}`} accentColor={colors.text3} />
          <StatCard label="Cache Entries" value={obsData.cache.size} accentColor={colors.text3} />
        </div>
      )}

      {/* AI & Learning Engine Health */}
      {obsData && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>AI &amp; Learning Engine Health</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {/* Foxy AI Tutor */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Foxy</div>
                <StatusBadge
                  label={obsData.activity_24h.chats > 0 ? 'Active' : 'Idle'}
                  variant={obsData.activity_24h.chats > 0 ? 'success' : 'warning'}
                />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>
                {obsData.activity_24h.chats.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>chats in last 24h</div>
            </div>

            {/* Quiz Engine */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Quiz Engine</div>
                <StatusBadge
                  label={obsData.activity_24h.quizzes > 0 ? 'Active' : 'Idle'}
                  variant={obsData.activity_24h.quizzes > 0 ? 'success' : 'warning'}
                />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>
                {obsData.activity_24h.quizzes.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>quizzes in last 24h</div>
            </div>

            {/* Simulation Lab — live from stats route (Phase F.6 fix 2026-05-17) */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Simulation Lab</div>
                <StatusBadge
                  label={(stats?.totals?.simulations || 0) > 0 ? 'Active' : 'Empty'}
                  variant={(stats?.totals?.simulations || 0) > 0 ? 'success' : 'warning'}
                />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>{stats?.totals?.simulations ?? 0}</div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>built-in simulations</div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                Interactive: {stats?.totals?.interactive_simulations ?? 0} · Exam: {stats?.totals?.exam_simulations ?? 0}
              </div>
            </div>

            {/* Content Quality */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Content Quality</div>
                <StatusBadge
                  label={obsData.content.questions > 1000 ? 'Strong' : obsData.content.questions > 500 ? 'Growing' : 'Needs Work'}
                  variant={obsData.content.questions > 1000 ? 'success' : obsData.content.questions > 500 ? 'info' : 'warning'}
                />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>
                {obsData.content.questions.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>questions across {obsData.content.topics.toLocaleString()} topics</div>
            </div>
          </div>
        </div>
      )}

      {/* IRT Question-Selection Readiness (Item 4.3) — diagnostics only.
          ff_irt_question_selection is deliberately OFF; this panel shows
          what fraction of the actively-served question bank has crossed
          the n>=30 calibration floor, so an operator can tell whether
          flipping the flag would change anything meaningful yet. */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>IRT Question-Selection Readiness</h2>
        {irtReadinessError && !irtReadiness && (
          <div style={{ ...S.card, color: colors.danger, fontSize: 12 }}>
            {irtReadinessError}
          </div>
        )}
        {irtReadiness && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>ff_irt_question_selection</div>
                  <StatusBadge label="OFF (by design)" variant="neutral" />
                </div>
                <div style={{ fontSize: 11, color: colors.text3 }}>
                  Off until calibration accumulates — see Foxy moat plan.
                </div>
              </div>
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Calibration floor crossed</div>
                  <StatusBadge
                    label={
                      irtReadiness.overall_readiness_ratio >= 0.5
                        ? 'Meaningful'
                        : irtReadiness.overall_readiness_ratio > 0
                          ? 'Growing'
                          : 'Not yet'
                    }
                    variant={
                      irtReadiness.overall_readiness_ratio >= 0.5
                        ? 'success'
                        : irtReadiness.overall_readiness_ratio > 0
                          ? 'info'
                          : 'warning'
                    }
                  />
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>
                  {(irtReadiness.overall_readiness_ratio * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                  {irtReadiness.total_calibrated_n_ge_30.toLocaleString()} / {irtReadiness.total_active_served.toLocaleString()} actively-served questions with irt_calibration_n {'>='} 30
                </div>
              </div>
            </div>

            {irtReadiness.breakdown.length > 0 ? (
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Subject</th>
                      <th style={S.th}>Grade</th>
                      <th style={S.th}>Actively served</th>
                      <th style={S.th}>Calibrated (n≥30)</th>
                      <th style={S.th}>Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {irtReadiness.breakdown.map((row, i) => (
                      <tr key={`${row.subject}-${row.grade}-${i}`}>
                        <td style={S.td}>{row.subject}</td>
                        <td style={S.td}>{row.grade}</td>
                        <td style={S.td}>{row.total_active_served.toLocaleString()}</td>
                        <td style={S.td}>{row.calibrated_n_ge_30.toLocaleString()}</td>
                        <td style={S.td}>{(row.readiness_ratio * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>
                No actively-served questions found (is_active + at least one response recorded).
              </div>
            )}
            <div style={{ fontSize: 11, color: colors.text3, marginTop: 6 }}>
              Generated: {new Date(irtReadiness.generated_at).toLocaleString()}
            </div>
          </>
        )}
      </div>

      {/* Failed Jobs */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Failed Jobs</h2>
        {failedJobs.length === 0 ? (
          <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>No failed jobs. All clear.</div>
        ) : (
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Type</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Attempts</th>
                  <th style={S.th}>Error</th>
                  <th style={S.th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((job, i) => (
                  <tr key={i}>
                    <td style={S.td}><code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '1px 6px', borderRadius: 3 }}>{job.task_type || '—'}</code></td>
                    <td style={S.td}><StatusBadge label={job.status || 'failed'} variant="danger" /></td>
                    <td style={S.td}>{job.attempts}</td>
                    <td style={{ ...S.td, fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: colors.danger }}>
                      {(job.last_error || '—').slice(0, 120)}
                    </td>
                    <td style={{ ...S.td, fontSize: 12 }}>{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Current Deployment */}
      {deployInfo && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Current Deployment</h2>
          <div style={S.card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              {[
                { label: 'Version', value: deployInfo.app_version },
                { label: 'Environment', value: deployInfo.environment },
                { label: 'Branch', value: deployInfo.deployment.branch },
                { label: 'Commit', value: deployInfo.deployment.commit_sha.slice(0, 10) },
                { label: 'Node', value: deployInfo.node_version },
                { label: 'Region', value: deployInfo.region },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{item.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.text1, marginTop: 2 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rollback Instructions */}
          {deployInfo.rollback_instructions.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: colors.accent, fontWeight: 600 }}>Rollback Instructions</summary>
              <div style={{ ...S.card, marginTop: 8 }}>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: colors.text2, lineHeight: 2 }}>
                  {deployInfo.rollback_instructions.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Deployment History — routed onto the shared admin-ui DataTable
          (built-in overflow-x-auto + token styling; was a raw <table>). */}
      {deployHistory.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Deployment History</h2>
          <DataTable
            columns={deployHistoryColumns}
            data={deployHistory}
            keyField="id"
            emptyMessage="No deployment history"
          />
        </div>
      )}

      {/* Backup Status */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Backup Status</h2>
        {backups.length === 0 ? (
          <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>No backup records. Verify via Supabase dashboard.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {backups.map(b => (
              <div key={b.id} style={{ ...S.card, borderLeft: `3px solid ${b.status === 'success' ? colors.success : b.status === 'failed' ? colors.danger : colors.warning}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <StatusBadge label={b.status} variant={b.status === 'success' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'} />
                    <span style={{ fontSize: 12, color: colors.text3, marginLeft: 8 }}>{b.backup_type} — {b.provider}</span>
                  </div>
                  <span style={{ fontSize: 11, color: colors.text3 }}>
                    {b.completed_at ? new Date(b.completed_at).toLocaleString() : 'Not verified'}
                  </span>
                </div>
                {b.coverage && <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>{b.coverage}</div>}
                {b.notes && <div style={{ fontSize: 11, color: colors.text3, marginTop: 2, fontStyle: 'italic' }}>{b.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature Flags Summary */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ ...S.h2, margin: 0 }}>Feature Flags Overview</h2>
          <a href="/super-admin/flags" style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}>Manage flags</a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
          {flags.slice(0, 12).map(flag => (
            <div key={flag.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <div>
                <code style={{ fontSize: 12, color: colors.text1, fontWeight: 600 }}>{flag.name}</code>
                {flag.description && <div style={{ fontSize: 10, color: colors.text3, marginTop: 2 }}>{flag.description}</div>}
              </div>
              <StatusBadge label={flag.enabled ? 'ON' : 'OFF'} variant={flag.enabled ? 'success' : 'neutral'} />
            </div>
          ))}
        </div>
      </div>

      {/* Cache Keys */}
      {obsData && obsData.cache.keys.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={S.h2}>Cache Keys ({obsData.cache.size})</h2>
          <div style={{ ...S.card, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {obsData.cache.keys.map(k => (
              <code key={k} style={{ fontSize: 11, padding: '2px 8px', background: colors.surface, borderRadius: 4, color: colors.text2 }}>{k}</code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DiagnosticsPage() {
  return <AdminShell><DiagnosticsContent /></AdminShell>;
}
