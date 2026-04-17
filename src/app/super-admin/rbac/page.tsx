'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

/* ── Types ── */
interface DashboardStats {
  activeElevations: number;
  activeSessions: number;
  activeTokens: number;
}

interface ElevationRecord {
  id: string;
  user_id: string;
  role_id: string;
  granted_by: string;
  reason: string;
  status: string;
  expires_at: string;
  [key: string]: unknown;
}

interface ImpersonationRecord {
  id: string;
  admin_user_id: string;
  target_user_id: string;
  status: string;
  action_count: number;
  started_at: string;
  expires_at: string;
  [key: string]: unknown;
}

interface DelegationRecord {
  id: string;
  granter: string;
  grantee: string;
  school_id: string;
  permissions: string[];
  status: string;
  use_count: number;
  max_uses: number | null;
  expires_at: string;
  [key: string]: unknown;
}

type TabKey = 'dashboard' | 'elevations' | 'impersonation' | 'delegations';

/* ── Helpers ── */
function relativeTime(dateStr: string): string {
  if (!dateStr) return '\u2014';
  const now = Date.now();
  const target = new Date(dateStr).getTime();
  const diff = target - now;
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (absDiff < 60000) return diff >= 0 ? 'in <1m' : '<1m ago';
  if (minutes < 60) return diff >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  if (hours < 24) return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

function statusVariant(status: string): 'success' | 'danger' | 'neutral' | 'warning' | 'info' {
  switch (status) {
    case 'active': return 'success';
    case 'expired': case 'ended': return 'neutral';
    case 'revoked': case 'terminated': return 'danger';
    default: return 'neutral';
  }
}

function truncateId(id: string | undefined | null): string {
  if (!id) return '\u2014';
  return id.length > 12 ? id.slice(0, 12) + '\u2026' : id;
}

/* ── Main Content ── */
function RBACContent() {
  const { apiFetch } = useAdmin();

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [stats, setStats] = useState<DashboardStats>({ activeElevations: 0, activeSessions: 0, activeTokens: 0 });
  const [elevations, setElevations] = useState<ElevationRecord[]>([]);
  const [sessions, setSessions] = useState<ImpersonationRecord[]>([]);
  const [tokens, setTokens] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Form visibility
  const [showElevationForm, setShowElevationForm] = useState(false);
  const [showImpersonationForm, setShowImpersonationForm] = useState(false);

  // Elevation form
  const [elevUserId, setElevUserId] = useState('');
  const [elevRoleId, setElevRoleId] = useState('');
  const [elevDuration, setElevDuration] = useState('24');
  const [elevReason, setElevReason] = useState('');

  // Impersonation form
  const [impTargetId, setImpTargetId] = useState('');
  const [impReason, setImpReason] = useState('');
  const [impMaxMinutes, setImpMaxMinutes] = useState('30');

  const showMsg = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  /* ── Fetchers ── */
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/rbac?action=dashboard_stats');
      if (res.ok) {
        const d = await res.json();
        setStats(d.data || { activeElevations: 0, activeSessions: 0, activeTokens: 0 });
      }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  const fetchElevations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/rbac?action=elevations');
      if (res.ok) { const d = await res.json(); setElevations(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/rbac?action=impersonation_sessions');
      if (res.ok) { const d = await res.json(); setSessions(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/rbac?action=delegation_tokens');
      if (res.ok) { const d = await res.json(); setTokens(d.data || []); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    switch (activeTab) {
      case 'dashboard': fetchStats(); break;
      case 'elevations': fetchElevations(); break;
      case 'impersonation': fetchSessions(); break;
      case 'delegations': fetchTokens(); break;
    }
  }, [activeTab, fetchStats, fetchElevations, fetchSessions, fetchTokens]);

  /* ── Actions ── */
  const revokeElevation = async (elevationId: string) => {
    try {
      const res = await apiFetch('/api/super-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke_elevation', elevationId }),
      });
      const d = await res.json();
      if (res.ok) { showMsg('Elevation revoked', 'success'); fetchElevations(); }
      else showMsg(d.error || 'Failed to revoke', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const grantElevation = async () => {
    if (!elevUserId || !elevRoleId || !elevReason) {
      showMsg('User ID, Role ID, and Reason are required', 'error');
      return;
    }
    try {
      const res = await apiFetch('/api/super-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({
          action: 'grant_elevation',
          userId: elevUserId,
          roleId: elevRoleId,
          durationHours: Number(elevDuration) || 24,
          reason: elevReason,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg('Elevation granted', 'success');
        setElevUserId(''); setElevRoleId(''); setElevDuration('24'); setElevReason('');
        setShowElevationForm(false);
        fetchElevations();
      } else showMsg(d.error || 'Failed to grant', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const endImpersonation = async (sessionId: string) => {
    try {
      const res = await apiFetch('/api/super-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({ action: 'end_impersonation', sessionId }),
      });
      const d = await res.json();
      if (res.ok) { showMsg('Session ended', 'success'); fetchSessions(); }
      else showMsg(d.error || 'Failed to end session', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const startImpersonation = async () => {
    if (!impTargetId || !impReason) {
      showMsg('Target User ID and Reason are required', 'error');
      return;
    }
    try {
      const res = await apiFetch('/api/super-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({
          action: 'start_impersonation',
          targetUserId: impTargetId,
          reason: impReason,
          maxMinutes: Number(impMaxMinutes) || 30,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        showMsg('Impersonation started', 'success');
        setImpTargetId(''); setImpReason(''); setImpMaxMinutes('30');
        setShowImpersonationForm(false);
        fetchSessions();
      } else showMsg(d.error || 'Failed to start', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  const revokeDelegation = async (tokenId: string) => {
    try {
      const res = await apiFetch('/api/super-admin/rbac', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke_delegation', tokenId }),
      });
      const d = await res.json();
      if (res.ok) { showMsg('Delegation revoked', 'success'); fetchTokens(); }
      else showMsg(d.error || 'Failed to revoke', 'error');
    } catch { showMsg('Request failed', 'error'); }
  };

  /* ── Column Definitions ── */
  const elevationColumns: Column<ElevationRecord>[] = [
    { key: 'user_id', label: 'User ID', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.user_id)}</code> },
    { key: 'role_id', label: 'Role ID', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.role_id)}</code> },
    { key: 'granted_by', label: 'Granted By', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.granted_by)}</code> },
    { key: 'reason', label: 'Reason', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.reason || '\u2014'}</span> },
    { key: 'status', label: 'Status', render: r => <StatusBadge label={r.status} variant={statusVariant(r.status)} /> },
    { key: 'expires_at', label: 'Expires At', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{relativeTime(r.expires_at)}</span> },
    {
      key: '_actions', label: 'Actions', sortable: false, render: r =>
        r.status === 'active' ? (
          <button onClick={e => { e.stopPropagation(); revokeElevation(r.id); }} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}>
            Revoke
          </button>
        ) : <span style={{ fontSize: 12, color: colors.text3 }}>\u2014</span>,
    },
  ];

  const sessionColumns: Column<ImpersonationRecord>[] = [
    { key: 'admin_user_id', label: 'Admin User ID', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.admin_user_id)}</code> },
    { key: 'target_user_id', label: 'Target User ID', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.target_user_id)}</code> },
    { key: 'status', label: 'Status', render: r => <StatusBadge label={r.status} variant={statusVariant(r.status)} /> },
    { key: 'action_count', label: 'Action Count', render: r => <span style={{ fontWeight: 600 }}>{r.action_count ?? 0}</span> },
    { key: 'started_at', label: 'Started At', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.started_at ? new Date(r.started_at).toLocaleString() : '\u2014'}</span> },
    { key: 'expires_at', label: 'Expires At', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{relativeTime(r.expires_at)}</span> },
    {
      key: '_actions', label: 'Actions', sortable: false, render: r =>
        r.status === 'active' ? (
          <button onClick={e => { e.stopPropagation(); endImpersonation(r.id); }} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}>
            End Session
          </button>
        ) : <span style={{ fontSize: 12, color: colors.text3 }}>\u2014</span>,
    },
  ];

  const delegationColumns: Column<DelegationRecord>[] = [
    { key: 'granter', label: 'Granter', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.granter)}</code> },
    { key: 'grantee', label: 'Grantee', render: r => <span style={{ fontSize: 12 }}>{r.grantee ? <code style={{ fontSize: 11 }}>{truncateId(r.grantee)}</code> : <em style={{ color: colors.text3 }}>Bearer</em>}</span> },
    { key: 'school_id', label: 'School ID', render: r => <code style={{ fontSize: 11 }}>{truncateId(r.school_id)}</code> },
    { key: 'permissions', label: 'Permissions', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{Array.isArray(r.permissions) ? r.permissions.join(', ') : '\u2014'}</span> },
    { key: 'status', label: 'Status', render: r => <StatusBadge label={r.status} variant={statusVariant(r.status)} /> },
    { key: 'use_count', label: 'Uses', render: r => <span style={{ fontSize: 12 }}>{r.use_count ?? 0}{r.max_uses != null ? `/${r.max_uses}` : ''}</span> },
    { key: 'expires_at', label: 'Expires At', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{relativeTime(r.expires_at)}</span> },
    {
      key: '_actions', label: 'Actions', sortable: false, render: r =>
        r.status === 'active' ? (
          <button onClick={e => { e.stopPropagation(); revokeDelegation(r.id); }} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}>
            Revoke
          </button>
        ) : <span style={{ fontSize: 12, color: colors.text3 }}>\u2014</span>,
    },
  ];

  /* ── Tab config ── */
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'elevations', label: 'Elevations' },
    { key: 'impersonation', label: 'Impersonation' },
    { key: 'delegations', label: 'Delegations' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>RBAC Management</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Privilege elevations, impersonation sessions, and delegation tokens</p>
        </div>
      </div>

      {/* Inline toast */}
      {message && (
        <div style={{
          ...S.card,
          marginBottom: 16,
          borderLeft: `3px solid ${message.type === 'success' ? colors.success : colors.danger}`,
          padding: '10px 16px',
          fontSize: 13,
          color: message.type === 'success' ? colors.success : colors.danger,
        }}>
          {message.text}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...S.filterBtn,
              ...(activeTab === tab.key ? S.filterActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Dashboard Tab ── */}
      {activeTab === 'dashboard' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {/* Active Elevations */}
          <div style={{ ...S.card, borderLeft: `4px solid ${colors.warning}` }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>
              {loading ? '\u2014' : stats.activeElevations}
            </div>
            <div style={{ fontSize: 13, color: colors.text2, fontWeight: 500 }}>Active Elevations</div>
          </div>
          {/* Active Impersonation Sessions */}
          <div style={{ ...S.card, borderLeft: `4px solid #7C3AED` }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>
              {loading ? '\u2014' : stats.activeSessions}
            </div>
            <div style={{ fontSize: 13, color: colors.text2, fontWeight: 500 }}>Active Impersonation Sessions</div>
          </div>
          {/* Active Delegation Tokens */}
          <div style={{ ...S.card, borderLeft: `4px solid ${colors.accent}` }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>
              {loading ? '\u2014' : stats.activeTokens}
            </div>
            <div style={{ fontSize: 13, color: colors.text2, fontWeight: 500 }}>Active Delegation Tokens</div>
          </div>
        </div>
      )}

      {/* ── Elevations Tab ── */}
      {activeTab === 'elevations' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              onClick={() => setShowElevationForm(!showElevationForm)}
              style={S.primaryBtn}
            >
              {showElevationForm ? 'Cancel' : '+ Grant Elevation'}
            </button>
          </div>

          {showElevationForm && (
            <div style={{ ...S.card, marginBottom: 16, borderLeft: `3px solid ${colors.warning}` }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>Grant Elevation</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>User ID</label>
                  <input value={elevUserId} onChange={e => setElevUserId(e.target.value)} placeholder="UUID" style={S.searchInput} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Role ID</label>
                  <input value={elevRoleId} onChange={e => setElevRoleId(e.target.value)} placeholder="UUID" style={S.searchInput} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Duration (hours)</label>
                  <input type="number" value={elevDuration} onChange={e => setElevDuration(e.target.value)} min="1" max="720" style={{ ...S.searchInput, width: 100 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Reason</label>
                  <input value={elevReason} onChange={e => setElevReason(e.target.value)} placeholder="Justification" style={{ ...S.searchInput, width: 260 }} />
                </div>
                <button onClick={grantElevation} style={S.primaryBtn}>Grant</button>
              </div>
            </div>
          )}

          <DataTable
            columns={elevationColumns}
            data={elevations}
            keyField="id"
            loading={loading}
            emptyMessage="No elevation records"
          />
        </div>
      )}

      {/* ── Impersonation Tab ── */}
      {activeTab === 'impersonation' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              onClick={() => setShowImpersonationForm(!showImpersonationForm)}
              style={S.primaryBtn}
            >
              {showImpersonationForm ? 'Cancel' : '+ Start Impersonation'}
            </button>
          </div>

          {showImpersonationForm && (
            <div style={{ ...S.card, marginBottom: 16, borderLeft: `3px solid #7C3AED` }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>Start Impersonation</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Target User ID</label>
                  <input value={impTargetId} onChange={e => setImpTargetId(e.target.value)} placeholder="UUID" style={S.searchInput} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Reason</label>
                  <input value={impReason} onChange={e => setImpReason(e.target.value)} placeholder="Justification" style={{ ...S.searchInput, width: 260 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Max Minutes</label>
                  <input type="number" value={impMaxMinutes} onChange={e => setImpMaxMinutes(e.target.value)} min="1" max="480" style={{ ...S.searchInput, width: 100 }} />
                </div>
                <button onClick={startImpersonation} style={S.primaryBtn}>Start</button>
              </div>
            </div>
          )}

          <DataTable
            columns={sessionColumns}
            data={sessions}
            keyField="id"
            loading={loading}
            emptyMessage="No impersonation sessions"
          />
        </div>
      )}

      {/* ── Delegations Tab ── */}
      {activeTab === 'delegations' && (
        <div>
          <DataTable
            columns={delegationColumns}
            data={tokens}
            keyField="id"
            loading={loading}
            emptyMessage="No delegation tokens"
          />
        </div>
      )}
    </div>
  );
}

export default function RBACPage() {
  return <AdminShell><RBACContent /></AdminShell>;
}
