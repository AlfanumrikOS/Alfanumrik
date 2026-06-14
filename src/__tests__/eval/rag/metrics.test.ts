// src/__tests__/eval/rag/metrics.test.ts
//
// RED-first pure-function unit tests for the B1 retrieval-quality metrics
// (Task 2). Every expected value below is HAND-COMPUTED from the spec §3
// formulas — no value is read back from the implementation.
//
// Spec anchors:
//   §3.1 recall@k   = |{ c ∈ R[0:k] : rel(c) >= 1 }| / |G|, G = {rel >= 1}
//   §3.2 nDCG@k     = DCG@k / IDCG@k, gain = 2^rel − 1, discount = log2(i+1),
//                     ideal ordering = golden rels sorted desc
//   §3.3 MRR        = 1 / rank_of_first_relevant (rel >= 1); 0 if none
//   §3.4 hit-rate@k = 1 if any rel-chunk in R[0:k] else 0
//   §3.6 multi_hop full-coverage@k = 1 iff EVERY rel==2 chunk ∈ R[0:k], else 0
//
// CRITICAL (rank-vs-score discipline): the metric functions consume the RANKED
// chunk-id list ONLY — never an RRF / cosine score. These fixtures pass no
// score at all, which structurally proves the metrics are scale-independent.
//
// Relevance threshold (recall/hit/MRR): rel >= 1 (rel ∈ {1,2}). multi_hop
// required-primary set uses rel == 2 strictly. Both pinned by §3.
//
// Pure/offline lane: no DB, no LLM, no network. Relative import (the `@/*`
// Vitest alias does not reach the eval harness, which lives outside src/) —
// matches the convention in `golden-schema.test.ts`.

import { describe, it, expect } from 'vitest';

import {
  recallAtK,
  ndcgAtK,
  mrr,
  hitRateAtK,
  multiHopCoverageAtK,
  aggregate,
  gradeBandOf,
  RELEVANCE_THRESHOLD,
  K_VALUES,
} from '../../../../eval/rag/harness/metrics';
import type {
  GoldenItem,
  GoldenRelevantChunk,
} from '../../../../eval/rag/harness/golden-schema';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function chunk(
  id: string,
  relevance: 0 | 1 | 2,
  off_grade_scope = false,
): GoldenRelevantChunk {
  return { chunk_id: id, relevance, off_grade_scope, label_source: 'assessment' };
}

/** Build a minimal GoldenItem for aggregation tests. */
function item(
  id: string,
  grade: GoldenItem['grade'],
  subject: GoldenItem['subject'],
  query_type: GoldenItem['query_type'],
  relevant_chunks: GoldenRelevantChunk[],
): GoldenItem {
  return {
    id,
    tier: 'seed',
    query: `q-${id}`,
    query_type,
    grade,
    subject,
    chapter_number: null,
    relevant_chunks,
    provenance: null,
  };
}

const EPS = 1e-9;

// ─── Constants ─────────────────────────────────────────────────────────────

describe('metrics — exported constants', () => {
  it('uses rel >= 1 as the relevant threshold (spec §3: G = {rel >= 1})', () => {
    expect(RELEVANCE_THRESHOLD).toBe(1);
  });

  it('exposes the default k values {5, 10, 20} (spec §B1.4)', () => {
    expect(K_VALUES).toEqual([5, 10, 20]);
  });
});

// ─── recall@k (§3.1) ─────────────────────────────────────────────────────────

describe('recallAtK (§3.1)', () => {
  it('perfect ranking → recall@5 = 1.0', () => {
    // G = {A(2), B(1), C(2)} ; |G| = 3 ; all in top-5.
    const relevant = [chunk('A', 2), chunk('B', 1), chunk('C', 2)];
    const ranked = ['A', 'B', 'C', 'X', 'Y'];
    expect(recallAtK(ranked, relevant, 5)).toBeCloseTo(1.0, 12);
  });

  it('partial ranking → recall@2 = 1/3, recall@5 = 2/3, recall@6 = 1.0', () => {
    // G = {A(2), B(1), C(2)} ; ranked = [X, A, Y, B, Z, C].
    const relevant = [chunk('A', 2), chunk('B', 1), chunk('C', 2)];
    const ranked = ['X', 'A', 'Y', 'B', 'Z', 'C'];
    expect(recallAtK(ranked, relevant, 2)).toBeCloseTo(1 / 3, 12);
    expect(recallAtK(ranked, relevant, 5)).toBeCloseTo(2 / 3, 12);
    expect(recallAtK(ranked, relevant, 6)).toBeCloseTo(1.0, 12);
  });

  it('no relevant chunk in topK → recall = 0', () => {
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const ranked = ['X', 'Y', 'Z'];
    expect(recallAtK(ranked, relevant, 5)).toBe(0);
  });

  it('relevance 0 chunks are NOT counted as relevant (threshold rel >= 1)', () => {
    // Only A(1) is relevant; B(0) is a labeled-irrelevant chunk and must not
    // inflate |G| nor count as a hit.
    const relevant = [chunk('A', 1), chunk('B', 0)];
    const ranked = ['B', 'A'];
    // |G| = 1 (only A). B is in topK but rel 0 → not a hit. A is a hit. 1/1.
    expect(recallAtK(ranked, relevant, 5)).toBeCloseTo(1.0, 12);
  });

  it('|G| = 0 (all labeled rel 0) → returns null (excluded, never 0 or 1)', () => {
    const relevant = [chunk('A', 0), chunk('B', 0)];
    const ranked = ['A', 'B'];
    expect(recallAtK(ranked, relevant, 5)).toBeNull();
  });
});

// ─── nDCG@k (§3.2) — graded gain 2^rel − 1 ───────────────────────────────────

describe('ndcgAtK (§3.2) — graded gain 2^rel − 1', () => {
  it('graded-relevance ranking [2,0,1,0,2] → nDCG@5 = 0.8642203869628404 (hand-calc)', () => {
    // Positions 1..5 have relevances [2,0,1,0,2].
    // DCG@5  = 3/log2(2) + 0 + 1/log2(4) + 0 + 3/log2(6) = 4.660558421703625
    // ideal  = [2,2,1,0,0] → IDCG@5 = 3 + 3/log2(3) + 1/log2(4) = 5.392789260714372
    // nDCG@5 = 0.8642203869628404
    const relevant = [chunk('A', 2), chunk('C', 1), chunk('E', 2)];
    const ranked = ['A', 'B', 'C', 'D', 'E']; // B,D unlabeled → rel 0
    expect(ndcgAtK(ranked, relevant, 5)).toBeCloseTo(0.8642203869628404, 12);
  });

  it('graded gain DIFFERS visibly from binary gain (2^2−1=3 ≠ 1)', () => {
    // With binary gain a rel-2 and a rel-1 would be identical; with 2^rel−1
    // the rel-2 at rank 1 vs rel-1 at rank 1 give different DCG. Verify the
    // rel-2-first ranking out-scores the rel-1-first ranking for the SAME
    // golden set, which only holds under graded gain.
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const rel2First = ndcgAtK(['A', 'B'], relevant, 2) as number; // ideal order → 1.0
    const rel1First = ndcgAtK(['B', 'A'], relevant, 2) as number; // suboptimal → < 1.0
    expect(rel2First).toBeCloseTo(1.0, 12);
    expect(rel1First).toBeLessThan(rel2First - 0.01);
  });

  it('perfect ideal ranking → nDCG@5 = 1.0', () => {
    const relevant = [chunk('A', 2), chunk('B', 2), chunk('C', 1)];
    const ranked = ['A', 'B', 'C', 'X', 'Y'];
    expect(ndcgAtK(ranked, relevant, 5)).toBeCloseTo(1.0, 12);
  });

  it('partial ranking [0,2,0,1,0] → nDCG@5 = 0.4308467671291832 (hand-calc)', () => {
    // ranked = [X, A, Y, B, Z]; golden A(2), B(1), C(2).
    // DCG@5  = 0 + 3/log2(3) + 0 + 1/log2(5) + 0 = 2.3234658187877653
    // IDCG@5 = ideal [2,2,1,0,0] = 5.392789260714372
    const relevant = [chunk('A', 2), chunk('B', 1), chunk('C', 2)];
    const ranked = ['X', 'A', 'Y', 'B', 'Z'];
    expect(ndcgAtK(ranked, relevant, 5)).toBeCloseTo(0.4308467671291832, 12);
  });

  it('no relevant chunk in topK → nDCG = 0', () => {
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const ranked = ['X', 'Y', 'Z'];
    expect(ndcgAtK(ranked, relevant, 5)).toBe(0);
  });

  it('|G| = 0 → IDCG = 0 → returns null (excluded)', () => {
    const relevant = [chunk('A', 0)];
    const ranked = ['A'];
    expect(ndcgAtK(ranked, relevant, 5)).toBeNull();
  });
});

// ─── MRR (§3.3) ──────────────────────────────────────────────────────────────

describe('mrr (§3.3)', () => {
  it('first relevant at rank 1 → MRR = 1.0', () => {
    const relevant = [chunk('A', 2)];
    expect(mrr(['A', 'X', 'Y'], relevant)).toBeCloseTo(1.0, 12);
  });

  it('first relevant at rank 3 → MRR = 1/3', () => {
    // ranked = [X, Y, A]; A is the first rel>=1.
    const relevant = [chunk('A', 1), chunk('B', 2)];
    expect(mrr(['X', 'Y', 'A', 'B'], relevant)).toBeCloseTo(1 / 3, 12);
  });

  it('a rel-0 chunk ahead of the first relevant does NOT count', () => {
    // ranked = [Z(0), A(1)]; Z is labeled rel 0, so first relevant is A at rank 2.
    const relevant = [chunk('Z', 0), chunk('A', 1)];
    expect(mrr(['Z', 'A'], relevant)).toBeCloseTo(1 / 2, 12);
  });

  it('no relevant chunk anywhere → MRR = 0', () => {
    const relevant = [chunk('A', 2)];
    expect(mrr(['X', 'Y', 'Z'], relevant)).toBe(0);
  });

  it('|G| = 0 → returns null (excluded)', () => {
    const relevant = [chunk('A', 0)];
    expect(mrr(['A'], relevant)).toBeNull();
  });
});

// ─── hit-rate@k (§3.4) ─────────────────────────────────────────────────────────

describe('hitRateAtK (§3.4) — per-item binary', () => {
  it('≥1 relevant in topK → 1', () => {
    const relevant = [chunk('A', 1)];
    expect(hitRateAtK(['X', 'A', 'Y'], relevant, 5)).toBe(1);
  });

  it('relevant exists but OUTSIDE topK → 0', () => {
    const relevant = [chunk('A', 2)];
    // A is at rank 4 but k = 3.
    expect(hitRateAtK(['X', 'Y', 'Z', 'A'], relevant, 3)).toBe(0);
  });

  it('no relevant in topK → 0', () => {
    const relevant = [chunk('A', 2)];
    expect(hitRateAtK(['X', 'Y'], relevant, 5)).toBe(0);
  });

  it('|G| = 0 → returns null (excluded)', () => {
    const relevant = [chunk('A', 0)];
    expect(hitRateAtK(['A'], relevant, 5)).toBeNull();
  });
});

// ─── multi_hop full-coverage@k (§3.6, A5) ────────────────────────────────────

describe('multiHopCoverageAtK (§3.6, A5) — strict full coverage of rel==2 set', () => {
  it('both required-primary (rel==2) chunks in topK → coverage = 1', () => {
    // P = {A, B} (rel 2); both in top-10.
    const relevant = [chunk('A', 2), chunk('B', 2), chunk('C', 1)];
    const ranked = ['A', 'X', 'B', 'Y'];
    expect(multiHopCoverageAtK(ranked, relevant, 10)).toBe(1);
  });

  it('only ONE of two required-primary chunks in topK → coverage = 0', () => {
    // P = {A, B}; B is outside top-3.
    const relevant = [chunk('A', 2), chunk('B', 2)];
    const ranked = ['A', 'X', 'Y', 'B'];
    expect(multiHopCoverageAtK(ranked, relevant, 3)).toBe(0);
  });

  it('partial recall is NOT credited (stricter than recall@k)', () => {
    // recall@3 here would be 1/2 (A present), but coverage must be 0.
    const relevant = [chunk('A', 2), chunk('B', 2)];
    const ranked = ['A', 'X', 'Y', 'B'];
    expect(recallAtK(ranked, relevant, 3)).toBeCloseTo(0.5, 12);
    expect(multiHopCoverageAtK(ranked, relevant, 3)).toBe(0);
  });

  it('a rel==1 chunk is NOT part of the required-primary set', () => {
    // P = {A} only (B is rel 1). A in topK → coverage 1 even though B absent.
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const ranked = ['A', 'X'];
    expect(multiHopCoverageAtK(ranked, relevant, 5)).toBe(1);
  });

  it('empty required-primary set (no rel==2) → returns null (excluded, mis-authored)', () => {
    const relevant = [chunk('A', 1), chunk('B', 1)];
    const ranked = ['A', 'B'];
    expect(multiHopCoverageAtK(ranked, relevant, 10)).toBeNull();
  });
});

// ─── gradeBandOf (A4) ─────────────────────────────────────────────────────────

describe('gradeBandOf (A4) — grade bands 6-8 / 9-10 / 11-12', () => {
  it('maps grades to the three bands', () => {
    expect(gradeBandOf('6')).toBe('6-8');
    expect(gradeBandOf('7')).toBe('6-8');
    expect(gradeBandOf('8')).toBe('6-8');
    expect(gradeBandOf('9')).toBe('9-10');
    expect(gradeBandOf('10')).toBe('9-10');
    expect(gradeBandOf('11')).toBe('11-12');
    expect(gradeBandOf('12')).toBe('11-12');
  });
});

// ─── aggregate (A4) — overall + per (grade-band × subject) cells ─────────────

describe('aggregate (A4) — overall + per-cell breakdown with item counts', () => {
  it('produces an overall mean AND per-(band × subject) cells with counts', () => {
    // Two items in the SAME cell (6-8 × science), known per-item recall@5.
    //  item1: G = {A(2), B(1)} ; ranked = [A, X, B] → recall@5 = 2/2 = 1.0
    //  item2: G = {C(2), D(2)} ; ranked = [C, X, Y] → recall@5 = 1/2 = 0.5
    // One item in a DIFFERENT cell (9-10 × math):
    //  item3: G = {E(1)} ; ranked = [X, E] → recall@5 = 1/1 = 1.0
    const items: Array<{ item: GoldenItem; ranked: string[] }> = [
      {
        item: item('i1', '8', 'science', 'factual', [chunk('A', 2), chunk('B', 1)]),
        ranked: ['A', 'X', 'B'],
      },
      {
        item: item('i2', '6', 'science', 'conceptual', [chunk('C', 2), chunk('D', 2)]),
        ranked: ['C', 'X', 'Y'],
      },
      {
        item: item('i3', '9', 'math', 'definition', [chunk('E', 1)]),
        ranked: ['X', 'E'],
      },
    ];

    const out = aggregate(items, 5, (ranked, relevant, k) =>
      recallAtK(ranked, relevant, k),
    );

    // Overall = mean of [1.0, 0.5, 1.0] = 0.8333...
    expect(out.overall.mean).toBeCloseTo((1.0 + 0.5 + 1.0) / 3, 12);
    expect(out.overall.count).toBe(3);
    expect(out.overall.excluded).toBe(0);

    // Cell (6-8 × science): items i1, i2 → mean (1.0 + 0.5)/2 = 0.75, count 2.
    const sci = out.cells.find((c) => c.band === '6-8' && c.subject === 'science');
    expect(sci).toBeDefined();
    expect(sci?.mean).toBeCloseTo(0.75, 12);
    expect(sci?.count).toBe(2);

    // Cell (9-10 × math): item i3 → mean 1.0, count 1.
    const math = out.cells.find((c) => c.band === '9-10' && c.subject === 'math');
    expect(math).toBeDefined();
    expect(math?.mean).toBeCloseTo(1.0, 12);
    expect(math?.count).toBe(1);
  });

  it('EXCLUDES + FLAGS |G|=0 items (never silently counts them as 0 or 1)', () => {
    // item1 measurable (recall 1.0); item2 has |G|=0 → excluded from the mean
    // but counted in `excluded`.
    const items: Array<{ item: GoldenItem; ranked: string[] }> = [
      {
        item: item('ok', '8', 'science', 'factual', [chunk('A', 2)]),
        ranked: ['A'],
      },
      {
        item: item('empty', '8', 'science', 'factual', [chunk('Z', 0)]),
        ranked: ['Z'],
      },
    ];

    const out = aggregate(items, 5, (ranked, relevant, k) =>
      recallAtK(ranked, relevant, k),
    );

    // Mean is over the 1 measurable item only.
    expect(out.overall.mean).toBeCloseTo(1.0, 12);
    expect(out.overall.count).toBe(1);
    expect(out.overall.excluded).toBe(1);
    expect(out.overall.excludedIds).toContain('empty');

    const cell = out.cells.find((c) => c.band === '6-8' && c.subject === 'science');
    expect(cell?.count).toBe(1);
    expect(cell?.excluded).toBe(1);
  });

  it('an all-excluded cell reports mean=null (not 0) so a noisy cell is not over-read', () => {
    const items: Array<{ item: GoldenItem; ranked: string[] }> = [
      {
        item: item('empty', '11', 'physics', 'factual', [chunk('Z', 0)]),
        ranked: ['Z'],
      },
    ];
    const out = aggregate(items, 5, (ranked, relevant, k) =>
      recallAtK(ranked, relevant, k),
    );
    expect(out.overall.mean).toBeNull();
    expect(out.overall.count).toBe(0);
    expect(out.overall.excluded).toBe(1);
    const cell = out.cells.find((c) => c.band === '11-12' && c.subject === 'physics');
    expect(cell?.mean).toBeNull();
    expect(cell?.count).toBe(0);
    expect(cell?.excluded).toBe(1);
  });
});

// ─── ranked-list duplicate chunk_id dedup (IR contract) ──────────────────────
//
// The live RRF fusion (dense arm + sparse arm) CAN emit the same chunk_id
// twice. Without dedup, a duplicate produces impossible values (recall > 1.0,
// nDCG > 1.0). The academically-correct IR contract: a chunk found twice is
// ONE retrieved item at its BEST (first/earliest) rank. Every metric must
// dedup the ranked list (first-occurrence-wins) BEFORE computing.

describe('ranked-list duplicate chunk_id dedup (IR contract)', () => {
  it('recallAtK(["A","A"], [A:rel2], 5) === 1.0 (was 2.0 before dedup)', () => {
    // |G| = 1 (A). Without dedup, A counted twice → hits=2 → recall 2.0
    // (impossible). With first-occurrence-wins dedup, A is one item → 1/1.
    const relevant = [chunk('A', 2)];
    expect(recallAtK(['A', 'A'], relevant, 5)).toBeCloseTo(1.0, 12);
  });

  it('ndcgAtK(["A","A"], [A:rel2], 5) <= 1.0 AND equals the single-A value', () => {
    // Without dedup, A's gain is counted at rank 1 AND rank 2, inflating DCG
    // above IDCG (which only credits A once) → nDCG > 1.0 (impossible). After
    // dedup, ["A","A"] is identical to ["A"].
    const relevant = [chunk('A', 2)];
    const dup = ndcgAtK(['A', 'A'], relevant, 5);
    const single = ndcgAtK(['A'], relevant, 5);
    expect(dup).not.toBeNull();
    expect(dup as number).toBeLessThanOrEqual(1.0);
    expect(dup as number).toBeCloseTo(single as number, 12);
    // The single-A perfect ranking is exactly 1.0.
    expect(single).toBeCloseTo(1.0, 12);
  });

  it('first-occurrence-wins: the rank of the EARLIER copy is used (MRR)', () => {
    // ranked = [A(0), Z, A(1)] — A appears at rank 1 (rel 0 copy) and rank 3.
    // Relevance is keyed by chunk_id (A is rel>=1 since the golden labels A:1),
    // so the first occurrence of A (rank 1) is the first relevant → MRR = 1.
    // The point: dedup keeps the EARLIER (best) rank, so the second copy at
    // rank 3 is never the one used.
    const relevant = [chunk('A', 1)];
    expect(mrr(['A', 'Z', 'A'], relevant)).toBeCloseTo(1.0, 12);
  });

  it('dup where the SECOND occurrence is the relevant target → first-occurrence rank wins', () => {
    // ranked = [B, A, B] ; B is rel 0, A is rel 2. After dedup → [B, A].
    // A's first (only) occurrence is rank 2 → MRR = 1/2. The trailing dup B at
    // rank 3 collapses into B's rank-1 occurrence and changes nothing.
    const relevant = [chunk('A', 2), chunk('B', 0)];
    expect(mrr(['B', 'A', 'B'], relevant)).toBeCloseTo(1 / 2, 12);
    // recall@2 over deduped [B, A]: A in window → 1/1.
    expect(recallAtK(['B', 'A', 'B'], relevant, 2)).toBeCloseTo(1.0, 12);
  });

  it('hitRateAtK never exceeds 1 with a dup-heavy ranked list', () => {
    const relevant = [chunk('A', 2)];
    expect(hitRateAtK(['A', 'A', 'A'], relevant, 5)).toBe(1);
  });

  it('multiHopCoverageAtK never exceeds 1 with duplicated primaries', () => {
    // P = {A, B}; both appear twice. Coverage is binary 1 regardless.
    const relevant = [chunk('A', 2), chunk('B', 2)];
    expect(multiHopCoverageAtK(['A', 'A', 'B', 'B'], relevant, 10)).toBe(1);
  });

  it('dedup interacts with the k window: dup compresses the window', () => {
    // ranked = [A, A, B] ; deduped → [A, B]. recall@2 over deduped sees both
    // A and B → 2/2 = 1.0. WITHOUT dedup, recall@2 over [A, A] would see only
    // A → 1/2, which is the bug (the duplicate stole B's slot).
    const relevant = [chunk('A', 2), chunk('B', 1)];
    expect(recallAtK(['A', 'A', 'B'], relevant, 2)).toBeCloseTo(1.0, 12);
  });

  it('no metric can return > 1.0 for a pathological all-relevant dup list', () => {
    // Every ranked id is the SAME relevant chunk repeated — the worst case for
    // an un-deduped recall (would be k/|G|).
    const relevant = [chunk('A', 2)];
    const ranked = ['A', 'A', 'A', 'A', 'A', 'A'];
    expect(recallAtK(ranked, relevant, 5) as number).toBeLessThanOrEqual(1.0);
    expect(ndcgAtK(ranked, relevant, 5) as number).toBeLessThanOrEqual(1.0);
    expect(hitRateAtK(ranked, relevant, 5) as number).toBeLessThanOrEqual(1.0);
    expect(mrr(ranked, relevant) as number).toBeLessThanOrEqual(1.0);
    expect(multiHopCoverageAtK(ranked, relevant, 5) as number).toBeLessThanOrEqual(1.0);
  });
});

// ─── boundary pins: k=0, empty ranked, k > length, ideal-order ties ──────────
//
// SHOULD-FIX boundary semantics. CONSISTENT k=0 semantics across ALL metrics:
// k=0 → null ("no window measured") for every metric. Rationale: k=0 names a
// degenerate window with zero retrieved items inspected; like |G|=0 it cannot
// be expressed as a meaningful 0.0 score (which would mean "measured, found
// nothing") — it is "not measurable" and MUST be excluded + flagged by the
// aggregator, not averaged in as a 0. MRR has no k argument, but maxK=0 names
// the same empty window → null.

describe('boundary — k=0 is null ("no window measured") consistently', () => {
  it('recallAtK k=0 → null', () => {
    expect(recallAtK(['A'], [chunk('A', 2)], 0)).toBeNull();
  });
  it('ndcgAtK k=0 → null', () => {
    expect(ndcgAtK(['A'], [chunk('A', 2)], 0)).toBeNull();
  });
  it('hitRateAtK k=0 → null', () => {
    expect(hitRateAtK(['A'], [chunk('A', 2)], 0)).toBeNull();
  });
  it('multiHopCoverageAtK k=0 → null', () => {
    expect(multiHopCoverageAtK(['A'], [chunk('A', 2)], 0)).toBeNull();
  });
  it('mrr maxK=0 → null (the same empty window)', () => {
    expect(mrr(['A'], [chunk('A', 2)], 0)).toBeNull();
  });
});

describe('boundary — empty ranked list [] (retrieval miss)', () => {
  it('recallAtK([], …) = 0 (relevant set exists, retrieved nothing → miss)', () => {
    expect(recallAtK([], [chunk('A', 2)], 5)).toBe(0);
  });
  it('ndcgAtK([], …) = 0 (DCG=0 over empty ranking, IDCG>0)', () => {
    expect(ndcgAtK([], [chunk('A', 2)], 5)).toBe(0);
  });
  it('mrr([], …) = 0 (no relevant found → miss, not null)', () => {
    expect(mrr([], [chunk('A', 2)])).toBe(0);
  });
  it('hitRateAtK([], …) = 0', () => {
    expect(hitRateAtK([], [chunk('A', 2)], 5)).toBe(0);
  });
  it('multiHopCoverageAtK([], …) = 0 (no primary covered → miss)', () => {
    expect(multiHopCoverageAtK([], [chunk('A', 2)], 5)).toBe(0);
  });
  it('empty ranked still respects |G|=0 → null (excluded beats miss)', () => {
    // An empty ranking with an unmeasurable relevant set is STILL null, not 0:
    // |G|=0 exclusion takes precedence over the retrieval-miss 0.
    expect(recallAtK([], [chunk('A', 0)], 5)).toBeNull();
  });
});

describe('boundary — k > ranked.length (window wider than the list)', () => {
  it('recallAtK k=100 on a 3-element list scores the whole list', () => {
    // ranked = [X, A, Y]; |G| = {A, B}; only A retrieved → 1/2. k=100 just
    // means "all of it", not an error.
    const relevant = [chunk('A', 2), chunk('B', 1)];
    expect(recallAtK(['X', 'A', 'Y'], relevant, 100)).toBeCloseTo(0.5, 12);
  });
  it('ndcgAtK k=100 on a short list equals the full-list nDCG', () => {
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const wide = ndcgAtK(['A', 'B'], relevant, 100) as number;
    const exact = ndcgAtK(['A', 'B'], relevant, 2) as number;
    expect(wide).toBeCloseTo(exact, 12);
    expect(wide).toBeCloseTo(1.0, 12); // ideal order
  });
});

describe('boundary — relevance ties in the ideal ordering (nDCG)', () => {
  it('ideal ordering [2,2,1] handles the tied rel-2 pair deterministically', () => {
    // golden A(2), B(2), C(1). Ideal rels desc = [2,2,1].
    // IDCG@3 = 3/log2(2) + 3/log2(3) + 1/log2(4)
    //        = 3 + 1.8927892607143721 + 0.5 = 5.392789260714372
    // Actual ranking [A, C, B] → rels [2,1,2]:
    // DCG@3 = 3/log2(2) + 1/log2(3) + 3/log2(4)
    //       = 3 + 0.6309297535714574 + 1.5 = 5.130929753571458
    // nDCG@3 = 5.130929753571458 / 5.392789260714372 = 0.9514426589871553
    const relevant = [chunk('A', 2), chunk('B', 2), chunk('C', 1)];
    expect(ndcgAtK(['A', 'C', 'B'], relevant, 3)).toBeCloseTo(0.9514426589871553, 12);
  });
});

// ─── MRR maxK window (§3.3 R[0:maxK] bound) ──────────────────────────────────

describe('mrr maxK window (§3.3 R[0:maxK] bound)', () => {
  it('relevant at rank 4 with maxK=3 → 0 (outside the window)', () => {
    // ranked = [X, Y, Z, A]; A (rel 2) is at rank 4, but the maxK=3 window is
    // [X, Y, Z] → no relevant in window → 0.
    const relevant = [chunk('A', 2)];
    expect(mrr(['X', 'Y', 'Z', 'A'], relevant, 3)).toBe(0);
  });
});

// ─── rank-vs-score discipline (defensive) ────────────────────────────────────

describe('rank-vs-score discipline', () => {
  it('STRUCTURAL no-op identity: re-passing the SAME order is a pure-fn identity', () => {
    // This is an explicit STRUCTURAL identity check, NOT a scale-independence
    // proof: the metric API takes NO score argument, so re-passing an
    // identical id order is the same input → trivially the same output. It
    // pins purity/determinism, nothing more.
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const ranked = ['A', 'X', 'B'];
    const r1 = ndcgAtK(ranked, relevant, 5);
    const r2 = ndcgAtK([...ranked], relevant, 5);
    expect(r1).not.toBeNull();
    expect(r1).toBeCloseTo(r2 as number, 12);
  });

  it('rank IS the only signal: two DIFFERENT id orders give different scores', () => {
    // A genuinely different ranking (different ORDER, not a hypothetical score
    // relabel of the same order) produces a different metric — the substantive
    // content of "rank is the signal".
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const good = ndcgAtK(['A', 'B'], relevant, 5) as number; // ideal order
    const bad = ndcgAtK(['B', 'A'], relevant, 5) as number; // swapped
    expect(good).toBeGreaterThan(bad + EPS);
  });

  it('reordering the ranked list changes the metric (rank IS the signal)', () => {
    const relevant = [chunk('A', 2), chunk('B', 1)];
    const good = ndcgAtK(['A', 'B'], relevant, 5) as number;
    const bad = ndcgAtK(['X', 'Y', 'A', 'B'], relevant, 5) as number;
    expect(good).toBeGreaterThan(bad + EPS);
  });
});
