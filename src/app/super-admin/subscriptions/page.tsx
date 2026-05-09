'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard, StatusBadge, DetailDrawer } from '@/components/admin-ui';
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

// Hex literal palette (matches deprecated admin-styles.ts colors).
const C = {
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  accent: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
};

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

  const filterBtnBase = 'rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2';
  const filterBtnActive = 'rounded-md border border-foreground bg-foreground px-3.5 py-1.5 text-xs font-medium text-surface-1';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Subscriptions & Billing</h1>
          <p className="m-0 text-[13px] text-muted-foreground">Plan distribution, entitlement inspection, and manual overrides</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="mb-6 flex gap-1 border-b border-surface-3 pb-0">
        <button
          onClick={() => setActiveTab('revenue')}
          className={`rounded-t-md px-3.5 py-1.5 text-xs ${activeTab === 'revenue' ? 'bg-surface-2 font-bold text-foreground' : 'bg-transparent font-medium text-muted-foreground'}`}
          style={{ borderBottom: activeTab === 'revenue' ? `2px solid ${C.text1}` : '2px solid transparent' }}
        >
          Revenue & Entitlements
        </button>
        <button
          onClick={() => setActiveTab('ops')}
          className={`rounded-t-md px-3.5 py-1.5 text-xs ${activeTab === 'ops' ? 'bg-surface-2 font-bold text-foreground' : 'bg-transparent font-medium text-muted-foreground'}`}
          style={{ borderBottom: activeTab === 'ops' ? `2px solid ${C.text1}` : '2px solid transparent' }}
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
          <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <StatCard label="Total Students" value={totalSubs} accentColor={C.accent} />
            <StatCard label="Paid Plans" value={paidSubs} accentColor={C.success} />
            <StatCard label="Free Plan" value={totalSubs - paidSubs} accentColor={C.text3} />
            <StatCard label="Conversion Rate" value={`${conversionRate}%`} accentColor={conversionRate >= 5 ? C.success : C.warning} />
            <StatCard label="Est. MRR" value={`₹${estimatedMRR.toLocaleString('en-IN')}`} accentColor={C.warning} icon="₹" />
            <StatCard label="Est. ARR" value={`₹${(estimatedMRR * 12).toLocaleString('en-IN')}`} accentColor={C.accent} />
          </div>
        );
      })()}

      {/* Plan Distribution */}
      {analytics && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan Distribution</h2>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            {analytics.revenue.map(r => {
              const maxCount = Math.max(...analytics.revenue.map(x => x.count), 1);
              const pctOfTotal = totalSubs > 0 ? ((r.count / totalSubs) * 100).toFixed(1) : '0';
              const planColor: Record<string, string> = {
                free: C.text3, starter_monthly: C.warning, starter_yearly: '#B45309',
                pro_monthly: C.accent, pro_yearly: '#1D4ED8',
                ultimate_monthly: C.success, ultimate_yearly: '#15803D',
              };
              return (
                <div key={r.plan} className="mb-2.5 flex items-center gap-3">
                  <span className="w-[140px] flex-shrink-0 text-[13px] capitalize text-muted-foreground">
                    {r.plan.replace(/_/g, ' ')}
                  </span>
                  <div className="h-[22px] flex-1 overflow-hidden rounded bg-surface-2">
                    <div style={{ width: `${(r.count / maxCount) * 100}%`, height: '100%', background: planColor[r.plan] || C.text3, borderRadius: 4, minWidth: r.count > 0 ? 4 : 0 }} />
                  </div>
                  <span className="w-[50px] text-right text-[13px] font-bold text-foreground">{r.count}</span>
                  <span className="w-[50px] text-right text-[11px] text-muted-foreground">{pctOfTotal}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Entitlement Inspector */}
      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entitlement Inspector</h2>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: `3px solid ${C.accent}` }}>
          <p className="mb-3 text-xs text-muted-foreground">Look up a student by name/email to inspect their subscription entitlement.</p>
          <div className="flex gap-2">
            <input
              value={lookupEmail}
              onChange={e => setLookupEmail(e.target.value)}
              placeholder="Search by name..."
              className="flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              onKeyDown={e => e.key === 'Enter' && lookupUser()}
            />
            <button onClick={lookupUser} className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90">Lookup</button>
          </div>
          {lookupResult && (
            <div className="mt-3 rounded-md bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-foreground">{lookupResult.name}</strong>
                  <span className="ml-2 text-xs text-muted-foreground">{lookupResult.email}</span>
                </div>
                <StatusBadge label={lookupResult.subscription_plan || 'free'} variant={lookupResult.subscription_plan && lookupResult.subscription_plan !== 'free' ? 'success' : 'neutral'} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <select value={overridePlan} onChange={e => { setOverridePlan(e.target.value); setOverrideMsg(null); }} className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm">
                  <option value="">Change plan to...</option>
                  {plans.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                </select>
                {overridePlan && (
                  <button
                    onClick={() => changePlan(lookupResult, overridePlan, true)}
                    disabled={overrideLoading}
                    className="rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-surface-2"
                    style={{ color: C.accent, borderColor: C.accent, opacity: overrideLoading ? 0.6 : 1 }}
                  >
                    {overrideLoading ? 'Applying…' : 'Apply Override'}
                  </button>
                )}
              </div>
              {overrideMsg && (
                <div className={`mt-2 rounded-md px-3 py-1.5 text-xs font-semibold ${overrideMsg.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`} style={{ border: `1px solid ${overrideMsg.ok ? '#16a34a' : '#dc2626'}30` }}>
                  {overrideMsg.ok ? '✓ ' : '✗ '}{overrideMsg.text}
                </div>
              )}
            </div>
          )}
          {lookupEmail && !lookupResult && !loading && (
            <div className="mt-2 text-xs text-muted-foreground">No student found matching that search.</div>
          )}
        </div>
      </div>

      {/* Subscription Table */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Student Subscriptions</h2>
      <div className="mb-3 flex gap-1.5">
        <button onClick={() => setFilterPlan('')} className={filterPlan === '' ? filterBtnActive : filterBtnBase}>All</button>
        {plans.map(p => (
          <button
            key={p}
            onClick={() => setFilterPlan(p)}
            className={`${filterPlan === p ? filterBtnActive : filterBtnBase} text-[11px]`}
          >
            {p.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-surface-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grade</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Joined</th>
              <th className="border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="border-b border-surface-2 px-3.5 py-6 text-center text-muted-foreground">Loading...</td></tr>}
            {!loading && users.filter(u => !filterPlan || (u.subscription_plan || 'free') === filterPlan).length === 0 && (
              <tr><td colSpan={7} className="border-b border-surface-2 px-3.5 py-6 text-center text-muted-foreground">No students found</td></tr>
            )}
            {!loading && users.filter(u => !filterPlan || (u.subscription_plan || 'free') === filterPlan).map(u => (
              <tr
                key={u.id}
                onClick={() => setSelectedUser(u)}
                className="cursor-pointer hover:bg-surface-2"
              >
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground"><strong>{u.name || '—'}</strong></td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{u.email || '—'}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground">{u.grade || '—'}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground"><StatusBadge label={u.subscription_plan || 'free'} variant={u.subscription_plan && u.subscription_plan !== 'free' ? 'info' : 'neutral'} /></td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground"><StatusBadge label={u.is_active !== false ? 'Active' : 'Banned'} variant={u.is_active !== false ? 'success' : 'danger'} /></td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground" onClick={e => e.stopPropagation()}>
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) changePlan(u, e.target.value); e.target.value = ''; }}
                    className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-1.5 py-1 text-[11px]"
                  >
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
      <div className="mt-3.5 flex items-center justify-center gap-2">
        <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} className={filterBtnBase}>Prev</button>
        <span className="px-3 py-1.5 text-xs text-muted-foreground">Page {userPage} of {Math.max(1, Math.ceil(userTotal / 25))}</span>
        <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} className={filterBtnBase}>Next</button>
      </div>

      {/* Detail Drawer */}
      <DetailDrawer open={!!selectedUser} onClose={() => setSelectedUser(null)} title="Subscription Detail">
        {selectedUser && (
          <div>
            <div className="mb-4">
              <h4 className="m-0 text-base font-bold text-foreground">{selectedUser.name}</h4>
              <div className="text-[13px] text-muted-foreground">{selectedUser.email}</div>
            </div>
            {[
              { label: 'Current Plan', value: selectedUser.subscription_plan || 'free' },
              { label: 'Grade', value: selectedUser.grade || '—' },
              { label: 'Status', value: selectedUser.is_active !== false ? 'Active' : 'Banned' },
              { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleString() },
            ].map(f => (
              <div key={f.label} className="flex justify-between border-b border-surface-2 py-2">
                <span className="text-[13px] text-muted-foreground">{f.label}</span>
                <span className="text-[13px] font-medium text-foreground">{f.value}</span>
              </div>
            ))}
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Override Plan</div>
              <div className="flex flex-wrap gap-1.5">
                {plans.map(p => (
                  <button
                    key={p}
                    onClick={() => changePlan(selectedUser, p)}
                    className={`${selectedUser.subscription_plan === p ? filterBtnActive : filterBtnBase} px-2.5 py-1 text-[11px]`}
                  >
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
