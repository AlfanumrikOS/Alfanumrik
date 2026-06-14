// eval/rag/harness/metrics.ts
//
// B1 retrieval-quality eval harness — Task 2: PURE rank-based metric functions.
// No I/O, no DB, no LLM, no network, no Date, no randomness. Offline tooling,
// NEVER imported by production / client code (enforced by the import-boundary
// test). Consumes Task 1's `GoldenItem` / `GoldenRelevantChunk` types — they
// are NOT redefined here.
//
// ── Rank-vs-score discipline (the single most important constraint) ──────────
// Every function consumes a RANKED list of retrieved `chunk_id`s (the system's
// output ORDER) plus the golden labels. NO RRF / cosine / fused score ever
// enters this module — the RPC's `similarity` column is an RRF FUSED SCORE on a
// `[0, ~0.033]` scale (spec Correction #3), so admitting it would corrupt the
// math. These metrics are scale-independent: rank is the only signal.
//
// ── Ranked-list dedup (academically-correct IR contract) ─────────────────────
// The live RRF fusion (dense arm + sparse arm) CAN emit the same chunk_id
// twice. A chunk found twice is ONE retrieved item at its BEST (first /
// earliest) rank — NOT two retrieved items. Every metric therefore dedups the
// `ranked` list by chunk_id, keeping the FIRST occurrence, BEFORE computing
// anything (the shared `dedupRanked` helper). This makes recall / nDCG / hit /
// coverage ≤ 1.0 and MRR ≤ 1.0 by construction for ANY input.
//
// ── k=0 / window semantics (consistent across ALL metrics) ───────────────────
// `k <= 0` (and `maxK <= 0` for MRR) means "no window measured" → `null` for
// EVERY metric (recall, nDCG, MRR, hit-rate, coverage). Like |G|=0, a zero
// window cannot be expressed as a meaningful 0.0 ("measured, found nothing") —
// it is "not measurable", so the aggregator EXCLUDES + FLAGS it rather than
// averaging in a spurious 0. An EMPTY `ranked` list (`[]`) with a non-empty
// relevant set is a genuine retrieval MISS → 0 (the |G|=0 null still wins when
// the relevant set itself is empty).
//
// ── Spec §3 formulas (exact) ─────────────────────────────────────────────────
// For a single item, let `R = [c1, c2, ...]` be the ranked chunk_ids and
// `rel(c)` the golden graded relevance (0|1|2; 0 for any chunk not labeled).
// Let `G = { c : rel(c) >= 1 }` be the relevant set.
//   §3.1 recall@k   = |{ c ∈ R[0:k] : rel(c) >= 1 }| / |G|   (null if |G| = 0)
//   §3.2 nDCG@k     = DCG@k / IDCG@k, gain = 2^rel − 1, discount = log2(i+1),
//                     ideal ordering = golden rels sorted desc (null if IDCG=0)
//   §3.3 MRR        = 1 / rank_of_first_relevant (rel >= 1); 0 if none; null if
//                     |G| = 0
//   §3.4 hit-rate@k = 1 if any rel-chunk in R[0:k] else 0 (null if |G| = 0)
//   §3.6 multi_hop full-coverage@k = 1 iff EVERY rel==2 chunk ∈ R[0:k] else 0;
//                     null (excluded) if the required-primary set P is empty.
//
// ── |relevant| = 0 handling (spec §3.1 / §3.6) ───────────────────────────────
// A per-item metric whose denominator/relevant-set is empty returns `null`
// (NOT 0, NOT 1) so the aggregator can EXCLUDE + FLAG it. The schema requires a
// non-empty `relevant_chunks` array, but an item whose every label is rel 0
// (or a multi_hop item with no rel==2 chunk) still yields an empty relevant
// set — handled defensively here.

import type { GoldenItem, GoldenRelevantChunk, Grade } from './golden-schema';

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Relevance threshold for recall / hit-rate / MRR (spec §3:
 * `G = { c : rel(c) >= 1 }`). A chunk counts as relevant iff `relevance >= 1`
 * (i.e. relevance 1 OR 2). The graded value still feeds nDCG's `2^rel − 1`
 * gain; this threshold only governs the binary "is it relevant" set.
 */
export const RELEVANCE_THRESHOLD = 1 as const;

/**
 * The required-primary relevance for multi_hop full-coverage (spec §3.6:
 * `P = { c : rel(c) == 2 }`). Strictly `== 2`, distinct from the recall
 * threshold above.
 */
export const REQUIRED_PRIMARY_RELEVANCE = 2 as const;

/** Default k values (spec §B1.4: "Default k ∈ {5, 10, 20}"). */
export const K_VALUES = [5, 10, 20] as const;
export type KValue = (typeof K_VALUES)[number];

/** Grade bands for the A4 per-cell breakdown. */
export const GRADE_BANDS = ['6-8', '9-10', '11-12'] as const;
export type GradeBand = (typeof GRADE_BANDS)[number];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Dedup a RANKED list of chunk_ids, keeping the FIRST (best / earliest)
 * occurrence of each id. The live RRF fusion (dense + sparse arms) CAN emit the
 * same chunk_id twice; the academically-correct IR contract treats a chunk
 * found twice as ONE retrieved item at its best rank. Every metric calls this
 * BEFORE doing any work, so recall / nDCG / hit / coverage stay ≤ 1.0 and MRR
 * stays ≤ 1.0 by construction for ANY input. Stable + order-preserving.
 */
function dedupRanked(ranked: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranked) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Build a `chunk_id → relevance` map from a golden item's labeled chunks. */
function relevanceMap(relevant: readonly GoldenRelevantChunk[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of relevant) {
    // Last-write-wins is fine; the schema validator forbids duplicate intent.
    m.set(c.chunk_id, c.relevance);
  }
  return m;
}

/** `rel(c)` — 0 for any chunk not present in the golden labels. */
function relOf(relMap: Map<string, number>, chunkId: string): number {
  return relMap.get(chunkId) ?? 0;
}

/** The relevant set G = { c : rel(c) >= threshold } (chunk ids). */
function relevantSet(relevant: readonly GoldenRelevantChunk[]): Set<string> {
  const s = new Set<string>();
  for (const c of relevant) {
    if (c.relevance >= RELEVANCE_THRESHOLD) s.add(c.chunk_id);
  }
  return s;
}

/** The required-primary set P = { c : rel(c) == 2 } (chunk ids). */
function requiredPrimarySet(relevant: readonly GoldenRelevantChunk[]): Set<string> {
  const s = new Set<string>();
  for (const c of relevant) {
    if (c.relevance === REQUIRED_PRIMARY_RELEVANCE) s.add(c.chunk_id);
  }
  return s;
}

/** Graded DCG gain for a relevance value: `2^rel − 1`. */
function gain(relevance: number): number {
  return Math.pow(2, relevance) - 1;
}

/** Rank discount for position `i` (1-based): `log2(i + 1)`. */
function discount(rank1Based: number): number {
  return Math.log2(rank1Based + 1);
}

// ─── §3.1 recall@k ─────────────────────────────────────────────────────────

/**
 * recall@k = |{ c ∈ R[0:k] : rel(c) >= 1 }| / |G|, over the DEDUPED ranked list
 * (first-occurrence-wins). Returns `null` when |G| = 0 (the item cannot measure
 * recall — excluded + flagged, never 0 or 1) and `null` when `k <= 0` (no
 * window measured). An empty `ranked` list with |G| > 0 is a retrieval miss → 0.
 */
export function recallAtK(
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  k: number,
): number | null {
  const G = relevantSet(relevant);
  if (G.size === 0) return null; // |G|=0 exclusion takes precedence over k=0.
  if (k <= 0) return null; // no window measured.
  const topK = dedupRanked(ranked).slice(0, k);
  let hits = 0;
  for (const id of topK) {
    if (G.has(id)) hits += 1;
  }
  return hits / G.size;
}

// ─── §3.2 nDCG@k (graded gain 2^rel − 1) ─────────────────────────────────────

/**
 * nDCG@k = DCG@k / IDCG@k with graded gain `2^rel − 1` and `log2(i+1)` discount,
 * over the DEDUPED ranked list (first-occurrence-wins); the ideal ordering is
 * the golden relevances sorted descending. Returns `null` when IDCG = 0 (no
 * relevant chunk → |G| = 0, excluded) and `null` when `k <= 0` (no window
 * measured). An empty `ranked` list with IDCG > 0 → 0 (retrieval miss). Dedup
 * keeps a doubly-emitted chunk from being credited twice, so DCG can never
 * exceed IDCG → nDCG ≤ 1.0.
 */
export function ndcgAtK(
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  k: number,
): number | null {
  // IDCG over the ideal ordering: ALL golden relevances sorted desc, top-k.
  // Computed first so the |G|=0 (IDCG=0) exclusion takes precedence over k=0.
  const idealRels = relevant
    .map((c) => c.relevance)
    .sort((a, b) => b - a)
    .slice(0, k <= 0 ? relevant.length : k);
  let idcg = 0;
  idealRels.forEach((rel, idx) => {
    idcg += gain(rel) / discount(idx + 1);
  });
  if (idcg === 0) return null; // no relevant chunk → excluded.
  if (k <= 0) return null; // no window measured.

  const relMap = relevanceMap(relevant);

  // DCG over the actual (DEDUPED) ranking, top-k.
  const topK = dedupRanked(ranked).slice(0, k);
  let dcg = 0;
  topK.forEach((id, idx) => {
    dcg += gain(relOf(relMap, id)) / discount(idx + 1);
  });

  return dcg / idcg;
}

// ─── §3.3 MRR ────────────────────────────────────────────────────────────────

/**
 * MRR = 1 / rank_of_first_relevant, where the first relevant is the first
 * `c ∈ R` with `rel(c) >= 1` over the DEDUPED ranked list (first-occurrence-
 * wins — so the EARLIER copy's rank is the one used, and the reciprocal can
 * never exceed 1.0). Returns 0 if no relevant chunk appears in the window;
 * `null` when |G| = 0 (excluded) or when `maxK` is EXPLICITLY `<= 0` (no window
 * measured — the §3.3 R[0:maxK] bound with an empty window). `maxK` bounds the
 * search window over the DEDUPED list; when OMITTED the whole list is searched,
 * so an empty `ranked` (`[]`) with |G| > 0 is a genuine retrieval MISS → 0
 * (NOT null — null is reserved for an explicit zero/negative window).
 */
export function mrr(
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  maxK?: number,
): number | null {
  const G = relevantSet(relevant);
  if (G.size === 0) return null; // |G|=0 exclusion takes precedence.
  if (maxK !== undefined && maxK <= 0) return null; // explicit empty window.
  const deduped = dedupRanked(ranked);
  const window = maxK === undefined ? deduped : deduped.slice(0, maxK);
  for (let i = 0; i < window.length; i += 1) {
    if (G.has(window[i])) return 1 / (i + 1);
  }
  return 0;
}

// ─── §3.4 hit-rate@k (per-item binary) ───────────────────────────────────────

/**
 * Per-item hit-rate: 1 if ≥1 relevant chunk in R[0:k] (over the DEDUPED ranked
 * list), else 0. Returns `null` when |G| = 0 (excluded) or `k <= 0` (no window
 * measured). The aggregate hit-rate (spec §3.4 — "fraction of items with ≥1
 * relevant in topK") is the mean of these per-item values, which the
 * `aggregate()` helper computes. (Dedup is moot for the binary hit decision but
 * applied for window-slice consistency with the other metrics.)
 */
export function hitRateAtK(
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  k: number,
): number | null {
  const G = relevantSet(relevant);
  if (G.size === 0) return null; // |G|=0 exclusion takes precedence over k=0.
  if (k <= 0) return null; // no window measured.
  const topK = dedupRanked(ranked).slice(0, k);
  for (const id of topK) {
    if (G.has(id)) return 1;
  }
  return 0;
}

// ─── §3.6 multi_hop full-coverage@k (A5) ─────────────────────────────────────

/**
 * Per-item multi_hop full-coverage: 1 iff EVERY required-primary chunk
 * (`rel == 2`) appears in R[0:k] (over the DEDUPED ranked list), else 0.
 * Strictly harder than recall@k (partial coverage credited) and hit-rate@k
 * (single hit credited). Returns `null` when the required-primary set P is
 * empty (a multi_hop item with no `rel == 2` chunk is mis-authored → excluded +
 * flagged) or `k <= 0` (no window measured). Dedup keeps a doubly-emitted
 * primary from spuriously consuming two of the k slots.
 */
export function multiHopCoverageAtK(
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  k: number,
): number | null {
  const P = requiredPrimarySet(relevant);
  if (P.size === 0) return null; // empty-P exclusion takes precedence over k=0.
  if (k <= 0) return null; // no window measured.
  const topK = new Set(dedupRanked(ranked).slice(0, k));
  for (const id of P) {
    if (!topK.has(id)) return 0; // any missing primary → no full coverage.
  }
  return 1;
}

// ─── A4 — grade-band mapping + aggregation ───────────────────────────────────

/** Map a P5 grade string to its A4 grade band (6-8 / 9-10 / 11-12). */
export function gradeBandOf(grade: Grade): GradeBand {
  switch (grade) {
    case '6':
    case '7':
    case '8':
      return '6-8';
    case '9':
    case '10':
      return '9-10';
    case '11':
    case '12':
      return '11-12';
    default: {
      // Exhaustiveness guard — `Grade` is a closed union, so this is dead code,
      // but it keeps the switch total if `Grade` ever widens.
      const _exhaustive: never = grade;
      throw new Error(`unhandled grade: ${String(_exhaustive)}`);
    }
  }
}

/** A scored item: its golden labels + the system's ranked chunk_id output. */
export interface ScoredItem {
  item: GoldenItem;
  ranked: string[];
}

/**
 * A per-item metric: consumes the ranked list + golden labels + k, returns the
 * metric value or `null` for an excluded item (|G|=0 / empty-P). The exact
 * shape of the Task 2 metric functions above.
 */
export type ItemMetric = (
  ranked: readonly string[],
  relevant: readonly GoldenRelevantChunk[],
  k: number,
) => number | null;

/** Mean over the measurable (non-null) values in one bucket, with counts. */
export interface MetricStat {
  /** Mean over measurable items; `null` when no item was measurable. */
  mean: number | null;
  /** Number of measurable items contributing to `mean`. */
  count: number;
  /** Number of items EXCLUDED (metric returned null — |G|=0 / empty-P). */
  excluded: number;
  /** Ids of the excluded items (A4 flagging — never silently dropped). */
  excludedIds: string[];
}

/** One (grade-band × subject) cell of the A4 breakdown. */
export interface MetricCell extends MetricStat {
  band: GradeBand;
  subject: GoldenItem['subject'];
}

/** The full aggregate: overall + per-(grade-band × subject) cells. */
export interface AggregateResult {
  overall: MetricStat;
  cells: MetricCell[];
}

function emptyStat(): { sum: number; count: number; excluded: number; excludedIds: string[] } {
  return { sum: 0, count: 0, excluded: 0, excludedIds: [] };
}

function finalize(acc: {
  sum: number;
  count: number;
  excluded: number;
  excludedIds: string[];
}): MetricStat {
  return {
    mean: acc.count === 0 ? null : acc.sum / acc.count,
    count: acc.count,
    excluded: acc.excluded,
    excludedIds: acc.excludedIds,
  };
}

/**
 * Aggregate one metric across a set of scored items, producing the global mean
 * AND the A4 per-(grade-band × subject) breakdown (each cell with its item
 * count). Items whose metric returns `null` (|G|=0 / empty-P) are EXCLUDED from
 * the mean and FLAGGED in `excluded` / `excludedIds` — never silently counted
 * as 0 or 1 (spec §3.1 / §3.6). A cell or the overall with no measurable item
 * reports `mean: null` so a noisy / empty cell is not over-read.
 */
export function aggregate(
  scored: readonly ScoredItem[],
  k: number,
  metric: ItemMetric,
): AggregateResult {
  const overall = emptyStat();
  const cellMap = new Map<string, ReturnType<typeof emptyStat> & { band: GradeBand; subject: GoldenItem['subject'] }>();

  for (const { item, ranked } of scored) {
    const band = gradeBandOf(item.grade);
    const subject = item.subject;
    const cellKey = `${band}::${subject}`;
    let cell = cellMap.get(cellKey);
    if (!cell) {
      cell = { ...emptyStat(), band, subject };
      cellMap.set(cellKey, cell);
    }

    const value = metric(ranked, item.relevant_chunks, k);
    if (value === null) {
      overall.excluded += 1;
      overall.excludedIds.push(item.id);
      cell.excluded += 1;
      cell.excludedIds.push(item.id);
    } else {
      overall.sum += value;
      overall.count += 1;
      cell.sum += value;
      cell.count += 1;
    }
  }

  const cells: MetricCell[] = [];
  for (const cell of cellMap.values()) {
    cells.push({ band: cell.band, subject: cell.subject, ...finalize(cell) });
  }

  return { overall: finalize(overall), cells };
}
