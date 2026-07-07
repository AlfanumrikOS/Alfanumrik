'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard, CHART_PALETTE } from '@alfanumrik/ui/admin-ui';

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

// Categorical palette — each colour only identifies a reason (no semantic
// load). Cycles the canonical token-driven CHART_PALETTE so no hex leaks in.
const ABSTAIN_COLORS: Record<string, string> = Object.fromEntries(
  ABSTAIN_REASONS.map((r, i) => [r, CHART_PALETTE[i % CHART_PALETTE.length]]),
);
const CATEGORICAL_FALLBACK = 'var(--text-3)';

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

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const H2 = 'mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const H3 = 'mb-2 mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const CARD = 'rounded-lg border border-surface-3 bg-surface-1 p-4';

function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0%';
  return `${Math.round(x * 100)}%`;
}

function circuitStyle(state?: string): {
  bg: string;
  fgClass: string;
  border: string;
  label: string;
} {
  switch (state) {
    case 'closed':
      return { bg: 'color-mix(in srgb, var(--success) 10%, transparent)', fgClass: 'text-success', border: 'var(--success)', label: 'Closed' };
    case 'degraded':
      return { bg: 'color-mix(in srgb, var(--warning) 10%, transparent)', fgClass: 'text-warning', border: 'var(--warning)', label: 'Degraded' };
    case 'open':
      return { bg: 'color-mix(in srgb, var(--danger) 10%, transparent)', fgClass: 'text-danger', border: 'var(--danger)', label: 'Open' };
    default:
      return { bg: 'var(--surface-2)', fgClass: 'text-muted-foreground', border: 'var(--text-3)', label: 'Unknown' };
  }
}

function gaugeAccent(rate: number): string {
  if (rate >= 0.05) return 'var(--danger)';
  if (rate >= 0.01) return 'var(--warning)';
  return 'var(--success)';
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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Grounding Health</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            Live state of the grounded-answer service — polls every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[11px] text-muted-foreground">
              Last updated: {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchHealth}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          data-testid="grounding-health-error"
          className="mb-4 rounded-md p-3 text-[13px] text-danger"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
        >
          Error loading health: {error}
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-[13px] text-muted-foreground">
          Loading grounding health...
        </div>
      )}

      {data && (
        <>
          {/* Calls per minute — one tile per caller */}
          <h2 className={H2}>Calls per minute (last 1 min)</h2>
          <div data-testid="calls-per-min-section" className="mb-6 grid grid-cols-5 gap-3">
            {CALLERS.map((caller) => (
              <StatCard
                key={caller}
                label={caller}
                value={data.callsPerMin[caller] ?? 0}
                accentColor="var(--info)"
              />
            ))}
          </div>

          {/* Grounded rate per caller */}
          <h2 className={H2}>Grounded rate (last hour)</h2>
          <div data-testid="grounded-rate-section" className="mb-6 grid grid-cols-5 gap-3">
            {CALLERS.map((caller) => {
              const rate = data.groundedRate[caller] ?? 0;
              const accent = rate >= 0.9 ? 'var(--success)' : rate >= 0.7 ? 'var(--warning)' : 'var(--danger)';
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
          <h2 className={H2}>Abstain reasons (last hour)</h2>
          <div data-testid="abstain-breakdown" className={`${CARD} mb-6`}>
            {abstainTotal === 0 ? (
              <div className="text-xs text-muted-foreground">
                No abstains in the last hour.
              </div>
            ) : (
              <>
                <div className="flex h-6 overflow-hidden rounded border border-surface-3 bg-surface-2">
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
                          background: ABSTAIN_COLORS[r] ?? CATEGORICAL_FALLBACK,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-3">
                  {ABSTAIN_REASONS.map((r) => (
                    <div key={r} className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: ABSTAIN_COLORS[r] ?? CATEGORICAL_FALLBACK }}
                      />
                      <span className="text-muted-foreground">
                        {r}: <b className="text-foreground">{data.abstainBreakdown[r] ?? 0}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Latency */}
          <h2 className={H2}>Latency (ms, last hour)</h2>
          <div data-testid="latency-section" className="mb-6 grid grid-cols-3 gap-3">
            <StatCard label="p50" value={`${data.latency.p50} ms`} accentColor="var(--success)" />
            <StatCard label="p95" value={`${data.latency.p95} ms`} accentColor="var(--warning)" />
            <StatCard label="p99" value={`${data.latency.p99} ms`} accentColor="var(--danger)" />
          </div>

          {/* Circuit states */}
          <h2 className={H2}>Circuit breakers</h2>
          <div data-testid="circuit-states-section" className="mb-6 grid grid-cols-3 gap-3">
            {(['voyage', 'claude', 'retrieval'] as const).map((name) => {
              const state = data.circuitStates[name];
              const style = circuitStyle(state);
              return (
                <div
                  key={name}
                  data-testid={`circuit-tile-${name}`}
                  className="rounded-lg border border-surface-3 p-4"
                  style={{ borderLeft: `3px solid ${style.border}`, backgroundColor: style.bg }}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {name}
                  </div>
                  <div className={`mt-1 text-xl font-bold ${style.fgClass}`}>
                    {style.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error rates */}
          <h2 className={H2}>Upstream error rates (last 5 min)</h2>
          <div data-testid="error-rates-section" className="mb-6 grid grid-cols-2 gap-3">
            <StatCard
              label="Voyage error rate"
              value={pct(data.voyageErrorRate)}
              accentColor={gaugeAccent(data.voyageErrorRate)}
            />
            <StatCard
              label="Claude error rate"
              value={pct(data.claudeErrorRate)}
              accentColor={gaugeAccent(data.claudeErrorRate)}
            />
          </div>

          {/* Study-path fallback telemetry (ddc41f8 hotfix) */}
          <h2 className={H2}>Study-path fallback (last hour)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Number of times <code>/api/student/subjects</code> or{' '}
            <code>/api/student/chapters</code> fell back to GRADE_SUBJECTS /
            chapters-catalog because the v2 RPC returned empty or errored.
            High during drain days 1-2 is expected; post-pilot should trend to
            zero. Stable non-zero indicates an ingestion problem — see{' '}
            <code>docs/runbooks/grounding/scoring-integrity-epoch.md</code>.
          </p>
          <div data-testid="study-path-fallback-section" className="mb-6 grid grid-cols-3 gap-3">
            <StatCard
              label="Total fallback events"
              value={String(data.studyPathFallback?.totalLastHour ?? 0)}
              accentColor={
                (data.studyPathFallback?.totalLastHour ?? 0) === 0
                  ? 'var(--success)'
                  : (data.studyPathFallback?.totalLastHour ?? 0) > 100
                    ? 'var(--danger)'
                    : 'var(--warning)'
              }
            />
            <StatCard
              label="Subjects route"
              value={String(data.studyPathFallback?.subjectsLastHour ?? 0)}
              accentColor="var(--text-3)"
            />
            <StatCard
              label="Chapters route"
              value={String(data.studyPathFallback?.chaptersLastHour ?? 0)}
              accentColor="var(--text-3)"
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
// reason). Cycles the canonical token-driven CHART_PALETTE so no hex leaks in.
const ORACLE_REASON_COLORS: Record<string, string> = Object.fromEntries(
  ORACLE_REJECTION_CATEGORIES.map((r, i) => [r, CHART_PALETTE[i % CHART_PALETTE.length]]),
);

function formatRejectionRate(
  rate: number | null,
  acceptedEventMissing: boolean,
): { text: string; accent: string } {
  if (rate === null) {
    return {
      text: acceptedEventMissing ? '—' : 'N/A',
      accent: 'var(--text-3)',
    };
  }
  // Health bands per spec: <2% too lax, 2-5% borderline, 5-15% healthy,
  // 15-25% noisy, >25% generator/oracle broken.
  if (rate < 0.02) return { text: pct(rate), accent: 'var(--warning)' };
  if (rate <= 0.15) return { text: pct(rate), accent: 'var(--success)' };
  if (rate <= 0.25) return { text: pct(rate), accent: 'var(--warning)' };
  return { text: pct(rate), accent: 'var(--danger)' };
}

function OracleHealthSection({
  oracle,
  error,
}: {
  oracle: OracleHealthData | null;
  error: string | null;
}) {
  return (
    <div data-testid="oracle-health-section" className="mt-8">
      <h2 className={H2}>Oracle health (last 24h)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
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
          className="mb-4 rounded-md p-3 text-[13px] text-danger"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
        >
          Error loading oracle health: {error}
        </div>
      )}

      {!oracle && !error && (
        <div className="p-4 text-center text-[13px] text-muted-foreground">
          Loading oracle telemetry...
        </div>
      )}

      {oracle && (
        <>
          {/* Top tiles */}
          <div data-testid="oracle-summary-tiles" className="mb-4 grid grid-cols-3 gap-3">
            <StatCard
              label="Total rejected (24h)"
              value={oracle.totalRejected}
              accentColor={oracle.totalRejected === 0 ? 'var(--success)' : 'var(--warning)'}
            />
            <StatCard
              label="Total candidates (24h)"
              value={oracle.totalEvaluated === null ? '—' : oracle.totalEvaluated}
              subtitle={
                oracle.notes.acceptedEventMissing ? 'Accepted-event not yet emitted' : undefined
              }
              accentColor="var(--text-3)"
            />
            <StatCard
              label="Rejection rate"
              value={
                formatRejectionRate(oracle.rejectionRate, oracle.notes.acceptedEventMissing).text
              }
              accentColor={
                formatRejectionRate(oracle.rejectionRate, oracle.notes.acceptedEventMissing).accent
              }
              subtitle="Target: 5-15%"
            />
          </div>

          {/* By-reason breakdown */}
          <h3 className={H3}>Rejections by reason</h3>
          <OracleReasonBreakdown
            byReason={oracle.rejectionsByReason}
            total={oracle.totalRejected}
          />

          {/* Hourly time series */}
          <h3 className={`${H3} mt-4`}>Hourly rejections</h3>
          <OracleSparkline series={oracle.hourlyRejections} />

          {/* Latest 10 */}
          <h3 className={`${H3} mt-4`}>Latest 10 rejections</h3>
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
      <div data-testid="oracle-reason-empty" className={`${CARD} text-xs text-muted-foreground`}>
        No rejections in the last 24 hours.
      </div>
    );
  }

  return (
    <div data-testid="oracle-reason-breakdown" className={CARD}>
      {/* Stacked bar */}
      <div className="flex h-[22px] overflow-hidden rounded border border-surface-3 bg-surface-2">
        {ordered.map((r) => {
          const width = total === 0 ? 0 : (r.count / total) * 100;
          return (
            <div
              key={r.reason}
              data-testid={`oracle-reason-bar-${r.reason}`}
              title={`${r.reason}: ${r.count}`}
              style={{
                width: `${width}%`,
                background: ORACLE_REASON_COLORS[r.reason] ?? CATEGORICAL_FALLBACK,
              }}
            />
          );
        })}
      </div>
      {/* Table — explicit counts so admins can copy values */}
      <table className="mt-3 w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Reason</th>
            <th className={`${TH} text-right`}>Count</th>
            <th className={`${TH} text-right`}>% of rejections</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.reason} data-testid={`oracle-reason-row-${r.reason}`}>
              <td className={TD}>
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                  style={{ background: ORACLE_REASON_COLORS[r.reason] ?? CATEGORICAL_FALLBACK }}
                />
                <code className="text-xs">{r.reason}</code>
              </td>
              <td className={`${TD} text-right font-semibold`}>{r.count}</td>
              <td className={`${TD} text-right text-muted-foreground`}>
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
    <div data-testid="oracle-sparkline" className={CARD}>
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
          stroke="var(--surface-3)"
          strokeWidth={1}
        />
        {total > 0 && (
          <polyline
            points={points}
            fill="none"
            stroke="var(--info)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
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
      <div data-testid="oracle-latest-empty" className={`${CARD} text-xs text-muted-foreground`}>
        No rejections to show.
      </div>
    );
  }
  return (
    <div data-testid="oracle-latest-table" className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Time</th>
            <th className={TH}>Reason</th>
            <th className={TH}>Question (first 80 chars)</th>
            <th className={`${TH} text-right`}>Suggested idx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.occurred_at}-${r.category}`}>
              <td className={`${TD} whitespace-nowrap`}>
                {new Date(r.occurred_at).toLocaleString()}
              </td>
              <td className={TD}>
                <code className="text-xs">{r.category}</code>
              </td>
              <td className={`${TD} max-w-[420px] overflow-hidden text-ellipsis text-muted-foreground`}>
                {r.question_preview ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td className={`${TD} text-right`}>
                {r.suggested_correct_index === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  r.suggested_correct_index
                )}
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
