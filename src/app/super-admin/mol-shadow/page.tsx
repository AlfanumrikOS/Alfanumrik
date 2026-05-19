'use client';

/**
 * /super-admin/mol-shadow — C4.2b-iii MOL shadow-routing dashboard.
 *
 * Observability surface for the Model Orchestration Layer shadow pipeline.
 * Reads /api/super-admin/mol-shadow which aggregates mol_request_logs,
 * mol_shadow_pairs_v1, mol_request_health_24h, and the two C4 feature
 * flags into a single read.
 *
 * P13 (data privacy): this page NEVER renders question text, baseline
 * response text, or shadow response text. The "View detail" link is a
 * placeholder for a separate page (`/super-admin/mol-shadow/[id]`) that
 * will surface the text-comparison UI with its own audit-log gate.
 * The placeholder link is wired so navigation works once that page lands.
 *
 * Auto-refreshes every 60s — the underlying read is heavier than the
 * grounding-health page (which polls every 30s) because the in-memory
 * pair JOIN is on a 7-day window.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AdminShell, { useAdmin } from '../_components/AdminShell';

// ── Types (mirror the route's response shape) ─────────────────────────────

interface FlagState {
  enabled: boolean;
  kill_switch: boolean;
  rollout_pct: number;
  task_types: string[];
}

interface TextCaptureFlag {
  enabled: boolean;
}

interface DailyRollup {
  shadow_cost_inr: number;
  shadow_cost_cap_inr: number;
  grader_cost_inr: number;
  grader_cost_cap_inr: number;
  shadow_rows_24h: number;
  graded_pairs_24h: number;
}

interface CostDeltaRow {
  task_type: string;
  n_pairs: number;
  baseline_inr_avg: number;
  shadow_inr_avg: number;
  delta_inr: number;
  delta_pct: number;
}

interface QualityBlock {
  n_graded_7d: number;
  per_dimension_avg: {
    accuracy: number | null;
    cbse_scope: number | null;
    age_appropriateness: number | null;
    scaffold_fidelity: number | null;
    helpfulness: number | null;
    citation_accuracy: number | null;
  };
  winner_distribution: { baseline: number; shadow: number; tie: number };
  overall_mean: number | null;
}

interface LatencyRow {
  provider: string;
  task_type: string;
  shadow_role: string | null;
  p50_ms: number;
  p95_ms: number;
  n_requests: number;
}

interface FallbackRow {
  task_type: string;
  n_requests: number;
  n_failures: number;
  failure_rate_pct: number;
}

interface CoverageRow {
  task_type: string;
  graded: number;
  ungraded: number;
  skipped_no_text: number;
  total: number;
  graded_pct: number;
}

interface RecentRow {
  shadow_request_id: string;
  baseline_request_id: string | null;
  task_type: string;
  shadow_grader_score: number;
  winner: 'baseline' | 'shadow' | 'tie' | null;
  latency_delta_ms: number | null;
  cost_delta_inr: number | null;
  created_at: string;
  graded_at: string | null;
}

interface DashboardData {
  generated_at: string;
  flags: { shadow: FlagState; text_capture: TextCaptureFlag };
  daily: DailyRollup;
  cost_delta: CostDeltaRow[];
  quality: QualityBlock;
  latency: LatencyRow[];
  fallback: FallbackRow[];
  sample_coverage: CoverageRow[];
  recent: RecentRow[];
  thresholds: {
    latency_warn_delta_ms: number;
    fallback_warn_pct: number;
    coverage_warn_pct: number;
  };
}

// ── Style constants (match foxy-quality + grounding/health) ───────────────

const TH =
  'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const TD_R = `${TD} text-right`;
const H2 = 'mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const CARD = 'rounded-lg border border-surface-3 bg-surface-1 p-4';

const POLL_MS = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────

function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatScore(n: number | null): string {
  return n === null ? '—' : n.toFixed(3);
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Map p95 deltas to a colour: red if shadow is >warn slower than baseline. */
function latencyWarnClass(row: LatencyRow, peers: LatencyRow[], warnDelta: number): string {
  if (row.shadow_role !== 'shadow') return '';
  // Find the baseline peer for the same (task_type) — provider differs by
  // design (baseline=anthropic, shadow=openai).
  const baseline = peers.find(
    (p) => p.task_type === row.task_type && p.shadow_role === 'baseline',
  );
  if (!baseline) return '';
  return row.p95_ms > baseline.p95_ms + warnDelta ? 'text-danger font-semibold' : '';
}

// ── Tiles ─────────────────────────────────────────────────────────────────

function FlagStatusTile({
  flag,
  textCapture,
}: {
  flag: FlagState;
  textCapture: TextCaptureFlag;
}) {
  const status = flag.kill_switch
    ? { label: 'KILL SWITCH', cls: 'bg-danger/10 text-danger', border: 'border-danger' }
    : flag.enabled
      ? { label: 'ENABLED', cls: 'bg-success/10 text-success', border: 'border-success' }
      : { label: 'DISABLED', cls: 'bg-surface-2 text-muted-foreground', border: 'border-surface-3' };

  const textStatus = textCapture.enabled
    ? { label: 'ENABLED', cls: 'bg-success/10 text-success' }
    : { label: 'DISABLED', cls: 'bg-surface-2 text-muted-foreground' };

  return (
    <div className={`${CARD} ${status.border}`} data-testid="flag-status-tile">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Shadow flag
      </div>
      <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-bold ${status.cls}`}>
        {status.label}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Rollout: <b className="text-foreground">{flag.rollout_pct}%</b>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Task types: <b className="text-foreground">{flag.task_types.length}</b>
      </div>
      <div className="mt-3 border-t border-surface-3 pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Text capture
        </div>
        <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-bold ${textStatus.cls}`}>
          {textStatus.label}
        </div>
      </div>
    </div>
  );
}

function CostBudgetTile({
  label,
  spent,
  cap,
  testId,
}: {
  label: string;
  spent: number;
  cap: number;
  testId: string;
}) {
  const pct = cap === 0 ? 0 : Math.min(100, (spent / cap) * 100);
  const cls = pct >= 90 ? 'text-danger' : pct >= 70 ? 'text-warning' : 'text-success';
  return (
    <div className={CARD} data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-[24px] font-bold ${cls}`}>{formatInr(spent)}</div>
      <div className="text-[11px] text-muted-foreground">
        of {formatInr(cap)} cap ({pct.toFixed(0)}%)
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
        <div
          className={
            pct >= 90 ? 'h-full bg-danger' : pct >= 70 ? 'h-full bg-warning' : 'h-full bg-success'
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function VolumeTile({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className={CARD} data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[24px] font-bold text-foreground">
        {value.toLocaleString('en-IN')}
      </div>
      <div className="text-[11px] text-muted-foreground">last 24h</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

function MolShadowPageInner() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/mol-shadow');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { success: boolean; data: DashboardData; error?: string };
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setData(body.data);
      setError(null);
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchDashboard();
    timerRef.current = setInterval(fetchDashboard, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchDashboard]);

  if (loading && !data) {
    return <p className="text-muted-foreground">Loading MOL shadow dashboard…</p>;
  }
  if (error && !data) {
    return (
      <div data-testid="mol-shadow-error" className="rounded-md bg-danger/10 p-3 text-[13px] text-danger">
        Error loading dashboard: {error}
      </div>
    );
  }
  if (!data) return null;

  // Empty-state hint: shadow rows could be 0 if the canary has not been flipped.
  const emptyShadow = data.daily.shadow_rows_24h === 0;

  return (
    <div data-testid="mol-shadow-page">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">MOL Shadow Routing</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            Observability for the C4 shadow pipeline. Baseline (Anthropic) serves the
            user; shadow (OpenAI) is fired in parallel, discarded from the user-path,
            and graded offline by Sonnet for quality comparison.
          </p>
          <p className="mt-1 m-0 text-[11px] text-muted-foreground">
            P13: this dashboard never renders question or response text — only
            aggregate scores, costs, and request UUIDs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[11px] text-muted-foreground">
              Last updated: {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchDashboard}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-warning/10 p-3 text-[13px] text-warning">
          Refresh error: {error} (showing last successful data)
        </div>
      )}

      {emptyShadow && (
        <div
          data-testid="mol-shadow-empty-banner"
          className="mb-4 rounded-md bg-surface-2 p-3 text-[13px] text-muted-foreground"
        >
          No shadow rows in the last 24h. The canary either has not been flipped, or
          the kill switch is active. Once <code>ff_grounded_answer_mol_shadow_v1</code>{' '}
          is enabled with a non-zero rollout, rows will appear here within minutes.
        </div>
      )}

      {/* ── Header row: status + budgets + volume ───────────────────────── */}
      <section className="mb-6 grid grid-cols-5 gap-3">
        <FlagStatusTile flag={data.flags.shadow} textCapture={data.flags.text_capture} />
        <CostBudgetTile
          label="Shadow cost today"
          spent={data.daily.shadow_cost_inr}
          cap={data.daily.shadow_cost_cap_inr}
          testId="shadow-cost-tile"
        />
        <CostBudgetTile
          label="Grader cost today"
          spent={data.daily.grader_cost_inr}
          cap={data.daily.grader_cost_cap_inr}
          testId="grader-cost-tile"
        />
        <VolumeTile
          label="Shadow rows"
          value={data.daily.shadow_rows_24h}
          testId="shadow-rows-tile"
        />
        <VolumeTile
          label="Graded pairs"
          value={data.daily.graded_pairs_24h}
          testId="graded-pairs-tile"
        />
      </section>

      {/* ── Cost delta ──────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className={H2}>Cost delta — baseline vs shadow (last 7d, sorted by greatest savings)</h2>
        {data.cost_delta.length === 0 ? (
          <div className={`${CARD} text-[13px] text-muted-foreground`}>
            No paired baseline ↔ shadow rows yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]" data-testid="cost-delta-table">
              <thead>
                <tr>
                  <th className={TH}>Task type</th>
                  <th className={TH_R}>Pairs</th>
                  <th className={TH_R}>Baseline ₹/call</th>
                  <th className={TH_R}>Shadow ₹/call</th>
                  <th className={TH_R}>Δ ₹/call</th>
                  <th className={TH_R}>Δ %</th>
                </tr>
              </thead>
              <tbody>
                {data.cost_delta.map((r) => {
                  const savings = r.delta_pct < 0;
                  return (
                    <tr key={r.task_type}>
                      <td className={TD}>{r.task_type}</td>
                      <td className={TD_R}>{r.n_pairs.toLocaleString('en-IN')}</td>
                      <td className={TD_R}>{formatInr(r.baseline_inr_avg)}</td>
                      <td className={TD_R}>{formatInr(r.shadow_inr_avg)}</td>
                      <td
                        className={`${TD_R} font-semibold ${savings ? 'text-success' : 'text-danger'}`}
                      >
                        {formatInr(r.delta_inr)}
                      </td>
                      <td
                        className={`${TD_R} font-semibold ${savings ? 'text-success' : 'text-danger'}`}
                      >
                        {r.delta_pct > 0 ? '+' : ''}
                        {r.delta_pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Quality (per-dimension averages + winner distribution) ──────── */}
      <section className="mb-6">
        <h2 className={H2}>Quality (last 7d, n={data.quality.n_graded_7d})</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className={`${CARD} col-span-2`} data-testid="quality-dimensions">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Dimension</th>
                  <th className={TH_R}>Shadow mean</th>
                  <th className={TH}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['accuracy', 'Factual claims are true'],
                    ['cbse_scope', 'Stays inside CBSE curriculum'],
                    ['age_appropriateness', 'Language fits the grade'],
                    ['scaffold_fidelity', 'Builds understanding step-by-step'],
                    ['helpfulness', 'Addresses the asked question'],
                    ['citation_accuracy', 'Mean excludes null rows (rubric v2)'],
                  ] as const
                ).map(([key, note]) => (
                  <tr key={key}>
                    <td className={TD}>
                      <code className="text-xs">{key}</code>
                    </td>
                    <td className={`${TD_R} font-semibold`}>
                      {formatScore(data.quality.per_dimension_avg[key])}
                    </td>
                    <td className={`${TD} text-xs text-muted-foreground`}>{note}</td>
                  </tr>
                ))}
                <tr>
                  <td className={`${TD} font-semibold`}>overall</td>
                  <td className={`${TD_R} font-bold`}>
                    {formatScore(data.quality.overall_mean)}
                  </td>
                  <td className={`${TD} text-xs text-muted-foreground`}>
                    Weighted sum, recomputed defensively
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={CARD} data-testid="winner-distribution">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Winner distribution
            </div>
            <div className="mt-3 space-y-2">
              {(
                [
                  ['baseline', data.quality.winner_distribution.baseline, '#2563EB'],
                  ['shadow', data.quality.winner_distribution.shadow, '#16A34A'],
                  ['tie', data.quality.winner_distribution.tie, '#9CA3AF'],
                ] as const
              ).map(([label, count, color]) => {
                const total =
                  data.quality.winner_distribution.baseline +
                  data.quality.winner_distribution.shadow +
                  data.quality.winner_distribution.tie;
                const pct = total === 0 ? 0 : (count / total) * 100;
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{label}</span>
                      <span className="text-muted-foreground">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2">
                      <div style={{ width: `${pct}%`, background: color, height: '100%' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Latency ──────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className={H2}>Latency (last 24h, per provider × task_type)</h2>
        {data.latency.length === 0 ? (
          <div className={`${CARD} text-[13px] text-muted-foreground`}>No latency data.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]" data-testid="latency-table">
              <thead>
                <tr>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Task type</th>
                  <th className={TH}>Role</th>
                  <th className={TH_R}>n requests</th>
                  <th className={TH_R}>p50 ms</th>
                  <th className={TH_R}>p95 ms</th>
                </tr>
              </thead>
              <tbody>
                {data.latency.map((row) => (
                  <tr key={`${row.provider}-${row.task_type}-${row.shadow_role}`}>
                    <td className={TD}>{row.provider}</td>
                    <td className={TD}>{row.task_type}</td>
                    <td className={TD}>{row.shadow_role ?? '—'}</td>
                    <td className={TD_R}>{row.n_requests.toLocaleString('en-IN')}</td>
                    <td className={TD_R}>{row.p50_ms.toLocaleString('en-IN')}</td>
                    <td
                      className={`${TD_R} ${latencyWarnClass(row, data.latency, data.thresholds.latency_warn_delta_ms)}`}
                    >
                      {row.p95_ms.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-surface-3 bg-surface-2 px-3.5 py-2 text-[11px] text-muted-foreground">
              Red p95 = shadow exceeds baseline by &gt; {data.thresholds.latency_warn_delta_ms}ms on
              the same task_type.
            </div>
          </div>
        )}
      </section>

      {/* ── Fallback rate ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className={H2}>Fallback rate (last 24h, per task type)</h2>
        {data.fallback.length === 0 ? (
          <div className={`${CARD} text-[13px] text-muted-foreground`}>No fallback data.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]" data-testid="fallback-table">
              <thead>
                <tr>
                  <th className={TH}>Task type</th>
                  <th className={TH_R}>n requests</th>
                  <th className={TH_R}>n failures</th>
                  <th className={TH_R}>Failure rate</th>
                </tr>
              </thead>
              <tbody>
                {data.fallback.map((row) => {
                  const warn = row.failure_rate_pct > data.thresholds.fallback_warn_pct;
                  return (
                    <tr key={row.task_type}>
                      <td className={TD}>{row.task_type}</td>
                      <td className={TD_R}>{row.n_requests.toLocaleString('en-IN')}</td>
                      <td className={TD_R}>{row.n_failures.toLocaleString('en-IN')}</td>
                      <td
                        className={`${TD_R} font-semibold ${warn ? 'text-danger' : 'text-foreground'}`}
                      >
                        {formatPct(row.failure_rate_pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-surface-3 bg-surface-2 px-3.5 py-2 text-[11px] text-muted-foreground">
              Red rate &gt; {data.thresholds.fallback_warn_pct}% on any task type signals an upstream
              regression.
            </div>
          </div>
        )}
      </section>

      {/* ── Sample coverage ─────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className={H2}>Sample coverage (last 7d, per task type)</h2>
        {data.sample_coverage.length === 0 ? (
          <div className={`${CARD} text-[13px] text-muted-foreground`}>
            No graded sample yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]" data-testid="coverage-table">
              <thead>
                <tr>
                  <th className={TH}>Task type</th>
                  <th className={TH_R}>Graded</th>
                  <th className={TH_R}>Ungraded</th>
                  <th className={TH_R}>Skipped (no text)</th>
                  <th className={TH_R}>Total</th>
                  <th className={TH_R}>Graded %</th>
                </tr>
              </thead>
              <tbody>
                {data.sample_coverage.map((row) => {
                  const warn = row.graded_pct < data.thresholds.coverage_warn_pct;
                  return (
                    <tr key={row.task_type}>
                      <td className={TD}>{row.task_type}</td>
                      <td className={TD_R}>{row.graded.toLocaleString('en-IN')}</td>
                      <td className={TD_R}>{row.ungraded.toLocaleString('en-IN')}</td>
                      <td className={TD_R}>{row.skipped_no_text.toLocaleString('en-IN')}</td>
                      <td className={TD_R}>{row.total.toLocaleString('en-IN')}</td>
                      <td
                        className={`${TD_R} font-semibold ${warn ? 'text-warning' : 'text-success'}`}
                      >
                        {formatPct(row.graded_pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-surface-3 bg-surface-2 px-3.5 py-2 text-[11px] text-muted-foreground">
              Yellow &lt; {data.thresholds.coverage_warn_pct}% means the grader is falling behind on
              sampled pairs.
            </div>
          </div>
        )}
      </section>

      {/* ── Recent graded runs ──────────────────────────────────────────── */}
      <section>
        <h2 className={H2}>Recent grader runs (last {data.recent.length})</h2>
        {data.recent.length === 0 ? (
          <div className={`${CARD} text-[13px] text-muted-foreground`}>
            No graded pairs yet. The Sonnet grader runs nightly via daily-cron.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]" data-testid="recent-table">
              <thead>
                <tr>
                  <th className={TH}>Shadow ID</th>
                  <th className={TH}>Task type</th>
                  <th className={TH_R}>Score</th>
                  <th className={TH}>Winner</th>
                  <th className={TH_R}>Δ latency</th>
                  <th className={TH_R}>Δ cost</th>
                  <th className={TH}>Graded at</th>
                  <th className={TH}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.shadow_request_id}>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {truncateId(r.shadow_request_id)}
                    </td>
                    <td className={TD}>{r.task_type}</td>
                    <td className={`${TD_R} font-bold`}>{r.shadow_grader_score.toFixed(3)}</td>
                    <td className={TD}>
                      {r.winner ? (
                        <span
                          className={
                            r.winner === 'shadow'
                              ? 'rounded bg-success/10 px-1.5 py-0.5 text-xs font-semibold text-success'
                              : r.winner === 'baseline'
                                ? 'rounded bg-info/10 px-1.5 py-0.5 text-xs font-semibold text-foreground'
                                : 'rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {r.winner}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={`${TD_R} text-xs text-muted-foreground`}>
                      {r.latency_delta_ms === null ? '—' : `${r.latency_delta_ms > 0 ? '+' : ''}${r.latency_delta_ms} ms`}
                    </td>
                    <td className={`${TD_R} text-xs text-muted-foreground`}>
                      {r.cost_delta_inr === null ? '—' : formatInr(r.cost_delta_inr)}
                    </td>
                    <td className={`${TD} text-xs text-muted-foreground`}>
                      {r.graded_at ? new Date(r.graded_at).toLocaleString() : '—'}
                    </td>
                    <td className={`${TD} text-xs`}>
                      <Link
                        href={`/super-admin/mol-shadow/${encodeURIComponent(r.shadow_request_id)}`}
                        className="text-info hover:underline"
                      >
                        View detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-surface-3 bg-surface-2 px-3.5 py-2 text-[11px] text-muted-foreground">
              The detail page is a separate, audit-logged surface (deferred — placeholder link
              for now).
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function MolShadowPage() {
  return (
    <AdminShell>
      <MolShadowPageInner />
    </AdminShell>
  );
}
