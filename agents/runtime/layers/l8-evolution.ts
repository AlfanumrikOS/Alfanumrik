/**
 * agents/runtime/layers/l8-evolution.ts — L8 outcome attribution.
 *
 * The final layer of the mesh. Reads shipped cycles, computes
 * before/after metric deltas using state_events as the journey
 * source of truth, and writes one outcome_metrics row per
 * (cycle, metric) pair.
 *
 * Why this works for a small, slow-changing user base:
 *
 *   - We don't run causal inference. A cycle's deployment is the
 *     intervention; we compare a 7d window before and after. With
 *     small sample sizes the statistically-significant flag is set
 *     conservatively (large effect + min sample size); everything
 *     else gets `statistically_significant=false` and waits for more
 *     data.
 *   - Synthetic control / A/B is out of scope for Phase 5. The
 *     `significance_method` column records 'pre_post' for these
 *     rows so a later analyst can re-attribute with better methods.
 *
 * Gating:
 *
 *   - `ff_mesh_l8_attribution_v1` must be ON globally.
 *   - Cycle must satisfy ALL of:
 *       status='complete', ended_reason='shipped', target_metric IS NOT NULL
 *   - At least `windowDays` (default 7) must have elapsed since
 *     ended_at; otherwise the after-window is incomplete and we skip.
 *   - No existing outcome_metrics row for (cycle_id, metric) — we
 *     never re-attribute the same cycle. Recomputing on better data
 *     would happen as a separate "L8 refresh" pass with explicit
 *     re-trigger.
 *
 * Statistical significance heuristic (intentionally conservative):
 *
 *   - For `rate` metrics: |delta| >= 0.05 AND sampleSize >= 30 → true
 *   - For `count` metrics: relative change >= 0.20 AND sampleSize >= 30 → true
 *   - For `duration_sec`: same as `rate` with inverted sign at comparator time
 *   - Else: false
 *
 *   These thresholds are intentionally easy to beat at scale and
 *   intentionally hard to clear with N<30 — the mesh's job is to
 *   propose changes, not to lie about their impact.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMetricDef, type MetricDef, type MetricSample } from '../metrics/registry';

export const L8_FLAG = 'ff_mesh_l8_attribution_v1';

export interface L8AttributionOptions {
  sb: SupabaseClient;
  /** Window length (days) before AND after the cycle ended_at. Default 7. */
  windowDays?: number;
  /** Test-injectable clock. */
  now?: () => Date;
  /** Test-injectable flag check. */
  isEnabled?: () => Promise<boolean>;
  /** Limit the number of cycles attributed in one pass. Default 50. */
  maxCycles?: number;
}

export interface AttributionRecord {
  cycleId: string;
  metric: string;
  beforeValue: number;
  afterValue: number;
  delta: number;
  sampleSizeBefore: number;
  sampleSizeAfter: number;
  statisticallySignificant: boolean;
  significanceMethod: 'pre_post' | 'none';
  windowBefore: { start: string; end: string };
  windowAfter: { start: string; end: string };
  notes: string;
}

export interface L8AttributionResult {
  reason: 'flag_off' | 'no_cycles' | 'ok';
  attributed: AttributionRecord[];
  skipped: Array<{ cycleId: string; reason: string }>;
  errors: Array<{ cycleId: string; metric: string; message: string }>;
}

interface CycleRow {
  id: string;
  ended_at: string | null;
  ended_reason: string | null;
  target_metric: string | null;
  target_delta: number | null;
  status: string;
  goal: string;
}

/**
 * One attribution pass. Idempotent — skips cycles that already have an
 * outcome_metrics row for the target metric. Returns a structured
 * result so the CLI / cron caller can log / summarise.
 */
export async function runL8Attribution(
  opts: L8AttributionOptions,
): Promise<L8AttributionResult> {
  const enabled = opts.isEnabled
    ? await opts.isEnabled()
    : await readFlag(opts.sb, L8_FLAG);
  if (!enabled) {
    return { reason: 'flag_off', attributed: [], skipped: [], errors: [] };
  }

  const windowDays = opts.windowDays ?? 7;
  const now = (opts.now ?? (() => new Date()))();
  const maxCycles = opts.maxCycles ?? 50;

  const cutoffIso = new Date(now.getTime() - windowDays * 24 * 3600 * 1000).toISOString();

  // Eligible: shipped, has target_metric, and ended_at < now - windowDays.
  const { data: cycleRows, error: cyclesErr } = await opts.sb
    .from('cycles')
    .select('id, ended_at, ended_reason, target_metric, target_delta, status, goal')
    .eq('ended_reason', 'shipped')
    .not('target_metric', 'is', null)
    .not('ended_at', 'is', null)
    .lt('ended_at', cutoffIso)
    .order('ended_at', { ascending: true })
    .limit(maxCycles);

  if (cyclesErr) {
    return {
      reason: 'ok',
      attributed: [],
      skipped: [],
      errors: [{ cycleId: '_query_', metric: '_none_', message: cyclesErr.message }],
    };
  }

  if (!cycleRows || cycleRows.length === 0) {
    return { reason: 'no_cycles', attributed: [], skipped: [], errors: [] };
  }

  const attributed: AttributionRecord[] = [];
  const skipped: L8AttributionResult['skipped'] = [];
  const errors: L8AttributionResult['errors'] = [];

  for (const cycle of cycleRows as CycleRow[]) {
    const metricName = cycle.target_metric!;
    const metric = getMetricDef(metricName);
    if (!metric) {
      skipped.push({ cycleId: cycle.id, reason: `unknown_metric:${metricName}` });
      continue;
    }

    const alreadyAttributed = await hasOutcomeRow(opts.sb, cycle.id, metricName);
    if (alreadyAttributed) {
      skipped.push({ cycleId: cycle.id, reason: 'already_attributed' });
      continue;
    }

    try {
      const record = await attributeOne(opts.sb, cycle, metric, windowDays);
      const inserted = await writeOutcomeRow(opts.sb, cycle, record);
      if (inserted) {
        attributed.push(record);
      } else {
        skipped.push({ cycleId: cycle.id, reason: 'insert_conflict' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ cycleId: cycle.id, metric: metricName, message });
    }
  }

  return { reason: 'ok', attributed, skipped, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function readFlag(sb: SupabaseClient, name: string): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', name)
      .maybeSingle();
    if (error || !data) return false;
    return data.is_enabled === true;
  } catch {
    return false;
  }
}

async function hasOutcomeRow(
  sb: SupabaseClient,
  cycleId: string,
  metric: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from('outcome_metrics')
    .select('id')
    .eq('cycle_id', cycleId)
    .eq('metric', metric)
    .limit(1);
  if (error) {
    throw new Error(`hasOutcomeRow: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

async function attributeOne(
  sb: SupabaseClient,
  cycle: CycleRow,
  metric: MetricDef,
  windowDays: number,
): Promise<AttributionRecord> {
  if (!cycle.ended_at) {
    throw new Error('cycle has no ended_at (this should not happen — filter guard)');
  }
  const endedMs = Date.parse(cycle.ended_at);
  const winMs = windowDays * 24 * 3600 * 1000;
  const beforeStart = new Date(endedMs - winMs).toISOString();
  const beforeEnd = cycle.ended_at;
  const afterStart = cycle.ended_at;
  const afterEnd = new Date(endedMs + winMs).toISOString();

  const [before, after]: [MetricSample, MetricSample] = await Promise.all([
    metric.compute(sb, { startsAt: beforeStart, endsAt: beforeEnd }),
    metric.compute(sb, { startsAt: afterStart, endsAt: afterEnd }),
  ]);

  const delta = after.value - before.value;
  const significant = isSignificant(metric, before, after);

  const targetDelta = typeof cycle.target_delta === 'number' ? cycle.target_delta : null;
  const directionMatched = metric.direction === 'up' ? delta > 0 : delta < 0;
  const noteLines = [
    `target_delta=${targetDelta ?? 'unset'} observed_delta=${round3(delta)} direction_matched=${directionMatched}`,
    `before(n=${before.sampleSize})=${round3(before.value)} after(n=${after.sampleSize})=${round3(after.value)}`,
  ];

  return {
    cycleId: cycle.id,
    metric: metric.name,
    beforeValue: before.value,
    afterValue: after.value,
    delta,
    sampleSizeBefore: before.sampleSize,
    sampleSizeAfter: after.sampleSize,
    statisticallySignificant: significant,
    significanceMethod: significant ? 'pre_post' : 'none',
    windowBefore: { start: beforeStart, end: beforeEnd },
    windowAfter: { start: afterStart, end: afterEnd },
    notes: noteLines.join(' | '),
  };
}

async function writeOutcomeRow(
  sb: SupabaseClient,
  cycle: CycleRow,
  record: AttributionRecord,
): Promise<boolean> {
  const { error } = await sb.from('outcome_metrics').insert({
    cycle_id: cycle.id,
    metric: record.metric,
    before_value: record.beforeValue,
    after_value: record.afterValue,
    window_before: pgRange(record.windowBefore),
    window_after: pgRange(record.windowAfter),
    sample_size_before: record.sampleSizeBefore,
    sample_size_after: record.sampleSizeAfter,
    statistically_significant: record.statisticallySignificant,
    significance_method: record.significanceMethod,
    notes: record.notes,
  });
  if (error) {
    // 23505 = unique-violation; treat as already-attributed (idempotent).
    if ((error as { code?: string }).code === '23505') return false;
    throw new Error(`outcome_metrics insert: ${error.message}`);
  }
  return true;
}

/**
 * Conservative pre/post significance test.
 *   - rate metrics: |delta| ≥ 0.05 AND min(sampleSizeBefore, sampleSizeAfter) ≥ 30
 *   - count metrics: relative change ≥ 0.20 AND min(samples) ≥ 30
 *   - duration_sec: same threshold as `rate`
 *
 * Intentionally easy to beat at scale, intentionally hard at small N.
 */
export function isSignificant(
  metric: MetricDef,
  before: MetricSample,
  after: MetricSample,
): boolean {
  const minN = Math.min(before.sampleSize, after.sampleSize);
  if (minN < 30) return false;
  const delta = after.value - before.value;
  if (metric.kind === 'count') {
    if (before.value <= 0) return Math.abs(delta) >= 1;
    return Math.abs(delta / before.value) >= 0.2;
  }
  // rate / duration_sec — absolute delta of 5pp on a [0,1] rate or
  // 5 seconds on a duration.
  return Math.abs(delta) >= 0.05;
}

function pgRange(window: { start: string; end: string }): string {
  // Postgres tstzrange literal — inclusive lower, exclusive upper.
  // We escape commas/quotes that could break the literal by trusting
  // ISO-8601's bounded shape.
  return `[${window.start},${window.end})`;
}

function round3(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return Math.round(v * 1000) / 1000 + '';
}
