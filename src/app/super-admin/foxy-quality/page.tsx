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
import { colors, S } from '../_components/admin-styles';

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
    return <p style={{ color: colors.text3 }}>Loading quality scores…</p>;
  }
  if (error || !data) {
    return <p style={{ color: colors.danger }}>{error ?? 'No data'}</p>;
  }

  const deltaColor =
    data.weeklyDelta === null
      ? colors.text3
      : data.weeklyDelta >= 0
        ? colors.success
        : data.weeklyDelta <= -10
          ? colors.danger
          : colors.warning;
  const deltaPrefix = data.weeklyDelta !== null && data.weeklyDelta > 0 ? '+' : '';

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.h1}>Foxy Quality (LLM-as-judge)</h1>
        <p style={{ ...S.subtitle, marginBottom: 6 }}>
          Nightly Sonnet judge scores Foxy answers across 4 dimensions: accuracy
          (vs cited NCERT chunks), scaffold fidelity (per coach mode),
          age-appropriateness, and CBSE scope. Composite uses
          0.40 / 0.30 / 0.20 / 0.10 weights. Rubric: <strong>{data.rubricVersion}</strong>.
        </p>
        <p style={{ fontSize: 12, color: colors.text3, margin: 0 }}>
          {data.totalScored} answers scored in the last 30 days.
        </p>
      </div>

      {/* KPI tiles */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
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
          return (
            <div key={key} style={S.card}>
              <div style={{ fontSize: 11, color: colors.text2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                {label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: colors.text1, marginTop: 4 }}>
                {cur ?? '—'}
              </div>
              <div style={{ fontSize: 11, color: colors.text3 }}>last 7d avg</div>
              {delta !== null && (
                <div
                  style={{
                    fontSize: 12,
                    color:
                      key === 'overall' ? deltaColor : delta >= 0 ? colors.success : delta <= -10 ? colors.danger : colors.warning,
                    marginTop: 4,
                    fontWeight: 500,
                  }}
                >
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
        <div
          style={{
            ...S.card,
            background: colors.dangerLight,
            borderColor: colors.danger,
            color: colors.danger,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          ⚠ Quality drift: overall is {deltaPrefix}
          {data.weeklyDelta} points vs the prior 7 days. Investigate before promoting any prompt change.
        </div>
      )}

      {/* Daily trend table */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Daily averages — last 14 days</h2>
        {data.dailyAverages.length === 0 ? (
          <div style={{ ...S.card, color: colors.text3, fontSize: 13 }}>
            No scores yet. The nightly cron at 03:40 UTC will populate this on the next run.
          </div>
        ) : (
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Day (UTC)</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Count</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Overall</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Accuracy</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Scaffold</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Age</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Scope</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyAverages.map((d) => (
                  <tr key={d.day}>
                    <td style={S.td}>{d.day}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{d.count}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{d.overall}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{d.accuracy}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{d.scaffold}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{d.age}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{d.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lowest 10 — triage queue */}
      <section>
        <h2 style={S.h2}>Lowest overall — last 30 days</h2>
        {data.lowestRecent.length === 0 ? (
          <div style={{ ...S.card, color: colors.text3, fontSize: 13 }}>
            Nothing scored yet.
          </div>
        ) : (
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Scored at</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Overall</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Acc</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Scaff</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Age</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Scope</th>
                  <th style={S.th}>Judge note</th>
                  <th style={S.th}>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.lowestRecent.map((r) => (
                  <tr key={r.messageId}>
                    <td style={{ ...S.td, fontSize: 12, color: colors.text2 }}>
                      {new Date(r.scoredAt).toLocaleString()}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: r.overall < 50 ? colors.danger : r.overall < 70 ? colors.warning : colors.text1 }}>
                      {r.overall}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.accuracy}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.scaffold}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.age}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{r.scope}</td>
                    <td style={{ ...S.td, fontSize: 12, color: colors.text2, maxWidth: 320 }}>
                      {r.notes ?? <span style={{ color: colors.text3 }}>—</span>}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: colors.text3 }}>
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
