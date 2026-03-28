'use client';

import { useState, useEffect, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK SUPER ADMIN PANEL — Full Control Dashboard
   Server-side protected via middleware (secret in query param).
   ═══════════════════════════════════════════════════════════════ */

interface SystemStats {
  totals: Record<string, number>;
  last_24h: Record<string, number>;
  last_7d?: Record<string, number>;
}

interface UserRecord {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  grade?: string;
  board?: string;
  xp_total?: number;
  streak_days?: number;
  school_name?: string;
  is_active?: boolean;
  account_status?: string;
  subscription_plan?: string;
  created_at: string;
  [key: string]: unknown;
}

interface AuditEntry {
  id: string;
  auth_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

type Tab = 'dashboard' | 'users' | 'reports' | 'logs';

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userRole, setUserRole] = useState('student');
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [reportStatus, setReportStatus] = useState('');

  // Get secret from URL — middleware already validated it
  const [secretKey] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('secret') || '';
  });

  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-admin-secret': secretKey,
  }), [secretKey]);

  // ── Data fetchers ──
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/internal/admin/stats', { headers: h() });
      if (res.ok) setStats(await res.json());
    } catch { /* */ }
    setLoading(false);
  }, [h]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
      if (userSearch) p.set('search', userSearch);
      const res = await fetch(`/api/internal/admin/users?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setUsers(d.data || []); setUserTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, userRole, userPage, userSearch]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(logPage), limit: '25' });
      const res = await fetch(`/api/internal/admin/logs?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setLogs(d.data || []); setLogTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, logPage]);

  useEffect(() => {
    if (!secretKey) return;
    if (activeTab === 'dashboard') fetchStats();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'logs') fetchLogs();
  }, [secretKey, activeTab, fetchStats, fetchUsers, fetchLogs]);

  // ── Actions ──
  const toggleUser = async (user: UserRecord) => {
    const table = user.role === 'teacher' ? 'teachers' : user.role === 'parent' ? 'guardians' : 'students';
    await fetch('/api/internal/admin/users', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ user_id: user.id, table, updates: { is_active: !user.is_active } }),
    });
    fetchUsers();
  };

  const downloadReport = async (type: string, format: string) => {
    setReportStatus(`Generating ${type} report...`);
    try {
      const res = await fetch(`/api/internal/admin/reports?type=${type}&format=${format}`, { headers: h() });
      if (!res.ok) { setReportStatus('Failed to generate report'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      a.href = url;
      a.download = `alfanumrik-${type}-${ts}.${format === 'json' ? 'json' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(url);
      setReportStatus(`${type} report downloaded!`);
      setTimeout(() => setReportStatus(''), 3000);
    } catch { setReportStatus('Download failed'); }
  };

  if (!secretKey) {
    return <div style={S.center}><p style={{ color: '#888' }}>Access: /internal/admin?secret=YOUR_KEY</p></div>;
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'reports', label: 'Reports', icon: '📋' },
    { key: 'logs', label: 'Audit Logs', icon: '🔍' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', fontFamily: "'Plus Jakarta Sans', monospace" }}>
      {/* ── Header ── */}
      <header style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🦊</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#E8581C' }}>ALFANUMRIK</div>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Super Admin Console</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#444' }}>{new Date().toLocaleString()}</div>
      </header>

      {/* ── Tabs ── */}
      <nav style={{ padding: '0 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 0, background: '#0f0f0f' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '12px 18px', fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400,
            color: activeTab === tab.key ? '#E8581C' : '#666', background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.key ? '2px solid #E8581C' : '2px solid transparent',
            cursor: 'pointer', letterSpacing: 0.5,
          }}>
            <span style={{ marginRight: 6 }}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main style={{ padding: '20px', maxWidth: 1400, margin: '0 auto' }}>
        {loading && <div style={{ fontSize: 11, color: '#E8581C', marginBottom: 12 }}>● Loading data...</div>}

        {/* ═══ DASHBOARD ═══ */}
        {activeTab === 'dashboard' && (
          <div>
            {stats ? (
              <>
                {/* Platform Totals */}
                <div style={{ marginBottom: 28 }}>
                  <h2 style={S.h2}>Platform Overview</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Students', value: stats.totals.students, icon: '🎓', color: '#E8581C' },
                      { label: 'Teachers', value: stats.totals.teachers, icon: '👩‍🏫', color: '#2563EB' },
                      { label: 'Parents', value: stats.totals.parents, icon: '👨‍👩‍👧', color: '#16A34A' },
                      { label: 'Quiz Sessions', value: stats.totals.quiz_sessions, icon: '⚡', color: '#F59E0B' },
                      { label: 'Chat Sessions', value: stats.totals.chat_sessions, icon: '🦊', color: '#E8581C' },
                    ].map(s => (
                      <div key={s.label} style={{ ...S.card, borderLeft: `3px solid ${s.color}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value >= 0 ? s.value.toLocaleString() : '—'}</span>
                          <span style={{ fontSize: 24 }}>{s.icon}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Activity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
                  <div>
                    <h2 style={S.h2}>Last 24 Hours</h2>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {Object.entries(stats.last_24h).map(([k, v]) => (
                        <div key={k} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#aaa', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 20, fontWeight: 800, color: '#22C55E' }}>{v >= 0 ? v : '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {stats.last_7d && (
                    <div>
                      <h2 style={S.h2}>Last 7 Days</h2>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {Object.entries(stats.last_7d).map(([k, v]) => (
                          <div key={k} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: '#aaa', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                            <span style={{ fontSize: 20, fontWeight: 800, color: '#3B82F6' }}>{v >= 0 ? v : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <h2 style={S.h2}>Quick Actions</h2>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => { setActiveTab('users'); setUserRole('student'); }} style={S.quickBtn}>View Students</button>
                  <button onClick={() => { setActiveTab('users'); setUserRole('teacher'); }} style={S.quickBtn}>View Teachers</button>
                  <button onClick={() => setActiveTab('reports')} style={S.quickBtn}>Download Reports</button>
                  <button onClick={() => setActiveTab('logs')} style={S.quickBtn}>View Audit Logs</button>
                  <button onClick={fetchStats} style={{ ...S.quickBtn, color: '#22C55E', borderColor: '#22C55E40' }}>↻ Refresh</button>
                </div>
              </>
            ) : !loading && (
              <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                <p>Loading dashboard data...</p>
                <button onClick={fetchStats} style={{ ...S.quickBtn, marginTop: 12 }}>Retry</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ USERS ═══ */}
        {activeTab === 'users' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['student', 'teacher', 'parent'].map(r => (
                  <button key={r} onClick={() => { setUserRole(r === 'parent' ? 'guardian' : r); setUserPage(1); }}
                    style={{ ...S.filterBtn, ...(userRole === (r === 'parent' ? 'guardian' : r) ? S.filterActive : {}) }}>
                    {r === 'student' ? '🎓' : r === 'teacher' ? '👩‍🏫' : '👨‍👩‍👧'} {r}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search name..."
                  style={S.searchInput} onKeyDown={e => e.key === 'Enter' && fetchUsers()} />
                <button onClick={() => downloadReport(userRole === 'guardian' ? 'parents' : `${userRole}s`, 'csv')}
                  style={{ ...S.quickBtn, fontSize: 11, padding: '6px 12px' }}>⬇ CSV</button>
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
              {userTotal} {userRole === 'guardian' ? 'parent' : userRole}s found
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Name</th>
                    <th style={S.th}>Email</th>
                    {userRole === 'student' && <><th style={S.th}>Grade</th><th style={S.th}>XP</th><th style={S.th}>Plan</th></>}
                    {userRole === 'teacher' && <th style={S.th}>School</th>}
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Joined</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No users found</td></tr>
                  )}
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={S.td}><strong>{u.name || '—'}</strong></td>
                      <td style={{ ...S.td, fontSize: 11 }}>{u.email || '—'}</td>
                      {userRole === 'student' && (
                        <>
                          <td style={S.td}>{u.grade || '—'}</td>
                          <td style={S.td}><span style={{ color: '#F59E0B' }}>{u.xp_total ?? 0}</span></td>
                          <td style={S.td}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: u.subscription_plan === 'premium' ? '#F59E0B20' : u.subscription_plan === 'basic' ? '#3B82F620' : '#33333380',
                              color: u.subscription_plan === 'premium' ? '#F59E0B' : u.subscription_plan === 'basic' ? '#3B82F6' : '#888',
                            }}>{u.subscription_plan || 'free'}</span>
                          </td>
                        </>
                      )}
                      {userRole === 'teacher' && <td style={S.td}>{u.school_name || '—'}</td>}
                      <td style={S.td}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: u.is_active !== false ? '#16A34A20' : '#EF444420',
                          color: u.is_active !== false ? '#16A34A' : '#EF4444',
                        }}>{u.is_active !== false ? 'Active' : 'Banned'}</span>
                      </td>
                      <td style={{ ...S.td, fontSize: 11 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                      <td style={S.td}>
                        <button onClick={() => toggleUser(u)} style={{
                          ...S.actionBtn,
                          color: u.is_active !== false ? '#EF4444' : '#22C55E',
                          borderColor: u.is_active !== false ? '#EF444440' : '#22C55E40',
                        }}>{u.is_active !== false ? '⛔ Ban' : '✅ Unban'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {userPage} of {Math.max(1, Math.ceil(userTotal / 25))}</span>
              <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* ═══ REPORTS ═══ */}
        {activeTab === 'reports' && (
          <div>
            <h2 style={S.h2}>Download Reports</h2>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 20 }}>Export data as CSV or JSON files with timestamps. Reports include all records up to 5,000 rows.</p>

            {reportStatus && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: reportStatus.includes('failed') ? '#2a1010' : '#0a2a0a',
                color: reportStatus.includes('failed') ? '#EF4444' : '#22C55E', fontSize: 12, marginBottom: 16,
                border: `1px solid ${reportStatus.includes('failed') ? '#3a1515' : '#153015'}` }}>
                {reportStatus}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {[
                { type: 'students', icon: '🎓', label: 'Student Records', desc: 'Names, grades, XP, subscriptions, status' },
                { type: 'teachers', icon: '👩‍🏫', label: 'Teacher Records', desc: 'Names, schools, active status' },
                { type: 'parents', icon: '👨‍👩‍👧', label: 'Parent Records', desc: 'Names, emails, phone numbers' },
                { type: 'quizzes', icon: '⚡', label: 'Quiz Sessions', desc: 'Scores, subjects, completion status' },
                { type: 'chats', icon: '🦊', label: 'Chat Sessions', desc: 'Subjects, message counts, activity' },
                { type: 'audit', icon: '🔍', label: 'Audit Logs', desc: 'All admin actions and system events' },
              ].map(r => (
                <div key={r.type} style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{r.icon} {r.label}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>{r.desc}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => downloadReport(r.type, 'csv')} style={{ ...S.dlBtn, flex: 1 }}>⬇ CSV</button>
                    <button onClick={() => downloadReport(r.type, 'json')} style={{ ...S.dlBtn, flex: 1, background: '#1a1a2a', borderColor: '#3B82F640', color: '#3B82F6' }}>⬇ JSON</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ AUDIT LOGS ═══ */}
        {activeTab === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Audit Logs</h2>
              <button onClick={() => downloadReport('audit', 'csv')} style={{ ...S.quickBtn, fontSize: 11 }}>⬇ Export CSV</button>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{logTotal} total entries</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Timestamp</th>
                    <th style={S.th}>Action</th>
                    <th style={S.th}>Resource</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>User ID</th>
                    <th style={S.th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No audit logs yet</td></tr>
                  )}
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString()}</td>
                      <td style={S.td}><code style={{ color: '#E8581C', background: '#E8581C15', padding: '1px 6px', borderRadius: 3 }}>{l.action}</code></td>
                      <td style={S.td}>{l.resource_type}{l.resource_id ? <code style={{ color: '#888', marginLeft: 4 }}>:{l.resource_id.slice(0, 8)}</code> : ''}</td>
                      <td style={S.td}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: l.status === 'success' ? '#16A34A18' : l.status === 'denied' ? '#EF444418' : '#F59E0B18',
                          color: l.status === 'success' ? '#16A34A' : l.status === 'denied' ? '#EF4444' : '#F59E0B',
                        }}>{l.status || '—'}</span>
                      </td>
                      <td style={{ ...S.td, fontSize: 10 }}><code>{l.auth_user_id?.slice(0, 12) || '—'}</code></td>
                      <td style={{ ...S.td, fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.details ? JSON.stringify(l.details).slice(0, 60) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <button disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {logPage} of {Math.max(1, Math.ceil(logTotal / 25))}</span>
              <button disabled={logs.length < 25} onClick={() => setLogPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Styles ─── */
const S: Record<string, React.CSSProperties> = {
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#e0e0e0', fontFamily: 'monospace' },
  h2: { fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 12 },
  card: { padding: 16, borderRadius: 10, border: '1px solid #1e1e1e', background: '#111' },
  searchInput: { padding: '8px 14px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#e0e0e0', fontSize: 12, outline: 'none', fontFamily: 'inherit', width: 200 },
  filterBtn: { padding: '7px 14px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#888', fontSize: 12, cursor: 'pointer' },
  filterActive: { background: '#E8581C18', color: '#E8581C', borderColor: '#E8581C40' },
  quickBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid #E8581C40', background: '#E8581C10', color: '#E8581C', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  dlBtn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #16A34A40', background: '#16A34A10', color: '#16A34A', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #1e1e1e', color: '#555', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.5 },
  td: { padding: '10px 12px', borderBottom: '1px solid #141414', color: '#ccc' },
  actionBtn: { background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  pageBtn: { padding: '7px 16px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#888', fontSize: 12, cursor: 'pointer' },
};
