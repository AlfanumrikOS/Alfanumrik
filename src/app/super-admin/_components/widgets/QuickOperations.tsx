'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/admin-ui';

interface QuickOperationsProps {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const inputCls = 'rounded-md border border-surface-3 bg-surface-1 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary';
const primaryBtnCls = 'rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-surface-1 hover:opacity-90';
const secondaryBtnCls = 'rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2';

export default function QuickOperations({ apiFetch }: QuickOperationsProps) {
  const [testName, setTestName] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testRole, setTestRole] = useState('student');
  const [testResult, setTestResult] = useState('');
  const [lookupSearch, setLookupSearch] = useState('');
  const [lookupResults, setLookupResults] = useState<Array<Record<string, unknown>>>([]);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportStatus, setSupportStatus] = useState('');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Operations</div>

      {/* Create Test Account */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #2563EB' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Create Test Account</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={testRole} onChange={e => setTestRole(e.target.value)} className={inputCls} style={{ cursor: 'pointer' }}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            <option value="parent">Parent</option>
          </select>
          <input value={testName} onChange={e => setTestName(e.target.value)} placeholder="Name" className={inputCls} style={{ width: 120 }} />
          <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Email" className={inputCls} style={{ flex: 1, minWidth: 140 }} />
          <button onClick={createTestAccount} className={primaryBtnCls}>Create</button>
        </div>
        {testResult && <div style={{ marginTop: 6, fontSize: 11, color: testResult.startsWith('Done') ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{testResult}</div>}
      </div>

      {/* User Lookup */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #D97706' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>User Lookup</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={lookupSearch}
            onChange={e => setLookupSearch(e.target.value)}
            placeholder="Search by name..."
            className={inputCls}
            style={{ flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && lookupUser()}
          />
          <button onClick={lookupUser} className={secondaryBtnCls}>Find</button>
        </div>
        {lookupResults.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {lookupResults.map((u, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 12 }}>
                <div>
                  <strong style={{ color: 'var(--text-1)' }}>{String(u.name || '—')}</strong>
                  <span style={{ color: '#9CA3AF', marginLeft: 6 }}>{String(u.email || '')}</span>
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
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #DC2626' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Password Reset</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="User email" className={inputCls} style={{ flex: 1 }} />
          <button
            onClick={sendPasswordReset}
            className="rounded-md border bg-transparent px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            style={{ color: '#DC2626', borderColor: '#DC2626' }}
          >
            Reset
          </button>
        </div>
        {supportStatus && <div style={{ marginTop: 4, fontSize: 11, color: supportStatus === 'Failed' ? '#DC2626' : '#16A34A' }}>{supportStatus}</div>}
      </div>

      {/* Navigation Commands */}
      <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Go To</div>
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
            <a
              key={item.href}
              href={item.href}
              className="rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-2"
              style={{ textDecoration: 'none', display: 'block', textAlign: 'center', transition: 'background 0.1s' }}
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
