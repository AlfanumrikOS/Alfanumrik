'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from './_components/AdminShell';
import StatCard from './_components/StatCard';
import StatusBadge from './_components/StatusBadge';
import { colors, S } from './_components/admin-styles';

interface SystemStats {
  totals: Record<string, number>;
  last_24h: Record<string, number>;
  last_7d?: Record<string, number>;
}

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
  app_version: string; environment: string; region: string; server_time: string;
  deployment: { id: string; url: string; branch: string; commit_sha: string; commit_message: string; commit_author: string };
  rollback_instructions: string[];
}

interface BackupRecord {
  id: string; backup_type: string; status: string; provider: string; coverage: string | null;
  size_bytes: number | null; completed_at: string | null; verified_at: string | null; notes: string | null; created_at: string;
}

interface DeployRecord {
  id: string; app_version: string; commit_sha: string | null; commit_message: string | null;
  commit_author: string | null; branch: string | null; environment: string; status: string; deployed_at: string;
}

interface AuditEntry {
  id: string; admin_id: string; action: string; entity_type: string; entity_id: string | null;
  details: Record<string, unknown> | null; ip_address: string | null; created_at: string;
}

interface AnalyticsData {
  engagement: { date: string; signups: number; quizzes: number; chats: number }[];
  revenue: { plan: string; count: number }[];
  retention: { period: string; count: number }[];
  content_stats: { chapters: number; topics: number; questions: number };
  top_students: { id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number }[];
}

interface FeatureFlag {
  id: string; name: string; enabled: boolean; description: string | null;
}

function ControlRoom() {
  const { apiFetch } = useAdmin();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick action states
  const [testName, setTestName] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testRole, setTestRole] = useState('student');
  const [testResult, setTestResult] = useState('');
  const [lookupSearch, setLookupSearch] = useState('');
  const [lookupResults, setLookupResults] = useState<Array<Record<string, unknown>>>([]);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportStatus, setSupportStatus] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, deployRes, obsRes, backupRes, deployHistRes, logsRes, analyticsRes, flagsRes] = await Promise.all([
        apiFetch('/api/super-admin/stats'),
        apiFetch('/api/super-admin/deploy'),
        apiFetch('/api/super-admin/observability'),
        apiFetch('/api/super-admin/platform-ops?action=backups'),
        apiFetch('/api/super-admin/platform-ops?action=deployments&limit=5'),
        apiFetch('/api/super-admin/logs?limit=10'),
        apiFetch('/api/super-admin/analytics'),
        apiFetch('/api/super-admin/feature-flags'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (deployRes.ok) setDeployInfo(await deployRes.json());
      if (obsRes.ok) setObsData(await obsRes.json());
      if (backupRes.ok) { const d = await backupRes.json(); setBackups(d.data || []); }
      if (deployHistRes.ok) { const d = await deployHistRes.json(); setDeployHistory(d.data || []); }
      if (logsRes.ok) { const d = await logsRes.json(); setRecentLogs(d.data || []); }
      if (analyticsRes.ok) setAnalytics(await analyticsRes.json());
      if (flagsRes.ok) { const d = await flagsRes.json(); setFlags(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createTestAccount = async () => {
    if (!testName || !testEmail) return;
    setTestResult('Creating...');
    try {
      const res = await apiFetch('/api/super-admin/test-accounts', {
        method: 'POST', body: JSON.stringify({ role: testRole, name: testName, email: testEmail }),
      });
      const d = await res.json();
      if (res.ok) { setTestResult(`Done. Password: ${d.password}`); setTestName(''); setTestEmail(''); }
      else setTestResult(d.error || 'Failed');
    } catch { setTestResult('Request failed'); }
  };

  const lookupUser = async () => {
    if (!lookupSearch.trim()) return;
    const res = await apiFetch(`/api/super-admin/users?role=student&search=${encodeURIComponent(lookupSearch)}&limit=5`);
    if (res.ok) { const d = await res.json(); setLookupResults(d.data || []); }
  };

  const sendPasswordReset = async () => {
    if (!supportEmail.trim()) return;
    setSupportStatus('Sending...');
    try {
      const res = await apiFetch(`/api/super-admin/support?action=reset_password`, {
        method: 'POST', body: JSON.stringify({ email: supportEmail }),
      });
      const d = await res.json();
      setSupportStatus(res.ok ? (d.message || 'Sent') : (d.error || 'Failed'));
    } catch { setSupportStatus('Failed'); }
  };

  const toggleFlag = async (flag: FeatureFlag) => {
    await apiFetch('/api/super-admin/feature-flags', {
      method: 'PATCH', body: JSON.stringify({ id: flag.id, updates: { enabled: !flag.enabled } }),
    });
    const res = await apiFetch('/api/super-admin/feature-flags');
    if (res.ok) { const d = await res.json(); setFlags(d.data || []); }
  };

  if (loading && !stats) {
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading control room...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ ...S.h1, fontSize: 18 }}>Control Room</h1>
          <p style={{ fontSize: 12, color: colors.text3, margin: 0 }}>Platform operations, system status, and quick interventions</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {deployInfo && <code style={{ fontSize: 11, color: colors.text3, background: colors.surface, padding: '4px 8px', borderRadius: 4 }}>v{deployInfo.app_version}</code>}
          <button onClick={fetchAll} style={S.secondaryBtn}>Refresh All</button>
        </div>
      </div>

      {/* ═══ SYSTEM STATUS BAR ═══ */}
      {obsData && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0,
          border: `1px solid ${obsData.health.status === 'healthy' ? '#BBF7D0' : '#FECACA'}`,
          borderRadius: 8, overflow: 'hidden', marginBottom: 16,
        }}>
          <div style={{
            padding: '12px 16px',
            background: obsData.health.status === 'healthy' ? colors.successLight : colors.dangerLight,
            display: 'flex', alignItems: 'center', gap: 8, borderRight: `1px solid ${colors.border}`,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: obsData.health.status === 'healthy' ? colors.success : colors.danger }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>
              {obsData.health.status === 'healthy' ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED'}
            </span>
          </div>
          <div style={{ padding: '10px 16px', background: colors.surface, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'Active now', value: obsData.users.active_24h, warn: false },
              { label: '7d active', value: obsData.users.active_7d, warn: false },
              { label: 'Failed jobs', value: obsData.jobs.failed, warn: obsData.jobs.failed > 0 },
              { label: 'Pending', value: obsData.jobs.pending, warn: obsData.jobs.pending > 5 },
              { label: 'Flags', value: `${obsData.feature_flags.enabled}/${obsData.feature_flags.total}`, warn: false },
              { label: 'Cache', value: obsData.cache.size, warn: false },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: colors.text3 }}>{item.label}:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: item.warn ? colors.danger : colors.text1 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ TWO-COLUMN: OPERATIONS + STATUS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* ── LEFT: QUICK OPERATIONS ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Quick Operations</div>

          {/* Create Test Account */}
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.accent}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>Create Test Account</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select value={testRole} onChange={e => setTestRole(e.target.value)} style={{ ...S.select, fontSize: 12, padding: '6px 8px' }}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="parent">Parent</option>
              </select>
              <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Name" style={{ ...S.searchInput, width: 120, fontSize: 12, padding: '6px 8px' }} />
              <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Email" style={{ ...S.searchInput, flex: 1, minWidth: 140, fontSize: 12, padding: '6px 8px' }} />
              <button onClick={createTestAccount} style={{ ...S.primaryBtn, fontSize: 12, padding: '6px 12px' }}>Create</button>
            </div>
            {testResult && <div style={{ marginTop: 6, fontSize: 11, color: testResult.startsWith('Done') ? colors.success : colors.danger, fontWeight: 600 }}>{testResult}</div>}
          </div>

          {/* User Lookup */}
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.warning}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>User Lookup</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={lookupSearch} onChange={e => setLookupSearch(e.target.value)} placeholder="Search by name..."
                style={{ ...S.searchInput, flex: 1, fontSize: 12, padding: '6px 8px' }} onKeyDown={e => e.key === 'Enter' && lookupUser()} />
              <button onClick={lookupUser} style={{ ...S.secondaryBtn, fontSize: 12, padding: '6px 12px' }}>Find</button>
            </div>
            {lookupResults.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {lookupResults.map((u, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                    <div>
                      <strong style={{ color: colors.text1 }}>{String(u.name || '—')}</strong>
                      <span style={{ color: colors.text3, marginLeft: 6 }}>{String(u.email || '')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <StatusBadge label={String(u.subscription_plan || 'free')} variant="neutral" />
                      <StatusBadge label={u.is_active !== false ? 'Active' : 'Banned'} variant={u.is_active !== false ? 'success' : 'danger'} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Password Reset */}
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.danger}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>Password Reset</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="User email"
                style={{ ...S.searchInput, flex: 1, fontSize: 12, padding: '6px 8px' }} />
              <button onClick={sendPasswordReset} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger, fontSize: 12, padding: '6px 12px' }}>Reset</button>
            </div>
            {supportStatus && <div style={{ marginTop: 4, fontSize: 11, color: supportStatus === 'Failed' ? colors.danger : colors.success }}>{supportStatus}</div>}
          </div>

          {/* Navigation Commands */}
          <div style={{ ...S.card }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>Go To</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { href: '/super-admin/users', label: 'Users & Roles' },
                { href: '/super-admin/subscriptions', label: 'Subscriptions' },
                { href: '/super-admin/learning', label: 'Learning Intel' },
                { href: '/super-admin/diagnostics', label: 'Diagnostics' },
                { href: '/super-admin/workbench', label: 'Data Workbench' },
                { href: '/super-admin/flags', label: 'Feature Flags' },
                { href: '/super-admin/institutions', label: 'Institutions' },
                { href: '/super-admin/cms', label: 'Content CMS' },
                { href: '/super-admin/reports', label: 'Reports' },
                { href: '/super-admin/logs', label: 'Audit Logs' },
              ].map(item => (
                <a key={item.href} href={item.href} style={{
                  padding: '8px 12px', borderRadius: 6, border: `1px solid ${colors.border}`,
                  background: colors.bg, color: colors.text1, fontSize: 12, fontWeight: 500,
                  textDecoration: 'none', display: 'block', textAlign: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = colors.surface}
                onMouseLeave={e => e.currentTarget.style.background = colors.bg}>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: LIVE STATUS ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5 }}>Live Status</div>

          {/* Platform Metrics */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <StatCard label="Students" value={stats.totals.students} accentColor={colors.accent} />
              <StatCard label="Teachers" value={stats.totals.teachers} accentColor={colors.success} />
              <StatCard label="Parents" value={stats.totals.parents} accentColor="#8B5CF6" />
            </div>
          )}

          {/* Activity Panel */}
          {stats && (
            <div style={{ ...S.card, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Activity</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ borderRight: `1px solid ${colors.border}`, paddingRight: 12 }}>
                  <div style={{ fontSize: 10, color: colors.text3, fontWeight: 600, marginBottom: 4 }}>LAST 24H</div>
                  {Object.entries(stats.last_24h).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                      <span style={{ color: colors.text2, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ fontWeight: 700, color: colors.text1 }}>{v >= 0 ? v : '—'}</span>
                    </div>
                  ))}
                </div>
                {stats.last_7d && (
                  <div style={{ paddingLeft: 12 }}>
                    <div style={{ fontSize: 10, color: colors.text3, fontWeight: 600, marginBottom: 4 }}>LAST 7D</div>
                    {Object.entries(stats.last_7d).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                        <span style={{ color: colors.text2, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                        <span style={{ fontWeight: 700, color: colors.text1 }}>{v >= 0 ? v : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Inline metrics */}
              <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${colors.borderLight}` }}>
                <StatCard label="Quiz Sessions" value={stats.totals.quiz_sessions} accentColor={colors.warning} />
                <StatCard label="Chat Sessions" value={stats.totals.chat_sessions} accentColor="#EC4899" />
              </div>
            </div>
          )}

          {/* Feature Flags Quick Toggle */}
          <div style={{ ...S.card, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Feature Flags</div>
              <a href="/super-admin/flags" style={{ fontSize: 11, color: colors.accent, textDecoration: 'none' }}>Manage</a>
            </div>
            {flags.slice(0, 8).map(flag => (
              <div key={flag.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
                <code style={{ fontSize: 11, color: colors.text1 }}>{flag.name}</code>
                <button onClick={() => toggleFlag(flag)} style={{
                  padding: '2px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700,
                  background: flag.enabled ? colors.success : colors.border,
                  color: flag.enabled ? '#fff' : colors.text3,
                }}>{flag.enabled ? 'ON' : 'OFF'}</button>
              </div>
            ))}
            {flags.length === 0 && <div style={{ fontSize: 11, color: colors.text3 }}>No flags configured</div>}
          </div>

          {/* Subscription Breakdown */}
          {analytics && analytics.revenue.length > 0 && (
            <div style={{ ...S.card, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Subscription Plans</div>
              {analytics.revenue.map(r => {
                const maxCount = Math.max(...analytics.revenue.map(x => x.count), 1);
                return (
                  <div key={r.plan} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: colors.text2, width: 100, textTransform: 'capitalize', flexShrink: 0 }}>{r.plan.replace(/_/g, ' ')}</span>
                    <div style={{ flex: 1, height: 14, background: colors.surface, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(r.count / maxCount) * 100}%`, height: '100%', background: colors.accent, borderRadius: 3, opacity: 0.6, minWidth: r.count > 0 ? 3 : 0 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1, width: 30, textAlign: 'right' }}>{r.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ PENDING ACTIONS ═══ */}
      {(() => {
        const pendingItems: { icon: string; text: string; href: string; isAlert: boolean }[] = [];
        if (obsData && obsData.jobs.failed > 0) {
          pendingItems.push({ icon: '\u26A0\uFE0F', text: `${obsData.jobs.failed} failed job${obsData.jobs.failed > 1 ? 's' : ''} need review`, href: '/super-admin/diagnostics', isAlert: true });
        }
        if (analytics) {
          pendingItems.push({ icon: '\uD83D\uDCDD', text: 'Content items may need review', href: '/super-admin/cms', isAlert: false });
        }
        if (flags.length > 0 || obsData) {
          const enabled = obsData ? obsData.feature_flags.enabled : flags.filter(f => f.enabled).length;
          const total = obsData ? obsData.feature_flags.total : flags.length;
          pendingItems.push({ icon: '\uD83D\uDEA9', text: `${enabled} flags active / ${total} total`, href: '/super-admin/flags', isAlert: false });
        }
        pendingItems.push({ icon: '\uD83C\uDD98', text: 'Check support center', href: '/super-admin/support', isAlert: false });

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...S.card, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>Pending Actions</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#fff', background: colors.accent,
                  borderRadius: 10, padding: '1px 7px', lineHeight: '16px',
                }}>{pendingItems.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {pendingItems.map((item, i) => (
                  <a
                    key={i}
                    href={item.href}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px', borderRadius: 6, textDecoration: 'none',
                      background: item.isAlert ? 'rgba(239,68,68,0.06)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!item.isAlert) e.currentTarget.style.background = colors.surface; }}
                    onMouseLeave={e => { if (!item.isAlert) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{item.icon}</span>
                      <span style={{ fontSize: 12, color: item.isAlert ? colors.danger : colors.text1, fontWeight: item.isAlert ? 600 : 400 }}>{item.text}</span>
                    </div>
                    <span style={{ fontSize: 12, color: colors.text3 }}>{'\u2192'}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ BOTTOM SECTION: DEPLOYMENT + AUDIT + BACKUPS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Deployment */}
        {deployInfo && (
          <div style={{ ...S.card, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Deployment</div>
            {[
              { l: 'Version', v: deployInfo.app_version },
              { l: 'Env', v: deployInfo.environment },
              { l: 'Branch', v: deployInfo.deployment.branch },
              { l: 'Commit', v: deployInfo.deployment.commit_sha.slice(0, 8) },
              { l: 'Author', v: deployInfo.deployment.commit_author },
              { l: 'Region', v: deployInfo.region },
            ].map(item => (
              <div key={item.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: colors.text3 }}>{item.l}</span>
                <span style={{ color: colors.text1, fontWeight: 500, fontFamily: item.l === 'Commit' ? 'monospace' : 'inherit' }}>{item.v}</span>
              </div>
            ))}
            {deployInfo.deployment.commit_message !== 'unknown' && (
              <div style={{ marginTop: 8, padding: '6px 8px', background: colors.surface, borderRadius: 4, fontSize: 11, color: colors.text2 }}>
                {deployInfo.deployment.commit_message}
              </div>
            )}
          </div>
        )}

        {/* Recent Audit */}
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1 }}>Audit Trail</div>
            <a href="/super-admin/logs" style={{ fontSize: 11, color: colors.accent, textDecoration: 'none' }}>All</a>
          </div>
          {recentLogs.length === 0 ? (
            <div style={{ fontSize: 11, color: colors.text3 }}>No recent actions</div>
          ) : recentLogs.slice(0, 8).map(l => (
            <div key={l.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <code style={{ fontSize: 10, color: colors.text1, background: colors.surface, padding: '1px 4px', borderRadius: 2 }}>{l.action}</code>
              <span style={{ fontSize: 10, color: colors.text3 }}>{new Date(l.created_at).toLocaleString().replace(/:\d{2}\s/, ' ')}</span>
            </div>
          ))}
        </div>

        {/* Backups */}
        <div style={{ ...S.card, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Backups</div>
          {backups.length === 0 ? (
            <div style={{ fontSize: 11, color: colors.text3 }}>No backup records. Check Supabase dashboard.</div>
          ) : backups.slice(0, 4).map(b => (
            <div key={b.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <StatusBadge label={b.status} variant={b.status === 'success' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'} />
                <span style={{ fontSize: 11, color: colors.text3 }}>{b.backup_type}</span>
              </div>
              <span style={{ fontSize: 10, color: colors.text3 }}>
                {b.completed_at ? new Date(b.completed_at).toLocaleDateString() : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Deployments */}
      {deployHistory.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Recent Deployments</div>
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
                    <td style={S.td}><code style={{ fontSize: 11, color: colors.text2 }}>{(d.commit_sha || '').slice(0, 8)}</code></td>
                    <td style={{ ...S.td, fontSize: 12 }}>{new Date(d.deployed_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ LEARNER HEALTH ═══ */}
      {analytics && stats && obsData && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Learner Health</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {(() => {
              const totalStudents = stats.totals?.students || 0;
              const activeToday = obsData.users.active_24h || 0;
              const quizzesToday = obsData.activity_24h.quizzes || 0;
              const chatsToday = obsData.activity_24h.chats || 0;
              const engagementRate = totalStudents > 0 ? Math.round((activeToday / totalStudents) * 100) : 0;
              const avgQuizzesPerActive = activeToday > 0 ? (quizzesToday / activeToday).toFixed(1) : '0';
              const topStudents = analytics.top_students || [];
              const avgXp = topStudents.length > 0 ? Math.round(topStudents.reduce((s, t) => s + t.xp_total, 0) / topStudents.length) : 0;

              return [
                {
                  label: 'Daily engagement',
                  value: `${engagementRate}%`,
                  detail: `${activeToday}/${totalStudents} students active today`,
                  color: engagementRate >= 30 ? colors.success : engagementRate >= 10 ? colors.warning : colors.danger,
                },
                {
                  label: 'Quiz activity',
                  value: `${quizzesToday}`,
                  detail: `${avgQuizzesPerActive} quizzes per active student`,
                  color: quizzesToday > 0 ? colors.success : colors.warning,
                },
                {
                  label: 'AI tutor usage',
                  value: `${chatsToday}`,
                  detail: 'Foxy sessions today',
                  color: chatsToday > 0 ? colors.accent : colors.text3,
                },
                {
                  label: 'Top learner XP',
                  value: avgXp.toLocaleString(),
                  detail: `avg of top ${topStudents.length} students`,
                  color: colors.accent,
                },
              ].map(item => (
                <div key={item.label} style={{ ...S.card, padding: '12px 14px', borderLeft: `3px solid ${item.color}` }}>
                  <div style={{ fontSize: 11, color: colors.text3, marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 10, color: colors.text3, marginTop: 2 }}>{item.detail}</div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ═══ PLATFORM HEALTH GRID ═══ */}
      {stats && obsData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {/* Parent-Student Linkage */}
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.accent}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>👨‍👧 Parent-Student Linkage</div>
            {(() => {
              const totalStudents = stats.totals?.students || 0;
              const totalParents = stats.totals?.parents || 0;
              const linkageRate = totalStudents > 0 ? Math.round((totalParents / totalStudents) * 100) : 0;
              const linkColor = linkageRate >= 60 ? colors.success : linkageRate >= 30 ? colors.warning : colors.danger;
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: linkColor }}>{linkageRate}%</span>
                    <span style={{ fontSize: 11, color: colors.text3 }}>linked</span>
                  </div>
                  <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
                    {totalParents} parents · {totalStudents} students
                  </div>
                  <div style={{ marginTop: 6, height: 6, background: colors.surface, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${linkageRate}%`, height: '100%', background: linkColor, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Teacher-Class Coverage */}
          <div style={{ ...S.card, borderLeft: `3px solid ${colors.warning}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1, marginBottom: 8 }}>👩‍🏫 Teacher Coverage</div>
            {(() => {
              const totalTeachers = stats.totals?.teachers || 0;
              const totalStudents = stats.totals?.students || 0;
              const ratio = totalTeachers > 0 ? Math.round(totalStudents / totalTeachers) : 0;
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: colors.text1 }}>{totalTeachers}</span>
                    <span style={{ fontSize: 11, color: colors.text3 }}>teachers</span>
                  </div>
                  <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
                    {ratio > 0 ? `1:${ratio} teacher-student ratio` : 'No teachers registered'}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge label={ratio > 0 && ratio <= 40 ? 'Healthy' : 'Stretched'} variant={ratio > 0 && ratio <= 40 ? 'success' : 'warning'} />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Content Coverage */}
          {analytics && (
            <div style={{ ...S.card, borderLeft: `3px solid ${colors.success}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>📚 Content Coverage</div>
                <StatusBadge
                  label={analytics.content_stats.questions > 1000 ? 'Strong' : analytics.content_stats.questions > 500 ? 'Growing' : 'Needs Content'}
                  variant={analytics.content_stats.questions > 1000 ? 'success' : analytics.content_stats.questions > 500 ? 'warning' : 'danger'}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.chapters}</div>
                  <div style={{ fontSize: 10, color: colors.text3 }}>Chapters</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.topics}</div>
                  <div style={{ fontSize: 10, color: colors.text3 }}>Topics</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>{analytics.content_stats.questions}</div>
                  <div style={{ fontSize: 10, color: colors.text3 }}>Questions</div>
                </div>
              </div>
            </div>
          )}

          {/* Simulation Health */}
          <div style={{ ...S.card, borderLeft: `3px solid #8B5CF6` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.text1 }}>🔬 Simulation Lab</div>
              <StatusBadge label="Active" variant="success" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#8B5CF6' }}>19</span>
              <span style={{ fontSize: 11, color: colors.text3 }}>built-in simulations</span>
            </div>
            <div style={{ fontSize: 11, color: colors.text3, marginTop: 4 }}>
              Physics: 8 · Chemistry: 4 · Math: 7
            </div>
          </div>
        </div>
      )}

      {/* Content + Engagement Row */}
      {analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Content</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <StatCard label="Chapters" value={analytics.content_stats.chapters} accentColor={colors.accent} />
              <StatCard label="Topics" value={analytics.content_stats.topics} accentColor={colors.warning} />
              <StatCard label="Questions" value={analytics.content_stats.questions} accentColor={colors.success} />
            </div>
          </div>
          {analytics.engagement.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.text2, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>30-Day Engagement</div>
              <div style={{ ...S.card, padding: 12 }}>
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                  {analytics.engagement.map(day => {
                    const total = day.signups + day.quizzes + day.chats;
                    const maxTotal = Math.max(...analytics.engagement.map(d => d.signups + d.quizzes + d.chats), 1);
                    return (
                      <div key={day.date} style={{ flex: 1 }} title={`${day.date}: ${total}`}>
                        <div style={{ width: '100%', background: colors.accent, borderRadius: 1, height: `${(total / maxTotal) * 100}%`, minHeight: total > 0 ? 2 : 0, opacity: 0.6 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 9, color: colors.text3 }}>{analytics.engagement[0]?.date}</span>
                  <span style={{ fontSize: 9, color: colors.text3 }}>{analytics.engagement[analytics.engagement.length - 1]?.date}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SuperAdminPage() {
  return (
    <AdminShell>
      <ControlRoom />
    </AdminShell>
  );
}
