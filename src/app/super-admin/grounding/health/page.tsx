'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';
import StatCard from '../../_components/StatCard';

/**
 * Grounding Health — super-admin page (Task 3.16)
 *
 * Live operational state of the grounded-answer service. Polls
 * /api/super-admin/grounding/health every 30s (SWR via setInterval —
 * avoids pulling the swr lib just for this).
 *
 * Response shape is defined by the Batch 3C route and documented in
 * spec §4.3. Display is intentionally read-only — actions are on the
 * sister pages (verification-queue, ai-issues).
 */

const CALLERS = ['foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic'] as const;
type Caller = (typeof CALLERS)[number];

const ABSTAIN_REASONS = [
  'chapter_not_ready',
  'no_chunks_retrieved',
  'low_similarity',
  'no_supporting_chunks',
  'scope_mismatch',
  'upstream_error',
  'circuit_open',
] as const;

const ABSTAIN_COLORS: Record<string, string> = {
  chapter_not_ready: '#F59E0B',
  no_chunks_retrieved: '#F97316',
  low_similarity: '#FB923C',
  no_supporting_chunks: '#FBBF24',
  scope_mismatch: '#A855F7',
  upstream_error: '#DC2626',
  circuit_open: '#B91C1C',
};

interface HealthData {
  callsPerMin: Record<Caller, number>;
  groundedRate: Record<Caller, number>;
  abstainBreakdown: Record<string, number>;
  latency: { p50: number; p95: number; p99: number };
  circuitStates: Record<string, 'closed' | 'degraded' | 'open'>;
  voyageErrorRate: number;
  claudeErrorRate: number;
  /**
   * Study-path fallback activity in the last hour.
   * High volume during drain days 1-2 is expected; post-pilot should trend
   * to zero. Stable non-zero = ingestion problem (see scoring-integrity-epoch
   * runbook + ddc41f8 commit message).
   */
  studyPathFallback?: {
    totalLastHour: number;
    subjectsLastHour: number;
    chaptersLastHour: number;
  };
  generated_at: string;
}

/**
 * Oracle telemetry shape — emitted by /api/super-admin/ai/oracle-health.
 * Keep in sync with that route's response contract.
 */
interface OracleHealthData {
  windowHours: number;
  totalRejected: number;
  totalEvaluated: number | null;
  rejectionRate: number | null;
  rejectionsByReason: Record<string, number>;
  latestRejections: Array<{
    occurred_at: string;
    category: string;
    reason: string;
    question_preview: string | null;
    suggested_correct_index: number | null;
  }>;
  hourlyRejections: Array<{ hour: string; count: number }>;
  notes: { acceptedEventMissing: boolean };
  generated_at: string;
}

const POLL_MS = 30_000;

function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0%';
  return `${Math.round(x * 100)}%`;
}

function circuitColor(state?: string): { bg: string; fg: string; label: string } {
  switch (state) {
    case 'closed':
      return { bg: colors.successLight, fg: colors.success, label: 'Closed' };
    case 'degraded':
      return { bg: colors.warningLight, fg: colors.warning, label: 'Degraded' };
    case 'open':
      return { bg: colors.dangerLight, fg: colors.danger, label: 'Open' };
    default:
      return { bg: colors.surface, fg: colors.text3, label: 'Unknown' };
  }
}

function gaugeColor(rate: number): string {
  if (rate >= 0.05) return colors.danger;
  if (rate >= 0.01) return colors.warning;
  return colors.success;
}

function GroundingHealthContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [oracleData, setOracleData] = useState<OracleHealthData | null>(null);
  const [oracleError, setOracleError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/grounding/health');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as { success: boolean; data: HealthData; error?: string };
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setData(body.data);
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const fetchOracle = useCallback(async () => {
    // The oracle panel polls alongside the grounding panel but does not
    // gate the page on its result — a 5xx here only blanks that section.
    try {
      const res = await apiFetch('/api/super-admin/ai/oracle-health');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOracleError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        success: boolean;
        data: OracleHealthData;
        error?: string;
      };
      if (!body.success) {
        setOracleError(body.error || 'Request failed');
        return;
      }
      setOracleData(body.data);
      setOracleError(null);
    } catch (err) {
      setOracleError(err instanceof Error ? err.message : 'Failed to fetch oracle health');
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchHealth();
    fetchOracle();
    timerRef.current = setInterval(() => {
      fetchHealth();
      fetchOracle();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchHealth, fetchOracle]);

  const abstainTotal = data
    ? Object.values(data.abstainBreakdown).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div data-testid="grounding-health-page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Grounding Health</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Live state of the grounded-answer service — polls every 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastFetched && (
            <span style={{ fontSize: 11, color: colors.text3 }}>
              Last updated: {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchHealth} style={S.secondaryBtn}>Refresh</button>
        </div>
      </div>

      {error && (
        <div
          data-testid="grounding-health-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error loading health: {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
          Loading grounding health...
        </div>
      )}

      {data && (
        <>
          {/* Calls per minute — one tile per caller */}
          <h2 style={S.h2}>Calls per minute (last 1 min)</h2>
          <div
            data-testid="calls-per-min-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {CALLERS.map((caller) => (
              <StatCard
                key={caller}
                label={caller}
                value={data.callsPerMin[caller] ?? 0}
                accentColor={colors.accent}
              />
            ))}
          </div>

          {/* Grounded rate per caller */}
          <h2 style={S.h2}>Grounded rate (last hour)</h2>
          <div
            data-testid="grounded-rate-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {CALLERS.map((caller) => {
              const rate = data.groundedRate[caller] ?? 0;
              const accent = rate >= 0.9 ? colors.success : rate >= 0.7 ? colors.warning : colors.danger;
              return (
                <StatCard
                  key={caller}
                  label={caller}
                  value={pct(rate)}
                  accentColor={accent}
                />
              );
            })}
          </div>

          {/* Abstain reasons stacked bar */}
          <h2 style={S.h2}>Abstain reasons (last hour)</h2>
          <div
            data-testid="abstain-breakdown"
            style={{ ...S.card, marginBottom: 24 }}
          >
            {abstainTotal === 0 ? (
              <div style={{ fontSize: 12, color: colors.text3 }}>
                No abstains in the last hour.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    height: 24,
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                  }}
                >
                  {ABSTAIN_REASONS.map((r) => {
                    const count = data.abstainBreakdown[r] ?? 0;
                    const width = abstainTotal === 0 ? 0 : (count / abstainTotal) * 100;
                    if (width === 0) return null;
                    return (
                      <div
                        key={r}
                        title={`${r}: ${count}`}
                        data-testid={`abstain-bar-${r}`}
                        style={{
                          width: `${width}%`,
                          background: ABSTAIN_COLORS[r] ?? colors.text3,
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                  {ABSTAIN_REASONS.map((r) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: ABSTAIN_COLORS[r] ?? colors.text3,
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ color: colors.text2 }}>
                        {r}: <b style={{ color: colors.text1 }}>{data.abstainBreakdown[r] ?? 0}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Latency */}
          <h2 style={S.h2}>Latency (ms, last hour)</h2>
          <div
            data-testid="latency-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard label="p50" value={`${data.latency.p50} ms`} accentColor={colors.success} />
            <StatCard label="p95" value={`${data.latency.p95} ms`} accentColor={colors.warning} />
            <StatCard label="p99" value={`${data.latency.p99} ms`} accentColor={colors.danger} />
          </div>

          {/* Circuit states */}
          <h2 style={S.h2}>Circuit breakers</h2>
          <div
            data-testid="circuit-states-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {(['voyage', 'claude', 'retrieval'] as const).map((name) => {
              const state = data.circuitStates[name];
              const color = circuitColor(state);
              return (
                <div
                  key={name}
                  data-testid={`circuit-tile-${name}`}
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    borderLeft: `3px solid ${color.fg}`,
                    background: color.bg,
                  }}
                >
                  <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 20, color: color.fg, fontWeight: 700, marginTop: 4 }}>
                    {color.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error rates */}
          <h2 style={S.h2}>Upstream error rates (last 5 min)</h2>
          <div
            data-testid="error-rates-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard
              label="Voyage error rate"
              value={pct(data.voyageErrorRate)}
              accentColor={gaugeColor(data.voyageErrorRate)}
            />
            <StatCard
              label="Claude error rate"
              value={pct(data.claudeErrorRate)}
              accentColor={gaugeColor(data.claudeErrorRate)}
            />
          </div>

          {/* Study-path fallback telemetry (ddc41f8 hotfix) */}
          <h2 style={S.h2}>
            Study-path fallback (last hour)
          </h2>
          <p style={{ ...S.small, marginBottom: 12 }}>
            Number of times <code>/api/student/subjects</code> or{' '}
            <code>/api/student/chapters</code> fell back to GRADE_SUBJECTS /
            chapters-catalog because the v2 RPC returned empty or errored.
            High during drain days 1-2 is expected; post-pilot should trend to
            zero. Stable non-zero indicates an ingestion problem — see{' '}
            <code>docs/runbooks/grounding/scoring-integrity-epoch.md</code>.
          </p>
          <div
            data-testid="study-path-fallback-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard
              label="Total fallback events"
              value={String(data.studyPathFallback?.totalLastHour ?? 0)}
              accentColor={
                (data.studyPathFallback?.totalLastHour ?? 0) === 0
                  ? colors.success
                  : (data.studyPathFallback?.totalLastHour ?? 0) > 100
                    ? colors.danger
                    : colors.warning
              }
            />
            <StatCard
              label="Subjects route"
              value={String(data.studyPathFallback?.subjectsLastHour ?? 0)}
              accentColor={colors.text3}
            />
            <StatCard
              label="Chapters route"
              value={String(data.studyPathFallback?.chaptersLastHour ?? 0)}
              accentColor={colors.text3}
            />
          </div>
        </>
      )}

      {/* ── Oracle health (REG-54 / PR #454) ─────────────────────────────
          Telemetry for the AI quiz-generator validation oracle. Renders
          even when grounding `data` is null because the oracle uses a
          separate API route. Health rule of thumb: rejection rate 5-15%
          is healthy. <2% means the oracle is too lax; >25% means the
          generator is broken or the oracle is too strict. */}
      <OracleHealthSection oracle={oracleData} error={oracleError} />
    </div>
  );
}

// ─── Oracle health section ──────────────────────────────────────────────

const ORACLE_REJECTION_CATEGORIES = [
  'p6_text_empty_or_placeholder',
  'p6_options_not_4',
  'p6_options_not_distinct',
  'p6_correct_index_out_of_range',
  'p6_explanation_empty',
  'p6_invalid_difficulty',
  'p6_invalid_bloom',
  'options_overlap_semantic',
  'numeric_inconsistency',
  'llm_mismatch',
  'llm_ambiguous',
  'llm_grader_unavailable',
] as const;

// Categorical palette — no semantic load (each colour just identifies a
// reason). Reuses the abstain palette feel for visual consistency.
const ORACLE_REASON_COLORS: Record<string, string> = {
  p6_text_empty_or_placeholder: '#DC2626',
  p6_options_not_4: '#F97316',
  p6_options_not_distinct: '#FB923C',
  p6_correct_index_out_of_range: '#F59E0B',
  p6_explanation_empty: '#FBBF24',
  p6_invalid_difficulty: '#A855F7',
  p6_invalid_bloom: '#8B5CF6',
  options_overlap_semantic: '#EAB308',
  numeric_inconsistency: '#84CC16',
  llm_mismatch: '#0EA5E9',
  llm_ambiguous: '#3B82F6',
  llm_grader_unavailable: '#B91C1C',
};

function formatRejectionRate(
  rate: number | null,
  acceptedEventMissing: boolean,
): { text: string; accent: string } {
  if (rate === null) {
    return {
      text: acceptedEventMissing ? '—' : 'N/A',
      accent: colors.text3,
    };
  }
  // Health bands per spec: <2% too lax, 2-5% borderline, 5-15% healthy,
  // 15-25% noisy, >25% generator/oracle broken.
  if (rate < 0.02) return { text: pct(rate), accent: colors.warning };
  if (rate <= 0.15) return { text: pct(rate), accent: colors.success };
  if (rate <= 0.25) return { text: pct(rate), accent: colors.warning };
  return { text: pct(rate), accent: colors.danger };
}

function OracleHealthSection({
  oracle,
  error,
}: {
  oracle: OracleHealthData | null;
  error: string | null;
}) {
  return (
    <div data-testid="oracle-health-section" style={{ marginTop: 32 }}>
      <h2 style={S.h2}>Oracle health (last 24h)</h2>
      <p style={{ fontSize: 12, color: colors.text3, marginBottom: 12 }}>
        AI quiz-generator validation oracle (REG-54). Rejected candidates
        never reach <code>question_bank</code>. Healthy rejection rate:
        5-15%. Below 2% means the oracle is too lax; above 25% means the
        generator is broken or the oracle is too strict. Source:{' '}
        <code>ops_events</code> rows with{' '}
        <code>category=&apos;quiz.oracle_rejection&apos;</code>.
      </p>

      {error && (
        <div
          data-testid="oracle-health-error"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
            background: colors.dangerLight,
            color: colors.danger,
            fontSize: 13,
          }}
        >
          Error loading oracle health: {error}
        </div>
      )}

      {!oracle && !error && (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            color: colors.text3,
            fontSize: 13,
          }}
        >
          Loading oracle telemetry...
        </div>
      )}

      {oracle && (
        <>
          {/* Top tiles */}
          <div
            data-testid="oracle-summary-tiles"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <StatCard
              label="Total rejected (24h)"
              value={oracle.totalRejected}
              accentColor={
                oracle.totalRejected === 0 ? colors.success : colors.warning
              }
            />
            <StatCard
              label="Total candidates (24h)"
              value={
                oracle.totalEvaluated === null
                  ? '—'
                  : oracle.totalEvaluated
              }
              subtitle={
                oracle.notes.acceptedEventMissing
                  ? 'Accepted-event not yet emitted'
                  : undefined
              }
              accentColor={colors.text3}
            />
            <StatCard
              label="Rejection rate"
              value={
                formatRejectionRate(
                  oracle.rejectionRate,
                  oracle.notes.acceptedEventMissing,
                ).text
              }
              accentColor={
                formatRejectionRate(
                  oracle.rejectionRate,
                  oracle.notes.acceptedEventMissing,
                ).accent
              }
              subtitle="Target: 5-15%"
            />
          </div>

          {/* By-reason breakdown */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text2,
              textTransform: 'uppercase',
              letterSpacing: 1.2,
              marginBottom: 8,
              marginTop: 8,
            }}
          >
            Rejections by reason
          </h3>
          <OracleReasonBreakdown
            byReason={oracle.rejectionsByReason}
            total={oracle.totalRejected}
          />

          {/* Hourly time series */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text2,
              textTransform: 'uppercase',
              letterSpacing: 1.2,
              marginBottom: 8,
              marginTop: 16,
            }}
          >
            Hourly rejections
          </h3>
          <OracleSparkline series={oracle.hourlyRejections} />

          {/* Latest 10 */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text2,
              textTransform: 'uppercase',
              letterSpacing: 1.2,
              marginBottom: 8,
              marginTop: 16,
            }}
          >
            Latest 10 rejections
          </h3>
          <OracleLatestTable rows={oracle.latestRejections} />
        </>
      )}
    </div>
  );
}

function OracleReasonBreakdown({
  byReason,
  total,
}: {
  byReason: Record<string, number>;
  total: number;
}) {
  // Render in descending count for at-a-glance reading. Categories with
  // count=0 are hidden from the legend so the eye lands on real signal.
  const allReasons = new Set<string>([
    ...ORACLE_REJECTION_CATEGORIES,
    ...Object.keys(byReason),
  ]);
  const ordered = Array.from(allReasons)
    .map((r) => ({ reason: r, count: byReason[r] ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  if (total === 0 || ordered.length === 0) {
    return (
      <div
        data-testid="oracle-reason-empty"
        style={{ ...S.card, fontSize: 12, color: colors.text3 }}
      >
        No rejections in the last 24 hours.
      </div>
    );
  }

  return (
    <div data-testid="oracle-reason-breakdown" style={S.card}>
      {/* Stacked bar */}
      <div
        style={{
          display: 'flex',
          height: 22,
          borderRadius: 4,
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        {ordered.map((r) => {
          const width = total === 0 ? 0 : (r.count / total) * 100;
          return (
            <div
              key={r.reason}
              data-testid={`oracle-reason-bar-${r.reason}`}
              title={`${r.reason}: ${r.count}`}
              style={{
                width: `${width}%`,
                background: ORACLE_REASON_COLORS[r.reason] ?? colors.text3,
              }}
            />
          );
        })}
      </div>
      {/* Table — explicit counts so admins can copy values */}
      <table style={{ ...S.table, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={S.th}>Reason</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Count</th>
            <th style={{ ...S.th, textAlign: 'right' }}>% of rejections</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.reason} data-testid={`oracle-reason-row-${r.reason}`}>
              <td style={S.td}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: ORACLE_REASON_COLORS[r.reason] ?? colors.text3,
                    display: 'inline-block',
                    marginRight: 8,
                    verticalAlign: 'middle',
                  }}
                />
                <code style={{ fontSize: 12 }}>{r.reason}</code>
              </td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>
                {r.count}
              </td>
              <td style={{ ...S.td, textAlign: 'right', color: colors.text2 }}>
                {pct(r.count / total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OracleSparkline({
  series,
}: {
  series: Array<{ hour: string; count: number }>;
}) {
  // Plain inline SVG — no chart library, keeps bundle flat per P10.
  const W = 600;
  const H = 60;
  const PAD = 4;
  const max = Math.max(1, ...series.map((s) => s.count));
  const stepX = series.length > 1 ? (W - 2 * PAD) / (series.length - 1) : 0;
  const points = series
    .map((s, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - (s.count / max) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const total = series.reduce((sum, s) => sum + s.count, 0);

  return (
    <div data-testid="oracle-sparkline" style={S.card}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Hourly oracle rejections, last 24 hours"
      >
        {/* Baseline */}
        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          stroke={colors.border}
          strokeWidth={1}
        />
        {total > 0 && (
          <polyline
            points={points}
            fill="none"
            stroke={colors.accent}
            strokeWidth={1.5}
          />
        )}
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: colors.text3,
          marginTop: 4,
        }}
      >
        <span>24h ago</span>
        <span>peak: {max}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function OracleLatestTable({
  rows,
}: {
  rows: OracleHealthData['latestRejections'];
}) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="oracle-latest-empty"
        style={{ ...S.card, fontSize: 12, color: colors.text3 }}
      >
        No rejections to show.
      </div>
    );
  }
  return (
    <div data-testid="oracle-latest-table" style={{ ...S.card, padding: 0 }}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Time</th>
            <th style={S.th}>Reason</th>
            <th style={S.th}>Question (first 80 chars)</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Suggested idx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.occurred_at}-${r.category}`}>
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                {new Date(r.occurred_at).toLocaleString()}
              </td>
              <td style={S.td}>
                <code style={{ fontSize: 12 }}>{r.category}</code>
              </td>
              <td
                style={{
                  ...S.td,
                  color: colors.text2,
                  maxWidth: 420,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.question_preview ?? <span style={{ color: colors.text3 }}>—</span>}
              </td>
              <td style={{ ...S.td, textAlign: 'right' }}>
                {r.suggested_correct_index === null
                  ? <span style={{ color: colors.text3 }}>—</span>
                  : r.suggested_correct_index}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GroundingHealthPage() {
  return (
    <AdminShell>
      <GroundingHealthContent />
    </AdminShell>
  );
}