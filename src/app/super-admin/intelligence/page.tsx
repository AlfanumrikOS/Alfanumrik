'use client';

/**
 * /super-admin/intelligence — Education Intelligence Cloud · Overview
 *
 * Consumes GET /api/super-admin/intelligence/overview (backend-owned read API).
 * Flag-gated by ff_education_intelligence: when OFF the whole EIC group is
 * hidden in the nav and this page renders notFound(). Pages stay behind
 * super-admin auth (AdminShell) regardless.
 *
 * English-only (internal tooling). Charts are lazy-loaded (dynamic import) to
 * keep this admin page code-split (P10). The only non-Recharts primitive is the
 * plain-CSS ScoreBar; page-level charts use the admin-ui Recharts wrappers.
 */

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import {
  StatCard,
  StatusBadge,
  DataTable,
  NoDataState,
  StalenessTag,
  type Column,
} from '@/components/admin-ui';
import { getFeatureFlags } from '@/lib/supabase';
import { EDUCATION_INTELLIGENCE_FLAGS } from '@/lib/feature-flags';

// Charts are code-split off the initial page bundle (P10).
const LineChart = dynamic(() => import('@/components/admin-ui').then((m) => m.LineChart), { ssr: false });
const BarChart = dynamic(() => import('@/components/admin-ui').then((m) => m.BarChart), { ssr: false });
const DonutChart = dynamic(() => import('@/components/admin-ui').then((m) => m.DonutChart), { ssr: false });

// ── Shared EIC helpers (English-only; internal tooling) ──

export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/** 0-100 score band → admin-ui StatusBadge variant. */
export function bandVariant(score: number | null | undefined): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  if (score == null || !Number.isFinite(score)) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'info';
  if (score >= 40) return 'warning';
  return 'danger';
}

const TIER_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  elite: 'success',
  healthy: 'info',
  needs_attention: 'warning',
  critical: 'danger',
};

const CHURN_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

/** Honesty caption shared across New/Net-New MRR surfaces. */
export const NEW_MRR_CAVEAT =
  'v1 approximation — expansion revenue is folded into New MRR. Not yet separated from net-new logos.';
export const CHURN_SIGNAL_CAVEAT =
  'Payment-failure churn signal covers B2C subscriptions only. B2B/institutional churn is inferred from engagement, not billing.';

/** Inline ⓘ tooltip caption used next to a label that carries a caveat. */
export function Caveat({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="ml-1 inline-flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full border border-surface-3 text-[9px] font-bold text-muted-foreground align-middle"
    >
      ⓘ
    </span>
  );
}

/** Latest-rollup-date tag rendered next to a page title. */
export function RollupDate({ date }: { date: string | null }) {
  if (!date) return null;
  return (
    <span className="ml-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wider">Latest rollup</span>
      <span className="font-semibold text-foreground">{date}</span>
    </span>
  );
}

/** Shared page header with refresh + staleness. */
export function EICHeader({
  title,
  subtitle,
  rollupDate,
  generatedAt,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  rollupDate: string | null;
  generatedAt: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <div className="flex flex-wrap items-center">
          <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <RollupDate date={rollupDate} />
          {generatedAt && (
            <span className="ml-2">
              <StalenessTag lastUpdated={new Date(generatedAt)} />
            </span>
          )}
        </div>
        <p className="m-0 mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      <button
        onClick={onRefresh}
        className="shrink-0 rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
      >
        ↻ Refresh
      </button>
    </div>
  );
}

/** Standard EIC empty state (tables empty until migrations + nightly job run). */
export function EICEmpty() {
  return (
    <NoDataState
      reason="no_data"
      title="No intelligence data yet"
      message="The nightly rollup tables have not been populated. Data appears after the first nightly job runs post-migration."
    />
  );
}

/** Hook: resolve ff_education_intelligence client-side. null = still loading. */
export function useEducationIntelligenceFlag(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getFeatureFlags()
      .then((flags) => { if (!cancelled) setEnabled(Boolean(flags[EDUCATION_INTELLIGENCE_FLAGS.V1])); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

// ── API shapes (mirror /api/super-admin/intelligence/overview) ──

interface OverviewData {
  mrr: {
    total: number; arr: number; student: number; school: number;
    new: number; churn: number; snapshot_date: string;
  } | null;
  health: {
    tier_counts: { elite: number; healthy: number; needs_attention: number; critical: number };
    schools_scored: number;
    avg_composite: number;
  };
  churn: {
    band_counts: { low: number; medium: number; high: number; critical: number };
    top_risks: TopRisk[];
  };
  generated_at: string;
}

interface TopRisk {
  school_id: string;
  school_name: string | null;
  risk_score: number;
  risk_band: string | null;
  days_to_renewal: number | null;
  reasons: string[];
  [key: string]: unknown;
}

// ── Content ──

function OverviewContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/intelligence/overview');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !data) {
    return <div className="p-10 text-center text-muted-foreground">Loading intelligence overview…</div>;
  }
  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="mb-3 text-sm text-danger">{error}</div>
        <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const { mrr, health, churn } = data;
  const netNew = mrr ? mrr.new - mrr.churn : 0;
  const totalBandSchools = Object.values(churn.band_counts).reduce((a, b) => a + b, 0);
  const churnRate = totalBandSchools > 0
    ? Math.round(((churn.band_counts.high + churn.band_counts.critical) / totalBandSchools) * 1000) / 10
    : 0;
  const atRisk = churn.band_counts.high + churn.band_counts.critical;
  const activeSchools = health.schools_scored;

  const hasData = Boolean(mrr) || activeSchools > 0 || totalBandSchools > 0;

  const riskColumns: Column<TopRisk>[] = [
    {
      key: 'school_name', label: 'School',
      render: r => <strong className="text-foreground">{r.school_name ?? r.school_id.slice(0, 8)}</strong>,
    },
    {
      key: 'risk_score', label: 'Risk',
      render: r => <span className="font-semibold tabular-nums">{Math.round(r.risk_score)}</span>,
    },
    {
      key: 'risk_band', label: 'Band',
      render: r => (
        <span className="inline-flex items-center gap-1.5">
          {(r.risk_band === 'critical') && (
            <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
          )}
          <StatusBadge label={r.risk_band ?? '—'} variant={CHURN_VARIANT[r.risk_band ?? ''] ?? 'neutral'} />
        </span>
      ),
    },
    {
      key: 'days_to_renewal', label: 'Renewal',
      render: r => r.days_to_renewal == null
        ? <span className="text-muted-foreground">—</span>
        : <span className={r.days_to_renewal <= 30 ? 'font-semibold text-danger' : ''}>{r.days_to_renewal}d</span>,
    },
    {
      key: 'reasons', label: 'Top reasons',
      render: r => <span className="text-[12px] text-muted-foreground">{r.reasons.slice(0, 2).join('; ') || '—'}</span>,
    },
  ];

  return (
    <div>
      <EICHeader
        title="Education Intelligence · Overview"
        subtitle="Platform revenue, school health, and churn risk at a glance"
        rollupDate={mrr?.snapshot_date ?? null}
        generatedAt={data.generated_at}
        onRefresh={fetchData}
      />

      {!hasData && <div className="mb-6"><EICEmpty /></div>}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Platform MRR"
          value={mrr ? formatINR(mrr.total) : '—'}
          accentColor="#16A34A"
          subtitle={mrr ? `ARR ${formatINR(mrr.arr)}` : 'No snapshot'}
        />
        <div>
          <StatCard
            label="Net New MRR"
            value={mrr ? formatINR(netNew) : '—'}
            accentColor={netNew >= 0 ? '#16A34A' : '#DC2626'}
            subtitle={mrr ? `New ${formatINR(mrr.new)} · Churn ${formatINR(mrr.churn)}` : '—'}
          />
          <div className="mt-1 px-[18px] text-[10px] leading-tight text-muted-foreground">
            <Caveat text={NEW_MRR_CAVEAT} /> {NEW_MRR_CAVEAT}
          </div>
        </div>
        <StatCard label="Active Schools" value={activeSchools} accentColor="#2563EB" subtitle="Scored in latest rollup" />
        <StatCard
          label="At-Risk Schools"
          value={atRisk}
          accentColor={atRisk > 0 ? '#DC2626' : '#6B7280'}
          subtitle="High + critical churn band"
        />
        <StatCard
          label="Avg Composite Health"
          value={health.avg_composite}
          accentColor={
            health.avg_composite >= 80 ? '#16A34A'
              : health.avg_composite >= 60 ? '#2563EB'
              : health.avg_composite >= 40 ? '#D97706' : '#DC2626'
          }
          subtitle="0-100, latest per school"
        />
        <StatCard
          label="Churn Rate"
          value={`${churnRate}%`}
          accentColor={churnRate >= 15 ? '#DC2626' : churnRate >= 5 ? '#D97706' : '#16A34A'}
          subtitle="High/critical share of scored schools"
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">MRR (latest snapshot)</h2>
          <LineChart
            series={mrr ? [{ name: 'MRR', data: [{ x: mrr.snapshot_date, y: mrr.total }] }] : []}
            emptyLabel="Full 90-day MRR trend on the Revenue page"
          />
          <p className="m-0 mt-2 text-[11px] text-muted-foreground">90-day MRR trend lives on the Revenue page.</p>
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Health Tier Distribution</h2>
          <DonutChart
            data={[
              { name: 'Elite', value: health.tier_counts.elite },
              { name: 'Healthy', value: health.tier_counts.healthy },
              { name: 'Needs attention', value: health.tier_counts.needs_attention },
              { name: 'Critical', value: health.tier_counts.critical },
            ]}
          />
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          New vs Churned MRR <Caveat text={NEW_MRR_CAVEAT} />
        </h2>
        <p className="m-0 mb-3 text-[11px] text-muted-foreground">{NEW_MRR_CAVEAT}</p>
        <BarChart
          series={mrr ? [
            { name: 'New MRR', data: [{ x: mrr.snapshot_date, y: mrr.new }] },
            { name: 'Churned MRR', data: [{ x: mrr.snapshot_date, y: mrr.churn }] },
          ] : []}
        />
      </div>

      {/* At-risk panel */}
      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          At-Risk Schools (top 8 by risk score) <Caveat text={CHURN_SIGNAL_CAVEAT} />
        </h2>
        {churn.top_risks.length === 0 ? (
          <EICEmpty />
        ) : (
          <DataTable
            columns={riskColumns}
            data={churn.top_risks.slice(0, 8)}
            keyField="school_id"
            emptyMessage="No at-risk schools"
            onRowClick={(r) => { window.location.href = `/super-admin/intelligence/schools/${r.school_id}`; }}
          />
        )}
        <p className="m-0 mt-2 text-[11px] text-muted-foreground"><Caveat text={CHURN_SIGNAL_CAVEAT} /> {CHURN_SIGNAL_CAVEAT}</p>
      </div>
    </div>
  );
}

export default function IntelligenceOverviewPage() {
  const flag = useEducationIntelligenceFlag();
  if (flag === false) notFound();
  return (
    <AdminShell>
      {flag === null
        ? <div className="p-10 text-center text-muted-foreground">Loading…</div>
        : <OverviewContent />}
    </AdminShell>
  );
}
