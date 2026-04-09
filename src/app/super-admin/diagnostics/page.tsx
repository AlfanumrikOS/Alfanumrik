'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

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
}

interface FailedJob {
  task_type: string; status: string; attempts: number; last_error: string | null; created_at: string;
}

interface FeatureFlag {
  id: string; name: string; enabled: boolean; description: string | null;
  target_roles: string[]; target_environments: string[];
}

interface DbPerfData {
  connections: {
    active: number;
    by_state: Array<{ state: string; count: number }>;
  };
  tables: Array<{
    tablename: string;
    live_rows: number;
    dead_rows: number;
    size_bytes: number;
  }>;
  slow_functions: Array<{
    funcname: string;
    calls: number;
    total_time: number;
    mean_time: number;
  }>;
  timestamp: string;
  alert: string | null;
}

function DiagnosticsContent() {
  const { apiFetch } = useAdmin();
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbPerf, setDbPerf] = useState<DbPerfData | null>(null);
  const [dbPerfLoading, setDbPerfLoading] = useState(false);
  const [dbPerfError, setDbPerfError] = useState<string | null>(null);

  const fetchDbPerf = useCallback(async () => {
    setDbPerfLoading(true);
    setDbPerfError(null);
    try {
      const res = await apiFetch('/api/super-admin/db-performance');
      if (res.ok) {
        const json = await res.json();
        setDbPerf(json.data ?? null);
      } else {
        setDbPerfError(`Failed to load database performance (HTTP ${res.status})`);
      }
    } catch (err) {
      setDbPerfError(err instanceof Error ? err.message : 'Unknown error fetching database performance');
    } finally {
      setDbPerfLoading(false);
    }
  }, [apiFetch]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [obsRes, deployRes, backupRes, histRes, jobsRes, flagsRes] = await Promise.all([
      apiFetch('/api/super-admin/observability'),
      apiFetch('/api/super-admin/deploy'),
      apiFetch('/api/super-admin/platform-ops?action=backups'),
      apiFetch('/api/super-admin/platform-ops?action=deployments&limit=10'),
      apiFetch('/api/super-admin/support?action=failed_jobs'),
      apiFetch('/api/super-admin/feature-flags'),
    ]);
    if (obsRes.ok) setObsData(await obsRes.json());
    if (deployRes.ok) setDeployInfo(await deployRes.json());
    if (backupRes.ok) { const d = await backupRes.json(); setBackups(d.data || []); }
    if (histRes.ok) { const d = await histRes.json(); setDeployHistory(d.data || []); }
    if (jobsRes.ok) { const d = await jobsRes.json(); setFailedJobs(d.data || []); }
    if (flagsRes.ok) { const d = await flagsRes.json(); setFlags(d.data || []); }
    setLoading(false);
    fetchDbPerf();
  }, [apiFetch, fetchDbPerf]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(fetchDbPerf, 60_000);
    return () => clearInterval(interval);
  }, [fetchDbPerf]);

  if (loading && !obsData) {
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading diagnostics...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Operational Diagnostics</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>System health, failed jobs, deployments, and feature flags</p>
        </div>
        <button onClick={fetchAll} style={S.secondaryBtn}>Refresh</button>
      </div>

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
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Foxy AI Tutor</div>
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

            {/* Simulation Lab */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>Simulation Lab</div>
                <StatusBadge label="Verified" variant="success" />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, lineHeight: 1.2 }}>19</div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>built-in simulations</div>
              <div style={{ fontSize: 11, color: colors.success, marginTop: 2, fontWeight: 600 }}>14 &rarr; 19 (+5 this sprint)</div>
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

      {/* Failed Jobs */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Failed Jobs</h2>
        {failedJobs.length === 0 ? (
          <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>No failed jobs. All clear.</div>
        ) : (
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
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

      {/* Deployment History */}
      {deployHistory.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Deployment History</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Version</th>
                  <th style={S.th}>Branch</th>
                  <th style={S.th}>Env</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Commit</th>
                  <th style={S.th}>Deployed</th>
                </tr>
              </thead>
              <tbody>
                {deployHistory.map(d => (
                  <tr key={d.id}>
                    <td style={S.td}><strong>{d.app_version}</strong></td>
                    <td style={S.td}>{d.branch || '—'}</td>
                    <td style={S.td}><StatusBadge label={d.environment} variant={d.environment === 'production' ? 'info' : 'neutral'} /></td>
                    <td style={S.td}><StatusBadge label={d.status} variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'} /></td>
                    <td style={{ ...S.td, fontSize: 11 }}><code>{(d.commit_sha || '').slice(0, 8)}</code></td>
                    <td style={{ ...S.td, fontSize: 12 }}>{new Date(d.deployed_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Database Performance */}
      <div style={{ marginTop: 24 }}>
        <h2 style={S.h2}>Database Performance</h2>

        {dbPerfLoading && !dbPerf && (
          <div style={{ color: colors.text3, fontSize: 12, padding: '12px 0' }}>Loading database performance...</div>
        )}

        {dbPerfError && !dbPerf && (
          <div style={{
            ...S.card,
            borderLeft: `3px solid ${colors.danger}`,
            background: colors.dangerLight,
            color: colors.danger,
            fontSize: 12,
            marginBottom: 12,
          }}>
            {dbPerfError}
          </div>
        )}

        {dbPerf && (
          <>
            {/* Alert banner */}
            {dbPerf.alert && (
              <div style={{
                padding: '10px 14px',
                background: colors.dangerLight,
                border: `1px solid #FECACA`,
                borderRadius: 8,
                color: colors.danger,
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 16,
              }}>
                {dbPerf.alert}
              </div>
            )}

            {/* Connection Health */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Connection Health
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 12 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 10, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Active Connections</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: colors.text1, marginTop: 4, lineHeight: 1.2 }}>{dbPerf.connections.active}</div>
                </div>
              </div>
              {dbPerf.connections.by_state.length > 0 && (
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>State</th>
                        <th style={S.th}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbPerf.connections.by_state.map((row, i) => (
                        <tr key={i}>
                          <td style={S.td}><code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '1px 6px', borderRadius: 3 }}>{row.state || '—'}</code></td>
                          <td style={S.td}>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top Tables by Size */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Top Tables by Size
              </div>
              {dbPerf.tables.length === 0 ? (
                <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>
                  pg_stat_user_tables not accessible — check service role permissions
                </div>
              ) : (
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Table Name</th>
                        <th style={S.th}>Live Rows</th>
                        <th style={S.th}>Dead Rows</th>
                        <th style={S.th}>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbPerf.tables.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td style={S.td}><code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '1px 6px', borderRadius: 3 }}>{row.tablename}</code></td>
                          <td style={S.td}>{row.live_rows.toLocaleString()}</td>
                          <td style={{ ...S.td, color: row.dead_rows > 0 ? colors.warning : colors.text1 }}>{row.dead_rows.toLocaleString()}</td>
                          <td style={S.td}>{(row.size_bytes / 1_048_576).toFixed(1)} MB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Slowest Functions */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Slowest Functions
              </div>
              {dbPerf.slow_functions.length === 0 ? (
                <div style={{ ...S.card, color: colors.text3, fontSize: 12 }}>
                  pg_stat_user_functions not accessible or no calls recorded yet
                </div>
              ) : (
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Function</th>
                        <th style={S.th}>Calls</th>
                        <th style={S.th}>Mean Time (ms)</th>
                        <th style={S.th}>Total Time (ms)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbPerf.slow_functions.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td style={S.td}><code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '1px 6px', borderRadius: 3 }}>{row.funcname}</code></td>
                          <td style={S.td}>{row.calls.toLocaleString()}</td>
                          <td style={S.td}>{row.mean_time.toFixed(2)}</td>
                          <td style={S.td}>{row.total_time.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  return <AdminShell><DiagnosticsContent /></AdminShell>;
}
