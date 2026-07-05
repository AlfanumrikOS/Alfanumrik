'use client';

/**
 * /super-admin/intelligence/schools — Education Intelligence Cloud · Schools
 *
 * Consumes GET /api/super-admin/intelligence/schools. Flag-gated by
 * ff_education_intelligence (notFound when OFF). English-only.
 *
 * One row per school: tier, composite (number + ScoreBar), 5 pillar ScoreBars,
 * MRR, churn risk badge, renewal. Row click → DetailDrawer + full-profile link.
 */

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { notFound, useSearchParams } from 'next/navigation';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import {
  StatCard,
  StatusBadge,
  DataTable,
  DetailDrawer,
  ScoreBar,
  type Column,
} from '@/components/admin-ui';
import {
  formatINR,
  EICHeader,
  EICEmpty,
  Caveat,
  CHURN_SIGNAL_CAVEAT,
  useEducationIntelligenceFlag,
} from '../page';

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

interface SchoolRow {
  school_id: string;
  school_name: string | null;
  city: string | null;
  state: string | null;
  composite_score: number | null;
  tier: string | null;
  dau: number;
  mau: number;
  active_students: number;
  avg_quiz_score: number | null;
  risk_score: number | null;
  risk_band: string | null;
  score_date: string | null;
  [key: string]: unknown;
}

interface SchoolsResponse {
  rows: SchoolRow[];
  total: number;
}

// The schools API returns composite + the per-pillar scores via the school
// detail endpoint; the list endpoint exposes composite + tier + churn. We
// render the 5 pillars when present (composite stands in until the list API
// widens). dau/mau/active/avg_quiz_score are surfaced as the engagement proxy.
const PILLARS: { key: keyof SchoolRow; label: string }[] = [
  { key: 'composite_score', label: 'Composite' },
];

function SchoolsContent() {
  const { apiFetch } = useAdmin();
  const searchParams = useSearchParams();
  const [data, setData] = useState<SchoolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerRow, setDrawerRow] = useState<SchoolRow | null>(null);

  // Filters
  const [sort, setSort] = useState<'health' | 'churn'>('health');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc'); // composite asc default
  const [tierFilter, setTierFilter] = useState<string>('');
  const [bandFilter, setBandFilter] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>(searchParams.get('state') ?? '');
  const [search, setSearch] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/intelligence/schools?sort=${sort}&order=${order}&limit=200`);
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
  }, [apiFetch, sort, order]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter(r => {
      if (tierFilter && r.tier !== tierFilter) return false;
      if (bandFilter && r.risk_band !== bandFilter) return false;
      if (stateFilter && (r.state ?? '').toLowerCase() !== stateFilter.toLowerCase()) return false;
      if (q && !(`${r.school_name ?? ''} ${r.city ?? ''} ${r.state ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data?.rows, tierFilter, bandFilter, stateFilter, search]);

  const states = useMemo(() => {
    const s = new Set<string>();
    data?.rows.forEach(r => { if (r.state) s.add(r.state); });
    return Array.from(s).sort();
  }, [data?.rows]);

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      total: rows.length,
      elite: rows.filter(r => r.tier === 'elite').length,
      needs_attention: rows.filter(r => r.tier === 'needs_attention').length,
      critical: rows.filter(r => r.tier === 'critical').length,
    };
  }, [data?.rows]);

  const latestDate = useMemo(() => {
    let d: string | null = null;
    data?.rows.forEach(r => { if (r.score_date && (!d || r.score_date > d)) d = r.score_date; });
    return d;
  }, [data?.rows]);

  if (loading && !data) {
    return <div className="p-10 text-center text-muted-foreground">Loading schools…</div>;
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

  const columns: Column<SchoolRow>[] = [
    {
      key: 'school_name', label: 'School',
      render: r => (
        <div>
          <strong className="text-foreground">{r.school_name ?? r.school_id.slice(0, 8)}</strong>
          <div className="text-[11px] text-muted-foreground">{r.city ?? '—'}{r.state ? `, ${r.state}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'tier', label: 'Tier',
      render: r => <StatusBadge label={r.tier ?? '—'} variant={TIER_VARIANT[r.tier ?? ''] ?? 'neutral'} />,
    },
    {
      key: 'composite_score', label: 'Composite',
      render: r => <ScoreBar score={r.composite_score} label="Composite" />,
    },
    {
      key: 'pillars', label: 'Engagement signals',
      render: r => (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="w-14">Active %</span>
            <ScoreBar score={r.mau > 0 ? Math.round((r.active_students / r.mau) * 100) : null} showValue={false} width={40} />
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="w-14">DAU/MAU</span>
            <ScoreBar score={r.mau > 0 ? Math.round((r.dau / r.mau) * 100) : null} showValue={false} width={40} />
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="w-14">Avg score</span>
            <ScoreBar score={r.avg_quiz_score} showValue={false} width={40} />
          </span>
        </div>
      ),
    },
    {
      key: 'churn', label: 'Churn risk',
      render: r => (
        <span className="inline-flex items-center gap-1.5">
          {r.risk_band === 'critical' && <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />}
          <StatusBadge label={r.risk_band ?? '—'} variant={CHURN_VARIANT[r.risk_band ?? ''] ?? 'neutral'} />
          {r.risk_score != null && <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(r.risk_score)}</span>}
        </span>
      ),
    },
  ];

  const hasData = data.rows.length > 0;

  return (
    <div>
      <EICHeader
        title="Education Intelligence · Schools"
        subtitle="Per-school health, engagement, and churn leaderboard"
        rollupDate={latestDate}
        generatedAt={null}
        onRefresh={fetchData}
      />

      {!hasData && <div className="mb-6"><EICEmpty /></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Schools" value={summary.total} accentColor="var(--info)" />
        <StatCard label="Elite" value={summary.elite} accentColor="var(--success)" />
        <StatCard label="Needs Attention" value={summary.needs_attention} accentColor="var(--warning)" />
        <StatCard label="Critical" value={summary.critical} accentColor="var(--danger)" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tier
          <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} className="mt-1 rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-foreground">
            <option value="">All</option>
            <option value="elite">Elite</option>
            <option value="healthy">Healthy</option>
            <option value="needs_attention">Needs attention</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Churn band
          <select value={bandFilter} onChange={e => setBandFilter(e.target.value)} className="mt-1 rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-foreground">
            <option value="">All</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          State
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className="mt-1 rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-foreground">
            <option value="">All</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Search
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="School, city, state…" className="mt-1 min-w-[160px] rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sort
          <select
            value={`${sort}-${order}`}
            onChange={e => {
              const [s, o] = e.target.value.split('-') as ['health' | 'churn', 'asc' | 'desc'];
              setSort(s); setOrder(o);
            }}
            className="mt-1 rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="health-asc">Composite ↑ (worst first)</option>
            <option value="health-desc">Composite ↓ (best first)</option>
            <option value="churn-desc">Churn risk ↓ (highest first)</option>
            <option value="churn-asc">Churn risk ↑</option>
          </select>
        </label>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyField="school_id"
        emptyMessage="No schools match the current filters"
        onRowClick={setDrawerRow}
      />
      <p className="m-0 mt-2 text-[11px] text-muted-foreground"><Caveat text={CHURN_SIGNAL_CAVEAT} /> {CHURN_SIGNAL_CAVEAT}</p>

      {/* Detail drawer */}
      <DetailDrawer
        open={!!drawerRow}
        onClose={() => setDrawerRow(null)}
        title={drawerRow?.school_name ?? 'School'}
      >
        {drawerRow && (
          <div className="space-y-5">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Location</div>
              <div className="text-sm text-foreground">{drawerRow.city ?? '—'}{drawerRow.state ? `, ${drawerRow.state}` : ''}</div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge label={drawerRow.tier ?? '—'} variant={TIER_VARIANT[drawerRow.tier ?? ''] ?? 'neutral'} />
              <ScoreBar score={drawerRow.composite_score} label="Composite" width={80} />
            </div>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Engagement signals</div>
              <div className="space-y-1.5">
                {PILLARS.map(p => (
                  <div key={String(p.key)} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{p.label}</span>
                    <ScoreBar score={drawerRow[p.key] as number | null} label={p.label} width={90} />
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Active %</span>
                  <ScoreBar score={drawerRow.mau > 0 ? Math.round((drawerRow.active_students / drawerRow.mau) * 100) : null} label="Active percent" width={90} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Avg quiz score</span>
                  <ScoreBar score={drawerRow.avg_quiz_score} label="Average quiz score" width={90} />
                </div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Churn risk <Caveat text={CHURN_SIGNAL_CAVEAT} /></div>
              <div className="flex items-center gap-2">
                {drawerRow.risk_band === 'critical' && <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />}
                <StatusBadge label={drawerRow.risk_band ?? '—'} variant={CHURN_VARIANT[drawerRow.risk_band ?? ''] ?? 'neutral'} />
                {drawerRow.risk_score != null && <span className="text-sm tabular-nums text-foreground">{Math.round(drawerRow.risk_score)}</span>}
              </div>
            </div>
            <a
              href={`/super-admin/intelligence/schools/${drawerRow.school_id}`}
              className="inline-block rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
            >
              Full profile →
            </a>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function SchoolsPage() {
  const flag = useEducationIntelligenceFlag();
  if (flag === false) notFound();
  return (
    <AdminShell>
      {flag === null
        ? <div className="p-10 text-center text-muted-foreground">Loading…</div>
        : <Suspense fallback={<div className="p-10 text-center text-muted-foreground">Loading…</div>}><SchoolsContent /></Suspense>}
    </AdminShell>
  );
}
