/**
 * REGRESSION — shadow confidence v2 (relevance-based), behavioural pins.
 *
 * File under test: supabase/functions/grounded-answer/confidence-v2.ts
 * Ships with:      6e6f9d96 (migration 20260727130000 — cosine_similarity)
 *                  9febc5be (confidence-v2 + migration 20260727130100)
 *
 * WHY THIS EXISTS
 * ---------------
 * confidence v1 feeds `computeConfidence` an RRF ORDERING statistic. In the
 * vector-only regime RRF is fixed by construction (ranks 1,2,3 → 1/61, 1/62,
 * 1/63) and groundingPassRatio is pinned at 1, so v1 collapses to
 *     0.347606 + 0.2 * (chunks / match_count)
 * — three reachable values, 912 of 996 production traces at exactly 0.647606.
 * It is a chunk counter. v2 substitutes a RELEVANCE signal into the SAME
 * unmodified `computeConfidence`. The entire value of this step is the
 * INTEGRITY OF THE SHADOW DATA it collects, so these are the pins that protect
 * it:
 *
 *   (2) NULL is never coerced to 0 — at any hop. A chunk with no signal is
 *       OMITTED from the top-3 average, never zeroed. All-null ⇒ null/'none'.
 *   (4) Precedence + no scale mixing — the TOP chunk decides the source
 *       (rerank > cosine > none) and it is applied UNIFORMLY to the top-3
 *       average. `top_cosine_similarity` is reported independently of the
 *       chosen source.
 *
 * Invariant (1) — "confidence_v2 is never compared to a threshold" — is a
 * SOURCE-level property and is pinned statically in
 * `rag-confidence-v2-shadow-source-pins.test.ts`, not here.
 *
 * P12 (AI safety / grounding honesty).
 */

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadV2(): Promise<any> {
  return await import('../../../../../supabase/functions/grounded-answer/confidence-v2');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadV1(): Promise<any> {
  return await import('../../../../../supabase/functions/grounded-answer/confidence');
}

describe('REGRESSION — confidence v2 reuses the v1 formula verbatim', () => {
  it('equals computeConfidence() fed the relevance signal (no new formula)', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();

    const chunks = [
      { cosine_similarity: 0.8 },
      { cosine_similarity: 0.7 },
      { cosine_similarity: 0.6 },
      { cosine_similarity: 0.5 },
    ];
    const got = computeConfidenceV2({
      chunks,
      matchCountTarget: 8,
      groundingCheckPassRatio: 1,
    });

    const expected = computeConfidence({
      topSimilarity: 0.8,
      top3AverageSimilarity: (0.8 + 0.7 + 0.6) / 3,
      chunksReturned: 4,
      matchCountTarget: 8,
      groundingCheckPassRatio: 1,
    });

    expect(got.confidence_v2).toBe(expected);
  });

  it('passes groundingCheckPassRatio straight through (v1 weight untouched)', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const chunks = [{ cosine_similarity: 0.5 }];
    const pass = computeConfidenceV2({ chunks, matchCountTarget: 5, groundingCheckPassRatio: 1 });
    const fail = computeConfidenceV2({ chunks, matchCountTarget: 5, groundingCheckPassRatio: 0 });
    // 0.1 weight on groundingCheckPassRatio, exactly as in confidence.ts.
    expect(pass.confidence_v2! - fail.confidence_v2!).toBeCloseTo(0.1, 10);
  });

  it('does not divide by zero when matchCountTarget is 0', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 1 }],
      matchCountTarget: 0,
      groundingCheckPassRatio: 1,
    });
    // 0.4*1 + 0.3*1 + 0.2*0 + 0.1*1
    expect(got.confidence_v2).toBeCloseTo(0.8, 10);
  });
});

describe('REGRESSION — confidence v2 source precedence (top chunk decides)', () => {
  it("uses 'rerank' when the top chunk carries a cross-encoder score", async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.4, rerank_score: 0.9 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('rerank');
  });

  it("falls back to 'cosine' when the top chunk has no rerank score", async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.4, rerank_score: null }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('cosine');
  });

  it("records 'none' + null when the top chunk carries neither signal", async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: null, rerank_score: null }, { cosine_similarity: 0.9 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    // The TOP chunk decides. A signal-bearing chunk further down does NOT
    // rescue the row — that would silently change which chunk the score
    // describes.
    expect(got.confidence_v2_source).toBe('none');
    expect(got.confidence_v2).toBeNull();
    expect(got.signal_coverage).toBe(0);
  });

  it('empty chunk list ⇒ null / none / null / 0', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got).toEqual({
      confidence_v2: null,
      confidence_v2_source: 'none',
      top_cosine_similarity: null,
      signal_coverage: 0,
    });
  });

  it('rerank precedence holds even when the cosine is much larger', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    // The inversion this whole change exists to avoid: a chunk correctly
    // promoted by the cross-encoder carries a LOW pre-rerank ordering
    // statistic. v2 must read the cross-encoder score, not the cosine.
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.99, rerank_score: 0.30 }],
      matchCountTarget: 1,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('rerank');
    expect(got.confidence_v2).toBe(
      computeConfidence({
        topSimilarity: 0.3,
        top3AverageSimilarity: 0.3,
        chunksReturned: 1,
        matchCountTarget: 1,
        groundingCheckPassRatio: 1,
      }),
    );
  });
});

describe('REGRESSION — no scale mixing within a row', () => {
  it('averages ONLY chunks carrying the source signal (cosines excluded from a rerank row)', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    const got = computeConfidenceV2({
      chunks: [
        { cosine_similarity: 0.10, rerank_score: 0.90 }, // top → source 'rerank'
        { cosine_similarity: 0.99, rerank_score: null }, // cosine ONLY — must NOT pollute
        { cosine_similarity: 0.20, rerank_score: 0.50 },
      ],
      matchCountTarget: 3,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('rerank');
    expect(got.signal_coverage).toBe(2);
    expect(got.confidence_v2).toBe(
      computeConfidence({
        topSimilarity: 0.9,
        top3AverageSimilarity: (0.9 + 0.5) / 2, // 0.99 cosine never enters
        chunksReturned: 3,
        matchCountTarget: 3,
        groundingCheckPassRatio: 1,
      }),
    );
  });

  it('a rerank-sourced row still reports its own top_cosine_similarity', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.4321, rerank_score: 0.9 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    // top_cosine_similarity is recorded INDEPENDENTLY of the chosen source —
    // it is the analysis join key between the two unpoolable populations.
    expect(got.confidence_v2_source).toBe('rerank');
    expect(got.top_cosine_similarity).toBe(0.4321);
  });

  it('a rerank-sourced row with no cosine reports top_cosine_similarity = null', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: null, rerank_score: 0.9 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('rerank');
    expect(got.top_cosine_similarity).toBeNull();
  });

  it("a 'none' row still reports top_cosine_similarity (which is null by definition)", async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{}],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2_source).toBe('none');
    expect(got.top_cosine_similarity).toBeNull();
  });

  it('the top-3 window is exactly 3 — a 4th chunk never contributes', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    const got = computeConfidenceV2({
      chunks: [
        { cosine_similarity: 0.9 },
        { cosine_similarity: 0.8 },
        { cosine_similarity: 0.7 },
        { cosine_similarity: 0.0 }, // outside the window
      ],
      matchCountTarget: 4,
      groundingCheckPassRatio: 1,
    });
    expect(got.signal_coverage).toBe(3);
    expect(got.confidence_v2).toBe(
      computeConfidence({
        topSimilarity: 0.9,
        top3AverageSimilarity: (0.9 + 0.8 + 0.7) / 3,
        chunksReturned: 4,
        matchCountTarget: 4,
        groundingCheckPassRatio: 1,
      }),
    );
  });
});

describe('REGRESSION — NULL is omitted, never coerced to 0 (computeConfidenceV2 hop)', () => {
  it('a null-signal neighbour is OMITTED from the top-3 average, not zeroed', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    const got = computeConfidenceV2({
      chunks: [
        { cosine_similarity: 0.8 },
        { cosine_similarity: null }, // unembedded / FTS-recovered → unknown
        { cosine_similarity: 0.6 },
      ],
      matchCountTarget: 3,
      groundingCheckPassRatio: 1,
    });
    expect(got.signal_coverage).toBe(2);

    const omitted = computeConfidence({
      topSimilarity: 0.8,
      top3AverageSimilarity: (0.8 + 0.6) / 2, // 0.7
      chunksReturned: 3,
      matchCountTarget: 3,
      groundingCheckPassRatio: 1,
    });
    const zeroed = computeConfidence({
      topSimilarity: 0.8,
      top3AverageSimilarity: (0.8 + 0 + 0.6) / 3, // 0.4666… — the WRONG answer
      chunksReturned: 3,
      matchCountTarget: 3,
      groundingCheckPassRatio: 1,
    });

    expect(got.confidence_v2).toBe(omitted);
    expect(got.confidence_v2).not.toBe(zeroed);
    expect(omitted).toBeGreaterThan(zeroed); // zeroing would depress the mean
  });

  it('chunksReturned counts ALL chunks, including signal-less ones', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    // Coverage (0.2 weight) is a RETRIEVAL-volume term, not a relevance term:
    // signal-less chunks were still returned and must still count.
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.5 }, { cosine_similarity: null }, { cosine_similarity: null }],
      matchCountTarget: 3,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2).toBe(
      computeConfidence({
        topSimilarity: 0.5,
        top3AverageSimilarity: 0.5,
        chunksReturned: 3,
        matchCountTarget: 3,
        groundingCheckPassRatio: 1,
      }),
    );
  });

  it('treats undefined, NaN and Infinity as "unknown" (null), never as 0 or 1', async () => {
    const { computeConfidenceV2 } = await loadV2();
    for (const bad of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const got = computeConfidenceV2({
        chunks: [{ cosine_similarity: bad as number | null | undefined }],
        matchCountTarget: 5,
        groundingCheckPassRatio: 1,
      });
      expect(got.confidence_v2_source).toBe('none');
      expect(got.confidence_v2).toBeNull();
      expect(got.top_cosine_similarity).toBeNull();
    }
  });

  it('a genuine 0.0 cosine is a REAL measurement and is kept (not confused with null)', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    // 0 means "measured and maximally irrelevant" — distinct from null.
    expect(got.confidence_v2_source).toBe('cosine');
    expect(got.top_cosine_similarity).toBe(0);
    expect(got.confidence_v2).not.toBeNull();
  });

  it('all-null chunk list ⇒ confidence_v2 null with source none (excluded from analysis)', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: null }, { rerank_score: null }, {}],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2).toBeNull();
    expect(got.confidence_v2_source).toBe('none');
    expect(got.signal_coverage).toBe(0);
  });

  it('single signal-bearing chunk: top-3 average falls back to the top signal, not 0', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const { computeConfidence } = await loadV1();
    const got = computeConfidenceV2({
      chunks: [{ cosine_similarity: 0.77 }],
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(got.confidence_v2).toBe(
      computeConfidence({
        topSimilarity: 0.77,
        top3AverageSimilarity: 0.77,
        chunksReturned: 1,
        matchCountTarget: 5,
        groundingCheckPassRatio: 1,
      }),
    );
  });
});

describe('REGRESSION — computeConfidenceV2 is pure, total and side-effect free', () => {
  it('does not mutate the chunk array or its members', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const chunks = [
      { cosine_similarity: 0.8, rerank_score: 0.9 },
      { cosine_similarity: null, rerank_score: null },
    ];
    const before = JSON.stringify(chunks);
    computeConfidenceV2({ chunks, matchCountTarget: 5, groundingCheckPassRatio: 1 });
    expect(JSON.stringify(chunks)).toBe(before);
    expect(chunks).toHaveLength(2);
  });

  it('never throws on a non-array chunks argument', async () => {
    const { computeConfidenceV2 } = await loadV2();
    for (const bad of [null, undefined, 'nope', 42, {}]) {
      const got = computeConfidenceV2({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunks: bad as any,
        matchCountTarget: 5,
        groundingCheckPassRatio: 1,
      });
      expect(got.confidence_v2).toBeNull();
      expect(got.confidence_v2_source).toBe('none');
    }
  });

  it('is deterministic for identical input', async () => {
    const { computeConfidenceV2 } = await loadV2();
    const args = {
      chunks: [{ cosine_similarity: 0.61, rerank_score: 0.42 }, { cosine_similarity: 0.5 }],
      matchCountTarget: 6,
      groundingCheckPassRatio: 1,
    };
    expect(computeConfidenceV2(args)).toEqual(computeConfidenceV2(args));
  });

  it('the source vocabulary is exactly the DB CHECK vocabulary', async () => {
    const { computeConfidenceV2 } = await loadV2();
    // migration 20260727130100 constrains the column to
    // ('rerank','cosine','none') OR NULL. Anything else fails the insert.
    const allowed = new Set(['rerank', 'cosine', 'none']);
    const cases = [
      [{ rerank_score: 0.5 }],
      [{ cosine_similarity: 0.5 }],
      [{}],
      [],
    ];
    for (const chunks of cases) {
      const got = computeConfidenceV2({
        chunks,
        matchCountTarget: 5,
        groundingCheckPassRatio: 1,
      });
      expect(allowed.has(got.confidence_v2_source)).toBe(true);
    }
  });

  it('output stays inside the numeric(5,4) DB domain [0,1]', async () => {
    const { computeConfidenceV2 } = await loadV2();
    // Voyage rerank scores are nominally [0,1] but the column is numeric(5,4)
    // — an out-of-domain value would fail the insert and destroy the trace.
    for (const signal of [-5, 0, 0.5, 1, 12345]) {
      const got = computeConfidenceV2({
        chunks: [{ rerank_score: signal }],
        matchCountTarget: 5,
        groundingCheckPassRatio: 1,
      });
      expect(got.confidence_v2).toBeGreaterThanOrEqual(0);
      expect(got.confidence_v2).toBeLessThanOrEqual(1);
    }
  });
});
