'use client';

import { useState, useEffect, useCallback } from 'react';

interface SystemStats {
  totals: Record<string, number>;
  last_24h: Record<string, number>;
}

interface UserRecord {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  is_active?: boolean;
  account_status?: string;
  created_at: string;
  [key: string]: unknown;
}

interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
}

export default function SuperAdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'logs'>('dashboard');

  // Dashboard state
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

  // Simple headers — only admin key needed, no JWT
  const adminHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-admin-key': secretKey,
  }), [secretKey]);

  // Verify admin access
  const verifyAccess = async () => {
    if (!secretKey.trim()) { setError('Enter admin key'); return; }
    setError('');
    try {
      const res = await fetch('/api/internal/admin/stats', { headers: adminHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setAuthenticated(true);
      } else {
        setError('Invalid admin key or insufficient permissions');
      }
    } catch {
      setError('Connection failed');
    }
  };

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/internal/admin/stats', { headers: adminHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, [adminHeaders]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
      if (userSearch) params.set('search', userSearch);
      const res = await fetch(`/api/internal/admin/users?${params}`, { headers: adminHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.data || []);
        setUserTotal(data.total || 0);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [adminHeaders, userRole, userPage, userSearch]);

  // Fetch audit logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(logPage), limit: '25' });
      const res = await fetch(`/api/internal/admin/logs?${params}`, { headers: adminHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data || []);
        setLogTotal(data.total || 0);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [adminHeaders, logPage]);

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === 'dashboard') fetchStats();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'logs') fetchLogs();
  }, [authenticated, activeTab, fetchStats, fetchUsers, fetchLogs]);

  // Toggle user active status
  const toggleUserActive = async (user: UserRecord) => {
    const table = user.role === 'teacher' ? 'teachers' : user.role === 'guardian' ? 'guardians' : 'students';
    const res = await fetch('/api/internal/admin/users', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({
        user_id: user.id,
        table,
        updates: { is_active: !user.is_active },
      }),
    });
    if (res.ok) fetchUsers();
  };

  // Admin key gate
  if (!authenticated) {
    return (
      <div style={styles.center}>
        <div style={styles.keyCard}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Admin Access</h1>
          {error && <div style={styles.error}>{error}</div>}
          <input
            type="password"
            value={secretKey}
            onChange={e => setSecretKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verifyAccess()}
            placeholder="Enter admin secret key"
            style={styles.input}
            aria-label="Admin secret key"
            autoComplete="off"
          />
          <button onClick={verifyAccess} style={styles.primaryBtn}>Verify Access</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e0e0e0', fontFamily: 'monospace' }}>
      {/* Header */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#E8581C' }}>ALFANUMRIK</span>
          <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>Super Admin</span>
        </div>
        <span style={{ fontSize: 11, color: '#555' }}>Admin Panel</span>
      </header>

      {/* Tabs */}
      <nav style={{ padding: '0 20px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: 0 }}>
        {(['dashboard', 'users', 'logs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: activeTab === tab ? 700 : 400,
              color: activeTab === tab ? '#E8581C' : '#888',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #E8581C' : '2px solid transparent',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
        {loading && <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>Loading...</div>}

        {/* ═══ DASHBOARD TAB ═══ */}
        {activeTab === 'dashboard' && stats && (
          <div>
            <h2 style={styles.sectionTitle}>Platform Totals</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              {Object.entries(stats.totals).map(([k, v]) => (
                <div key={k} style={styles.statCard}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#E8581C' }}>{v.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>{k.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>

            <h2 style={styles.sectionTitle}>Last 24 Hours</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {Object.entries(stats.last_24h).map(([k, v]) => (
                <div key={k} style={styles.statCard}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#22C55E' }}>{v.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>{k.replace(/_/g, ' ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ USERS TAB ═══ */}
        {activeTab === 'users' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {['student', 'teacher', 'parent'].map(r => (
                <button key={r} onClick={() => { setUserRole(r === 'parent' ? 'guardian' : r); setUserPage(1); }}
                  style={{ ...styles.filterBtn, ...(userRole === (r === 'parent' ? 'guardian' : r) ? styles.filterBtnActive : {}) }}>
                  {r}
                </button>
              ))}
              <input
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search name..."
                style={{ ...styles.input, flex: 1, minWidth: 150 }}
                onKeyDown={e => e.key === 'Enter' && fetchUsers()}
              />
            </div>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{userTotal} total</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={styles.td}>{u.name}</td>
                      <td style={styles.td}>{u.email}</td>
                      <td style={styles.td}>
                        <span style={{ color: u.is_active !== false ? '#22C55E' : '#EF4444', fontSize: 11 }}>
                          {u.is_active !== false ? 'Active' : 'Banned'}
                        </span>
                      </td>
                      <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                      <td style={styles.td}>
                        <button onClick={() => toggleUserActive(u)}
                          style={{ ...styles.actionBtn, color: u.is_active !== false ? '#EF4444' : '#22C55E' }}>
                          {u.is_active !== false ? 'Ban' : 'Unban'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={styles.pageBtn}>Prev</button>
              <span style={{ fontSize: 12, color: '#888', padding: '6px 12px' }}>Page {userPage}</span>
              <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={styles.pageBtn}>Next</button>
            </div>
          </div>
        )}

        {/* ═══ LOGS TAB ═══ */}
        {activeTab === 'logs' && (
          <div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{logTotal} total entries</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Time</th>
                    <th style={styles.th}>Action</th>
                    <th style={styles.th}>Resource</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>User</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td style={styles.td}>{new Date(l.created_at).toLocaleString()}</td>
                      <td style={styles.td}><code style={{ color: '#E8581C' }}>{l.action}</code></td>
                      <td style={styles.td}>{l.resource_type}{l.resource_id ? `:${l.resource_id.slice(0, 8)}` : ''}</td>
                      <td style={styles.td}>
                        <span style={{ color: l.status === 'success' ? '#22C55E' : l.status === 'denied' ? '#EF4444' : '#F59E0B' }}>
                          {l.status}
                        </span>
                      </td>
                      <td style={styles.td}><code style={{ fontSize: 10 }}>{l.user_id?.slice(0, 8) || '—'}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <button disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)} style={styles.pageBtn}>Prev</button>
              <span style={{ fontSize: 12, color: '#888', padding: '6px 12px' }}>Page {logPage}</span>
              <button disabled={logs.length < 25} onClick={() => setLogPage(p => p + 1)} style={styles.pageBtn}>Next</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Styles ─── */
const styles: Record<string, React.CSSProperties> = {
  center: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f', color: '#e0e0e0', fontFamily: 'monospace' },
  keyCard: { padding: 32, borderRadius: 12, border: '1px solid #2a2a2a', background: '#1a1a1a', textAlign: 'center', width: 320 },
  error: { padding: '8px 12px', borderRadius: 8, background: '#2a1010', color: '#EF4444', fontSize: 12, marginBottom: 12, border: '1px solid #3a1515' },
  input: { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#e0e0e0', fontSize: 13, outline: 'none', marginBottom: 12, fontFamily: 'monospace' },
  primaryBtn: { width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', background: '#E8581C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 12 },
  statCard: { padding: 16, borderRadius: 8, border: '1px solid #2a2a2a', background: '#1a1a1a' },
  filterBtn: { padding: '6px 14px', borderRadius: 6, border: '1px solid #333', background: '#1a1a1a', color: '#888', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' as const },
  filterBtnActive: { background: '#E8581C20', color: '#E8581C', borderColor: '#E8581C40' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '1px solid #2a2a2a', color: '#666', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1 },
  td: { padding: '8px 12px', borderBottom: '1px solid #1a1a1a', color: '#ccc' },
  actionBtn: { background: 'none', border: '1px solid #333', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' },
  pageBtn: { padding: '6px 14px', borderRadius: 6, border: '1px solid #333', background: '#1a1a1a', color: '#888', fontSize: 12, cursor: 'pointer' },
};
