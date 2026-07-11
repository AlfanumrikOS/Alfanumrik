'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button, DataState, MetricTrust, PageHeader, StatusBadge, Surface } from '@alfanumrik/ui/v3';
import { useSuperAdminV3 } from './SuperAdminV3Workspace';

function useAdminResource<T>(path: string) {
  const { apiFetch } = useSuperAdminV3();
  const [data, setData] = useState<T | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    apiFetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`request:${response.status}`);
      return response.json() as Promise<T>;
    }).then((body) => { if (active) { setData(body); setRetrievedAt(new Date().toISOString()); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiFetch, attempt, path]);
  return { data, loading, error, retrievedAt, retry: () => setAttempt((value) => value + 1) };
}

function Metric({ label, value, source, definition, retrievedAt, evidenceHref }: { label: string; value: number | string | null | undefined; source: string; definition: string; retrievedAt?: string | null; evidenceHref?: string }) {
  return <Surface className="p-4"><p className="text-sm text-secondary-ink">{label}</p><p className="mt-1 text-2xl font-bold">{value == null || value === -1 ? '—' : value}</p><MetricTrust source={source} definition={definition} freshness={null} retrievedAt={retrievedAt ? new Date(retrievedAt).toLocaleString('en-IN') : null} evidenceHref={evidenceHref} /></Surface>;
}

interface Stats { totals?: { students?: number; teachers?: number; parents?: number; schools?: number; quiz_sessions?: number; chat_sessions?: number }; last_24h?: { signups?: number; quizzes?: number; chats?: number } }

export function SuperV3Command() {
  const { environment } = useSuperAdminV3();
  const stats = useAdminResource<Stats>('/api/super-admin/stats');
  return <div className="space-y-5"><PageHeader eyebrow={`${environment} environment`} title="Command" description="Platform, customer and learning signals requiring operator attention." actions={<Button onClick={stats.retry}>Refresh</Button>} />{stats.loading ? <DataState state="loading" title="Loading governed platform signals" /> : stats.error || !stats.data ? <DataState state="error" title="Command data is temporarily unavailable" action={<Button onClick={stats.retry}>Try again</Button>} /> : <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Institutions" value={stats.data.totals?.schools} source="Platform statistics read model" definition="School tenant rows that are not deleted." retrievedAt={stats.retrievedAt} evidenceHref="/super-admin/institutions" /><Metric label="Learners" value={stats.data.totals?.students} source="Platform statistics read model" definition="Student profiles excluding demo accounts." retrievedAt={stats.retrievedAt} evidenceHref="/super-admin/students" /><Metric label="Teachers" value={stats.data.totals?.teachers} source="Platform statistics read model" definition="Teacher profiles excluding demo accounts." retrievedAt={stats.retrievedAt} evidenceHref="/super-admin/users?role=teacher" /><Metric label="Quizzes · 24h" value={stats.data.last_24h?.quizzes} source="Platform statistics read model" definition="Quiz sessions created in the rolling 24-hour window at query time." retrievedAt={stats.retrievedAt} evidenceHref="/super-admin/analytics" /></div><Surface className="p-5"><h2 className="font-bold">Operator priorities</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><Link className="rounded-xl border border-border p-4" href="/super-admin/alerts"><StatusBadge tone="warning">Review</StatusBadge><p className="mt-2 font-semibold">Active alerts</p></Link><Link className="rounded-xl border border-border p-4" href="/super-admin/observability"><StatusBadge tone="info">Inspect</StatusBadge><p className="mt-2 font-semibold">Platform operations</p></Link><Link className="rounded-xl border border-border p-4" href="/super-admin/support"><StatusBadge tone="neutral">Respond</StatusBadge><p className="mt-2 font-semibold">Customer support</p></Link></div></Surface></>}</div>;
}

interface Institution { id: string; name: string; board?: string; city?: string; state?: string; subscription_plan?: string; is_active?: boolean }

export function SuperV3Institutions() {
  const resource = useAdminResource<{ data?: Institution[] } | Institution[]>('/api/super-admin/institutions');
  const rows = useMemo(() => resource.data ? (Array.isArray(resource.data) ? resource.data : resource.data.data ?? []) : [], [resource.data]);
  return <div className="space-y-5"><PageHeader title="Institutions" description="Platform-wide institution registry. Institution-level filtering is not yet supported by this read model." />{resource.loading ? <DataState state="loading" title="Loading institutions" /> : resource.error ? <DataState state="error" title="Institutions are temporarily unavailable" action={<Button onClick={resource.retry}>Try again</Button>} /> : rows.length === 0 ? <DataState state="empty" title="No institutions" /> : <div className="space-y-3">{rows.map((item) => <Surface key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><h2 className="font-bold">{item.name}</h2><p className="mt-1 text-sm text-secondary-ink">{[item.board, item.city, item.state].filter(Boolean).join(' · ') || 'Institution details unavailable'}</p></div><StatusBadge tone={item.is_active == null ? 'neutral' : item.is_active ? 'success' : 'warning'}>{item.is_active == null ? '—' : item.is_active ? 'Active' : 'Paused'}</StatusBadge></Surface>)}</div>}</div>;
}

function OperationsGrid({ items }: { items: Array<{ href: string; title: string; description: string; risk?: string }> }) {
  return <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <Link href={item.href} key={item.href}><Surface className="h-full p-5"><div className="flex items-start justify-between gap-3"><h2 className="font-bold">{item.title}</h2>{item.risk && <StatusBadge tone="warning">{item.risk}</StatusBadge>}</div><p className="mt-2 text-sm text-secondary-ink">{item.description}</p></Surface></Link>)}</div>;
}

export function SuperV3Operations() {
  const alerts = useAdminResource<{ total?: number; state?: string }>('/api/super-admin/alerts');
  const health = useAdminResource<{ schools?: Array<{ id: string; errors_24h?: string }>; synthetic_monitor_degraded?: boolean; errors_24h_degraded?: boolean }>('/api/super-admin/health');
  const errorRows = health.data?.schools;
  const hasCompleteErrorEvidence = Boolean(errorRows?.length) && errorRows!.every((school) => school.errors_24h != null && Number.isFinite(Number(school.errors_24h)));
  const errors = health.data?.errors_24h_degraded || !hasCompleteErrorEvidence ? null : errorRows!.reduce((sum, school) => sum + Number(school.errors_24h), 0);
  const syntheticMonitor = health.loading || health.error || health.data?.synthetic_monitor_degraded == null ? null : health.data.synthetic_monitor_degraded ? 'Degraded' : 'Available';
  return <div className="space-y-5"><PageHeader title="Operations" description="Live platform operations with governed drill-down and audit context." actions={<Button onClick={() => { alerts.retry(); health.retry(); }}>Refresh</Button>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Alert rules" value={alerts.loading || alerts.error || alerts.data?.state === 'table_missing' ? null : alerts.data?.total} source={alerts.data?.state === 'table_missing' ? 'Alert registry unavailable' : 'Alert registry read model'} definition="Governed alert-rule records available to the current environment." retrievedAt={alerts.retrievedAt} evidenceHref="/super-admin/alerts" /><Metric label="Institutions monitored" value={health.loading || health.error ? null : health.data?.schools?.length} source="Platform health read model" definition="Institutions returned by the current platform health snapshot." retrievedAt={health.retrievedAt} evidenceHref="/super-admin/health" /><Metric label="Errors · 24h" value={errors} source={health.data?.errors_24h_degraded ? 'Monitoring source degraded' : 'Platform health read model'} definition="Sum of 24-hour institution error counts only when every returned count is available." retrievedAt={health.retrievedAt} evidenceHref="/super-admin/observability" /><Metric label="Synthetic monitor" value={syntheticMonitor} source="Platform health read model" definition="Availability state returned by the environment synthetic monitor." retrievedAt={health.retrievedAt} evidenceHref="/super-admin/health" /></div>
    {(alerts.error || health.error) && <DataState state="stale" title="Some operational signals are unavailable" description="Unavailable values are shown as —; no fallback was calculated in the browser." />}
    <OperationsGrid items={[{ href: '/super-admin/observability', title: 'Observability', description: 'Events, snapshots and governed monitoring rules.' }, { href: '/super-admin/alerts', title: 'Alerts', description: 'Investigate active customer and platform alerts.' }, { href: '/super-admin/bulk-actions', title: 'Bulk actions', description: 'Every mutation requires explicit selection, impact review and server authorization.', risk: 'Audited' }, { href: '/super-admin/flags', title: 'Feature flags', description: 'Cohort and capability controls with rollback context.', risk: 'Audited' }, { href: '/super-admin/logs', title: 'Audit trail', description: 'Verify authorized operator and system actions.' }, { href: '/super-admin/health', title: 'Platform health', description: 'Infrastructure and service readiness evidence.' }]} />
  </div>;
}

export function SuperV3Revenue() {
  const payments = useAdminResource<{ data?: { stuckCount?: number; failureCount24h?: number; activationTiming?: { median?: number; p95?: number; max?: number; sampleSize?: number } } }>('/api/super-admin/payment-ops/stats');
  const hasTiming = (payments.data?.data?.activationTiming?.sampleSize ?? 0) > 0;
  return <div className="space-y-5"><PageHeader title="Revenue" description="Live payment operations separated from learning and platform health." actions={<Button onClick={payments.retry}>Refresh</Button>} />
    {payments.loading ? <DataState state="loading" title="Loading payment operations" /> : payments.error ? <DataState state="error" title="Payment operations are unavailable" action={<Button onClick={payments.retry}>Try again</Button>} /> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Stuck payments" value={payments.data?.data?.stuckCount} source="Payment operations read model" definition="Captured payments without a corresponding activated plan." retrievedAt={payments.retrievedAt} evidenceHref="/super-admin/subscriptions" /><Metric label="Failures · 24h" value={payments.data?.data?.failureCount24h} source="Payment operations read model" definition="Payment failure events in the rolling 24-hour window." retrievedAt={payments.retrievedAt} evidenceHref="/super-admin/invoices" /><Metric label="Median activation" value={!hasTiming || payments.data?.data?.activationTiming?.median == null ? null : `${Math.round(payments.data.data.activationTiming.median)}s`} source="Payment operations read model" definition="Median elapsed seconds from captured payment to plan activation for the returned sample." retrievedAt={payments.retrievedAt} evidenceHref="/super-admin/subscriptions" /><Metric label="P95 activation" value={!hasTiming || payments.data?.data?.activationTiming?.p95 == null ? null : `${Math.round(payments.data.data.activationTiming.p95)}s`} source="Payment operations read model" definition="95th-percentile elapsed seconds from captured payment to plan activation for the returned sample." retrievedAt={payments.retrievedAt} evidenceHref="/super-admin/subscriptions" /></div>}
    <OperationsGrid items={[{ href: '/super-admin/subscriptions', title: 'Subscriptions', description: 'Plan state and governed payment operations.' }, { href: '/super-admin/invoices', title: 'Invoices', description: 'Invoice state, failures and reconciliation.' }, { href: '/super-admin/analytics-b2b', title: 'B2B analytics', description: 'Institution adoption and subscription evidence.' }, { href: '/super-admin/intelligence/revenue', title: 'Revenue intelligence', description: 'Source-backed customer and revenue analysis.' }]} />
  </div>;
}

export function SuperV3Governance() {
  const audit = useAdminResource<{ data?: Array<{ id: string; action?: string; resource_type?: string; created_at?: string }>; total?: number }>('/api/super-admin/logs?limit=5');
  return <div className="space-y-5"><PageHeader title="Governance" description="Permissions, contracts, audit and data-control surfaces." />
    <Surface className="p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Recent audited activity</h2><p className="text-sm text-secondary-ink">{audit.data?.total ?? '—'} recorded actions</p></div><Link href="/super-admin/logs" className="text-sm font-semibold">Full audit log</Link></div>{audit.loading ? <DataState state="loading" compact title="Loading audit trail" /> : audit.error ? <DataState state="error" compact title="Audit trail unavailable" action={<Button onClick={audit.retry}>Try again</Button>} /> : !(audit.data?.data?.length) ? <DataState state="empty" compact title="No audit entries" /> : <div className="mt-4 divide-y divide-border">{audit.data.data.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.action ?? 'Recorded action'}</p><p className="text-sm text-secondary-ink">{item.resource_type ?? 'Resource —'}</p></div><span className="text-xs text-secondary-ink">{item.created_at ? new Date(item.created_at).toLocaleString('en-IN') : '—'}</span></div>)}</div>}</Surface>
    <OperationsGrid items={[{ href: '/super-admin/rbac', title: 'Roles & access', description: 'Operator permission assignments and elevation boundaries.', risk: 'Restricted' }, { href: '/super-admin/entitlements', title: 'Entitlements', description: 'Institution plan and capability contracts.' }, { href: '/super-admin/readiness-rubric', title: 'Release readiness', description: 'Production evidence and operational release controls.' }, { href: '/super-admin/users', title: 'Read-only view as', description: 'Open the actual user experience through the existing read-only adapter; no mutation credentials are issued.' }]} />
  </div>;
}
