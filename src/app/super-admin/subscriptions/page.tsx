'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import DetailDrawer from '../_components/DetailDrawer';
import { colors, S } from '../_components/admin-styles';
import { PRICING, yearlyPerMonth } from '@/lib/plans';
import PaymentOpsTab from './_components/PaymentOpsTab';

interface UserRecord {
  id: string; auth_user_id: string; name: string; email: string; role: string;
  grade?: string; subscription_plan?: string; is_active?: boolean; created_at: string;
  [key: string]: unknown;
}

interface AnalyticsData {
  revenue: { plan: string; count: number }[];
  retention: { period: string; count: number }[];
}

function SubscriptionsContent() {
  const { apiFetch } = useAdmin();
  const [activeTab, setActiveTab] = useState<'revenue' | 'ops'>('revenue');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [filterPlan, setFilterPlan] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [overridePlan, setOverridePlan] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<UserRecord | null>(null);
  const [overrideMsg, setOverrideMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    const res = await apiFetch('/api/super-admin/analytics');
    if (res.ok) setAnalytics(await res.json());
  }, [apiFetch]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: 'student', page: String(userPage), limit: '25' });
      if (filterPlan) p.set('search', ''); // filter by plan is done client-side for now
      const res = await apiFetch(`/api/super-admin/users?${p}`);
      if (res.ok) { const d = await res.json(); setUsers(d.data || []); setUserTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch, userPage, filterPlan]);

  useEffect(() => { fetchAnalytics(); fetchUsers(); }, [fetchAnalytics, fetchUsers]);

  const changePlan = async (user: UserRecord, newPlan: string, isLookupOverride = false) => {
    if (isLookupOverride) { setOverrideLoading(true); setOverrideMsg(null); }
    try {
      const res = await apiFetch('/api/super-admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: user.id, table: 'students', updates: { subscription_plan: newPlan } }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (isLookupOverride) setOverrideMsg({ ok: false, text: json.error || 'Override failed' });
      } else {
        if (isLookupOverride) {
          setOverrideMsg({ ok: true, text: `Plan changed to "${newPlan}" — applied immediately` });
          setLookupResult({ ...user, subscription_plan: newPlan });
          setOverridePlan('');
        }
        fetchUsers();
        if (selectedUser?.id === user.id) setSelectedUser({ ...user, subscription_plan: newPlan });
      }
    } catch {
      if (isLookupOverride) setOverrideMsg({ ok: false, text: 'Network error — override not applied' });
    }
    if (isLookupOverride) setOverrideLoading(false);
  };

  const lookupUser = async () => {
    if (!lookupEmail.trim()) return;
    setLoading(true);
    const res = await apiFetch(`/api/super-admin/users?role=student&search=${encodeURIComponent(lookupEmail)}&limit=1`);
    if (res.ok) {
      const d = await res.json();
      setLookupResult(d.data?.[0] || null);
    }
    setLoading(false);
  };

  const plans = ['free', 'starter_monthly', 'starter_yearly', 'pro_monthly', 'pro_yearly', 'ultimate_monthly', 'ultimate_yearly'];
  const totalSubs = analytics?.revenue.reduce((sum, r) => sum + r.count, 0) || 0;
  const paidSubs = analytics?.revenue.filter(r => r.plan !== 'free').reduce((sum, r) => sum + r.count, 0) || 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Subscriptions & Billing</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Plan distribution, entitlement inspection, and manual overrides</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${colors.border}`, paddingBottom: 0 }}>
        <button
          onClick={() => setActiveTab('revenue')}
          style={{
            ...S.filterBtn,
            borderRadius: '6px 6px 0 0',
            borderBottom: activeTab === 'revenue' ? `2px solid ${colors.text1}` : '2px solid transparent',
            fontWeight: activeTab === 'revenue' ? 700 : 500,
            color: activeTab === 'revenue' ? colors.text1 : colors.text2,
            background: activeTab === 'revenue' ? colors.surface : 'transparent',
          }}
        >
          Revenue & Entitlements
        </button>
        <button
          onClick={() => setActiveTab('ops')}
          style={{
            ...S.filterBtn,
            borderRadius: '6px 6px 0 0',
            borderBottom: activeTab === 'ops' ? `2px solid ${colors.text1}` : '2px solid transparent',
            fontWeight: activeTab === 'ops' ? 700 : 500,
            color: activeTab === 'ops' ? colors.text1 : colors.text2,
            background: activeTab === 'ops' ? colors.surface : 'transparent',
          }}
        >
          Payment Ops
        </button>
      </div>

      {activeTab === 'ops' && <PaymentOpsTab />}

      {activeTab === 'revenue' && <>
      {/* KPI Cards */}
      {analytics && (() => {
        // Monthly revenue estimation using centralized PRICING from @/lib/plans
        const PLAN_PRICES: Record<string, number> = {
          starter_monthly: PRICING.starter.monthly,
          starter_yearly: yearlyPerMonth(PRICING.starter.yearly),
          pro_monthly: PRICING.pro.monthly,
          pro_yearly: yearlyPerMonth(PRICING.pro.yearly),
          ultimate_monthly: PRICING.unlimited.monthly,
          ultimate_yearly: yearlyPerMonth(PRICING.unlimited.yearly),
          unlimited_monthly: PRICING.unlimited.monthly,
          unlimited_yearly: yearlyPerMonth(PRICING.unlimited.yearly),
          starter: PRICING.starter.monthly,
          pro: PRICING.pro.monthly,
          unlimited: PRICING.unlimited.monthly,
        };
        const estimatedMRR = analytics.revenue.reduce((sum, r) => {
          const price = PLAN_PRICES[r.plan] || 0;
          return sum + r.count * price;
        }, 0);
        const conversionRate = totalSubs > 0 ? Math.round((paidSubs / totalSubs) * 100) : 0;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Total Students" value={totalSubs} accentColor={colors.accent} />
            <StatCard label="Paid Plans" value={paidSubs} accentColor={colors.success} />
            <StatCard label="Free Plan" value={totalSubs - paidSubs} accentColor={colors.text3} />
            <StatCard label="Conversion Rate" value={`${conversionRate}%`} accentColor={conversionRate >= 5 ? colors.success : colors.warning} />
            <StatCard label="Est. MRR" value={`₹${estimatedMRR.toLocaleString('en-IN')}`} accentColor={colors.warning} icon="₹" />
            <StatCard label="Est. ARR" value={`₹${(estimatedMRR * 12).toLocaleString('en-IN')}`} accentColor={colors.accent} />
          </div>
        );
      })()}

      {/* Plan Distribution */}
      {analytics && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Plan Distribution</h2>
          <div style={S.card}>
            {analytics.revenue.map(r => {
              const maxCount = Math.max(...analytics.revenue.map(x => x.count), 1);
              const pctOfTotal = totalSubs > 0 ? ((r.count / totalSubs) * 100).toFixed(1) : '0';
              const planColor: Record<string, string> = {
                free: colors.text3, starter_monthly: colors.warning, starter_yearly: '#B45309',
                pro_monthly: colors.accent, pro_yearly: '#1D4ED8',
                ultimate_monthly: colors.success, ultimate_yearly: '#15803D',
              };
              return (
                <div key={r.plan} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: colors.text2, width: 140, textTransform: 'capitalize', flexShrink: 0 }}>
                    {r.plan.replace(/_/g, ' ')}
                  </span>
                  <div style={{ flex: 1, height: 22, background: colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(r.count / maxCount) * 100}%`, height: '100%', background: planColor[r.plan] || colors.text3, borderRadius: 4, minWidth: r.count > 0 ? 4 : 0 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1, width: 50, textAlign: 'right' }}>{r.count}</span>
                  <span style={{ fontSize: 11, color: colors.text3, width: 50, textAlign: 'right' }}>{pctOfTotal}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entitlement Inspector */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Entitlement Inspector</h2>
        <div style={{ ...S.card, borderLeft: `3px solid ${colors.accent}` }}>
          <p style={{ fontSize: 12, color: colors.text3, marginBottom: 12 }}>Look up a student by name/email to inspect their subscription entitlement.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={lookupEmail} onChange={e => setLookupEmail(e.target.value)} placeholder="Search by name..."
              style={{ ...S.searchInput, flex: 1 }} onKeyDown={e => e.key === 'Enter' && lookupUser()} />
            <button onClick={lookupUser} style={S.primaryBtn}>Lookup</button>
          </div>
          {lookupResult && (
            <div style={{ marginTop: 12, padding: 12, background: colors.surface, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ color: colors.text1 }}>{lookupResult.name}</strong>
                  <span style={{ fontSize: 12, color: colors.text3, marginLeft: 8 }}>{lookupResult.email}</span>
                </div>
                <StatusBadge label={lookupResult.subscription_plan || 'free'} variant={lookupResult.subscription_plan && lookupResult.subscription_plan !== 'free' ? 'success' : 'neutral'} />
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={overridePlan} onChange={e => { setOverridePlan(e.target.value); setOverrideMsg(null); }} style={S.select}>
                  <option value="">Change plan to...</option>
                  {plans.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                </select>
                {overridePlan && (
                  <button
                    onClick={() => changePlan(lookupResult, overridePlan, true)}
                    disabled={overrideLoading}
                    style={{ ...S.actionBtn, color: colors.accent, borderColor: colors.accent, opacity: overrideLoading ? 0.6 : 1 }}>
                    {overrideLoading ? 'Applying…' : 'Apply Override'}
                  </button>
                )}
              </div>
              {overrideMsg && (
                <div style={{ marginTop: 8, padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: overrideMsg.ok ? '#16a34a18' : '#dc262618', color: overrideMsg.ok ? '#16a34a' : '#dc2626', border: `1px solid ${overrideMsg.ok ? '#16a34a' : '#dc2626'}30` }}>
                  {overrideMsg.ok ? '✓ ' : '✗ '}{overrideMsg.text}
                </div>
              )}
            </div>
          )}
          {lookupEmail && !lookupResult && !loading && (
            <div style={{ marginTop: 8, fontSize: 12, color: colors.text3 }}>No student found matching that search.</div>
          )}
        </div>
      </div>

      {/* Subscription Table */}
      <h2 style={S.h2}>Student Subscriptions</h2>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setFilterPlan('')} style={{ ...S.filterBtn, ...(filterPlan === '' ? S.filterActive : {}) }}>All</button>
        {plans.map(p => (
          <button key={p} onClick={() => setFilterPlan(p)} style={{ ...S.filterBtn, ...(filterPlan === p ? S.filterActive : {}), fontSize: 11 }}>
            {p.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Grade</th>
              <th style={S.th}>Plan</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Joined</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>Loading...</td></tr>}
            {!loading && users.filter(u => !filterPlan || (u.subscription_plan || 'free') === filterPlan).length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>No students found</td></tr>
            )}
            {!loading && users.filter(u => !filterPlan || (u.subscription_plan || 'free') === filterPlan).map(u => (
              <tr key={u.id} onClick={() => setSelectedUser(u)} style={{ cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = colors.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={S.td}><strong>{u.name || '—'}</strong></td>
                <td style={{ ...S.td, fontSize: 12, color: colors.text2 }}>{u.email || '—'}</td>
                <td style={S.td}>{u.grade || '—'}</td>
                <td style={S.td}><StatusBadge label={u.subscription_plan || 'free'} variant={u.subscription_plan && u.subscription_plan !== 'free' ? 'info' : 'neutral'} /></td>
                <td style={S.td}><StatusBadge label={u.is_active !== false ? 'Active' : 'Banned'} variant={u.is_active !== false ? 'success' : 'danger'} /></td>
                <td style={{ ...S.td, fontSize: 12, color: colors.text2 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <select defaultValue="" onChange={e => { if (e.target.value) changePlan(u, e.target.value); e.target.value = ''; }} style={{ ...S.select, fontSize: 11, padding: '4px 6px' }}>
                    <option value="" disabled>Change plan</option>
                    {plans.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>Page {userPage} of {Math.max(1, Math.ceil(userTotal / 25))}</span>
        <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      {/* Detail Drawer */}
      <DetailDrawer open={!!selectedUser} onClose={() => setSelectedUser(null)} title="Subscription Detail">
        {selectedUser && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 16, fontWeight: 700, color: colors.text1, margin: 0 }}>{selectedUser.name}</h4>
              <div style={{ fontSize: 13, color: colors.text3 }}>{selectedUser.email}</div>
            </div>
            {[
              { label: 'Current Plan', value: selectedUser.subscription_plan || 'free' },
              { label: 'Grade', value: selectedUser.grade || '—' },
              { label: 'Status', value: selectedUser.is_active !== false ? 'Active' : 'Banned' },
              { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleString() },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
                <span style={{ fontSize: 13, color: colors.text3 }}>{f.label}</span>
                <span style={{ fontSize: 13, color: colors.text1, fontWeight: 500 }}>{f.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: colors.text3, marginBottom: 6, fontWeight: 600 }}>Override Plan</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {plans.map(p => (
                  <button key={p} onClick={() => changePlan(selectedUser, p)}
                    style={{ ...S.filterBtn, ...(selectedUser.subscription_plan === p ? S.filterActive : {}), fontSize: 11, padding: '4px 10px' }}>
                    {p.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>
      </>}
    </div>
  );
}

export default function SubscriptionsPage() {
  return <AdminShell><SubscriptionsContent /></AdminShell>;
}
