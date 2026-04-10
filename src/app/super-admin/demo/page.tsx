'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';

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
      ? { background: colors.accentLight, color: colors.accent }
      : role === 'teacher'
        ? { background: colors.warningLight, color: colors.warning }
        : { background: colors.successLight, color: colors.success }),
  });

  const statusBadge = (status: string): React.CSSProperties => ({
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    background: status === 'active' ? colors.successLight : colors.dangerLight,
    color: status === 'active' ? colors.success : colors.danger,
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Demo Accounts</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Manage demo accounts for sales presentations and testing
          </p>
        </div>
        <div style={{ fontSize: 13, color: colors.text2 }}>
          {accounts.length} accounts total
        </div>
      </div>

      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Students</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.accent }}>{byRole('student').length}</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Teachers</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.warning }}>{byRole('teacher').length}</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Parents</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.success }}>{byRole('parent').length}</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Active</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.success }}>{activeCount}</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Inactive</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.danger }}>{inactiveCount}</div>
        </div>
        <div style={S.card}>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Last Reset</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text1, marginTop: 4 }}>{formatDate(lastReset)}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <h2 style={S.h2}>Quick Actions</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button
          onClick={handleResetAll}
          disabled={actionLoading === 'reset-all'}
          style={{ ...S.dangerBtn, opacity: actionLoading === 'reset-all' ? 0.6 : 1 }}
        >
          {actionLoading === 'reset-all' ? 'Resetting...' : 'Reset All Demo Accounts'}
        </button>
        <button
          onClick={handleCreateSet}
          disabled={actionLoading === 'create-set'}
          style={{ ...S.primaryBtn, opacity: actionLoading === 'create-set' ? 0.6 : 1 }}
        >
          {actionLoading === 'create-set' ? 'Creating...' : 'Create Demo Set'}
        </button>
        <span style={{ fontSize: 12, color: colors.text3, alignSelf: 'center' }}>
          Creates one student + one teacher + one parent
        </span>
      </div>

      {/* Create Demo Account Form */}
      <h2 style={S.h2}>Create Demo Account</h2>
      <div style={{ ...S.cardSurface, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Role</label>
            <select value={formRole} onChange={e => setFormRole(e.target.value as 'student' | 'teacher' | 'parent')} style={{ ...S.select, width: '100%' }}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
            </select>
          </div>
          {formRole === 'student' && (
            <div>
              <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Persona</label>
              <select value={formPersona} onChange={e => setFormPersona(e.target.value as 'average' | 'high_performer' | 'weak_student')} style={{ ...S.select, width: '100%' }}>
                <option value="average">Average</option>
                <option value="high_performer">High Performer</option>
                <option value="weak_student">Weak Student</option>
              </select>
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Name</label>
            <input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="Demo Student"
              style={{ ...S.searchInput, width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4, fontWeight: 600 }}>Email</label>
            <input
              value={formEmail}
              onChange={e => setFormEmail(e.target.value)}
              placeholder="demo-student@alfanumrik.com"
              style={{ ...S.searchInput, width: '100%' }}
            />
          </div>
          <div>
            <button
              onClick={handleCreate}
              disabled={creating || !formName.trim() || !formEmail.trim()}
              style={{ ...S.primaryBtn, width: '100%', opacity: creating || !formName.trim() || !formEmail.trim() ? 0.6 : 1 }}
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
          <div style={{ ...S.card, maxWidth: 480, width: '90%', padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text1, marginBottom: 4, marginTop: 0 }}>
              Demo Account Credentials
            </h3>
            <p style={{ fontSize: 12, color: colors.text3, marginBottom: 16, marginTop: 0 }}>
              Save these credentials. The password cannot be retrieved later.
            </p>
            {credentials.map((cred, i) => (
              <div key={i} style={{ ...S.cardSurface, marginBottom: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: colors.text1 }}>{cred.name}</span>
                  <span style={roleBadge(cred.role)}>{cred.role}</span>
                </div>
                <div style={{ fontSize: 12, color: colors.text2, marginBottom: 2 }}>
                  Email: <code style={{ color: colors.text1 }}>{cred.email}</code>
                </div>
                <div style={{ fontSize: 12, color: colors.text2 }}>
                  Password: <code style={{ color: colors.text1 }}>{cred.password}</code>
                </div>
                {cred.student_invite_code && (
                  <>
                    <div style={{ fontSize: 12, color: colors.accent, marginTop: 6, fontWeight: 600 }}>
                      Parent Portal Login
                    </div>
                    <div style={{ fontSize: 12, color: colors.text2, marginTop: 2 }}>
                      Link Code: <code style={{ color: colors.text1, fontWeight: 700 }}>{cred.student_invite_code}</code>
                    </div>
                    <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                      {cred.login_instructions || 'Go to /parent and enter the link code (not email/password).'}
                    </div>
                  </>
                )}
              </div>
            ))}
            <button onClick={() => setCredentials(null)} style={{ ...S.primaryBtn, marginTop: 12, width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Accounts Table */}
      <h2 style={S.h2}>Demo Accounts</h2>
      <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8 }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Persona</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Last Reset</th>
              <th style={{ ...S.th, textAlign: 'right' as const }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && accounts.length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 32 }}>Loading...</td></tr>
            )}
            {!loading && accounts.length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 32 }}>No demo accounts yet. Create one above or use &quot;Create Demo Set&quot;.</td></tr>
            )}
            {accounts.map(account => (
              <tr key={account.id}>
                <td style={S.td}>
                  <span style={{ fontWeight: 600, color: colors.text1 }}>{account.name}</span>
                </td>
                <td style={S.td}>
                  <code style={{ fontSize: 12, color: colors.text2 }}>{account.email}</code>
                </td>
                <td style={S.td}>
                  <span style={roleBadge(account.role)}>{account.role}</span>
                </td>
                <td style={S.td}>
                  <span style={{ fontSize: 12, color: colors.text2 }}>{account.persona || '—'}</span>
                </td>
                <td style={S.td}>
                  <span style={statusBadge(account.status)}>{account.status}</span>
                </td>
                <td style={S.td}>
                  <span style={{ fontSize: 12, color: colors.text3 }}>{formatDate(account.last_reset)}</span>
                </td>
                <td style={{ ...S.td, textAlign: 'right' as const }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleReset(account.id)}
                      disabled={actionLoading === account.id + '-reset'}
                      style={{ ...S.actionBtn, fontSize: 11 }}
                    >
                      {actionLoading === account.id + '-reset' ? '...' : 'Reset'}
                    </button>
                    <button
                      onClick={() => handleToggle(account.id)}
                      disabled={actionLoading === account.id + '-toggle'}
                      style={{
                        ...S.actionBtn,
                        fontSize: 11,
                        color: account.status === 'active' ? colors.warning : colors.success,
                        borderColor: account.status === 'active' ? colors.warning : colors.success,
                      }}
                    >
                      {actionLoading === account.id + '-toggle'
                        ? '...'
                        : account.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(account.id, account.name)}
                      disabled={actionLoading === account.id + '-delete'}
                      style={{ ...S.actionBtn, fontSize: 11, color: colors.danger, borderColor: colors.danger }}
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
