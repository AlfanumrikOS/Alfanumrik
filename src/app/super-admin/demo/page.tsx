'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard } from '@/components/admin-ui';

interface DemoAccount {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'parent';
  persona: string | null;
  status: 'active' | 'inactive';
  last_reset: string | null;
  created_at: string;
}

interface CreatedCredentials {
  email: string;
  password: string;
  name: string;
  role: string;
  student_invite_code?: string;
  login_instructions?: string;
}

function DemoContent() {
  const { apiFetch } = useAdmin();
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form state
  const [formRole, setFormRole] = useState<'student' | 'teacher' | 'parent'>('student');
  const [formPersona, setFormPersona] = useState<'average' | 'high_performer' | 'weak_student'>('average');
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [creating, setCreating] = useState(false);

  // Credentials modal
  const [credentials, setCredentials] = useState<CreatedCredentials[] | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/demo-accounts');
      if (res.ok) {
        const d = await res.json();
        setAccounts(d.data || []);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Derived counts
  const byRole = (role: string) => accounts.filter(a => a.role === role);
  const activeCount = accounts.filter(a => a.status === 'active').length;
  const inactiveCount = accounts.filter(a => a.status === 'inactive').length;
  const lastReset = accounts.reduce((latest: string | null, a) => {
    if (!a.last_reset) return latest;
    if (!latest) return a.last_reset;
    return a.last_reset > latest ? a.last_reset : latest;
  }, null);

  const handleCreate = async () => {
    if (!formName.trim() || !formEmail.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch('/api/super-admin/demo-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: formRole,
          persona: formRole === 'student' ? formPersona : null,
          name: formName.trim(),
          email: formEmail.trim(),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success && d.data) {
          setCredentials([{
            email: d.data.email,
            password: d.data.password,
            name: formName.trim(),
            role: d.data.role,
            student_invite_code: d.data.student_invite_code,
            login_instructions: d.data.login_instructions,
          }]);
        }
        setFormName('');
        setFormEmail('');
        fetchAccounts();
      }
    } catch {
      // silent
    }
    setCreating(false);
  };

  const handleReset = async (id: string) => {
    setActionLoading(id + '-reset');
    try {
      await apiFetch('/api/super-admin/demo-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reset' }),
      });
      fetchAccounts();
    } catch {
      // silent
    }
    setActionLoading(null);
  };

  const handleToggle = async (id: string) => {
    setActionLoading(id + '-toggle');
    try {
      await apiFetch('/api/super-admin/demo-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'toggle' }),
      });
      fetchAccounts();
    } catch {
      // silent
    }
    setActionLoading(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete demo account "${name}"?`)) return;
    setActionLoading(id + '-delete');
    try {
      await apiFetch(`/api/super-admin/demo-accounts?id=${id}`, { method: 'DELETE' });
      fetchAccounts();
    } catch {
      // silent
    }
    setActionLoading(null);
  };

  const handleResetAll = async () => {
    if (!confirm('Reset ALL demo accounts? This will clear all their data and restore defaults.')) return;
    setActionLoading('reset-all');
    try {
      await apiFetch('/api/super-admin/demo-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-all' }),
      });
      fetchAccounts();
    } catch {
      // silent
    }
    setActionLoading(null);
  };

  const handleCreateSet = async () => {
    setActionLoading('create-set');
    try {
      const res = await apiFetch('/api/super-admin/demo-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-set' }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success && d.data) {
          const items = Array.isArray(d.data) ? d.data : [d.data];
          setCredentials(items.map((item: Record<string, string>) => ({
            email: item.email,
            password: item.password,
            name: item.name || item.role,
            role: item.role,
            student_invite_code: item.student_invite_code,
            login_instructions: item.login_instructions,
          })));
        }
        fetchAccounts();
      }
    } catch {
      // silent
    }
    setActionLoading(null);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const roleBadge = (role: string): React.CSSProperties => ({
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    ...(role === 'student'
      ? { background: '#EFF6FF', color: '#2563EB' }
      : role === 'teacher'
        ? { background: '#FFFBEB', color: '#D97706' }
        : { background: '#F0FDF4', color: '#16A34A' }),
  });

  const statusBadge = (status: string): React.CSSProperties => ({
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    background: status === 'active' ? '#F0FDF4' : '#FEF2F2',
    color: status === 'active' ? '#16A34A' : '#DC2626',
  });

  const tableThStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 14px',
    borderBottom: `2px solid #E5E7EB`,
    color: '#6B7280',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    background: '#F9FAFB',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  const tableTdStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: `1px solid #F3F4F6`,
    color: '#111827',
    fontSize: 13,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold text-foreground">Demo Accounts</h1>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>
            Manage demo accounts for sales presentations and testing
          </p>
        </div>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          {accounts.length} accounts total
        </div>
      </div>

      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Students" value={byRole('student').length} accentColor="#2563EB" />
        <StatCard label="Teachers" value={byRole('teacher').length} accentColor="#D97706" />
        <StatCard label="Parents" value={byRole('parent').length} accentColor="#16A34A" />
        <StatCard label="Active" value={activeCount} accentColor="#16A34A" />
        <StatCard label="Inactive" value={inactiveCount} accentColor="#DC2626" />
        <StatCard label="Last Reset" value={formatDate(lastReset)} />
      </div>

      {/* Quick Actions */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Actions</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button
          onClick={handleResetAll}
          disabled={actionLoading === 'reset-all'}
          className="rounded-md border border-danger bg-danger/10 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/20"
          style={{ opacity: actionLoading === 'reset-all' ? 0.6 : 1 }}
        >
          {actionLoading === 'reset-all' ? 'Resetting...' : 'Reset All Demo Accounts'}
        </button>
        <button
          onClick={handleCreateSet}
          disabled={actionLoading === 'create-set'}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
          style={{ opacity: actionLoading === 'create-set' ? 0.6 : 1 }}
        >
          {actionLoading === 'create-set' ? 'Creating...' : 'Create Demo Set'}
        </button>
        <span style={{ fontSize: 12, color: '#9CA3AF', alignSelf: 'center' }}>
          Creates one student + one teacher + one parent
        </span>
      </div>

      {/* Create Demo Account Form */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Create Demo Account</h2>
      <div
        className="rounded-lg border border-surface-3 bg-surface-2 p-4"
        style={{ marginBottom: 24 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4, fontWeight: 600 }}>Role</label>
            <select
              value={formRole}
              onChange={e => setFormRole(e.target.value as 'student' | 'teacher' | 'parent')}
              className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"
            >
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
            </select>
          </div>
          {formRole === 'student' && (
            <div>
              <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4, fontWeight: 600 }}>Persona</label>
              <select
                value={formPersona}
                onChange={e => setFormPersona(e.target.value as 'average' | 'high_performer' | 'weak_student')}
                className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm cursor-pointer"
              >
                <option value="average">Average</option>
                <option value="high_performer">High Performer</option>
                <option value="weak_student">Weak Student</option>
              </select>
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4, fontWeight: 600 }}>Name</label>
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="Demo Student"
              className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginBottom: 4, fontWeight: 600 }}>Email</label>
            <input
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
              placeholder="demo-student@alfanumrik.com"
              className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <button
              onClick={handleCreate}
              disabled={creating || !formName.trim() || !formEmail.trim()}
              className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
              style={{ opacity: creating || !formName.trim() || !formEmail.trim() ? 0.6 : 1 }}
            >
              {creating ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>

      {/* Credentials Modal */}
      {credentials && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div
            className="rounded-lg border border-surface-3 bg-surface-1"
            style={{ maxWidth: 480, width: '90%', padding: 24 }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4, marginTop: 0 }}>
              Demo Account Credentials
            </h3>
            <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16, marginTop: 0 }}>
              Save these credentials. The password cannot be retrieved later.
            </p>
            {credentials.map((cred, i) => (
              <div
                key={i}
                className="rounded-lg border border-surface-3 bg-surface-2"
                style={{ marginBottom: 8, padding: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{cred.name}</span>
                  <span style={roleBadge(cred.role)}>{cred.role}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 2 }}>
                  Email: <code style={{ color: '#111827' }}>{cred.email}</code>
                </div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  Password: <code style={{ color: '#111827' }}>{cred.password}</code>
                </div>
                {cred.student_invite_code && (
                  <>
                    <div style={{ fontSize: 12, color: '#2563EB', marginTop: 6, fontWeight: 600 }}>
                      Parent Portal Login
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                      Link Code: <code style={{ color: '#111827', fontWeight: 700 }}>{cred.student_invite_code}</code>
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                      {cred.login_instructions || 'Go to /parent and enter the link code (not email/password).'}
                    </div>
                  </>
                )}
              </div>
            ))}
            <button
              onClick={() => setCredentials(null)}
              className="mt-3 w-full rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Accounts Table */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Demo Accounts</h2>
      <div style={{ overflowX: 'auto', border: `1px solid #E5E7EB`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={tableThStyle}>Name</th>
              <th style={tableThStyle}>Email</th>
              <th style={tableThStyle}>Role</th>
              <th style={tableThStyle}>Persona</th>
              <th style={tableThStyle}>Status</th>
              <th style={tableThStyle}>Last Reset</th>
              <th style={{ ...tableThStyle, textAlign: 'right' as const }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && accounts.length === 0 && (
              <tr><td colSpan={7} style={{ ...tableTdStyle, textAlign: 'center', color: '#9CA3AF', padding: 32 }}>Loading...</td></tr>
            )}
            {!loading && accounts.length === 0 && (
              <tr><td colSpan={7} style={{ ...tableTdStyle, textAlign: 'center', color: '#9CA3AF', padding: 32 }}>No demo accounts yet. Create one above or use &quot;Create Demo Set&quot;.</td></tr>
            )}
            {accounts.map(account => (
              <tr key={account.id}>
                <td style={tableTdStyle}>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{account.name}</span>
                </td>
                <td style={tableTdStyle}>
                  <code style={{ fontSize: 12, color: '#6B7280' }}>{account.email}</code>
                </td>
                <td style={tableTdStyle}>
                  <span style={roleBadge(account.role)}>{account.role}</span>
                </td>
                <td style={tableTdStyle}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>{account.persona || '—'}</span>
                </td>
                <td style={tableTdStyle}>
                  <span style={statusBadge(account.status)}>{account.status}</span>
                </td>
                <td style={tableTdStyle}>
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>{formatDate(account.last_reset)}</span>
                </td>
                <td style={{ ...tableTdStyle, textAlign: 'right' as const }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleReset(account.id)}
                      disabled={actionLoading === account.id + '-reset'}
                      className="rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
                    >
                      {actionLoading === account.id + '-reset' ? '...' : 'Reset'}
                    </button>
                    <button
                      onClick={() => handleToggle(account.id)}
                      disabled={actionLoading === account.id + '-toggle'}
                      className="rounded-md border bg-transparent px-2.5 py-1 text-[11px] font-medium hover:bg-surface-2"
                      style={{
                        color: account.status === 'active' ? '#D97706' : '#16A34A',
                        borderColor: account.status === 'active' ? '#D97706' : '#16A34A',
                      }}
                    >
                      {actionLoading === account.id + '-toggle'
                        ? '...'
                        : account.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(account.id, account.name)}
                      disabled={actionLoading === account.id + '-delete'}
                      className="rounded-md border bg-transparent px-2.5 py-1 text-[11px] font-medium hover:bg-surface-2"
                      style={{ color: '#DC2626', borderColor: '#DC2626' }}
                    >
                      {actionLoading === account.id + '-delete' ? '...' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DemoPage() {
  return <AdminShell><DemoContent /></AdminShell>;
}
