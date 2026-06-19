'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { DataTable, type Column, DetailDrawer, StatusBadge } from '@/components/admin-ui';
import { toast } from '@/components/ui/toast';

interface UserRecord {
  id: string; auth_user_id: string; name: string; email: string; role: string;
  grade?: string; board?: string; xp_total?: number; streak_days?: number;
  school_name?: string; is_active?: boolean; account_status?: string;
  subscription_plan?: string; created_at: string; [key: string]: unknown;
}

interface RoleRecord { id: string; name: string; display_name: string; hierarchy_level: number; description: string; }
interface UserRoleRecord { id: string; auth_user_id: string; role_id: string; is_active: boolean; created_at: string; roles: { name: string; display_name: string } | null; }

const PAGE_LIMIT = 50;

function UsersContent() {
  const { apiFetch } = useAdmin();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userRole, setUserRole] = useState('student');
  const [userSearch, setUserSearch] = useState('');
  const userPage = Math.max(1, parseInt(searchParams.get('page') || '1'));
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
      const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: String(PAGE_LIMIT) });
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
    if (!assignUserId || !assignRoleName) { toast.error('User ID and role name required'); return; }
    const res = await apiFetch('/api/super-admin/roles', { method: 'POST', body: JSON.stringify({ auth_user_id: assignUserId, role_name: assignRoleName }) });
    const d = await res.json();
    if (!res.ok) { toast.error(d.error || 'Assign failed'); return; }
    setAssignUserId(''); setAssignRoleName(''); fetchRoles();
  };

  const revokeRole = async (userRoleId: string) => {
    if (!confirm('Revoke this role assignment?')) return;
    await apiFetch('/api/super-admin/roles', { method: 'DELETE', body: JSON.stringify({ user_role_id: userRoleId }) });
    fetchRoles();
  };

  const createTestAccount = async () => {
    if (!testName || !testEmail) { toast.error('Name and email required'); return; }
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

  const filterBtnBase = 'rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2';
  const filterBtnActive = 'rounded-md border border-foreground bg-foreground px-3.5 py-1.5 text-xs font-medium text-surface-1';
  const actionBtnBase = 'rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-surface-2';

  const columns: Column<UserRecord>[] = [
    { key: 'name', label: 'Name', render: r => <strong className="text-foreground">{r.name || '—'}</strong> },
    { key: 'email', label: 'Email', render: r => <span className="text-xs text-muted-foreground">{r.email || '—'}</span> },
    ...(userRole === 'student' ? [
      { key: 'grade', label: 'Grade' } as Column<UserRecord>,
      { key: 'xp_total', label: 'XP', render: (r: UserRecord) => <span className="font-semibold">{r.xp_total ?? 0}</span> } as Column<UserRecord>,
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
    { key: 'created_at', label: 'Joined', render: r => <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span> },
    { key: '_actions', label: 'Actions', sortable: false, render: r => (
      <button
        onClick={e => { e.stopPropagation(); toggleUser(r); }}
        className={`${actionBtnBase} ${r.is_active !== false ? 'border-danger text-danger' : 'border-success text-success'}`}
      >
        {r.is_active !== false ? 'Ban' : 'Unban'}
      </button>
    )},
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Users & Roles</h1>
          <p className="m-0 text-[13px] text-muted-foreground">Manage users, roles, and test accounts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Export CSV</button>
          <button onClick={() => setShowTestForm(!showTestForm)} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">
            {showTestForm ? 'Cancel' : '+ Test Account'}
          </button>
          <button onClick={() => setShowRolePanel(!showRolePanel)} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">
            {showRolePanel ? 'Hide Roles' : 'Manage Roles'}
          </button>
        </div>
      </div>

      {/* Test Account Form */}
      {showTestForm && (
        <div className="mb-5 rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #2563EB' }}>
          <h3 className="mb-3 text-sm font-bold text-foreground">Create Test Account</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">Role</label>
              <select value={testRole} onChange={e => setTestRole(e.target.value)} className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm">
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="parent">Parent</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">Name</label>
              <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Test User" className="w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">Email</label>
              <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@alfanumrik.com" className="w-[260px] rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <button onClick={createTestAccount} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">Create</button>
          </div>
          {testResult && <div className={`mt-2 text-xs ${testResult.startsWith('Created') ? 'text-success' : 'text-danger'}`}>{testResult}</div>}
        </div>
      )}

      {/* Role Management Panel */}
      {showRolePanel && (
        <div className="mb-5 rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #D97706' }}>
          <h3 className="mb-3 text-sm font-bold text-foreground">Role Management</h3>

          {/* Assign Role */}
          <div className="mb-4 flex flex-wrap gap-2">
            <input value={assignUserId} onChange={e => setAssignUserId(e.target.value)} placeholder="auth_user_id (UUID)" className="min-w-[200px] flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <select value={assignRoleName} onChange={e => setAssignRoleName(e.target.value)} className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm">
              <option value="">Select role</option>
              {allRoles.map(r => <option key={r.id} value={r.name}>{r.display_name || r.name}</option>)}
            </select>
            <button onClick={assignRole} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">Assign Role</button>
          </div>

          {/* Available Roles */}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Available Roles ({allRoles.length})
          </div>
          <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {allRoles.map(r => (
              <div
                key={r.id}
                className="rounded-lg border border-surface-3 bg-surface-1 p-2.5"
                style={{ borderLeft: `3px solid ${r.hierarchy_level >= 90 ? '#DC2626' : r.hierarchy_level >= 50 ? '#D97706' : '#9CA3AF'}` }}
              >
                <div className="text-[13px] font-semibold text-foreground">{r.display_name || r.name}</div>
                <div className="text-[10px] text-muted-foreground">Level {r.hierarchy_level}</div>
                {r.description && <div className="mt-0.5 text-[10px] text-muted-foreground">{r.description}</div>}
              </div>
            ))}
          </div>

          {/* Current Assignments */}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Current Assignments ({userRolesTotal})
          </div>
          <div className="overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">User ID</th>
                  <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assigned</th>
                  <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userRoles.length === 0 && (
                  <tr><td colSpan={5} className="border-b border-surface-3 px-3.5 py-5 text-center text-[13px] text-muted-foreground">No assignments</td></tr>
                )}
                {userRoles.map(ur => (
                  <tr key={ur.id}>
                    <td className="border-b border-surface-3 px-3.5 py-2.5 text-[11px] text-foreground"><code>{ur.auth_user_id?.slice(0, 12)}...</code></td>
                    <td className="border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground"><strong>{ur.roles?.display_name || ur.roles?.name || '—'}</strong></td>
                    <td className="border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground"><StatusBadge label={ur.is_active ? 'Active' : 'Inactive'} variant={ur.is_active ? 'success' : 'neutral'} /></td>
                    <td className="border-b border-surface-3 px-3.5 py-2.5 text-xs text-foreground">{ur.created_at ? new Date(ur.created_at).toLocaleDateString() : '—'}</td>
                    <td className="border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground">
                      <button onClick={() => revokeRole(ur.id)} className={`${actionBtnBase} border-danger text-danger`}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {[
            { key: 'student', label: 'Students' },
            { key: 'teacher', label: 'Teachers' },
            { key: 'guardian', label: 'Parents' },
          ].map(r => (
            <button
              key={r.key}
              onClick={() => { setUserRole(r.key); router.push('?page=1'); }}
              className={userRole === r.key ? filterBtnActive : filterBtnBase}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder="Search name..."
            className="w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={e => e.key === 'Enter' && fetchUsers()}
          />
          <button onClick={downloadCSV} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Export CSV</button>
        </div>
      </div>

      <div className="mb-2 text-xs text-muted-foreground">
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
        <div
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-5 py-2.5 text-surface-1"
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
        >
          <span className="text-[13px] font-semibold">{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} className="rounded border-0 bg-white/20 px-3 py-1 text-xs text-surface-1 cursor-pointer">
            Clear
          </button>
          <button onClick={downloadCSV} className="rounded border-0 bg-surface-1 px-3 py-1 text-xs font-semibold text-foreground cursor-pointer">
            Export Selected
          </button>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-surface-3 text-[13px]">
        <span className="text-muted-foreground">
          {userTotal === 0
            ? 'No users found'
            : `${(userPage - 1) * PAGE_LIMIT + 1}–${Math.min(userPage * PAGE_LIMIT, userTotal)} of ${userTotal}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`?page=${userPage - 1}`)}
            disabled={userPage <= 1}
            className="px-3 py-1.5 rounded-md border border-surface-3 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            onClick={() => router.push(`?page=${userPage + 1}`)}
            disabled={userPage * PAGE_LIMIT >= userTotal}
            className="px-3 py-1.5 rounded-md border border-surface-3 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {/* User Detail Drawer */}
      <DetailDrawer open={!!selectedUser} onClose={() => setSelectedUser(null)} title={selectedUser?.name || 'User Details'}>
        {selectedUser && (
          <div>
            <div className="mb-5">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Profile</div>
              {[
                { label: 'Name', value: selectedUser.name },
                { label: 'Email', value: selectedUser.email },
                { label: 'Role', value: selectedUser.role },
                { label: 'Grade', value: selectedUser.grade },
                { label: 'Board', value: selectedUser.board },
                { label: 'School', value: selectedUser.school_name },
                { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleString() },
              ].filter(f => f.value).map(f => (
                <div key={f.label} className="flex justify-between border-b border-surface-2 py-2">
                  <span className="text-[13px] text-muted-foreground">{f.label}</span>
                  <span className="text-[13px] font-medium text-foreground">{f.value}</span>
                </div>
              ))}
            </div>

            <div className="mb-5">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status & Subscription</div>
              <div className="mt-2 flex gap-2">
                <StatusBadge label={selectedUser.is_active !== false ? 'Active' : 'Banned'} variant={selectedUser.is_active !== false ? 'success' : 'danger'} />
                {selectedUser.subscription_plan && <StatusBadge label={selectedUser.subscription_plan} variant="info" />}
              </div>
              {selectedUser.xp_total != null && (
                <div className="mt-3">
                  <span className="text-[13px] text-muted-foreground">XP: </span>
                  <span className="text-base font-bold text-foreground">{selectedUser.xp_total}</span>
                  {selectedUser.streak_days != null && (
                    <span className="ml-4 text-[13px] text-muted-foreground">Streak: {selectedUser.streak_days}d</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { toggleUser(selectedUser); setSelectedUser(null); }}
                className={`rounded-md border bg-transparent px-4 py-2 text-xs font-medium hover:bg-surface-2 ${selectedUser.is_active !== false ? 'border-danger text-danger' : 'border-success text-success'}`}
              >
                {selectedUser.is_active !== false ? 'Ban User' : 'Unban User'}
              </button>
            </div>

            {selectedUser.role === 'student' && selectedUser.id && (
              <div className="mt-3">
                <Link href={`/super-admin/students/${selectedUser.id}`} className="text-sm text-blue-600 hover:underline">
                  View Full Profile &rarr;
                </Link>
              </div>
            )}

            <div className="mt-5 text-[10px] text-muted-foreground">
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
