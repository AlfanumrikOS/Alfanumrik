'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';


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
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

type Tab = 'dashboard' | 'users' | 'roles' | 'content' | 'analytics' | 'flags' | 'institutions' | 'support' | 'reports' | 'logs';

interface DeployInfo {
  app_version: string; environment: string; region: string; server_time: string; node_version: string;
  deployment: { id: string; url: string; branch: string; commit_sha: string; commit_message: string; commit_author: string };
  rollback_instructions: string[];
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
interface BackupRecord {
  id: string; backup_type: string; status: string; provider: string; coverage: string | null;
  size_bytes: number | null; completed_at: string | null; verified_at: string | null; notes: string | null; created_at: string;
}
interface DeployRecord {
  id: string; app_version: string; commit_sha: string | null; commit_message: string | null;
  commit_author: string | null; branch: string | null; environment: string; status: string; deployed_at: string; notes: string | null;
}
interface RoleRecord { id: string; name: string; display_name: string; hierarchy_level: number; is_system_role: boolean; description: string; }
interface UserRoleRecord { id: string; auth_user_id: string; role_id: string; is_active: boolean; created_at: string; roles: { name: string; display_name: string } | null; }

interface ContentRecord {
  id: string;
  title?: string;
  question_text?: string;
  subject_code?: string;
  subject?: string;
  grade?: string;
  chapter_number?: number;
  topic_order?: number;
  difficulty?: string;
  is_active?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  rollout_percentage: number | null;
  target_institutions: string[];
  target_roles: string[];
  target_environments: string[];
  description: string | null;
  created_at: string;
  updated_at: string | null;
}

interface FailedJob {
  task_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface SupportActivityData {
  quiz_sessions: { id: string }[];
  chat_sessions: { id: string }[];
  daily_usage: { date: string }[];
}

interface SupportFailedJobsData {
  data: FailedJob[];
  total: number;
}

interface InstitutionRecord {
  id: string;
  name: string;
  board: string;
  city?: string;
  state?: string;
  principal_name?: string;
  email?: string;
  phone?: string;
  max_students?: number;
  max_teachers?: number;
  subscription_plan?: string;
  is_active?: boolean;
  created_at?: string;
}

interface AnalyticsData {
  engagement: { date: string; signups: number; quizzes: number; chats: number }[];
  popular_subjects: { subject: string; count: number }[];
  revenue: { plan: string; count: number }[];
  retention: { period: string; count: number }[];
  content_stats: { chapters: number; topics: number; questions: number };
  top_students: { id: string; name: string; email: string; grade: string; xp_total: number; streak_days: number }[];
}

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
  const [logActionFilter, setLogActionFilter] = useState('');
  const [logEntityFilter, setLogEntityFilter] = useState('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportStatus, setReportStatus] = useState('');
  const [content, setContent] = useState<ContentRecord[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentType, setContentType] = useState('chapters');
  const [contentPage, setContentPage] = useState(1);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [showContentForm, setShowContentForm] = useState(false);
  const [contentForm, setContentForm] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [newFlagName, setNewFlagName] = useState('');
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null);
  const [flagScopeRoles, setFlagScopeRoles] = useState('');
  const [flagScopeEnvs, setFlagScopeEnvs] = useState('');
  const [supportAction, setSupportAction] = useState('failed_jobs');
  const [supportActivityData, setSupportActivityData] = useState<SupportActivityData | null>(null);
  const [supportJobsData, setSupportJobsData] = useState<SupportFailedJobsData | null>(null);
  const [supportUserId, setSupportUserId] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [obsData, setObsData] = useState<ObsData | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deployHistory, setDeployHistory] = useState<DeployRecord[]>([]);
  const [allRoles, setAllRoles] = useState<RoleRecord[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>([]);
  const [userRolesTotal, setUserRolesTotal] = useState(0);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRoleName, setAssignRoleName] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [institutionTotal, setInstitutionTotal] = useState(0);
  const [institutionPage, setInstitutionPage] = useState(1);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('');
  const [supabase] = useState(() =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')
  );

  // Get Supabase session token for API calls
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAccessToken(session.access_token);
      } else {
        window.location.href = '/super-admin/login';
      }
    };
    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { access_token: string } | null) => {
      if (session) {
        setAccessToken(session.access_token);
      } else {
        window.location.href = '/super-admin/login';
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const h = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  }), [accessToken]);

  // ── Data fetchers ──
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, deployRes, obsRes, backupRes, deployHistRes] = await Promise.all([
        fetch('/api/super-admin/stats', { headers: h() }),
        fetch('/api/super-admin/deploy', { headers: h() }),
        fetch('/api/super-admin/observability', { headers: h() }),
        fetch('/api/super-admin/platform-ops?action=backups', { headers: h() }),
        fetch('/api/super-admin/platform-ops?action=deployments&limit=5', { headers: h() }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (deployRes.ok) setDeployInfo(await deployRes.json());
      if (obsRes.ok) setObsData(await obsRes.json());
      if (backupRes.ok) { const d = await backupRes.json(); setBackups(d.data || []); }
      if (deployHistRes.ok) { const d = await deployHistRes.json(); setDeployHistory(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [h]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
      if (userSearch) p.set('search', userSearch);
      const res = await fetch(`/api/super-admin/users?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setUsers(d.data || []); setUserTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, userRole, userPage, userSearch]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(logPage), limit: '25' });
      if (logActionFilter) p.set('action_filter', logActionFilter);
      if (logEntityFilter) p.set('entity_filter', logEntityFilter);
      if (logDateFrom) p.set('date_from', logDateFrom);
      if (logDateTo) p.set('date_to', logDateTo);
      const res = await fetch(`/api/super-admin/logs?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setLogs(d.data || []); setLogTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, logPage, logActionFilter, logEntityFilter, logDateFrom, logDateTo]);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type: contentType, page: String(contentPage), limit: '25' });
      const res = await fetch(`/api/super-admin/content?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setContent(d.data || []); setContentTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, contentType, contentPage]);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/super-admin/analytics', { headers: h() });
      if (res.ok) setAnalyticsData(await res.json());
    } catch { /* */ }
    setLoading(false);
  }, [h]);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/super-admin/feature-flags', { headers: h() });
      if (res.ok) { const d = await res.json(); setFlags(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [h]);

  const toggleFlag = async (flag: FeatureFlag) => {
    await fetch('/api/super-admin/feature-flags', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ id: flag.id, updates: { enabled: !flag.enabled } }),
    });
    fetchFlags();
  };

  const createFlag = async () => {
    if (!newFlagName.trim()) return;
    await fetch('/api/super-admin/feature-flags', {
      method: 'POST', headers: h(),
      body: JSON.stringify({ name: newFlagName.trim(), enabled: false }),
    });
    setNewFlagName('');
    fetchFlags();
  };

  const saveFlagScoping = async (flagId: string) => {
    const roles = flagScopeRoles.split(',').map(s => s.trim()).filter(Boolean);
    const envs = flagScopeEnvs.split(',').map(s => s.trim()).filter(Boolean);
    await fetch('/api/super-admin/feature-flags', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ id: flagId, updates: { target_roles: roles, target_environments: envs } }),
    });
    setEditingFlagId(null);
    fetchFlags();
  };

  const deleteFlag = async (flag: FeatureFlag) => {
    if (!confirm(`Delete flag "${flag.name}"?`)) return;
    await fetch('/api/super-admin/feature-flags', {
      method: 'DELETE', headers: h(),
      body: JSON.stringify({ id: flag.id }),
    });
    fetchFlags();
  };

  const fetchSupport = useCallback(async (action?: string, params?: Record<string, string>) => {
    setLoading(true);
    try {
      const a = action || supportAction;
      const p = new URLSearchParams({ action: a, ...params });
      const res = await fetch(`/api/super-admin/support?${p}`, { headers: h() });
      if (res.ok) {
        const data = await res.json();
        if (a === 'user_activity') setSupportActivityData(data as SupportActivityData);
        else if (a === 'failed_jobs') setSupportJobsData(data as SupportFailedJobsData);
      }
    } catch { /* */ }
    setLoading(false);
  }, [h, supportAction]);

  const supportPost = async (action: string, body: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/super-admin/support?action=${action}`, {
        method: 'POST', headers: h(), body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) alert(d.message || 'Action completed');
      else alert(d.error || 'Action failed');
    } catch { alert('Request failed'); }
    setLoading(false);
  };

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, urRes] = await Promise.all([
        fetch('/api/super-admin/roles?action=roles', { headers: h() }),
        fetch('/api/super-admin/roles?action=user_roles', { headers: h() }),
      ]);
      if (rolesRes.ok) { const d = await rolesRes.json(); setAllRoles(d.data || []); }
      if (urRes.ok) { const d = await urRes.json(); setUserRoles(d.data || []); setUserRolesTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h]);

  const assignRole = async () => {
    if (!assignUserId || !assignRoleName) { alert('User ID and role name required'); return; }
    try {
      const res = await fetch('/api/super-admin/roles', { method: 'POST', headers: h(), body: JSON.stringify({ auth_user_id: assignUserId, role_name: assignRoleName }) });
      const d = await res.json();
      if (!res.ok) { alert(d.error || 'Assign failed'); return; }
      setAssignUserId(''); setAssignRoleName(''); fetchRoles();
    } catch { alert('Assign failed'); }
  };

  const revokeRole = async (userRoleId: string) => {
    if (!confirm('Revoke this role assignment?')) return;
    try {
      await fetch('/api/super-admin/roles', { method: 'DELETE', headers: h(), body: JSON.stringify({ user_role_id: userRoleId }) });
      fetchRoles();
    } catch { alert('Revoke failed'); }
  };

  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(institutionPage), limit: '25' });
      const res = await fetch(`/api/super-admin/institutions?${p}`, { headers: h() });
      if (res.ok) { const d = await res.json(); setInstitutions(d.data || []); setInstitutionTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [h, institutionPage]);

  const toggleInstitution = async (inst: InstitutionRecord) => {
    await fetch('/api/super-admin/institutions', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ id: inst.id, updates: { is_active: !inst.is_active } }),
    });
    fetchInstitutions();
  };

  const createContent = async () => {
    const typeMap: Record<string, string> = { chapters: 'chapter', topics: 'topic', questions: 'question' };
    try {
      const res = await fetch('/api/super-admin/content', {
        method: 'POST', headers: h(),
        body: JSON.stringify({ type: typeMap[contentType], data: contentForm }),
      });
      if (res.ok) { setShowContentForm(false); setContentForm({}); fetchContent(); }
      else { const e = await res.json(); alert(e.error || 'Failed to create'); }
    } catch { alert('Failed to create content'); }
  };

  const toggleContent = async (item: ContentRecord) => {
    const typeMap: Record<string, string> = { chapters: 'chapter', topics: 'topic', questions: 'question' };
    await fetch('/api/super-admin/content', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ type: typeMap[contentType], id: item.id, updates: { is_active: !item.is_active } }),
    });
    fetchContent();
  };

  useEffect(() => {
    if (!accessToken) return;
    if (activeTab === 'dashboard') fetchStats();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'roles') fetchRoles();
    if (activeTab === 'content') fetchContent();
    if (activeTab === 'analytics') fetchAnalytics();
    if (activeTab === 'flags') fetchFlags();
    if (activeTab === 'support') fetchSupport();
    if (activeTab === 'institutions') fetchInstitutions();
    if (activeTab === 'logs') fetchLogs();
  }, [accessToken, activeTab, fetchStats, fetchUsers, fetchRoles, fetchContent, fetchAnalytics, fetchFlags, fetchSupport, fetchInstitutions, fetchLogs]);

  // ── Actions ──
  const toggleUser = async (user: UserRecord) => {
    const table = user.role === 'teacher' ? 'teachers' : user.role === 'parent' ? 'guardians' : 'students';
    await fetch('/api/super-admin/users', {
      method: 'PATCH', headers: h(),
      body: JSON.stringify({ user_id: user.id, table, updates: { is_active: !user.is_active } }),
    });
    fetchUsers();
  };

  const downloadReport = async (type: string, format: string) => {
    setReportStatus(`Generating ${type} report...`);
    try {
      const res = await fetch(`/api/super-admin/reports?type=${type}&format=${format}`, { headers: h() });
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

  if (!accessToken) {
    return <div style={S.center}><p style={{ color: '#888' }}>Loading session...</p></div>;
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'roles', label: 'Roles', icon: '🔐' },
    { key: 'content', label: 'Content', icon: '📚' },
    { key: 'analytics', label: 'Analytics', icon: '📈' },
    { key: 'flags', label: 'Flags', icon: '🚩' },
    { key: 'institutions', label: 'Schools', icon: '🏫' },
    { key: 'support', label: 'Support', icon: '🛠' },
    { key: 'reports', label: 'Reports', icon: '📋' },
    { key: 'logs', label: 'Audit Logs', icon: '🔍' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#fff', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* ── Header ── */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#000' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>ALFANUMRIK</div>
            <div style={{ fontSize: 9, color: '#666', letterSpacing: 2, textTransform: 'uppercase' }}>Control Panel</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {adminName && <span style={{ fontSize: 11, color: '#888' }}>{adminName}</span>}
          <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/super-admin/login'; }}
            style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #333', background: 'transparent', color: '#888', fontSize: 10, cursor: 'pointer' }}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav style={{ padding: '0 20px', borderBottom: '1px solid #222', display: 'flex', gap: 0, background: '#000', overflowX: 'auto' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '10px 16px', fontSize: 11, fontWeight: activeTab === tab.key ? 700 : 400,
            color: activeTab === tab.key ? '#fff' : '#666', background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.key ? '2px solid #fff' : '2px solid transparent',
            cursor: 'pointer', letterSpacing: 0.5, whiteSpace: 'nowrap',
          }}>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main style={{ padding: '20px', maxWidth: 1400, margin: '0 auto' }}>
        {loading && <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Loading...</div>}

        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div>
            {stats ? (
              <>
                {/* Platform Totals */}
                <div style={{ marginBottom: 28 }}>
                  <h2 style={S.h2}>Platform Overview</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Students', value: stats.totals.students, icon: '🎓', color: '#fff' },
                      { label: 'Teachers', value: stats.totals.teachers, icon: '👩‍🏫', color: '#2563EB' },
                      { label: 'Parents', value: stats.totals.parents, icon: '👨‍👩‍👧', color: '#aaa' },
                      { label: 'Quiz Sessions', value: stats.totals.quiz_sessions, icon: '⚡', color: '#aaa' },
                      { label: 'Chat Sessions', value: stats.totals.chat_sessions, icon: '🦊', color: '#fff' },
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
                          <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{v >= 0 ? v : '—'}</span>
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
                            <span style={{ fontSize: 20, fontWeight: 800, color: '#aaa' }}>{v >= 0 ? v : '—'}</span>
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
                  <button onClick={fetchStats} style={{ ...S.quickBtn, color: '#fff', borderColor: '#444' }}>↻ Refresh</button>
                </div>

                {/* Observability */}
                {obsData && (
                  <div style={{ marginTop: 28 }}>
                    <h2 style={S.h2}>Platform Health</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                      <div style={{ ...S.card, borderLeft: `3px solid ${obsData.health.status === 'healthy' ? '#fff' : '#666'}` }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: obsData.health.status === 'healthy' ? '#fff' : '#666' }}>
                          {obsData.health.status === 'healthy' ? '● Healthy' : '● Degraded'}
                        </div>
                        <div style={{ fontSize: 10, color: '#888' }}>System Status</div>
                      </div>
                      <div style={{ ...S.card, borderLeft: '3px solid #333' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#aaa' }}>{obsData.users.active_24h}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Active Today</div>
                      </div>
                      <div style={{ ...S.card, borderLeft: '3px solid #333' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#aaa' }}>{obsData.users.active_7d}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Active 7 Days</div>
                      </div>
                      <div style={{ ...S.card, borderLeft: `3px solid ${obsData.jobs.failed > 0 ? '#fff' : '#666'}` }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: obsData.jobs.failed > 0 ? '#fff' : '#666' }}>{obsData.jobs.failed}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Failed Jobs</div>
                      </div>
                      <div style={{ ...S.card, borderLeft: '3px solid #333' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#aaa' }}>{obsData.feature_flags.enabled}/{obsData.feature_flags.total}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Flags Enabled</div>
                      </div>
                      <div style={{ ...S.card, borderLeft: '3px solid #333' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{obsData.cache.size}</div>
                        <div style={{ fontSize: 10, color: '#888' }}>Cache Entries</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Deployment */}
                {deployInfo && (
                  <div style={{ marginTop: 16 }}>
                    <h2 style={S.h2}>Current Deployment</h2>
                    <div style={{ ...S.card, marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Version</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 2 }}>{deployInfo.app_version}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Environment</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: deployInfo.environment === 'production' ? '#fff' : '#aaa', marginTop: 2 }}>
                            {deployInfo.environment}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Branch</div>
                          <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>{deployInfo.deployment.branch}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Commit</div>
                          <code style={{ fontSize: 11, color: '#aaa', marginTop: 2, display: 'block' }}>
                            {deployInfo.deployment.commit_sha.slice(0, 10)}
                          </code>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Author</div>
                          <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>{deployInfo.deployment.commit_author}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Region</div>
                          <div style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>{deployInfo.region}</div>
                        </div>
                      </div>
                      {deployInfo.deployment.commit_message !== 'unknown' && (
                        <div style={{ marginTop: 12, padding: '8px 12px', background: '#000', borderRadius: 6, fontSize: 11, color: '#888' }}>
                          {deployInfo.deployment.commit_message}
                        </div>
                      )}
                    </div>

                    <details style={{ marginBottom: 16 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888', fontWeight: 600 }}>Rollback Instructions</summary>
                      <div style={{ ...S.card, marginTop: 8 }}>
                        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#aaa', lineHeight: 2 }}>
                          {deployInfo.rollback_instructions.map((step, i) => <li key={i}>{step}</li>)}
                        </ol>
                      </div>
                    </details>
                  </div>
                )}

                {/* Backup Status */}
                <div style={{ marginTop: 16 }}>
                  <h2 style={S.h2}>Backup & Restore</h2>
                  {backups.length === 0 ? (
                    <div style={{ ...S.card, color: '#555', fontSize: 12 }}>No backup records found. Verify via Supabase dashboard.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {backups.map(b => {
                        const statusColor = b.status === 'success' ? '#fff' : b.status === 'failed' ? '#666' : b.status === 'unverified' ? '#aaa' : '#555';
                        return (
                          <div key={b.id} style={{ ...S.card, borderLeft: `3px solid ${statusColor}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 700, color: statusColor, textTransform: 'capitalize' }}>{b.status}</span>
                                <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>{b.backup_type} — {b.provider}</span>
                              </div>
                              <div style={{ fontSize: 10, color: '#555' }}>
                                {b.completed_at ? new Date(b.completed_at).toLocaleString() : b.verified_at ? `Verified ${new Date(b.verified_at).toLocaleDateString()}` : 'Not verified'}
                              </div>
                            </div>
                            {b.coverage && <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{b.coverage}</div>}
                            {b.notes && <div style={{ fontSize: 10, color: '#555', marginTop: 2, fontStyle: 'italic' }}>{b.notes}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888', fontWeight: 600 }}>Restore Checklist</summary>
                    <div style={{ ...S.card, marginTop: 8 }}>
                      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#aaa', lineHeight: 2 }}>
                        <li>Confirm the issue requires restore (not just rollback)</li>
                        <li>Pause Edge Functions from Supabase dashboard</li>
                        <li>Go to Supabase → Project Settings → Database → Backups</li>
                        <li>Select the most recent backup before the issue</li>
                        <li>Restore to a new branch or apply Point-in-Time Recovery</li>
                        <li>Verify data integrity on restored state</li>
                        <li>Re-enable Edge Functions</li>
                        <li>Update backup_status record via admin Support tools</li>
                      </ol>
                    </div>
                  </details>
                </div>

                {/* Deployment History */}
                {deployHistory.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h2 style={S.h2}>Recent Deployments</h2>
                    <div style={{ overflowX: 'auto' }}>
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
                              <td style={S.td}><span style={{ fontWeight: 700, color: '#fff' }}>{d.app_version}</span></td>
                              <td style={S.td}>{d.branch || '—'}</td>
                              <td style={S.td}>
                                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                                  background: d.environment === 'production' ? '#111' : '#0a0a0a',
                                  color: d.environment === 'production' ? '#fff' : '#aaa' }}>
                                  {d.environment}
                                </span>
                              </td>
                              <td style={S.td}>
                                <span style={{ fontSize: 10, color: d.status === 'success' ? '#fff' : d.status === 'failed' ? '#666' : '#aaa' }}>
                                  {d.status}
                                </span>
                              </td>
                              <td style={{ ...S.td, fontSize: 10 }}><code>{(d.commit_sha || '').slice(0, 8)}</code></td>
                              <td style={{ ...S.td, fontSize: 11 }}>{new Date(d.deployed_at).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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

        {/* Users */}
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
                          <td style={S.td}><span style={{ color: '#aaa' }}>{u.xp_total ?? 0}</span></td>
                          <td style={S.td}>
                            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: u.subscription_plan === 'premium' ? '#111' : u.subscription_plan === 'basic' ? '#111' : '#0a0a0a',
                              color: u.subscription_plan === 'premium' ? '#fff' : u.subscription_plan === 'basic' ? '#aaa' : '#666',
                            }}>{u.subscription_plan || 'free'}</span>
                          </td>
                        </>
                      )}
                      {userRole === 'teacher' && <td style={S.td}>{u.school_name || '—'}</td>}
                      <td style={S.td}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: u.is_active !== false ? '#111' : '#0a0a0a',
                          color: u.is_active !== false ? '#fff' : '#666',
                        }}>{u.is_active !== false ? 'Active' : 'Banned'}</span>
                      </td>
                      <td style={{ ...S.td, fontSize: 11 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                      <td style={S.td}>
                        <button onClick={() => toggleUser(u)} style={{
                          ...S.actionBtn,
                          color: u.is_active !== false ? '#888' : '#fff',
                          borderColor: u.is_active !== false ? '#444' : '#444',
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

        {/* Roles */}
        {activeTab === 'roles' && (
          <div>
            <h2 style={S.h2}>Role Management</h2>

            {/* Assign Role */}
            <div style={{ ...S.card, marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 10 }}>Assign Role to User</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={assignUserId} onChange={e => setAssignUserId(e.target.value)} placeholder="auth_user_id (UUID)"
                  style={{ ...S.searchInput, flex: 1, minWidth: 200 }} />
                <select value={assignRoleName} onChange={e => setAssignRoleName(e.target.value)} style={S.filterBtn}>
                  <option value="">Select role</option>
                  {Array.isArray(allRoles) && allRoles.map(r => r && r.id ? <option key={r.id} value={r.name}>{r.display_name || r.name}</option> : null)}
                </select>
                <button onClick={assignRole} style={{ ...S.quickBtn, background: '#111', color: '#aaa', borderColor: '#333' }}>Assign</button>
              </div>
            </div>

            {/* Roles Table */}
            <h2 style={S.h2}>Available Roles ({Array.isArray(allRoles) ? allRoles.length : 0})</h2>
            {Array.isArray(allRoles) && allRoles.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10, marginBottom: 24 }}>
                {allRoles.map(r => r && r.id ? (
                  <div key={r.id} style={{ ...S.card, borderLeft: `3px solid ${(r.hierarchy_level || 0) >= 90 ? '#fff' : (r.hierarchy_level || 0) >= 50 ? '#aaa' : '#666'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{r.display_name || r.name || '—'}</div>
                        <code style={{ fontSize: 10, color: '#888' }}>{r.name || '—'}</code>
                      </div>
                      <span style={{ fontSize: 10, color: '#555', background: '#1a1a1a', padding: '2px 6px', borderRadius: 4 }}>Lv {r.hierarchy_level ?? '?'}</span>
                    </div>
                    {r.description && <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{r.description}</div>}
                  </div>
                ) : null)}
              </div>
            ) : (
              <div style={{ ...S.card, marginBottom: 24, textAlign: 'center', color: '#555', padding: 24 }}>
                {loading ? 'Loading roles...' : 'No roles found. Check API connection.'}
              </div>
            )}

            {/* User Role Assignments */}
            <h2 style={S.h2}>Current Assignments ({userRolesTotal})</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>User ID</th>
                    <th style={S.th}>Role</th>
                    <th style={S.th}>Active</th>
                    <th style={S.th}>Assigned</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(!Array.isArray(userRoles) || userRoles.length === 0) && (
                    <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>
                      {loading ? 'Loading...' : 'No role assignments found'}
                    </td></tr>
                  )}
                  {Array.isArray(userRoles) && userRoles.map(ur => ur && ur.id ? (
                    <tr key={ur.id}>
                      <td style={{ ...S.td, fontSize: 10 }}><code>{ur.auth_user_id ? ur.auth_user_id.slice(0, 12) + '...' : '—'}</code></td>
                      <td style={S.td}><span style={{ color: '#aaa', fontWeight: 600 }}>{ur.roles?.display_name || ur.roles?.name || '—'}</span></td>
                      <td style={S.td}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: ur.is_active ? '#111' : '#0a0a0a', color: ur.is_active ? '#fff' : '#666' }}>
                          {ur.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontSize: 11 }}>{ur.created_at ? new Date(ur.created_at).toLocaleDateString() : '—'}</td>
                      <td style={S.td}>
                        <button onClick={() => revokeRole(ur.id)} style={{ ...S.actionBtn, color: '#888', borderColor: '#333', fontSize: 10 }}>Revoke</button>
                      </td>
                    </tr>
                  ) : null)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Content */}
        {activeTab === 'content' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['chapters', 'topics', 'questions'].map(t => (
                  <button key={t} onClick={() => { setContentType(t); setContentPage(1); }}
                    style={{ ...S.filterBtn, ...(contentType === t ? S.filterActive : {}) }}>
                    {t === 'chapters' ? '📖' : t === 'topics' ? '📝' : '❓'} {t}
                  </button>
                ))}
              </div>
              <button onClick={() => { setShowContentForm(!showContentForm); setContentForm({}); }}
                style={{ ...S.quickBtn, background: '#111', color: '#aaa', borderColor: '#333' }}>
                {showContentForm ? '✕ Cancel' : '+ Add New'}
              </button>
            </div>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{contentTotal} {contentType} found</div>

            {/* Create Form */}
            {showContentForm && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 12 }}>
                  Add New {contentType === 'chapters' ? 'Chapter' : contentType === 'topics' ? 'Topic' : 'Question'}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {contentType === 'chapters' && (
                    <>
                      <input placeholder="Title *" value={contentForm.title || ''} onChange={e => setContentForm(f => ({ ...f, title: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Title (Hindi)" value={contentForm.title_hi || ''} onChange={e => setContentForm(f => ({ ...f, title_hi: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Subject code (math, science...)" value={contentForm.subject_code || ''} onChange={e => setContentForm(f => ({ ...f, subject_code: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Grade (Grade 10)" value={contentForm.grade || ''} onChange={e => setContentForm(f => ({ ...f, grade: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Chapter number" type="number" value={contentForm.chapter_number || ''} onChange={e => setContentForm(f => ({ ...f, chapter_number: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Description" value={contentForm.description || ''} onChange={e => setContentForm(f => ({ ...f, description: e.target.value }))} style={S.searchInput} />
                    </>
                  )}
                  {contentType === 'topics' && (
                    <>
                      <input placeholder="Chapter ID *" value={contentForm.chapter_id || ''} onChange={e => setContentForm(f => ({ ...f, chapter_id: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Title *" value={contentForm.title || ''} onChange={e => setContentForm(f => ({ ...f, title: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Title (Hindi)" value={contentForm.title_hi || ''} onChange={e => setContentForm(f => ({ ...f, title_hi: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Topic order" type="number" value={contentForm.topic_order || ''} onChange={e => setContentForm(f => ({ ...f, topic_order: e.target.value }))} style={S.searchInput} />
                    </>
                  )}
                  {contentType === 'questions' && (
                    <>
                      <input placeholder="Subject (math, science...)" value={contentForm.subject || ''} onChange={e => setContentForm(f => ({ ...f, subject: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Grade (Grade 10)" value={contentForm.grade || ''} onChange={e => setContentForm(f => ({ ...f, grade: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Chapter title" value={contentForm.chapter_title || ''} onChange={e => setContentForm(f => ({ ...f, chapter_title: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Difficulty (easy/medium/hard)" value={contentForm.difficulty || ''} onChange={e => setContentForm(f => ({ ...f, difficulty: e.target.value }))} style={S.searchInput} />
                    </>
                  )}
                </div>
                {contentType === 'topics' && (
                  <textarea placeholder="Concept text (supports markdown)" value={contentForm.concept_text || ''}
                    onChange={e => setContentForm(f => ({ ...f, concept_text: e.target.value }))}
                    style={{ ...S.searchInput, width: '100%', minHeight: 120, marginTop: 10, resize: 'vertical' }} />
                )}
                {contentType === 'questions' && (
                  <>
                    <textarea placeholder="Question text *" value={contentForm.question_text || ''}
                      onChange={e => setContentForm(f => ({ ...f, question_text: e.target.value }))}
                      style={{ ...S.searchInput, width: '100%', minHeight: 60, marginTop: 10, resize: 'vertical' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      <input placeholder="Option A *" value={contentForm.option_a || ''} onChange={e => setContentForm(f => ({ ...f, option_a: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Option B *" value={contentForm.option_b || ''} onChange={e => setContentForm(f => ({ ...f, option_b: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Option C *" value={contentForm.option_c || ''} onChange={e => setContentForm(f => ({ ...f, option_c: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Option D *" value={contentForm.option_d || ''} onChange={e => setContentForm(f => ({ ...f, option_d: e.target.value }))} style={S.searchInput} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      <input placeholder="Correct option (0=A, 1=B, 2=C, 3=D)" type="number" value={contentForm.correct_option || ''}
                        onChange={e => setContentForm(f => ({ ...f, correct_option: e.target.value }))} style={S.searchInput} />
                      <input placeholder="Explanation" value={contentForm.explanation || ''} onChange={e => setContentForm(f => ({ ...f, explanation: e.target.value }))} style={S.searchInput} />
                    </div>
                  </>
                )}
                <button onClick={createContent} style={{ ...S.quickBtn, marginTop: 12, background: '#111', color: '#aaa', borderColor: '#333' }}>
                  Save {contentType === 'chapters' ? 'Chapter' : contentType === 'topics' ? 'Topic' : 'Question'}
                </button>
              </div>
            )}

            {/* Content Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    {contentType === 'chapters' && <><th style={S.th}>#</th><th style={S.th}>Title</th><th style={S.th}>Subject</th><th style={S.th}>Grade</th></>}
                    {contentType === 'topics' && <><th style={S.th}>#</th><th style={S.th}>Title</th><th style={S.th}>Chapter ID</th></>}
                    {contentType === 'questions' && <><th style={S.th}>Question</th><th style={S.th}>Subject</th><th style={S.th}>Grade</th><th style={S.th}>Difficulty</th></>}
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {content.length === 0 && (
                    <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No {contentType} found. Add some!</td></tr>
                  )}
                  {content.map(item => (
                    <tr key={item.id}>
                      {contentType === 'chapters' && (
                        <>
                          <td style={S.td}>{item.chapter_number as number ?? '—'}</td>
                          <td style={S.td}><strong>{item.title || '—'}</strong></td>
                          <td style={S.td}>{item.subject_code || '—'}</td>
                          <td style={S.td}>{item.grade || '—'}</td>
                        </>
                      )}
                      {contentType === 'topics' && (
                        <>
                          <td style={S.td}>{item.topic_order as number ?? '—'}</td>
                          <td style={S.td}><strong>{item.title || '—'}</strong></td>
                          <td style={{ ...S.td, fontSize: 10 }}><code>{(item.chapter_id as string)?.slice(0, 8) || '—'}</code></td>
                        </>
                      )}
                      {contentType === 'questions' && (
                        <>
                          <td style={{ ...S.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.question_text || '—'}</td>
                          <td style={S.td}>{item.subject || '—'}</td>
                          <td style={S.td}>{item.grade || '—'}</td>
                          <td style={S.td}>{item.difficulty || '—'}</td>
                        </>
                      )}
                      <td style={S.td}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: item.is_active !== false ? '#111' : '#0a0a0a',
                          color: item.is_active !== false ? '#fff' : '#666',
                        }}>{item.is_active !== false ? 'Active' : 'Disabled'}</span>
                      </td>
                      <td style={S.td}>
                        <button onClick={() => toggleContent(item)} style={{
                          ...S.actionBtn,
                          color: item.is_active !== false ? '#888' : '#fff',
                          borderColor: item.is_active !== false ? '#444' : '#444',
                        }}>{item.is_active !== false ? 'Disable' : 'Enable'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <button disabled={contentPage <= 1} onClick={() => setContentPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {contentPage} of {Math.max(1, Math.ceil(contentTotal / 25))}</span>
              <button disabled={content.length < 25} onClick={() => setContentPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* Analytics */}
        {activeTab === 'analytics' && (
          <div>
            {analyticsData ? (
              <>
                {/* Content Stats */}
                <h2 style={S.h2}>Content Overview</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
                  {[
                    { label: 'Chapters', value: analyticsData.content_stats.chapters, icon: '📖', color: '#aaa' },
                    { label: 'Topics', value: analyticsData.content_stats.topics, icon: '📝', color: '#aaa' },
                    { label: 'Questions', value: analyticsData.content_stats.questions, icon: '❓', color: '#aaa' },
                  ].map(s => (
                    <div key={s.label} style={{ ...S.card, borderLeft: `3px solid ${s.color}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value >= 0 ? s.value : '—'}</span>
                        <span style={{ fontSize: 24 }}>{s.icon}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Retention */}
                <h2 style={S.h2}>Student Retention</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
                  {analyticsData.retention.map(r => (
                    <div key={r.period} style={{ ...S.card, borderLeft: '3px solid #333' }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: '#aaa' }}>{r.count}</span>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Active {r.period}</div>
                    </div>
                  ))}
                </div>

                {/* Revenue breakdown */}
                <h2 style={S.h2}>Subscription Plans</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
                  {analyticsData.revenue.map(r => {
                    const planColors: Record<string, string> = { free: '#555', starter_monthly: '#888', starter_yearly: '#888', pro_monthly: '#aaa', pro_yearly: '#aaa', ultimate_monthly: '#fff', ultimate_yearly: '#fff' };
                    return (
                      <div key={r.plan} style={{ ...S.card, borderLeft: `3px solid ${planColors[r.plan] || '#555'}` }}>
                        <span style={{ fontSize: 24, fontWeight: 800, color: planColors[r.plan] || '#888' }}>{r.count}</span>
                        <div style={{ fontSize: 10, color: '#888', marginTop: 4, textTransform: 'capitalize' }}>{r.plan.replace(/_/g, ' ')}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Popular Subjects */}
                <h2 style={S.h2}>Popular Subjects (by quiz count)</h2>
                <div style={{ ...S.card, marginBottom: 28 }}>
                  {analyticsData.popular_subjects.length === 0 ? (
                    <div style={{ color: '#555', fontSize: 12 }}>No quiz data yet</div>
                  ) : analyticsData.popular_subjects.slice(0, 10).map(s => {
                    const maxCount = analyticsData.popular_subjects[0]?.count || 1;
                    return (
                      <div key={s.subject} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: '#aaa', width: 100, textTransform: 'capitalize' }}>{s.subject}</span>
                        <div style={{ flex: 1, height: 16, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${(s.count / maxCount) * 100}%`, height: '100%', background: '#fff', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', width: 40, textAlign: 'right' }}>{s.count}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Top Students */}
                <h2 style={S.h2}>Top Students by XP</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Rank</th>
                        <th style={S.th}>Name</th>
                        <th style={S.th}>Grade</th>
                        <th style={S.th}>XP</th>
                        <th style={S.th}>Streak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.top_students.map((s, i) => (
                        <tr key={s.id}>
                          <td style={S.td}><span style={{ color: i < 3 ? '#fff' : '#666', fontWeight: 700 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span></td>
                          <td style={S.td}><strong>{s.name}</strong></td>
                          <td style={S.td}>{s.grade || '—'}</td>
                          <td style={S.td}><span style={{ color: '#aaa', fontWeight: 700 }}>{s.xp_total}</span></td>
                          <td style={S.td}><span style={{ color: '#888' }}>{s.streak_days}d</span></td>
                        </tr>
                      ))}
                      {analyticsData.top_students.length === 0 && (
                        <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No students yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 30-day Engagement */}
                <h2 style={{ ...S.h2, marginTop: 28 }}>30-Day Engagement</h2>
                <div style={{ ...S.card, overflowX: 'auto' }}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120, minWidth: 600 }}>
                    {analyticsData.engagement.map(day => {
                      const total = day.signups + day.quizzes + day.chats;
                      const maxTotal = Math.max(...analyticsData.engagement.map(d => d.signups + d.quizzes + d.chats), 1);
                      return (
                        <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} title={`${day.date}: ${day.signups} signups, ${day.quizzes} quizzes, ${day.chats} chats`}>
                          <div style={{ width: '100%', background: '#fff', borderRadius: 2, height: `${(total / maxTotal) * 100}px`, minHeight: total > 0 ? 2 : 0 }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: '#555' }}>{analyticsData.engagement[0]?.date}</span>
                    <span style={{ fontSize: 9, color: '#555' }}>{analyticsData.engagement[analyticsData.engagement.length - 1]?.date}</span>
                  </div>
                </div>

                <button onClick={fetchAnalytics} style={{ ...S.quickBtn, marginTop: 16 }}>↻ Refresh Analytics</button>
              </>
            ) : !loading && (
              <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
                <p>Loading analytics...</p>
                <button onClick={fetchAnalytics} style={{ ...S.quickBtn, marginTop: 12 }}>Retry</button>
              </div>
            )}
          </div>
        )}

        {/* Feature Flags */}
        {activeTab === 'flags' && (
          <div>
            <h2 style={S.h2}>Feature Flags & Kill Switches</h2>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>Control feature rollouts, emergency disables, and beta access. Toggle any flag instantly.</p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input value={newFlagName} onChange={e => setNewFlagName(e.target.value)} placeholder="New flag name (e.g. foxy_ai_enabled)"
                style={{ ...S.searchInput, flex: 1 }} onKeyDown={e => e.key === 'Enter' && createFlag()} />
              <button onClick={createFlag} style={{ ...S.quickBtn, background: '#111', color: '#aaa', borderColor: '#333' }}>+ Add Flag</button>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {flags.length === 0 && !loading && (
                <div style={{ ...S.card, textAlign: 'center', color: '#555', padding: 24 }}>No feature flags configured. Add one above.</div>
              )}
              {flags.map(flag => (
                <div key={flag.id} style={{ ...S.card }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <code style={{ fontSize: 13, fontWeight: 700, color: flag.enabled ? '#fff' : '#555' }}>{flag.name}</code>
                      {flag.description && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{flag.description}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={() => {
                        if (editingFlagId === flag.id) { setEditingFlagId(null); }
                        else { setEditingFlagId(flag.id); setFlagScopeRoles((flag.target_roles || []).join(', ')); setFlagScopeEnvs((flag.target_environments || []).join(', ')); }
                      }} style={{ ...S.actionBtn, fontSize: 10, color: '#aaa', borderColor: '#333' }}>
                        {editingFlagId === flag.id ? 'Cancel' : 'Scope'}
                      </button>
                      <button onClick={() => toggleFlag(flag)} style={{
                        padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                        background: flag.enabled ? '#fff' : '#333', color: '#fff',
                      }}>{flag.enabled ? 'ON' : 'OFF'}</button>
                      <button onClick={() => deleteFlag(flag)} style={{ ...S.actionBtn, color: '#888', borderColor: '#333', fontSize: 10 }}>Del</button>
                    </div>
                  </div>
                  {/* Scoping tags */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {flag.target_roles && flag.target_roles.length > 0 && flag.target_roles.map(r => (
                      <span key={r} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#111', color: '#aaa' }}>role:{r}</span>
                    ))}
                    {flag.target_environments && flag.target_environments.length > 0 && flag.target_environments.map(e => (
                      <span key={e} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#111', color: '#aaa' }}>env:{e}</span>
                    ))}
                    {(!flag.target_roles || flag.target_roles.length === 0) && (!flag.target_environments || flag.target_environments.length === 0) && (
                      <span style={{ fontSize: 9, color: '#555' }}>Global (all roles, all environments)</span>
                    )}
                  </div>
                  {/* Scoping editor */}
                  {editingFlagId === flag.id && (
                    <div style={{ marginTop: 10, padding: 10, background: '#000', borderRadius: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 4 }}>Target Roles (comma-separated)</label>
                          <input value={flagScopeRoles} onChange={e => setFlagScopeRoles(e.target.value)} placeholder="student, teacher, parent"
                            style={S.searchInput} />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 4 }}>Target Environments (comma-separated)</label>
                          <input value={flagScopeEnvs} onChange={e => setFlagScopeEnvs(e.target.value)} placeholder="production, staging"
                            style={S.searchInput} />
                        </div>
                      </div>
                      <button onClick={() => saveFlagScoping(flag.id)} style={{ ...S.actionBtn, marginTop: 8, color: '#aaa', borderColor: '#333', padding: '6px 16px' }}>
                        Save Scoping
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 24 }}>
              <h2 style={S.h2}>Recommended Flags</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                {['foxy_ai_enabled', 'razorpay_payments', 'quiz_module', 'simulations', 'parent_portal', 'teacher_portal', 'leaderboard', 'push_notifications', 'onboarding_flow', 'beta_features'].map(name => {
                  const exists = flags.some(f => f.name === name);
                  return (
                    <div key={name} style={{ ...S.card, opacity: exists ? 0.5 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <code style={{ fontSize: 11, color: '#aaa' }}>{name}</code>
                      {!exists && (
                        <button onClick={() => { setNewFlagName(name); createFlag(); }} style={{ ...S.actionBtn, color: '#aaa', borderColor: '#333', fontSize: 10 }}>Add</button>
                      )}
                      {exists && <span style={{ fontSize: 10, color: '#aaa' }}>Active</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Schools */}
        {activeTab === 'institutions' && (
          <div>
            <h2 style={S.h2}>School & Institution Management</h2>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>Manage onboarded schools, their admins, and subscription status.</p>

            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{institutionTotal} schools found</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>School</th>
                    <th style={S.th}>Board</th>
                    <th style={S.th}>City</th>
                    <th style={S.th}>Principal</th>
                    <th style={S.th}>Students</th>
                    <th style={S.th}>Teachers</th>
                    <th style={S.th}>Plan</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {institutions.length === 0 && (
                    <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#555', padding: 24 }}>No schools onboarded yet.</td></tr>
                  )}
                  {institutions.map(inst => (
                    <tr key={inst.id}>
                      <td style={S.td}><strong>{inst.name || '—'}</strong></td>
                      <td style={S.td}>{inst.board || '—'}</td>
                      <td style={S.td}>{inst.city || '—'}</td>
                      <td style={S.td}>{inst.principal_name || '—'}</td>
                      <td style={S.td}><span style={{ color: '#fff', fontWeight: 700 }}>{inst.max_students ?? '—'}</span></td>
                      <td style={S.td}>{inst.subscription_plan || 'free'}</td>
                      <td style={S.td}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: inst.is_active !== false ? '#111' : '#0a0a0a',
                          color: inst.is_active !== false ? '#fff' : '#666',
                        }}>{inst.is_active !== false ? 'Active' : 'Suspended'}</span>
                      </td>
                      <td style={S.td}>
                        <button onClick={() => toggleInstitution(inst)} style={{
                          ...S.actionBtn,
                          color: inst.is_active !== false ? '#888' : '#fff',
                          borderColor: inst.is_active !== false ? '#444' : '#444',
                        }}>{inst.is_active !== false ? 'Suspend' : 'Activate'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <button disabled={institutionPage <= 1} onClick={() => setInstitutionPage(p => p - 1)} style={S.pageBtn}>← Prev</button>
              <span style={{ fontSize: 12, color: '#666', padding: '6px 12px' }}>Page {institutionPage} of {Math.max(1, Math.ceil(institutionTotal / 25))}</span>
              <button disabled={institutions.length < 25} onClick={() => setInstitutionPage(p => p + 1)} style={S.pageBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* Support */}
        {activeTab === 'support' && (
          <div>
            <h2 style={S.h2}>Support & Intervention Tools</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* User Activity Lookup */}
              <div style={S.card}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 10 }}>User Activity Lookup</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={supportUserId} onChange={e => setSupportUserId(e.target.value)} placeholder="User ID"
                    style={{ ...S.searchInput, flex: 1 }} />
                  <button onClick={() => fetchSupport('user_activity', { user_id: supportUserId })}
                    style={S.quickBtn}>Lookup</button>
                </div>
                {supportActivityData && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
                    <div>Quiz sessions: {supportActivityData.quiz_sessions?.length ?? 0}</div>
                    <div>Chat sessions: {supportActivityData.chat_sessions?.length ?? 0}</div>
                  </div>
                )}
              </div>

              {/* Password Reset */}
              <div style={S.card}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 10 }}>Password Reset</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="User email"
                    style={{ ...S.searchInput, flex: 1 }} />
                  <button onClick={() => supportPost('reset_password', { email: supportEmail })}
                    style={{ ...S.quickBtn, color: '#aaa', borderColor: '#333', background: '#111' }}>Reset</button>
                </div>
              </div>

              {/* Resend Invite */}
              <div style={S.card}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 10 }}>Resend Invite</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="User email"
                    style={{ ...S.searchInput, flex: 1 }} />
                  <button onClick={() => supportPost('resend_invite', { email: supportEmail, type: 'student' })}
                    style={{ ...S.quickBtn, color: '#aaa', borderColor: '#333', background: '#111' }}>Send</button>
                </div>
              </div>

              {/* Parent-Student Links */}
              <div style={S.card}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 10 }}>Parent-Student Links</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={supportUserId} onChange={e => setSupportUserId(e.target.value)} placeholder="Student ID"
                    style={{ ...S.searchInput, flex: 1 }} />
                  <button onClick={() => fetchSupport('parent_links', { student_id: supportUserId })}
                    style={{ ...S.quickBtn, color: '#aaa', borderColor: '#333', background: '#111' }}>View</button>
                </div>
              </div>
            </div>

            {/* Failed Jobs */}
            <h2 style={S.h2}>Failed Jobs</h2>
            <button onClick={() => { setSupportAction('failed_jobs'); void fetchSupport('failed_jobs'); }}
              style={{ ...S.quickBtn, marginBottom: 12 }}>↻ Load Failed Jobs</button>

            {supportJobsData && supportJobsData.data.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
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
                    {supportJobsData.data.map((job, i) => (
                      <tr key={i}>
                        <td style={S.td}><code style={{ color: '#fff' }}>{job.task_type || '—'}</code></td>
                        <td style={S.td}>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#111', color: '#888' }}>
                            {job.status || 'failed'}
                          </span>
                        </td>
                        <td style={S.td}>{job.attempts}</td>
                        <td style={{ ...S.td, fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(job.last_error || '—').slice(0, 80)}
                        </td>
                        <td style={{ ...S.td, fontSize: 11 }}>{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Reports */}
        {activeTab === 'reports' && (
          <div>
            <h2 style={S.h2}>Download Reports</h2>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 20 }}>Export data as CSV or JSON files with timestamps. Reports include all records up to 5,000 rows.</p>

            {reportStatus && (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: reportStatus.includes('failed') ? '#2a1010' : '#0a2a0a',
                color: reportStatus.includes('failed') ? '#888' : '#fff', fontSize: 12, marginBottom: 16,
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
                    <button onClick={() => downloadReport(r.type, 'json')} style={{ ...S.dlBtn, flex: 1, background: '#1a1a2a', borderColor: '#333', color: '#aaa' }}>⬇ JSON</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit Logs */}
        {activeTab === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...S.h2, margin: 0 }}>Audit Logs</h2>
              <button onClick={() => downloadReport('audit', 'csv')} style={{ ...S.quickBtn, fontSize: 11 }}>⬇ Export CSV</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <input value={logActionFilter} onChange={e => { setLogActionFilter(e.target.value); setLogPage(1); }} placeholder="Filter by action..."
                style={S.searchInput} />
              <select value={logEntityFilter} onChange={e => { setLogEntityFilter(e.target.value); setLogPage(1); }} style={S.filterBtn}>
                <option value="">All entities</option>
                <option value="feature_flag">Feature Flag</option>
                <option value="school">School</option>
                <option value="user">User</option>
                <option value="curriculum_topics">Topic</option>
                <option value="question_bank">Question</option>
                <option value="user_roles">Role Assignment</option>
              </select>
              <input type="date" value={logDateFrom} onChange={e => { setLogDateFrom(e.target.value); setLogPage(1); }}
                style={{ ...S.searchInput, width: 140 }} />
              <input type="date" value={logDateTo} onChange={e => { setLogDateTo(e.target.value); setLogPage(1); }}
                style={{ ...S.searchInput, width: 140 }} />
              {(logActionFilter || logEntityFilter || logDateFrom || logDateTo) && (
                <button onClick={() => { setLogActionFilter(''); setLogEntityFilter(''); setLogDateFrom(''); setLogDateTo(''); setLogPage(1); }}
                  style={{ ...S.actionBtn, fontSize: 10 }}>Clear filters</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{logTotal} entries{logActionFilter || logEntityFilter || logDateFrom || logDateTo ? ' (filtered)' : ''}</div>

            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Timestamp</th>
                    <th style={S.th}>Action</th>
                    <th style={S.th}>Resource</th>
                    <th style={S.th}>IP</th>
                    <th style={S.th}>Admin ID</th>
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
                      <td style={S.td}><code style={{ color: '#fff', background: '#111', padding: '1px 6px', borderRadius: 3 }}>{l.action}</code></td>
                      <td style={S.td}>{l.entity_type}{l.entity_id ? <code style={{ color: '#888', marginLeft: 4 }}>:{l.entity_id.slice(0, 8)}</code> : ''}</td>
                      <td style={{ ...S.td, fontSize: 10 }}>{l.ip_address || '—'}</td>
                      <td style={{ ...S.td, fontSize: 10 }}><code>{l.admin_id?.slice(0, 12) || '—'}</code></td>
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

/* Styles */
const S: Record<string, React.CSSProperties> = {
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" },
  h2: { fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 2, marginBottom: 12 },
  card: { padding: 16, borderRadius: 6, border: '1px solid #222', background: '#000' },
  searchInput: { padding: '8px 12px', borderRadius: 4, border: '1px solid #333', background: '#000', color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'inherit', width: 200, boxSizing: 'border-box' as const },
  select: { padding: '8px 10px', borderRadius: 4, border: '1px solid #333', background: '#000', color: '#fff', fontSize: 12, outline: 'none' },
  filterBtn: { padding: '7px 14px', borderRadius: 4, border: '1px solid #333', background: '#000', color: '#aaa', fontSize: 12, cursor: 'pointer' },
  filterActive: { background: '#fff', color: '#000', borderColor: '#fff' },
  quickBtn: { padding: '8px 16px', borderRadius: 4, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  navBtn: { padding: '6px 14px', borderRadius: 4, border: '1px solid #333', background: '#000', color: '#aaa', fontSize: 12, cursor: 'pointer' },
  dlBtn: { padding: '8px 14px', borderRadius: 4, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #222', color: '#666', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.5 },
  td: { padding: '10px 12px', borderBottom: '1px solid #111', color: '#ccc' },
  actionBtn: { background: 'none', border: '1px solid #444', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600, color: '#ccc' },
  pageBtn: { padding: '7px 16px', borderRadius: 4, border: '1px solid #333', background: '#000', color: '#aaa', fontSize: 12, cursor: 'pointer' },
};
