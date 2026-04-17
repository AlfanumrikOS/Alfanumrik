'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

interface UserRecord {
  id: string; auth_user_id: string; name: string; email: string; role: string;
  grade?: string; board?: string; xp_total?: number; streak_days?: number;
  school_name?: string; is_active?: boolean; account_status?: string;
  subscription_plan?: string; created_at: string; [key: string]: unknown;
}

interface RoleRecord { id: string; name: string; display_name: string; hierarchy_level: number; description: string; }
interface UserRoleRecord { id: string; auth_user_id: string; role_id: string; is_active: boolean; created_at: string; roles: { name: string; display_name: string } | null; }

function UsersContent() {
  const { apiFetch, headers } = useAdmin();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userRole, setUserRole] = useState('student');
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Roles
  const [allRoles, setAllRoles] = useState<RoleRecord[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>([]);
  const [userRolesTotal, setUserRolesTotal] = useState(0);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRoleName, setAssignRoleName] = useState('');
  const [showRolePanel, setShowRolePanel] = useState(false);

  // Test account
  const [showTestForm, setShowTestForm] = useState(false);
  const [testRole, setTestRole] = useState('student');
  const [testName, setTestName] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
      if (userSearch) p.set('search', userSearch);
      const res = await apiFetch(`/api/super-admin/users?${p}`);
      if (res.ok) { const d = await res.json(); setUsers(d.data || []); setUserTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch, userRole, userPage, userSearch]);

  const fetchRoles = useCallback(async () => {
    try {
      const [rolesRes, urRes] = await Promise.all([
        apiFetch('/api/super-admin/roles?action=roles'),
        apiFetch('/api/super-admin/roles?action=user_roles'),
      ]);
      if (rolesRes.ok) { const d = await rolesRes.json(); setAllRoles(d.data || []); }
      if (urRes.ok) { const d = await urRes.json(); setUserRoles(d.data || []); setUserRolesTotal(d.total || 0); }
    } catch { /* */ }
  }, [apiFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { if (showRolePanel) fetchRoles(); }, [showRolePanel, fetchRoles]);

  const toggleUser = async (user: UserRecord) => {
    const table = user.role === 'teacher' ? 'teachers' : user.role === 'parent' ? 'guardians' : 'students';
    await apiFetch('/api/super-admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: user.id, table, updates: { is_active: !user.is_active } }),
    });
    fetchUsers();
  };

  const assignRole = async () => {
    if (!assignUserId || !assignRoleName) { alert('User ID and role name required'); return; }
    const res = await apiFetch('/api/super-admin/roles', { method: 'POST', body: JSON.stringify({ auth_user_id: assignUserId, role_name: assignRoleName }) });
    const d = await res.json();
    if (!res.ok) { alert(d.error || 'Assign failed'); return; }
    setAssignUserId(''); setAssignRoleName(''); fetchRoles();
  };

  const revokeRole = async (userRoleId: string) => {
    if (!confirm('Revoke this role assignment?')) return;
    await apiFetch('/api/super-admin/roles', { method: 'DELETE', body: JSON.stringify({ user_role_id: userRoleId }) });
    fetchRoles();
  };

  const createTestAccount = async () => {
    if (!testName || !testEmail) { alert('Name and email required'); return; }
    setTestResult('Creating...');
    try {
      const res = await apiFetch('/api/super-admin/test-accounts', {
        method: 'POST',
        body: JSON.stringify({ role: testRole, name: testName, email: testEmail }),
      });
      const d = await res.json();
      if (res.ok) {
        setTestResult(`Created! Password: ${d.password || 'Check email'}`);
        setTestName(''); setTestEmail('');
      } else {
        setTestResult(d.error || 'Failed to create');
      }
    } catch { setTestResult('Request failed'); }
  };

  const downloadCSV = async () => {
    const type = userRole === 'guardian' ? 'parents' : `${userRole}s`;
    const res = await apiFetch(`/api/super-admin/reports?type=${type}&format=csv`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<UserRecord>[] = [
    { key: 'name', label: 'Name', render: r => <strong style={{ color: colors.text1 }}>{r.name || '—'}</strong> },
    { key: 'email', label: 'Email', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.email || '—'}</span> },
    ...(userRole === 'student' ? [
      { key: 'grade', label: 'Grade' } as Column<UserRecord>,
      { key: 'xp_total', label: 'XP', render: (r: UserRecord) => <span style={{ fontWeight: 600 }}>{r.xp_total ?? 0}</span> } as Column<UserRecord>,
      { key: 'subscription_plan', label: 'Plan', render: (r: UserRecord) => {
        const plan = r.subscription_plan || 'free';
        const variant = plan === 'unlimited' || plan === 'ultimate_yearly' ? 'success' : plan.startsWith('pro') ? 'info' : plan.startsWith('starter') ? 'warning' : 'neutral';
        return <StatusBadge label={plan} variant={variant} />;
      }} as Column<UserRecord>,
    ] : []),
    ...(userRole === 'teacher' ? [
      { key: 'school_name', label: 'School' } as Column<UserRecord>,
    ] : []),
    { key: 'is_active', label: 'Status', render: r => (
      <StatusBadge label={r.is_active !== false ? 'Active' : 'Banned'} variant={r.is_active !== false ? 'success' : 'danger'} />
    )},
    { key: 'created_at', label: 'Joined', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{new Date(r.created_at).toLocaleDateString()}</span> },
    { key: '_actions', label: 'Actions', sortable: false, render: r => (
      <button onClick={e => { e.stopPropagation(); toggleUser(r); }} style={{
        ...S.actionBtn,
        color: r.is_active !== false ? colors.danger : colors.success,
        borderColor: r.is_active !== false ? colors.danger : colors.success,
      }}>{r.is_active !== false ? 'Ban' : 'Unban'}</button>
    )},
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={S.h1}>Users & Roles</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Manage users, roles, and test accounts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={downloadCSV} style={S.secondaryBtn}>Export CSV</button>
          <button onClick={() => setShowTestForm(!showTestForm)} style={S.primaryBtn}>
            {showTestForm ? 'Cancel' : '+ Test Account'}
          </button>
          <button onClick={() => setShowRolePanel(!showRolePanel)} style={S.secondaryBtn}>
            {showRolePanel ? 'Hide Roles' : 'Manage Roles'}
          </button>
        </div>
      </div>

      {/* Test Account Form */}
      {showTestForm && (
        <div style={{ ...S.card, marginBottom: 20, borderLeft: `3px solid ${colors.accent}` }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>Create Test Account</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Role</label>
              <select value={testRole} onChange={e => setTestRole(e.target.value)} style={S.select}>
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="parent">Parent</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Name</label>
              <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Test User" style={S.searchInput} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Email</label>
              <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@alfanumrik.com" style={{ ...S.searchInput, width: 260 }} />
            </div>
            <button onClick={createTestAccount} style={S.primaryBtn}>Create</button>
          </div>
          {testResult && <div style={{ marginTop: 8, fontSize: 12, color: testResult.startsWith('Created') ? colors.success : colors.danger }}>{testResult}</div>}
        </div>
      )}

      {/* Role Management Panel */}
      {showRolePanel && (
        <div style={{ ...S.card, marginBottom: 20, borderLeft: `3px solid ${colors.warning}` }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 12 }}>Role Management</h3>

          {/* Assign Role */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <input value={assignUserId} onChange={e => setAssignUserId(e.target.value)} placeholder="auth_user_id (UUID)" style={{ ...S.searchInput, flex: 1, minWidth: 200 }} />
            <select value={assignRoleName} onChange={e => setAssignRoleName(e.target.value)} style={S.select}>
              <option value="">Select role</option>
              {allRoles.map(r => <option key={r.id} value={r.name}>{r.display_name || r.name}</option>)}
            </select>
            <button onClick={assignRole} style={S.primaryBtn}>Assign Role</button>
          </div>

          {/* Available Roles */}
          <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            Available Roles ({allRoles.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 16 }}>
            {allRoles.map(r => (
              <div key={r.id} style={{ ...S.card, padding: 10, borderLeft: `3px solid ${r.hierarchy_level >= 90 ? colors.danger : r.hierarchy_level >= 50 ? colors.warning : colors.text3}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1 }}>{r.display_name || r.name}</div>
                <div style={{ fontSize: 10, color: colors.text3 }}>Level {r.hierarchy_level}</div>
                {r.description && <div style={{ fontSize: 10, color: colors.text3, marginTop: 2 }}>{r.description}</div>}
              </div>
            ))}
          </div>

          {/* Current Assignments */}
          <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            Current Assignments ({userRolesTotal})
          </div>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>User ID</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Assigned</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {userRoles.length === 0 && (
                  <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 20 }}>No assignments</td></tr>
                )}
                {userRoles.map(ur => (
                  <tr key={ur.id}>
                    <td style={{ ...S.td, fontSize: 11 }}><code>{ur.auth_user_id?.slice(0, 12)}...</code></td>
                    <td style={S.td}><strong>{ur.roles?.display_name || ur.roles?.name || '—'}</strong></td>
                    <td style={S.td}><StatusBadge label={ur.is_active ? 'Active' : 'Inactive'} variant={ur.is_active ? 'success' : 'neutral'} /></td>
                    <td style={{ ...S.td, fontSize: 12 }}>{ur.created_at ? new Date(ur.created_at).toLocaleDateString() : '—'}</td>
                    <td style={S.td}>
                      <button onClick={() => revokeRole(ur.id)} style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'student', label: 'Students' },
            { key: 'teacher', label: 'Teachers' },
            { key: 'guardian', label: 'Parents' },
          ].map(r => (
            <button key={r.key} onClick={() => { setUserRole(r.key); setUserPage(1); }}
              style={{ ...S.filterBtn, ...(userRole === r.key ? S.filterActive : {}) }}>
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search name..."
            style={S.searchInput} onKeyDown={e => e.key === 'Enter' && fetchUsers()} />
          <button onClick={downloadCSV} style={S.secondaryBtn}>Export CSV</button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>
        {userTotal} {userRole === 'guardian' ? 'parent' : userRole}s found
      </div>

      {/* User Table */}
      <DataTable
        columns={columns}
        data={users}
        keyField="id"
        onRowClick={setSelectedUser}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        loading={loading}
        emptyMessage="No users found"
      />

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: colors.text1, color: colors.bg, padding: '10px 20px',
          borderRadius: 8, display: 'flex', gap: 12, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 50,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: colors.bg, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            Clear
          </button>
          <button onClick={downloadCSV} style={{ background: colors.bg, color: colors.text1, border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Export Selected
          </button>
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>Page {userPage} of {Math.max(1, Math.ceil(userTotal / 25))}</span>
        <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      {/* User Detail Drawer */}
      <DetailDrawer open={!!selectedUser} onClose={() => setSelectedUser(null)} title={selectedUser?.name || 'User Details'}>
        {selectedUser && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Profile</div>
              {[
                { label: 'Name', value: selectedUser.name },
                { label: 'Email', value: selectedUser.email },
                { label: 'Role', value: selectedUser.role },
                { label: 'Grade', value: selectedUser.grade },
                { label: 'Board', value: selectedUser.board },
                { label: 'School', value: selectedUser.school_name },
                { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleString() },
              ].filter(f => f.value).map(f => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
                  <span style={{ fontSize: 13, color: colors.text3 }}>{f.label}</span>
                  <span style={{ fontSize: 13, color: colors.text1, fontWeight: 500 }}>{f.value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>Status & Subscription</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <StatusBadge label={selectedUser.is_active !== false ? 'Active' : 'Banned'} variant={selectedUser.is_active !== false ? 'success' : 'danger'} />
                {selectedUser.subscription_plan && <StatusBadge label={selectedUser.subscription_plan} variant="info" />}
              </div>
              {selectedUser.xp_total != null && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: colors.text3 }}>XP: </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: colors.text1 }}>{selectedUser.xp_total}</span>
                  {selectedUser.streak_days != null && (
                    <span style={{ fontSize: 13, color: colors.text3, marginLeft: 16 }}>Streak: {selectedUser.streak_days}d</span>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { toggleUser(selectedUser); setSelectedUser(null); }} style={{
                ...S.actionBtn,
                color: selectedUser.is_active !== false ? colors.danger : colors.success,
                borderColor: selectedUser.is_active !== false ? colors.danger : colors.success,
                padding: '8px 16px',
              }}>
                {selectedUser.is_active !== false ? 'Ban User' : 'Unban User'}
              </button>
            </div>

            {selectedUser.role === 'student' && selectedUser.id && (
              <div style={{ marginTop: 12 }}>
                <Link href={`/super-admin/students/${selectedUser.id}`} className="text-sm text-blue-600 hover:underline">
                  View Full Profile &rarr;
                </Link>
              </div>
            )}

            <div style={{ marginTop: 20, fontSize: 10, color: colors.text3 }}>
              ID: <code>{selectedUser.id}</code><br />
              Auth ID: <code>{selectedUser.auth_user_id}</code>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function UsersPage() {
  return <AdminShell><UsersContent /></AdminShell>;
}
