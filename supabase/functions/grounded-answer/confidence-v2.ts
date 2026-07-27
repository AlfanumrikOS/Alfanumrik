// supabase/functions/grounded-answer/confidence-v2.ts
//
// SHADOW-ONLY confidence computation. Recorded on the trace row; NEVER
// compared against any threshold, NEVER gates abstain, NEVER drives the soft
// banner. Step 2 of 3 in the confidence-instrumentation sequence (step 1 was
// migration 20260727130000, which exposed `cosine_similarity` from
// match_rag_chunks_ncert).
//
// ─── Why v1 needs a shadow ────────────────────────────────────────────────────
// confidence v1 feeds `computeConfidence` the RRF ordering statistic returned
// by match_rag_chunks_ncert. In the vector-only regime (92.8% of production
// traffic) RRF is FIXED BY CONSTRUCTION: ranks 1,2,3 always score 1/61, 1/62,
// 1/63. With groundingPassRatio pinned at 1, v1 collapses to
//
//     confidence = 0.347606 + 0.2 * (chunks / match_count)
//
// i.e. three reachable values, with 912 of 996 sampled traces landing on
// exactly 0.647606. That is a CHUNK COUNTER wearing a relevance costume: it
// cannot distinguish an on-topic rank-1 chunk from an off-topic one, because
// both are rank 1.
//
// ─── What v2 changes (and deliberately does not) ──────────────────────────────
// v2 reuses `computeConfidence` VERBATIM — same weights, same clamps, same
// pure function. No new formula, no new constant, no new threshold is invented
// here. The ONLY substitution is the input: instead of the RRF ordering
// statistic normalized by RRF_THEORETICAL_MAX, v2 feeds the actual RELEVANCE
// signal (already naturally on a [0,1] scale).
//
// Signal precedence, top chunk decides:
//   1. `rerank_score`  — Voyage rerank-2 cross-encoder score, when reranking ran.
//   2. `cosine_similarity` — absolute cosine from the RPC, otherwise.
//   3. neither → source 'none', confidence_v2 = null.
//
// Rerank wins because when reranking runs, `chunks[0].similarity` is the
// PRE-rerank RRF of whatever the cross-encoder promoted. A correct promotion
// from vector-rank 8 would therefore LOWER v1's measured confidence — an
// inversion. Preferring the cross-encoder score makes v2 immune to it.
//
// ─── Scale hygiene (the reason for confidence_v2_source) ─────────────────────
// Voyage rerank scores and absolute cosines are DIFFERENT measurement scales.
// They must never be pooled in analysis. Every row is stamped with the source
// that produced it so the two populations stay separable. Within a single row
// the scale is uniform by construction: the top-3 average is taken over ONLY
// those chunks carrying the SAME signal the top chunk used.
//
// ─── NULL is meaningful ───────────────────────────────────────────────────────
// A missing/NULL cosine means "this row carries no relevance evidence" (FTS-only
// tier-1 rows over unembedded chunks, all of tier 2, all of tier 3, unembedded
// chunks). A missing rerank score means "the cross-encoder did not judge this
// document". Neither is coerced to 0 anywhere in this file: 0 would assert
// "maximally irrelevant", which is a different and false claim. Rows with no
// signal at all record confidence_v2 = null with source 'none'; they are
// EXCLUDED from v2 analysis rather than silently dragging the mean down.

import { computeConfidence } from './confidence.ts';

export type ConfidenceV2Source = 'rerank' | 'cosine' | 'none';

/** Minimal structural contract — any chunk shape carrying the two signals. */
export interface ConfidenceV2Chunk {
  cosine_similarity?: number | null;
  rerank_score?: number | null;
}

export interface ConfidenceV2Result {
  /** null when no chunk carried any relevance signal. Never compared to a threshold. */
  confidence_v2: number | null;
  /** Which signal produced confidence_v2. Keeps the two scales unpoolable. */
  confidence_v2_source: ConfidenceV2Source;
  /** The TOP chunk's absolute cosine, reported independently of the source. */
  top_cosine_similarity: number | null;
  /** How many of the top-3 chunks actually carried the chosen signal (0-3). */
  signal_coverage: number;
}

/** Finite-number guard. `null`/`undefined`/NaN/Infinity → null (unknown). */
function asSignal(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Compute the shadow confidence. Pure, total, never throws. Mirrors the
 * argument shape of the v1 `computeConfidence` call it shadows so the two are
 * directly comparable for the same request.
 */
export function computeConfidenceV2(args: {
  /** Final ordered chunk list — the SAME array v1 measured. */
  chunks: ConfidenceV2Chunk[];
  matchCountTarget: number;
  /** Pass the SAME ratio v1 was given for this request (1 in soft/retrieve_only). */
  groundingCheckPassRatio: number;
}): ConfidenceV2Result {
  const chunks = Array.isArray(args.chunks) ? args.chunks : [];
  const top = chunks[0];
  const topCosine = asSignal(top?.cosine_similarity);

  if (chunks.length === 0) {
    return {
      confidence_v2: null,
      confidence_v2_source: 'none',
      top_cosine_similarity: null,
      signal_coverage: 0,
    };
  }

  const topRerank = asSignal(top?.rerank_score);
  const source: ConfidenceV2Source =
    topRerank !== null ? 'rerank' : topCosine !== null ? 'cosine' : 'none';

  if (source === 'none') {
    // No relevance evidence at all — record the absence honestly rather than
    // fabricating a score. top_cosine_similarity is null here by definition.
    return {
      confidence_v2: null,
      confidence_v2_source: 'none',
      top_cosine_similarity: topCosine,
      signal_coverage: 0,
    };
  }

  const pick = (c: ConfidenceV2Chunk): number | null =>
    source === 'rerank' ? asSignal(c?.rerank_score) : asSignal(c?.cosine_similarity);

  const topSignal = source === 'rerank' ? (topRerank as number) : (topCosine as number);

  // Single-scale top-3 average: only chunks carrying the SAME signal contribute.
  // Chunks with no signal are OMITTED (not zeroed) — an unmeasured neighbour
  // must not depress the average as if it were irrelevant.
  const top3 = chunks.slice(0, 3).map(pick).filter((v): v is number => v !== null);
  const top3Avg = top3.length > 0 ? top3.reduce((s, v) => s + v, 0) / top3.length : topSignal;

  return {
    // Same weights, same clamps, same function as v1. Only the inputs differ.
    confidence_v2: computeConfidence({
      topSimilarity: topSignal,
      top3AverageSimilarity: top3Avg,
      chunksReturned: chunks.length,
      matchCountTarget: args.matchCountTarget,
      groundingCheckPassRatio: args.groundingCheckPassRatio,
    }),
    confidence_v2_source: source,
    top_cosine_similarity: topCosine,
    signal_coverage: top3.length,
  };
}
