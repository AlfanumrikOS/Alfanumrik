'use client';

/**
 * /super-admin/intelligence/geography — EIC · Geography
 *
 * Consumes GET /api/super-admin/intelligence/geography?level=state|city.
 * Flag-gated by ff_education_intelligence (notFound when OFF). English-only.
 *
 * State↔city toggle (NO map — ranked table + bars). 3 StatCards, MRR-by-state
 * bar, avg-health-by-state bar, ranked table (active %, avg health ScoreBar,
 * MRR, churn rate). State row → city view; city row → schools page filtered.
 */

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { notFound } from 'next/navigation';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard, DataTable, ScoreBar, type Column } from '@alfanumrik/ui/admin-ui';
import {
  formatINR,
  EICHeader,
  EICEmpty,
  Caveat,
  CHURN_SIGNAL_CAVEAT,
  useEducationIntelligenceFlag,
} from '../page';

const BarChart = dynamic(() => import('@alfanumrik/ui/admin-ui').then((m) => m.BarChart), { ssr: false });

interface GeoRow {
  geo_key: string;
  school_count: number;
  student_count: number;
  active_students: number;
  avg_health_score: number | null;
  total_mrr: number;
  churn_rate: number | null;
  [key: string]: unknown;
}
interface GeoData {
  level: 'state' | 'city';
  rows: GeoRow[];
}

function GeographyContent() {
  const { apiFetch } = useAdmin();
  const [level, setLevel] = useState<'state' | 'city'>('state');
  const [data, setData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/intelligence/geography?level=${level}`);
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
  }, [apiFetch, level]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = data?.rows ?? [];
  const totalStudents = rows.reduce((a, r) => a + r.student_count, 0);
  const totalActive = rows.reduce((a, r) => a + r.active_students, 0);
  const activeRate = totalStudents > 0 ? Math.round((totalActive / totalStudents) * 1000) / 10 : 0;

  const hasData = rows.length > 0;

  const columns: Column<GeoRow>[] = [
    {
      key: 'geo_key', label: level === 'state' ? 'State' : 'City',
      render: r => <strong className="text-foreground">{r.geo_key}</strong>,
    },
    { key: 'school_count', label: 'Schools', render: r => <span className="tabular-nums">{r.school_count.toLocaleString()}</span> },
    { key: 'student_count', label: 'Students', render: r => <span className="tabular-nums">{r.student_count.toLocaleString()}</span> },
    {
      key: 'active', label: 'Active %',
      render: r => <span className="tabular-nums">{r.student_count > 0 ? `${Math.round((r.active_students / r.student_count) * 100)}%` : '—'}</span>,
    },
    {
      key: 'avg_health_score', label: 'Avg Health',
      render: r => <ScoreBar score={r.avg_health_score} label="Average health" />,
    },
    { key: 'total_mrr', label: 'MRR', render: r => <span className="font-semibold">{formatINR(r.total_mrr)}</span> },
    {
      key: 'churn_rate', label: 'Churn rate',
      render: r => <span className="tabular-nums">{r.churn_rate == null ? '—' : `${(r.churn_rate * (r.churn_rate <= 1 ? 100 : 1)).toFixed(1)}%`}</span>,
    },
  ];

  const handleRowClick = (r: GeoRow) => {
    if (level === 'state') {
      setLevel('city');
    } else {
      // city row → schools page filtered by state (and city, if the schools
      // page consumes it). geo_key at city level is the city name.
      window.location.href = `/super-admin/intelligence/schools?city=${encodeURIComponent(r.geo_key)}`;
    }
  };

  if (loading && !data) return <div className="p-10 text-center text-muted-foreground">Loading geography…</div>;
  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="mb-3 text-sm text-danger">{error}</div>
        <button onClick={fetchData} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <EICHeader
        title="Education Intelligence · Geography"
        subtitle="Distribution by state and city — ranked tables and bars (no map)"
        rollupDate={null}
        generatedAt={null}
        onRefresh={fetchData}
      />

      {/* Level toggle */}
      <div className="mb-4 inline-flex overflow-hidden rounded-md border border-surface-3">
        {(['state', 'city'] as const).map(l => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={[
              'px-4 py-1.5 text-sm font-medium capitalize',
              level === l ? 'bg-foreground text-surface-1' : 'bg-surface-1 text-muted-foreground hover:bg-surface-2',
            ].join(' ')}
          >
            {l}
          </button>
        ))}
      </div>

      {!hasData && <div className="mb-6"><EICEmpty /></div>}

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StatCard label={level === 'state' ? 'States Covered' : 'Cities Covered'} value={rows.length} accentColor="var(--info)" />
        <StatCard label="Total Students" value={totalStudents} accentColor="var(--purple)" />
        <StatCard label="Active Rate" value={`${activeRate}%`} accentColor={activeRate >= 50 ? 'var(--success)' : activeRate >= 25 ? 'var(--warning)' : 'var(--danger)'} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">MRR by {level}</h2>
          <BarChart series={[{ name: 'MRR', data: rows.slice(0, 20).map(r => ({ x: r.geo_key, y: r.total_mrr })) }]} />
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Health by {level}</h2>
          <BarChart series={[{ name: 'Avg Health', data: rows.slice(0, 20).filter(r => r.avg_health_score != null).map(r => ({ x: r.geo_key, y: r.avg_health_score as number })) }]} />
        </div>
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {level === 'state' ? 'States' : 'Cities'} ranked by students — click a row to {level === 'state' ? 'drill into cities' : 'view schools'}
        </h2>
        <DataTable columns={columns} data={rows} keyField="geo_key" emptyMessage="No geographic data" onRowClick={handleRowClick} />
        <p className="m-0 mt-2 text-[11px] text-muted-foreground"><Caveat text={CHURN_SIGNAL_CAVEAT} /> {CHURN_SIGNAL_CAVEAT}</p>
      </div>
    </div>
  );
}

export default function GeographyPage() {
  const flag = useEducationIntelligenceFlag();
  if (flag === false) notFound();
  return (
    <AdminShell>
      {flag === null
        ? <div className="p-10 text-center text-muted-foreground">Loading…</div>
        : <GeographyContent />}
    </AdminShell>
  );
}
