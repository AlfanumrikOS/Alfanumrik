'use client';

import { useState } from 'react';
import StatusBadge from '../StatusBadge';
import { colors, S } from '../admin-styles';

interface QuickOperationsProps {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

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
                  <strong style={{ color: colors.text1 }}>{String(u.name || '\u2014')}</strong>
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
  );
}
