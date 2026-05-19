/**
 * GET /api/super-admin/mol-shadow
 *
 * C4.2b-iii (2026-05-19): super-admin observability surface for the MOL
 * shadow-routing pipeline.
 *
 * Reads from:
 *   - mol_request_logs        — telemetry rows for baseline + shadow legs
 *   - mol_shadow_pairs_v1     — JOINed baseline ↔ shadow rows (analyst view)
 *   - mol_request_health_24h  — hourly rollup view (1h × provider × task_type
 *                                × shadow_role)
 *   - feature_flags           — current envelope state for both shadow flags
 *
 * P13 enforcement:
 *   This route NEVER selects question_text, baseline_response_text, or
 *   shadow_response_text columns from mol_shadow_text_buffer. It returns
 *   only scores, costs, latencies, task_type tags, and the shadow row's
 *   request_id (UUID, not PII). The "View detail" link in the UI is a
 *   placeholder for a separate, fully-RBAC'd page that will surface text
 *   bodies with audit-log gating.
 *
 * Audit:
 *   Every successful GET writes a single audit_logs row
 *   (action='mol_shadow_dashboard_viewed') so the super-admin SIEM has a
 *   trail of who looked at the shadow data and when.
 *
 * Response shape — see {@link MolShadowDashboard} below.
 *
 * Auth: super_admin.access permission via authorizeRequest.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ── Flag names (mirrors supabase/functions/grounded-answer/mol-shadow.ts) ──
const C4_SHADOW_FLAG = 'ff_grounded_answer_mol_shadow_v1';
const C4_TEXT_CAPTURE_FLAG = 'ff_mol_shadow_text_capture_v1';

// ── Daily caps (mirrors supabase/functions/_shared/mol/grader.ts) ─────────
// These INR caps are written in the grader-cron module; the dashboard reads
// them as display constants so the UI can render "₹X spent / ₹Y cap" tiles.
// If the cron's caps change, update these in lockstep.
const SHADOW_DAILY_COST_CAP_INR = 10_000;
const GRADER_DAILY_COST_CAP_INR = 5_000;

// Sampling default — only count rows that the grader would actually try to
// score. Mirrors GRADER_SAMPLING_RATES per task_type.
const TASK_TYPES_WITH_SAMPLING = new Set<string>([
  'doubt_solving',
  'step_by_step',
  'concept_explanation',
  'explanation',
]);

// Latency-warning threshold for the per-provider tile. Aligns with the
// C4 runbook's p95 slack: shadow p95 > baseline p95 + 200ms is a yellow flag.
const LATENCY_WARN_DELTA_MS = 200;

// Fallback warning threshold — > 2% on any task type is a yellow flag.
const FALLBACK_WARN_PCT = 2.0;

// Coverage warning threshold — graded_pct < 80% means the grader is falling
// behind on sampled pairs (over a 7-day window).
const COVERAGE_WARN_PCT = 80;

// Maximum recent grader runs surfaced in the dashboard.
const RECENT_LIMIT = 20;

// ── Response types ────────────────────────────────────────────────────────

interface FlagSnapshot {
  is_enabled: boolean;
  metadata: Record<string, unknown>;
}

interface MolShadowDashboard {
  generated_at: string;
  flags: {
    shadow: {
      enabled: boolean;
      kill_switch: boolean;
      rollout_pct: number;
      task_types: string[];
    };
    text_capture: {
      enabled: boolean;
    };
  };
  daily: {
    shadow_cost_inr: number;
    shadow_cost_cap_inr: number;
    grader_cost_inr: number;
    grader_cost_cap_inr: number;
    shadow_rows_24h: number;
    graded_pairs_24h: number;
  };
  cost_delta: Array<{
    task_type: string;
    n_pairs: number;
    baseline_inr_avg: number;
    shadow_inr_avg: number;
    delta_inr: number;
    delta_pct: number;
  }>;
  quality: {
    n_graded_7d: number;
    per_dimension_avg: {
      accuracy: number | null;
      cbse_scope: number | null;
      age_appropriateness: number | null;
      scaffold_fidelity: number | null;
      helpfulness: number | null;
      /** Mean over non-null rows only; null when every row had null. */
      citation_accuracy: number | null;
    };
    winner_distribution: {
      baseline: number;
      shadow: number;
      tie: number;
    };
    overall_mean: number | null;
  };
  latency: Array<{
    provider: string;
    task_type: string;
    shadow_role: string | null;
    p50_ms: number;
    p95_ms: number;
    n_requests: number;
  }>;
  fallback: Array<{
    task_type: string;
    n_requests: number;
    n_failures: number;
    failure_rate_pct: number;
  }>;
  sample_coverage: Array<{
    task_type: string;
    graded: number;
    ungraded: number;
    skipped_no_text: number;
    total: number;
    graded_pct: number;
  }>;
  recent: Array<{
    shadow_request_id: string;
    baseline_request_id: string | null;
    task_type: string;
    shadow_grader_score: number;
    winner: 'baseline' | 'shadow' | 'tie' | null;
    latency_delta_ms: number | null;
    cost_delta_inr: number | null;
    created_at: string;
    graded_at: string | null;
  }>;
  thresholds: {
    latency_warn_delta_ms: number;
    fallback_warn_pct: number;
    coverage_warn_pct: number;
  };
}

// ── DB row types (narrow what we expect off-the-wire) ─────────────────────

interface MolLogRow {
  request_id: string;
  task_type: string;
  shadow_role: string | null;
  shadow_of_request_id: string | null;
  shadow_grader_score: number | null;
  shadow_grader_payload: Record<string, unknown> | null;
  shadow_graded_at: string | null;
  provider: string | null;
  latency_ms: number | null;
  inr_cost: number | null;
  failure_chain: string | null;
  created_at: string;
}

interface HealthRow {
  hour: string;
  provider: string | null;
  task_type: string;
  shadow_role: string | null;
  n_requests: number | string | null;
  n_failures: number | string | null;
  p50_latency_ms: number | string | null;
  p95_latency_ms: number | string | null;
  inr_cost_sum: number | string | null;
}

interface PairRow {
  request_id: string;
  task_type: string;
  baseline_inr_cost: number | string | null;
  shadow_inr_cost: number | string | null;
  shadow_grader_score: number | null;
  shadow_grader_payload: Record<string, unknown> | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a feature_flags row into a typed envelope. Returns the column +
 * metadata blob; callers project the fields they care about.
 */
function parseFlag(row: { is_enabled?: boolean | null; metadata?: unknown } | null): FlagSnapshot {
  if (!row) return { is_enabled: false, metadata: {} };
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return { is_enabled: row.is_enabled === true, metadata };
}

/**
 * Read the canonical shadow-flag envelope. Mirrors readShadowEnvelope in
 * supabase/functions/grounded-answer/mol-shadow.ts — when metadata.enabled
 * is explicitly set, that wins over the column; otherwise the column wins.
 */
function projectShadowFlag(flag: FlagSnapshot): MolShadowDashboard['flags']['shadow'] {
  const md = flag.metadata;
  const mdEnabled = typeof md.enabled === 'boolean' ? md.enabled : null;
  const enabled = mdEnabled !== null ? mdEnabled : flag.is_enabled;
  const kill_switch = md.kill_switch === true;
  const rolloutRaw = md.rollout_pct;
  const rollout_pct =
    typeof rolloutRaw === 'number' && Number.isFinite(rolloutRaw)
      ? Math.max(0, Math.min(100, Math.round(rolloutRaw)))
      : 0;
  const task_types = Array.isArray(md.task_types)
    ? md.task_types.filter((t): t is string => typeof t === 'string')
    : [];
  return { enabled, kill_switch, rollout_pct, task_types };
}

function projectTextCaptureFlag(flag: FlagSnapshot): MolShadowDashboard['flags']['text_capture'] {
  const md = flag.metadata;
  const mdEnabled = typeof md.enabled === 'boolean' ? md.enabled : null;
  return { enabled: mdEnabled !== null ? mdEnabled : flag.is_enabled };
}

// ── Aggregation helpers ───────────────────────────────────────────────────

/**
 * Build the cost-delta table from pair rows. One bucket per task_type.
 * delta_pct is computed as (shadow - baseline) / baseline × 100; a negative
 * value means the shadow saved money.
 */
function buildCostDelta(pairs: PairRow[]): MolShadowDashboard['cost_delta'] {
  const buckets = new Map<
    string,
    { n: number; baseline_sum: number; shadow_sum: number }
  >();
  for (const p of pairs) {
    const b = toNumber(p.baseline_inr_cost);
    const s = toNumber(p.shadow_inr_cost);
    const cur = buckets.get(p.task_type) ?? { n: 0, baseline_sum: 0, shadow_sum: 0 };
    cur.n += 1;
    cur.baseline_sum += b;
    cur.shadow_sum += s;
    buckets.set(p.task_type, cur);
  }
  const rows = Array.from(buckets.entries()).map(([task_type, b]) => {
    const baseline_inr_avg = b.n === 0 ? 0 : b.baseline_sum / b.n;
    const shadow_inr_avg = b.n === 0 ? 0 : b.shadow_sum / b.n;
    const delta_inr = shadow_inr_avg - baseline_inr_avg;
    const delta_pct =
      baseline_inr_avg === 0 ? 0 : (delta_inr / baseline_inr_avg) * 100;
    return {
      task_type,
      n_pairs: b.n,
      baseline_inr_avg: round4(baseline_inr_avg),
      shadow_inr_avg: round4(shadow_inr_avg),
      delta_inr: round4(delta_inr),
      delta_pct: roundPct(delta_pct),
    };
  });
  // Stable ordering: greatest savings (most negative delta_pct) first.
  rows.sort((a, b) => a.delta_pct - b.delta_pct);
  return rows;
}

/**
 * Compute per-dimension averages over the last-7d graded pairs. Skips
 * citation_accuracy=null rows for that dimension (per grader rubric v2 the
 * dimension is legitimately null on abstain / no-citation turns).
 */
function buildQualityAverages(pairs: PairRow[]): MolShadowDashboard['quality'] {
  const sums = {
    accuracy: 0,
    cbse_scope: 0,
    age_appropriateness: 0,
    scaffold_fidelity: 0,
    helpfulness: 0,
    citation_accuracy: 0,
  };
  const counts = {
    accuracy: 0,
    cbse_scope: 0,
    age_appropriateness: 0,
    scaffold_fidelity: 0,
    helpfulness: 0,
    citation_accuracy: 0,
  };
  const winners = { baseline: 0, shadow: 0, tie: 0 };
  let overallSum = 0;
  let overallCount = 0;

  for (const p of pairs) {
    if (p.shadow_grader_score === null || p.shadow_grader_score === undefined) continue;
    const payload = p.shadow_grader_payload;
    if (!payload || typeof payload !== 'object') continue;

    overallSum += Number(p.shadow_grader_score);
    overallCount += 1;

    const shadow = (payload as { shadow?: Record<string, unknown> }).shadow;
    if (shadow && typeof shadow === 'object') {
      const dims = ['accuracy', 'cbse_scope', 'age_appropriateness', 'scaffold_fidelity', 'helpfulness'] as const;
      for (const d of dims) {
        const v = shadow[d];
        if (typeof v === 'number' && Number.isFinite(v)) {
          sums[d] += v;
          counts[d] += 1;
        }
      }
      // citation_accuracy may be null per rubric v2.
      const c = shadow.citation_accuracy;
      if (typeof c === 'number' && Number.isFinite(c)) {
        sums.citation_accuracy += c;
        counts.citation_accuracy += 1;
      }
    }

    const winner = (payload as { winner?: unknown }).winner;
    if (winner === 'baseline' || winner === 'shadow' || winner === 'tie') {
      winners[winner] += 1;
    }
  }

  const meanOrNull = (key: keyof typeof sums): number | null =>
    counts[key] === 0 ? null : round4(sums[key] / counts[key]);

  return {
    n_graded_7d: overallCount,
    per_dimension_avg: {
      accuracy: meanOrNull('accuracy'),
      cbse_scope: meanOrNull('cbse_scope'),
      age_appropriateness: meanOrNull('age_appropriateness'),
      scaffold_fidelity: meanOrNull('scaffold_fidelity'),
      helpfulness: meanOrNull('helpfulness'),
      citation_accuracy: meanOrNull('citation_accuracy'),
    },
    winner_distribution: winners,
    overall_mean: overallCount === 0 ? null : round4(overallSum / overallCount),
  };
}

/**
 * Roll up the hourly health view into per-(provider, task_type, shadow_role)
 * percentile rows over the last 24h. We collapse hourly buckets by averaging
 * the percentile values weighted by n_requests — close enough for an at-a-
 * glance comparison, exact percentiles would require re-aggregating
 * mol_request_logs which is a heavier read for the same operational signal.
 */
function buildLatency(health: HealthRow[]): MolShadowDashboard['latency'] {
  const buckets = new Map<
    string,
    {
      provider: string;
      task_type: string;
      shadow_role: string | null;
      p50_weighted: number;
      p95_weighted: number;
      n: number;
    }
  >();
  for (const h of health) {
    const provider = h.provider ?? 'unknown';
    const key = `${provider}|${h.task_type}|${h.shadow_role ?? 'null'}`;
    const n = toNumber(h.n_requests);
    if (n === 0) continue;
    const cur =
      buckets.get(key) ??
      {
        provider,
        task_type: h.task_type,
        shadow_role: h.shadow_role,
        p50_weighted: 0,
        p95_weighted: 0,
        n: 0,
      };
    cur.p50_weighted += toNumber(h.p50_latency_ms) * n;
    cur.p95_weighted += toNumber(h.p95_latency_ms) * n;
    cur.n += n;
    buckets.set(key, cur);
  }
  return Array.from(buckets.values())
    .map((b) => ({
      provider: b.provider,
      task_type: b.task_type,
      shadow_role: b.shadow_role,
      p50_ms: b.n === 0 ? 0 : Math.round(b.p50_weighted / b.n),
      p95_ms: b.n === 0 ? 0 : Math.round(b.p95_weighted / b.n),
      n_requests: b.n,
    }))
    .sort((a, b) => {
      if (a.task_type !== b.task_type) return a.task_type.localeCompare(b.task_type);
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return (a.shadow_role ?? '').localeCompare(b.shadow_role ?? '');
    });
}

function buildFallback(health: HealthRow[]): MolShadowDashboard['fallback'] {
  const buckets = new Map<string, { n: number; failures: number }>();
  for (const h of health) {
    const cur = buckets.get(h.task_type) ?? { n: 0, failures: 0 };
    cur.n += toNumber(h.n_requests);
    cur.failures += toNumber(h.n_failures);
    buckets.set(h.task_type, cur);
  }
  return Array.from(buckets.entries())
    .map(([task_type, b]) => ({
      task_type,
      n_requests: b.n,
      n_failures: b.failures,
      failure_rate_pct: b.n === 0 ? 0 : roundPct((b.failures / b.n) * 100),
    }))
    .sort((a, b) => b.failure_rate_pct - a.failure_rate_pct);
}

/**
 * Per task_type, count graded vs ungraded vs skipped_no_text shadow rows.
 *
 * Definitions (over the last 7 days, shadow_role='shadow' only):
 *   - graded         : shadow_grader_score IS NOT NULL
 *   - ungraded       : shadow_grader_score IS NULL AND no skip marker
 *   - skipped_no_text: shadow_grader_score IS NULL AND payload.skipped='no_text'
 *
 * The grader cron currently records skip outcomes in-memory and does not
 * write a per-row marker; until that lands, every ungraded row is bucketed
 * as "ungraded" and skipped_no_text stays 0. The output shape is forward-
 * compatible.
 */
function buildSampleCoverage(rows: MolLogRow[]): MolShadowDashboard['sample_coverage'] {
  const buckets = new Map<
    string,
    { graded: number; ungraded: number; skipped_no_text: number }
  >();
  for (const r of rows) {
    if (r.shadow_role !== 'shadow') continue;
    if (!TASK_TYPES_WITH_SAMPLING.has(r.task_type)) continue;
    const cur = buckets.get(r.task_type) ?? { graded: 0, ungraded: 0, skipped_no_text: 0 };
    if (r.shadow_grader_score !== null && r.shadow_grader_score !== undefined) {
      cur.graded += 1;
    } else {
      const payload = r.shadow_grader_payload;
      const skipped =
        payload && typeof payload === 'object' && (payload as { skipped?: unknown }).skipped === 'no_text';
      if (skipped) cur.skipped_no_text += 1;
      else cur.ungraded += 1;
    }
    buckets.set(r.task_type, cur);
  }
  return Array.from(buckets.entries())
    .map(([task_type, b]) => {
      const total = b.graded + b.ungraded + b.skipped_no_text;
      const graded_pct = total === 0 ? 0 : roundPct((b.graded / total) * 100);
      return {
        task_type,
        graded: b.graded,
        ungraded: b.ungraded,
        skipped_no_text: b.skipped_no_text,
        total,
        graded_pct,
      };
    })
    .sort((a, b) => a.graded_pct - b.graded_pct);
}

/**
 * Recent grader runs — the last N shadow rows with a non-null grader score,
 * newest first. Resolves baseline_request_id, latency_delta_ms, and
 * cost_delta_inr by JOINing with the corresponding baseline row in the same
 * fetched window. Rows whose baseline is older than the window are reported
 * with null deltas.
 */
function buildRecent(rows: MolLogRow[]): MolShadowDashboard['recent'] {
  // Build a quick lookup: baseline rows keyed by request_id.
  const baselines = new Map<string, MolLogRow>();
  for (const r of rows) {
    if (r.shadow_role === 'baseline') baselines.set(r.request_id, r);
  }
  // Filter graded shadow rows, sort by graded_at desc (fallback to created_at).
  const graded = rows.filter(
    (r) => r.shadow_role === 'shadow' && r.shadow_grader_score !== null && r.shadow_grader_score !== undefined,
  );
  graded.sort((a, b) => {
    const ta = a.shadow_graded_at ?? a.created_at;
    const tb = b.shadow_graded_at ?? b.created_at;
    return tb.localeCompare(ta);
  });
  return graded.slice(0, RECENT_LIMIT).map((s) => {
    const baseline = s.shadow_of_request_id ? baselines.get(s.shadow_of_request_id) : undefined;
    const payload = s.shadow_grader_payload;
    const rawWinner =
      payload && typeof payload === 'object' ? (payload as { winner?: unknown }).winner : null;
    const winner: 'baseline' | 'shadow' | 'tie' | null =
      rawWinner === 'baseline' || rawWinner === 'shadow' || rawWinner === 'tie' ? rawWinner : null;
    const latency_delta_ms =
      baseline && typeof baseline.latency_ms === 'number' && typeof s.latency_ms === 'number'
        ? s.latency_ms - baseline.latency_ms
        : null;
    const cost_delta_inr =
      baseline
        ? round4(toNumber(s.inr_cost) - toNumber(baseline.inr_cost))
        : null;
    return {
      shadow_request_id: s.request_id,
      baseline_request_id: s.shadow_of_request_id,
      task_type: s.task_type,
      shadow_grader_score: Number(s.shadow_grader_score),
      winner,
      latency_delta_ms,
      cost_delta_inr,
      created_at: s.created_at,
      graded_at: s.shadow_graded_at,
    };
  });
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await authorizeRequest(request, 'super_admin.access');
    if (!auth.authorized) return auth.errorResponse!;

    const nowMs = Date.now();
    const now = new Date(nowMs);
    const cutoff24h = new Date(nowMs - 24 * 3600 * 1000).toISOString();
    const cutoff7d = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();
    const todayStartIso = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    ).toISOString();

    // ── 1. Flag envelopes ────────────────────────────────────────────────
    const { data: flagRows, error: flagErr } = await supabaseAdmin
      .from('feature_flags')
      .select('flag_name, is_enabled, metadata')
      .in('flag_name', [C4_SHADOW_FLAG, C4_TEXT_CAPTURE_FLAG]);

    if (flagErr) {
      logger.error('super-admin.mol-shadow: flag fetch failed', { error: flagErr.message });
      return NextResponse.json(
        { success: false, error: 'Flag fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    const flagMap = new Map<string, FlagSnapshot>();
    for (const row of (flagRows ?? []) as Array<{
      flag_name: string;
      is_enabled: boolean | null;
      metadata: unknown;
    }>) {
      flagMap.set(row.flag_name, parseFlag(row));
    }
    const shadowFlag = projectShadowFlag(flagMap.get(C4_SHADOW_FLAG) ?? parseFlag(null));
    const textCaptureFlag = projectTextCaptureFlag(
      flagMap.get(C4_TEXT_CAPTURE_FLAG) ?? parseFlag(null),
    );

    // ── 2. mol_request_logs window: last 7 days, both roles ──────────────
    // We pull a single result set and partition in-memory so we do not
    // round-trip three times for similar data. The bound is 50_000 rows
    // (matching the grounding health route's cap) to keep the read flat
    // even as shadow volume climbs.
    const { data: logRowsRaw, error: logErr } = await supabaseAdmin
      .from('mol_request_logs')
      .select(
        'request_id, task_type, shadow_role, shadow_of_request_id, shadow_grader_score, shadow_grader_payload, shadow_graded_at, provider, latency_ms, inr_cost, failure_chain, created_at',
      )
      .gte('created_at', cutoff7d)
      .not('shadow_role', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50_000);

    if (logErr) {
      logger.error('super-admin.mol-shadow: log fetch failed', { error: logErr.message });
      return NextResponse.json(
        { success: false, error: 'Log fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    const logRows = (logRowsRaw ?? []) as MolLogRow[];

    // ── 3. Hourly health view (last 24h) ─────────────────────────────────
    const { data: healthRowsRaw, error: healthErr } = await supabaseAdmin
      .from('mol_request_health_24h')
      .select(
        'hour, provider, task_type, shadow_role, n_requests, n_failures, p50_latency_ms, p95_latency_ms, inr_cost_sum',
      );

    if (healthErr) {
      logger.error('super-admin.mol-shadow: health fetch failed', { error: healthErr.message });
      return NextResponse.json(
        { success: false, error: 'Health fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    const healthRows = (healthRowsRaw ?? []) as HealthRow[];

    // ── 4. Daily INR rollups (today UTC) ─────────────────────────────────
    // Two rollups: shadow_cost_inr (shadow_role='shadow') and
    // grader_cost_inr (the cron's own Sonnet spend, recorded as
    // shadow_role='shadow' rows tagged provider='anthropic' with
    // task_type='grader_overhead' once the cron emits them; today's cron
    // also writes a sentinel ops_events row but the cost rollup lives in
    // mol_request_logs to stay alongside the shadow spend it parallels).
    let shadowCostToday = 0;
    let graderCostToday = 0;
    for (const r of logRows) {
      if (r.created_at < todayStartIso) continue;
      if (r.shadow_role !== 'shadow') continue;
      const c = toNumber(r.inr_cost);
      if (r.task_type === 'grader_overhead') graderCostToday += c;
      else shadowCostToday += c;
    }

    // Volume counts over 24h. These are stricter than the 7d window above:
    // shadow_rows_24h counts shadow_role='shadow' rows created in the last
    // 24h; graded_pairs_24h counts shadow rows graded in the last 24h.
    let shadowRows24h = 0;
    let gradedPairs24h = 0;
    for (const r of logRows) {
      if (r.created_at < cutoff24h) continue;
      if (r.shadow_role !== 'shadow') continue;
      shadowRows24h += 1;
      if (r.shadow_grader_score !== null && r.shadow_grader_score !== undefined) {
        // Prefer shadow_graded_at if present, otherwise created_at as a proxy.
        const graded = r.shadow_graded_at ?? r.created_at;
        if (graded >= cutoff24h) gradedPairs24h += 1;
      }
    }

    // ── 5. Pair-level aggregation (cost delta + quality) ─────────────────
    // Build pair view in-memory from the same 7d row set so we do not pay
    // another DB round-trip. mol_shadow_pairs_v1 is the canonical analyst
    // surface, but the in-memory join is equivalent for these aggregates.
    const baselineById = new Map<string, MolLogRow>();
    for (const r of logRows) {
      if (r.shadow_role === 'baseline') baselineById.set(r.request_id, r);
    }
    const pairs: PairRow[] = [];
    for (const r of logRows) {
      if (r.shadow_role !== 'shadow') continue;
      if (!r.shadow_of_request_id) continue;
      const b = baselineById.get(r.shadow_of_request_id);
      if (!b) continue;
      pairs.push({
        request_id: r.request_id,
        task_type: r.task_type,
        baseline_inr_cost: b.inr_cost,
        shadow_inr_cost: r.inr_cost,
        shadow_grader_score: r.shadow_grader_score,
        shadow_grader_payload: r.shadow_grader_payload,
      });
    }
    const cost_delta = buildCostDelta(pairs);
    const quality = buildQualityAverages(pairs);
    const latency = buildLatency(healthRows);
    const fallback = buildFallback(healthRows);
    const sample_coverage = buildSampleCoverage(logRows);
    const recent = buildRecent(logRows);

    const dashboard: MolShadowDashboard = {
      generated_at: now.toISOString(),
      flags: {
        shadow: shadowFlag,
        text_capture: textCaptureFlag,
      },
      daily: {
        shadow_cost_inr: round4(shadowCostToday),
        shadow_cost_cap_inr: SHADOW_DAILY_COST_CAP_INR,
        grader_cost_inr: round4(graderCostToday),
        grader_cost_cap_inr: GRADER_DAILY_COST_CAP_INR,
        shadow_rows_24h: shadowRows24h,
        graded_pairs_24h: gradedPairs24h,
      },
      cost_delta,
      quality,
      latency,
      fallback,
      sample_coverage,
      recent,
      thresholds: {
        latency_warn_delta_ms: LATENCY_WARN_DELTA_MS,
        fallback_warn_pct: FALLBACK_WARN_PCT,
        coverage_warn_pct: COVERAGE_WARN_PCT,
      },
    };

    // ── 6. Audit (best-effort, do not block the response) ────────────────
    if (auth.userId) {
      // logAudit is fire-and-forget by design (errors are swallowed and
      // logged inside the helper). Calling it without awaiting would still
      // produce a row in practice, but awaiting here ensures the audit row
      // is written before the response so the test harness can observe it
      // synchronously.
      await logAudit(auth.userId, {
        action: 'mol_shadow_dashboard_viewed',
        resourceType: 'mol_shadow',
        details: {
          generated_at: dashboard.generated_at,
          shadow_rows_24h: shadowRows24h,
          graded_pairs_24h: gradedPairs24h,
        },
        status: 'success',
      });
    }

    return NextResponse.json({ success: true, data: dashboard });
  } catch (err) {
    logger.error('super-admin.mol-shadow: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
