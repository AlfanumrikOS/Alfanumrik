'use client';

/**
 * /super-admin/intelligence/revenue — EIC · Revenue
 *
 * Consumes GET /api/super-admin/intelligence/revenue. Flag-gated by
 * ff_education_intelligence (notFound when OFF). English-only.
 *
 * 5 StatCards (MRR, ARR, New, Churned, Net New sign-colored), MRR&ARR line,
 * new-vs-churn bar, top-schools-by-MRR bar, per-school MRR table (share %,
 * MoM delta). Top blue/partial honesty banner consolidates both caveats.
 */

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard, DataTable, NoDataState, type Column } from '@alfanumrik/ui/admin-ui';
import {
  formatINR,
  EICHeader,
  EICEmpty,
  Caveat,
  NEW_MRR_CAVEAT,
  CHURN_SIGNAL_CAVEAT,
  useEducationIntelligenceFlag,
} from '../shared';

const LineChart = dynamic(() => import('@alfanumrik/ui/admin-ui').then((m) => m.LineChart), { ssr: false });
const BarChart = dynamic(() => import('@alfanumrik/ui/admin-ui').then((m) => m.BarChart), { ssr: false });

interface SeriesPoint {
  snapshot_date: string;
  total_mrr: number;
  student_mrr: number;
  school_mrr: number;
  new_mrr: number;
  churn_mrr: number;
  arr: number;
}
interface TopSchool {
  school_id: string;
  school_name: string | null;
  mrr: number;
  arr: number;
  seats_purchased: number;
  [key: string]: unknown;
}
interface RevenueData {
  series: SeriesPoint[];
  top_schools: TopSchool[];
}

function RevenueContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/intelligence/revenue');
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

  if (loading && !data) return <div className="p-10 text-center text-muted-foreground">Loading revenue…</div>;
  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="mb-3 text-sm text-danger">{error}</div>
        <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const series = data.series;
  const latest = series[series.length - 1] ?? null;
  const netNew = latest ? latest.new_mrr - latest.churn_mrr : 0;
  const totalTopMrr = data.top_schools.reduce((a, s) => a + s.mrr, 0);
  const latestDate = latest?.snapshot_date ?? null;

  const hasData = series.length > 0 || data.top_schools.length > 0;

  const tableColumns: Column<TopSchool>[] = [
    {
      key: 'school_name', label: 'School',
      render: r => <strong className="text-foreground">{r.school_name ?? r.school_id.slice(0, 8)}</strong>,
    },
    { key: 'mrr', label: 'MRR', render: r => <span className="font-semibold">{formatINR(r.mrr)}</span> },
    {
      key: 'share', label: 'Share %',
      render: r => <span className="tabular-nums">{totalTopMrr > 0 ? `${((r.mrr / totalTopMrr) * 100).toFixed(1)}%` : '—'}</span>,
    },
    { key: 'seats_purchased', label: 'Seats', render: r => <span>{r.seats_purchased.toLocaleString()}</span> },
    {
      key: 'mom', label: 'MoM Δ',
      // MoM delta is not yet exposed per-school by the read API; render a
      // neutral placeholder rather than fabricate a number (P1 honesty).
      render: () => <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div>
      <EICHeader
        title="Education Intelligence · Revenue"
        subtitle="Platform MRR / ARR trend, new vs churned, and per-school revenue"
        rollupDate={latestDate}
        generatedAt={null}
        onRefresh={fetchData}
      />

      {/* Consolidated honesty banner (blue/partial — NOT red) */}
      <div className="mb-6">
        <NoDataState
          reason="partial"
          title="Revenue figures are v1 approximations"
          message={`${NEW_MRR_CAVEAT} ${CHURN_SIGNAL_CAVEAT}`}
        />
      </div>

      {!hasData && <div className="mb-6"><EICEmpty /></div>}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="MRR" value={latest ? formatINR(latest.total_mrr) : '—'} accentColor="var(--success)" />
        <StatCard label="ARR" value={latest ? formatINR(latest.arr) : '—'} accentColor="var(--info)" />
        <div>
          <StatCard label="New MRR" value={latest ? formatINR(latest.new_mrr) : '—'} accentColor="var(--success)" />
          <div className="mt-1 px-[18px] text-[10px] leading-tight text-muted-foreground"><Caveat text={NEW_MRR_CAVEAT} /> {NEW_MRR_CAVEAT}</div>
        </div>
        <StatCard label="Churned MRR" value={latest ? formatINR(latest.churn_mrr) : '—'} accentColor="var(--danger)" />
        <StatCard
          label="Net New MRR"
          value={latest ? formatINR(netNew) : '—'}
          accentColor={netNew >= 0 ? 'var(--success)' : 'var(--danger)'}
          subtitle="New − Churn"
        />
      </div>

      {/* MRR & ARR line */}
      <div className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">MRR &amp; ARR (90d)</h2>
        <LineChart
          series={[
            { name: 'MRR', data: series.map(s => ({ x: s.snapshot_date, y: s.total_mrr })) },
            { name: 'ARR', data: series.map(s => ({ x: s.snapshot_date, y: s.arr })) },
          ]}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            New vs Churned MRR <Caveat text={NEW_MRR_CAVEAT} />
          </h2>
          <p className="m-0 mb-3 text-[11px] text-muted-foreground">{NEW_MRR_CAVEAT}</p>
          <BarChart
            series={[
              { name: 'New MRR', data: series.map(s => ({ x: s.snapshot_date, y: s.new_mrr })) },
              { name: 'Churned MRR', data: series.map(s => ({ x: s.snapshot_date, y: s.churn_mrr })) },
            ]}
          />
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Schools by MRR</h2>
          <BarChart
            series={[{
              name: 'MRR',
              data: data.top_schools.slice(0, 15).map(s => ({ x: s.school_name ?? s.school_id.slice(0, 6), y: s.mrr })),
            }]}
          />
        </div>
      </div>

      {/* Per-school MRR table */}
      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Per-School MRR</h2>
        {data.top_schools.length === 0 ? (
          <EICEmpty />
        ) : (
          <DataTable columns={tableColumns} data={data.top_schools} keyField="school_id" emptyMessage="No school revenue data" />
        )}
      </div>
    </div>
  );
}

export default function RevenuePage() {
  const flag = useEducationIntelligenceFlag();
  if (flag === false) notFound();
  return (
    <AdminShell>
      {flag === null
        ? <div className="p-10 text-center text-muted-foreground">Loading…</div>
        : <RevenueContent />}
    </AdminShell>
  );
}
