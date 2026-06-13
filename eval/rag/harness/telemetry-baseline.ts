// eval/rag/harness/telemetry-baseline.ts
//
// B1 retrieval-quality eval harness — Task 6: production-telemetry rollup.
//
// Read-only aggregate rollups over the production trace tables
// (`retrieval_traces` + `grounded_ai_traces`) that establish a REAL-WORLD
// baseline ALONGSIDE the offline golden-set metrics (spec §B1.6). Where the
// golden-set metrics measure the labeled `retrieve()` path on a curated set,
// these rollups measure ACTUAL traffic — label-free, sliced by
// (grade × subject_code) — so B2 can see WHERE real students are getting weak
// retrieval and focus tuning there.
//
// This module is offline tooling. It is NEVER imported by production / client
// code (enforced by the Task 8 import-boundary test). Any REAL DB read is
// service-role server-only / offline (P8/B6) — the tests inject a FAKE client,
// so nothing here opens a connection. It performs ZERO writes; the rollups are
// written only to the on-disk report artifact by the runner.
//
// ── P13 — A1 COLUMN-ALLOWLIST PROJECTION (the headline invariant) ────────────
//
// The SELECT is built from an explicit per-table non-PII column allowlist
// constant — NEVER `SELECT *`. The rollup must NEVER pull an identifier into
// memory, and its OUTPUT is metadata-only (counts, rates, percentiles, cell
// keys) — never a raw query, never an id:
//     - `grounded_ai_traces.student_id`   — FORBIDDEN
//     - `retrieval_traces.user_id`        — FORBIDDEN
//     - `retrieval_traces.session_id`     — FORBIDDEN
//   These three (plus any future identifier column) live in
//   `TELEMETRY_FORBIDDEN_COLUMNS`; a unit test asserts neither the projection
//   constants, the actual `.select()` string, NOR the serialized rollup output
//   contain any of them.
//
// ── SCORE-SCALE DISCIPLINE — distinct tag per signal (Correction #3 + S6.1) ──
//
// `grounded_ai_traces.top_similarity` is an RRF *fused* score on a `[0, ~0.033]`
// scale (RRF k=60 reciprocal-rank fusion of the dense + sparse arms), NOT a
// cosine similarity. The 2026-05-10 confidence-threshold audit bug was caused by
// exactly this misread. So the top_similarity distribution carries an EXPLICIT
// `scale: 'rrf'` + a human label + the documented `[0, ~0.033]` range, so no
// downstream reader can mistake a fused RRF score for a cosine.
//
// `grounded_ai_traces.confidence`, by contrast, is a NORMALIZED `[0, 1]` score
// (top_similarity / RRF_THEORETICAL_MAX — the confidence projection the
// grounded-answer pipeline writes), NOT a raw RRF fused score. Tagging it
// `'rrf'` would re-introduce the same class of scale-misread (a reader would
// expect a `[0, 0.033]` fused score). So the confidence distribution carries its
// OWN distinct `scale: 'normalized'` tag + label + `[0, 1]` range (S6.1). Each
// distribution self-describes its scale; two scales are never conflated.

import { GROUNDED_AI_TRACES_ALLOWLIST, RETRIEVAL_TRACES_ALLOWLIST } from './trace-mining';

// ─── A1 — the allowlists are re-exported from trace-mining (single source) ───
//
// The column allowlists are AUTHORED in `trace-mining.ts` (Task 4). We re-export
// them so this module's tests can pin the same allowlist authority, and so there
// is ONE place "what may be read from these tables" is defined.

export { GROUNDED_AI_TRACES_ALLOWLIST, RETRIEVAL_TRACES_ALLOWLIST };

/**
 * The forbidden identifier columns — NEVER projected, NEVER surfaced (P13).
 * Mirrors `trace-mining.ts:FORBIDDEN_TRACE_COLUMNS`; kept as the telemetry
 * module's own named constant so the rollup's denylist assertion has a local
 * seam that does not depend on trace-mining's internal naming.
 */
export const TELEMETRY_FORBIDDEN_COLUMNS = [
  'student_id', // grounded_ai_traces
  'user_id', // retrieval_traces
  'session_id', // retrieval_traces
] as const;

// ─── The PROJECTION the rollup actually selects (subset of each allowlist) ───
//
// Telemetry needs only the rollup inputs: the slice keys (grade, subject), the
// hit-rate-proxy signal (chunk_count / chunk_ids), the score signals
// (top_similarity, confidence, reranked), and created_at. No free-form query
// text is needed for a rollup, so `query_preview` / `query_text` are NOT
// projected (a rollup is counts + distributions, not content). No identifier is
// ever named here.

type GroundedAllowed = (typeof GROUNDED_AI_TRACES_ALLOWLIST)[number];
type RetrievalAllowed = (typeof RETRIEVAL_TRACES_ALLOWLIST)[number];

/** What the rollup SELECTs from `grounded_ai_traces`. */
export const TELEMETRY_GROUNDED_PROJECTION = [
  'grade',
  'subject_code',
  'chunk_count',
  'top_similarity',
  'grounded',
  'confidence',
  'created_at',
] as const satisfies readonly GroundedAllowed[];

/** What the rollup SELECTs from `retrieval_traces`. */
export const TELEMETRY_RETRIEVAL_PROJECTION = [
  'grade',
  'subject',
  'chunk_ids',
  'reranked',
  'match_count',
  'created_at',
] as const satisfies readonly RetrievalAllowed[];

export type TelemetryTable = 'grounded_ai_traces' | 'retrieval_traces';

/**
 * Build the comma-joined Postgres `select(...)` column string for a table from
 * its telemetry PROJECTION constant. NEVER returns `'*'`. Single seam for the
 * denylist test.
 */
export function buildTelemetrySelect(table: TelemetryTable): string {
  const cols =
    table === 'grounded_ai_traces'
      ? TELEMETRY_GROUNDED_PROJECTION
      : TELEMETRY_RETRIEVAL_PROJECTION;
  return cols.join(', ');
}

// ─── RRF-scale labeling constants (MUST — Correction #3) ─────────────────────

/**
 * The documented RRF fused-score range. The dense + sparse arms are fused by
 * reciprocal-rank fusion with k=60, so the realised `top_similarity` lives in
 * roughly `[0, 1/30 ≈ 0.033]` — NOT the `[-1, 1]` of a cosine.
 */
export const SIMILARITY_SCALE_RANGE: readonly [number, number] = [0, 0.033];

/**
 * Human-readable scale label attached to EVERY similarity distribution in the
 * rollup output. States RRF + the range explicitly; deliberately never says
 * "cosine" so a reader cannot misread the distribution.
 */
export const SIMILARITY_SCALE_LABEL =
  'RRF fused score (reciprocal-rank fusion, k=60), range ~[0, 0.033] — a fused rank score, not a vector dot-product';

// ─── Normalized-confidence scale labeling (S6.1) ─────────────────────────────
//
// `grounded_ai_traces.confidence` is NOT a raw RRF fused score: it is the
// top_similarity NORMALIZED into [0, 1] by dividing by RRF_THEORETICAL_MAX (the
// post-fusion confidence projection the grounded-answer pipeline writes). Tagging
// it `scale: 'rrf'` would re-introduce exactly the kind of scale-misread the RRF
// labeling was added to prevent (a reader would expect a `[0, 0.033]` fused
// score, not a `[0, 1]` normalized one). So the confidence distribution carries
// its OWN distinct scale tag, label, and range.

/** The documented normalized-confidence range — a [0, 1] projection. */
export const CONFIDENCE_SCALE_RANGE: readonly [number, number] = [0, 1];

/**
 * Human-readable scale label for the normalized confidence distribution. States
 * "normalized confidence [0, 1]" explicitly; never says "rrf" or "cosine" so a
 * reader cannot misread the [0, 1] confidence for the [0, 0.033] fused score.
 */
export const CONFIDENCE_SCALE_LABEL =
  'normalized confidence (top_similarity / RRF_THEORETICAL_MAX), range [0, 1] — a normalized confidence score, not a raw RRF fused score';

// ─── Output shape ────────────────────────────────────────────────────────────

/**
 * The score scale a `ScoreDistribution` is measured on. EVERY distribution
 * carries its own tag so a reader can never conflate two different scales:
 *   - `'rrf'`        — a raw RRF fused score on `[0, ~0.033]` (top_similarity);
 *   - `'normalized'` — a `[0, 1]` normalized confidence (S6.1 — confidence is
 *                      top_similarity / RRF_THEORETICAL_MAX, NOT a raw fused
 *                      score, so it is deliberately NOT tagged `'rrf'`).
 */
export type ScoreScale = 'rrf' | 'normalized';

/**
 * A percentile summary of a score distribution. The `scale` tag is REQUIRED and
 * distinct per signal (Correction #3 + S6.1): a `top_similarity` distribution is
 * `'rrf'` (and can never be misread as a cosine), while a `confidence`
 * distribution is `'normalized'` (and can never be misread as a raw RRF fused
 * score). `p10/p50/p90` are `null` when the sample is empty.
 */
export interface ScoreDistribution {
  /** The score scale: `'rrf'` for `top_similarity`, `'normalized'` for confidence. */
  scale: ScoreScale;
  /** Human-readable scale label (`SIMILARITY_SCALE_LABEL` / `CONFIDENCE_SCALE_LABEL`). */
  scale_label: string;
  /** The documented numeric range (`[0, ~0.033]` for rrf, `[0, 1]` for normalized). */
  scale_range: readonly [number, number];
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** How many finite values fed the percentiles. */
  count: number;
}

/** Per-(grade × subject_code) slice of the `grounded_ai_traces` rollup. */
export interface GroundedCell {
  grade: string;
  subject: string;
  sample_size: number;
  hit_rate_proxy: number | null;
  grounded_rate: number | null;
  top_similarity: ScoreDistribution;
  confidence: ScoreDistribution;
}

/** Per-(grade × subject) slice of the `retrieval_traces` rollup. */
export interface RetrievalCell {
  grade: string;
  subject: string;
  sample_size: number;
  hit_rate_proxy: number | null;
  rerank_rate: number | null;
}

/** Overall + sliced rollup of `grounded_ai_traces`. */
export interface GroundedRollup {
  sample_size: number;
  /** Fraction of traces with `chunk_count > 0` (production hit-rate proxy). */
  hit_rate_proxy: number | null;
  /** Fraction of traces with `grounded = true`. */
  grounded_rate: number | null;
  /** RRF-scale top-similarity distribution (p10/p50/p90; scale='rrf'). */
  top_similarity: ScoreDistribution;
  /** Normalized [0,1] confidence distribution (p10/p50/p90; scale='normalized'). */
  confidence: ScoreDistribution;
  /** Per-(grade × subject_code) slices. */
  by_cell: GroundedCell[];
}

/** Overall + sliced rollup of `retrieval_traces`. */
export interface RetrievalRollup {
  sample_size: number;
  /** Fraction of traces with a non-empty `chunk_ids[]` (hit-rate proxy). */
  hit_rate_proxy: number | null;
  /** Fraction of traces with `reranked = true`. */
  rerank_rate: number | null;
  /** Per-(grade × subject) slices. */
  by_cell: RetrievalCell[];
}

export interface TelemetryRollup {
  grounded: GroundedRollup;
  retrieval: RetrievalRollup;
}

// ─── Pure math helpers ───────────────────────────────────────────────────────

/** Keep only finite numbers (drops NaN / null / undefined / non-numbers). */
function finiteOnly(xs: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  }
  return out;
}

/**
 * Percentiles by linear interpolation between the closest ranks on the SORTED
 * sample (the "type 7" / numpy-default method): `rank = q/100 * (n-1)`, then
 * interpolate between `floor(rank)` and `ceil(rank)`. Returns a map keyed by the
 * requested percentile; an empty (or all-non-finite) sample maps every
 * percentile to `null` (never NaN). Pure — no IO, no Date, no randomness.
 */
export function percentiles(
  values: readonly number[],
  qs: readonly number[],
): Record<number, number | null> {
  const sorted = finiteOnly(values).sort((a, b) => a - b);
  const out: Record<number, number | null> = {};
  if (sorted.length === 0) {
    for (const q of qs) out[q] = null;
    return out;
  }
  const n = sorted.length;
  for (const q of qs) {
    const clampedQ = Math.min(100, Math.max(0, q));
    const rank = (clampedQ / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) {
      out[q] = sorted[lo];
    } else {
      const frac = rank - lo;
      out[q] = sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
    }
  }
  return out;
}

/** Fraction of `rows` satisfying `pred`, or `null` for an empty `rows`. */
function rateOf<T>(rows: readonly T[], pred: (r: T) => boolean): number | null {
  if (rows.length === 0) return null;
  let n = 0;
  for (const r of rows) if (pred(r)) n += 1;
  return n / rows.length;
}

/**
 * Build a labeled `ScoreDistribution` from a raw numeric sample. The `scale`
 * selects the tag + the matching label + range, so a `top_similarity` (rrf)
 * distribution and a `confidence` (normalized) distribution can never be
 * conflated (Correction #3 + S6.1). Defaults to `'rrf'` for the top_similarity
 * callers; the confidence caller passes `'normalized'` explicitly.
 */
function scoreDistribution(
  values: readonly unknown[],
  scale: ScoreScale = 'rrf',
): ScoreDistribution {
  const finite = finiteOnly(values);
  const p = percentiles(finite, [10, 50, 90]);
  const isRrf = scale === 'rrf';
  return {
    scale,
    scale_label: isRrf ? SIMILARITY_SCALE_LABEL : CONFIDENCE_SCALE_LABEL,
    scale_range: isRrf ? SIMILARITY_SCALE_RANGE : CONFIDENCE_SCALE_RANGE,
    p10: p[10],
    p50: p[50],
    p90: p[90],
    count: finite.length,
  };
}

// ─── Row accessors (defensive; rows are already projection-restricted) ───────

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asStrOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

const UNKNOWN_KEY = '_unknown';

function cellKey(grade: string, subject: string): string {
  return `${grade} ${subject}`;
}

// ─── Grounded rollup ─────────────────────────────────────────────────────────

function rollupGrounded(rows: readonly Record<string, unknown>[]): GroundedRollup {
  const hitRate = rateOf(rows, (r) => (asNum(r.chunk_count) ?? 0) > 0);
  const groundedRate = rateOf(rows, (r) => r.grounded === true);
  const topSim = scoreDistribution(rows.map((r) => r.top_similarity), 'rrf');
  // S6.1 — confidence is a normalized [0, 1] score (post RRF_THEORETICAL_MAX
  // normalization), NOT a raw RRF fused score; tag it 'normalized', not 'rrf'.
  const conf = scoreDistribution(rows.map((r) => r.confidence), 'normalized');

  // Per-(grade × subject_code) slices.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const grade = asStrOr(r.grade, UNKNOWN_KEY);
    const subject = asStrOr(r.subject_code, UNKNOWN_KEY);
    const key = cellKey(grade, subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const byCell: GroundedCell[] = [];
  for (const bucket of groups.values()) {
    byCell.push({
      grade: asStrOr(bucket[0].grade, UNKNOWN_KEY),
      subject: asStrOr(bucket[0].subject_code, UNKNOWN_KEY),
      sample_size: bucket.length,
      hit_rate_proxy: rateOf(bucket, (r) => (asNum(r.chunk_count) ?? 0) > 0),
      grounded_rate: rateOf(bucket, (r) => r.grounded === true),
      top_similarity: scoreDistribution(bucket.map((r) => r.top_similarity), 'rrf'),
      confidence: scoreDistribution(bucket.map((r) => r.confidence), 'normalized'),
    });
  }
  byCell.sort((a, b) =>
    a.grade === b.grade ? a.subject.localeCompare(b.subject) : a.grade.localeCompare(b.grade),
  );

  return {
    sample_size: rows.length,
    hit_rate_proxy: hitRate,
    grounded_rate: groundedRate,
    top_similarity: topSim,
    confidence: conf,
    by_cell: byCell,
  };
}

// ─── Retrieval rollup ──────────────────────────────────────────────────────

function nonEmptyChunkIds(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function rollupRetrieval(rows: readonly Record<string, unknown>[]): RetrievalRollup {
  const hitRate = rateOf(rows, (r) => nonEmptyChunkIds(r.chunk_ids));
  const rerankRate = rateOf(rows, (r) => r.reranked === true);

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const grade = asStrOr(r.grade, UNKNOWN_KEY);
    const subject = asStrOr(r.subject, UNKNOWN_KEY);
    const key = cellKey(grade, subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const byCell: RetrievalCell[] = [];
  for (const bucket of groups.values()) {
    byCell.push({
      grade: asStrOr(bucket[0].grade, UNKNOWN_KEY),
      subject: asStrOr(bucket[0].subject, UNKNOWN_KEY),
      sample_size: bucket.length,
      hit_rate_proxy: rateOf(bucket, (r) => nonEmptyChunkIds(r.chunk_ids)),
      rerank_rate: rateOf(bucket, (r) => r.reranked === true),
    });
  }
  byCell.sort((a, b) =>
    a.grade === b.grade ? a.subject.localeCompare(b.subject) : a.grade.localeCompare(b.grade),
  );

  return {
    sample_size: rows.length,
    hit_rate_proxy: hitRate,
    rerank_rate: rerankRate,
    by_cell: byCell,
  };
}

// ─── Minimal injected-client contract ────────────────────────────────────────
//
// Narrowest possible Supabase surface so the rollup can take either a real
// service-role client (offline) or a hand-rolled fake (tests), with no `any`.
// The chain is `from(table).select(cols).limit(n)` → awaitable. Mirrors
// `trace-mining.ts`'s `TraceMiningClient`.

interface TelemetryQueryResult {
  data: Record<string, unknown>[] | null;
  error: unknown;
}

interface TelemetryQueryBuilder extends PromiseLike<TelemetryQueryResult> {
  limit(n: number): PromiseLike<TelemetryQueryResult>;
}

interface TelemetrySelectable {
  select(columns: string): TelemetryQueryBuilder;
}

export interface TelemetryClient {
  from(table: string): TelemetrySelectable;
}

export interface RollupOptions {
  /** Max rows to pull per table. Default 5000. */
  limit?: number;
}

/** A grounded zero-state rollup (empty / errored read), still RRF-labeled. */
function emptyGrounded(): GroundedRollup {
  return rollupGrounded([]);
}

function emptyRetrieval(): RetrievalRollup {
  return rollupRetrieval([]);
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Read `grounded_ai_traces` + `retrieval_traces` via the A1 column-allowlist
 * projection (`buildTelemetrySelect`, never `SELECT *`) and produce the
 * read-only §B1.6 rollups. No identifier ever enters memory; the output is
 * metadata-only (counts, rates, RRF-labeled percentiles, cell keys).
 *
 * READ-ONLY: only `.select()` is ever invoked — ZERO writes to any table. A
 * per-table query error degrades that table to a well-formed zero-state rollup
 * (never throws), so one table's failure cannot abort the other's measurement.
 */
export async function rollupTelemetry(
  supabase: TelemetryClient,
  options: RollupOptions = {},
): Promise<TelemetryRollup> {
  const limit = options.limit ?? 5000;

  let grounded: GroundedRollup;
  try {
    const res = await supabase
      .from('grounded_ai_traces')
      .select(buildTelemetrySelect('grounded_ai_traces'))
      .limit(limit);
    grounded = !res.error && res.data ? rollupGrounded(res.data) : emptyGrounded();
  } catch {
    grounded = emptyGrounded();
  }

  let retrieval: RetrievalRollup;
  try {
    const res = await supabase
      .from('retrieval_traces')
      .select(buildTelemetrySelect('retrieval_traces'))
      .limit(limit);
    retrieval = !res.error && res.data ? rollupRetrieval(res.data) : emptyRetrieval();
  } catch {
    retrieval = emptyRetrieval();
  }

  return { grounded, retrieval };
}
