'use client';

/**
 * /super-admin/foxy-quality — B'-1 Phase 2 dashboard.
 *
 * Renders the LLM-as-judge eval signal: 7-day rolling averages, prior-week
 * delta (drift detector), per-day trend table, and the 10 lowest-overall
 * scores in the last 30 days for triage. Fed by /api/super-admin/foxy-quality
 * which reads from foxy_quality_scores (populated nightly by
 * /api/cron/foxy-quality-sample).
 *
 * P13: never renders the message body, the question, or studentId. The
 * "Open in workbench" link is keyed on message_id and routes to the
 * existing super-admin workbench surface (separate RBAC).
 */

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';

interface AvgScores {
  overall: number;
  accuracy: number;
  scaffold: number;
  age: number;
  scope: number;
}

interface DailyAverage {
  day: string;
  count: number;
  overall: number;
  accuracy: number;
  scaffold: number;
  age: number;
  scope: number;
}

interface LowestScore {
  messageId: string;
  sessionId: string;
  scoredAt: string;
  overall: number;
  accuracy: number;
  scaffold: number;
  age: number;
  scope: number;
  notes: string | null;
}

interface DashboardData {
  rubricVersion: string;
  totalScored: number;
  last7DayAvg: AvgScores | null;
  prev7DayAvg: AvgScores | null;
  weeklyDelta: number | null;
  dailyAverages: DailyAverage[];
  lowestRecent: LowestScore[];
}

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const TD_R = `${TD} text-right`;

function FoxyQualityPageInner() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/foxy-quality');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { success: boolean; data: DashboardData };
      if (body.success) setData(body.data);
      else setError('API returned success=false');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading && !data) {
    return <p className="text-muted-foreground">Loading quality scores…</p>;
  }
  if (error || !data) {
    return <p className="text-danger">{error ?? 'No data'}</p>;
  }

  const deltaClass =
    data.weeklyDelta === null
      ? 'text-muted-foreground'
      : data.weeklyDelta >= 0
        ? 'text-success'
        : data.weeklyDelta <= -10
          ? 'text-danger'
          : 'text-warning';
  const deltaPrefix = data.weeklyDelta !== null && data.weeklyDelta > 0 ? '+' : '';

  const overallClass = (v: number) =>
    v < 50 ? 'text-danger' : v < 70 ? 'text-warning' : 'text-foreground';

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Foxy Quality (LLM-as-judge)</h1>
        <p className="mb-1.5 text-sm text-muted-foreground">
          Nightly Sonnet judge scores Foxy answers across 4 dimensions: accuracy
          (vs cited NCERT chunks), scaffold fidelity (per coach mode),
          age-appropriateness, and CBSE scope. Composite uses
          0.40 / 0.30 / 0.20 / 0.10 weights. Rubric: <strong>{data.rubricVersion}</strong>.
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          {data.totalScored} answers scored in the last 30 days.
        </p>
      </div>

      {/* KPI tiles */}
      <section className="mb-5 grid grid-cols-5 gap-3">
        {([
          { label: 'Overall', key: 'overall' },
          { label: 'Accuracy', key: 'accuracy' },
          { label: 'Scaffold', key: 'scaffold' },
          { label: 'Age-fit', key: 'age' },
          { label: 'CBSE scope', key: 'scope' },
        ] as const).map(({ label, key }) => {
          const cur = data.last7DayAvg?.[key];
          const prev = data.prev7DayAvg?.[key];
          const delta = cur !== undefined && prev !== undefined ? cur - prev : null;
          const localDeltaClass =
            delta === null
              ? ''
              : key === 'overall'
                ? deltaClass
                : delta >= 0
                  ? 'text-success'
                  : delta <= -10
                    ? 'text-danger'
                    : 'text-warning';
          return (
            <div key={key} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-1 text-[28px] font-bold text-foreground">{cur ?? '—'}</div>
              <div className="text-[11px] text-muted-foreground">last 7d avg</div>
              {delta !== null && (
                <div className={`mt-1 text-xs font-medium ${localDeltaClass}`}>
                  {delta > 0 ? '+' : ''}
                  {delta} vs prev 7d
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Drift banner */}
      {data.weeklyDelta !== null && data.weeklyDelta <= -10 && (
        <div className="mb-4 rounded-lg border border-danger p-4 text-[13px] text-danger" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>
          ⚠ Quality drift: overall is {deltaPrefix}
          {data.weeklyDelta} points vs the prior 7 days. Investigate before promoting any prompt change.
        </div>
      )}

      {/* Daily trend table */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Daily averages — last 14 days
        </h2>
        {data.dailyAverages.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            No scores yet. The nightly cron at 03:40 UTC will populate this on the next run.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Day (UTC)</th>
                  <th className={TH_R}>Count</th>
                  <th className={TH_R}>Overall</th>
                  <th className={TH_R}>Accuracy</th>
                  <th className={TH_R}>Scaffold</th>
                  <th className={TH_R}>Age</th>
                  <th className={TH_R}>Scope</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyAverages.map((d) => (
                  <tr key={d.day}>
                    <td className={TD}>{d.day}</td>
                    <td className={TD_R}>{d.count}</td>
                    <td className={`${TD_R} font-semibold`}>{d.overall}</td>
                    <td className={TD_R}>{d.accuracy}</td>
                    <td className={TD_R}>{d.scaffold}</td>
                    <td className={TD_R}>{d.age}</td>
                    <td className={TD_R}>{d.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lowest 10 — triage queue */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Lowest overall — last 30 days
        </h2>
        {data.lowestRecent.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            Nothing scored yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Scored at</th>
                  <th className={TH_R}>Overall</th>
                  <th className={TH_R}>Acc</th>
                  <th className={TH_R}>Scaff</th>
                  <th className={TH_R}>Age</th>
                  <th className={TH_R}>Scope</th>
                  <th className={TH}>Judge note</th>
                  <th className={TH}>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.lowestRecent.map((r) => (
                  <tr key={r.messageId}>
                    <td className={`${TD} text-xs text-muted-foreground`}>
                      {new Date(r.scoredAt).toLocaleString()}
                    </td>
                    <td className={`${TD_R} font-bold ${overallClass(r.overall)}`}>{r.overall}</td>
                    <td className={TD_R}>{r.accuracy}</td>
                    <td className={TD_R}>{r.scaffold}</td>
                    <td className={TD_R}>{r.age}</td>
                    <td className={TD_R}>{r.scope}</td>
                    <td className={`${TD} max-w-[320px] text-xs text-muted-foreground`}>
                      {r.notes ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {r.messageId.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function FoxyQualityPage() {
  return (
    <AdminShell>
      <FoxyQualityPageInner />
    </AdminShell>
  );
}
