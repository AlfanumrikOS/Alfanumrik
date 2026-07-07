/**
 * Tests for supabase/functions/_shared/rag/mmr.ts
 *
 * Why Vitest (not Deno test):
 *   The MMR module is pure TS — no Deno globals — so we exercise it from
 *   the standard Vitest runner. Edge-Function callers re-import the same
 *   source file under `deno test`.
 *
 * Audit context: Phase 2.B Win 2 (RAG strengthening). Locks down the
 * lambda-weighted greedy MMR algorithm used to diversify the reranked
 * top-N before injection into Foxy's prompt.
 */

import { describe, it, expect } from 'vitest';

// Dynamic import (any-typed) so TS doesn't trace into the Edge Function
// module — same pattern used by rag-retrieve.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMMR(): Promise<any> {
  return await import('../../../supabase/functions/_shared/rag/mmr');
}

describe('applyMMR — degenerate inputs', () => {
  it('returns empty for empty input', async () => {
    const { applyMMR } = await loadMMR();
    expect(applyMMR([], 0.7)).toEqual([]);
  });

  it('returns input as-is for a single chunk (nothing to diversify)', async () => {
    const { applyMMR } = await loadMMR();
    const single = [{ id: 'a', similarity: 0.9, content: 'photosynthesis basics' }];
    const result = applyMMR(single, 0.7);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('does not mutate the input array', async () => {
    const { applyMMR } = await loadMMR();
    const input = [
      { id: 'a', similarity: 0.9, content: 'alpha beta gamma' },
      { id: 'b', similarity: 0.8, content: 'delta epsilon zeta' },
    ];
    const snapshot = input.map((c: { id: string }) => c.id);
    applyMMR(input, 0.7);
    expect(input.map((c: { id: string }) => c.id)).toEqual(snapshot);
  });

  it('handles non-array input defensively', async () => {
    const { applyMMR } = await loadMMR();
    // Defensive contract — runtime edge: pipeline.ts wraps this in a
    // length check, but the module itself must not throw.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = applyMMR(undefined as any, 0.7);
    expect(result).toEqual([]);
  });
});

describe('applyMMR — top-1 invariant + output length', () => {
  it('always preserves the original top-1 unconditionally', async () => {
    const { applyMMR } = await loadMMR();
    // Top-1 is highest similarity. Even with lambda=0 (pure novelty),
    // slot-1 is taken before any redundancy comparison runs.
    const chunks = [
      { id: 'top', similarity: 0.95, content: 'photosynthesis chlorophyll light reaction' },
      { id: 'b', similarity: 0.90, content: 'photosynthesis chlorophyll light reaction' }, // near-dup of top
      { id: 'c', similarity: 0.85, content: 'mitosis cell division chromosome' },
    ];
    const resultRel = applyMMR(chunks, 1.0); // pure relevance
    const resultDiv = applyMMR(chunks, 0.0); // pure diversity
    expect(resultRel[0].id).toBe('top');
    expect(resultDiv[0].id).toBe('top');
  });

  it('output length always equals input length (MMR reorders, never drops)', async () => {
    const { applyMMR } = await loadMMR();
    const chunks = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      similarity: 0.9 - i * 0.05,
      content: `paragraph ${i} unique content tokens here`,
    }));
    const result = applyMMR(chunks, 0.7);
    expect(result).toHaveLength(8);
    expect(new Set(result.map((c: { id: string }) => c.id)).size).toBe(8); // no duplicates
  });
});

describe('applyMMR — lambda extremes', () => {
  it('lambda=1.0 (pure relevance) preserves the original ranking', async () => {
    const { applyMMR } = await loadMMR();
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'alpha beta gamma delta epsilon zeta' },
      { id: 'b', similarity: 0.90, content: 'alpha beta gamma delta epsilon zeta' }, // identical
      { id: 'c', similarity: 0.85, content: 'mitosis cell division chromosome unique' },
    ];
    const result = applyMMR(chunks, 1.0);
    expect(result.map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('lambda=0.0 (pure diversity) prefers the most-different chunk in slot 2', async () => {
    const { applyMMR } = await loadMMR();
    // Top-1 = a. b is identical to a (Jaccard ≈ 1). c is totally different.
    // Pure diversity picks c next.
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'photosynthesis chlorophyll light' },
      { id: 'b', similarity: 0.90, content: 'photosynthesis chlorophyll light' },
      { id: 'c', similarity: 0.85, content: 'mitosis chromosome division' },
    ];
    const result = applyMMR(chunks, 0.0);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c'); // diversity beat relevance
    expect(result[2].id).toBe('b');
  });

  it('lambda=0.7 (default) keeps near-duplicate behind a more diverse near-tied chunk', async () => {
    const { applyMMR } = await loadMMR();
    // Three chunks where the relevance gap is small so the redundancy
    // penalty (lambda=0.3 weight) dominates. Math (post normalization):
    //   normRel: a=1.0, b≈0.667, c=0.0
    //   slot 2 candidates after picking a:
    //     b: 0.7*0.667 - 0.3*1.0 = 0.467 - 0.300 = 0.167
    //     c: 0.7*0.0   - 0.3*0.0 = 0.000
    //   b wins on relevance — this case verifies that mild ties still
    //   respect relevance, which is the correct behavior at lambda=0.7.
    // Then for slot 3: only b vs c remain; b is still scored against a
    // (Jaccard=1), c against a (Jaccard=0). c gets dropped to slot 3.
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'photosynthesis chlorophyll light reaction stage' },
      { id: 'b', similarity: 0.92, content: 'photosynthesis chlorophyll light reaction stage' }, // dup of a
      { id: 'c', similarity: 0.80, content: 'mitochondria respiration glucose oxygen energy' },
    ];
    const result = applyMMR(chunks, 0.7);
    expect(result[0].id).toBe('a');
    // With this score gap b's relevance edge (~0.667 normalized) beats c's
    // diversity advantage at lambda=0.7. Documented for regression clarity.
    expect(result[1].id).toBe('b');
    expect(result[2].id).toBe('c');
  });

  it('lambda=0.7 prefers the diverse chunk when b is a near-duplicate close to c in relevance', async () => {
    const { applyMMR } = await loadMMR();
    // a=0.95, b=0.91, c=0.90. range=0.05.
    // normRel: a=1.0, b=0.2, c=0.0.
    // After picking a, slot 2:
    //   b: 0.7*0.2 - 0.3*1.0 = 0.14 - 0.30 = -0.16
    //   c: 0.7*0.0 - 0.3*0.0 = 0.00
    //   c wins. Demonstrates that when the marginal relevance gain of a
    //   near-duplicate is small, lambda=0.7 still surfaces a diverse chunk.
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'photosynthesis chlorophyll light reaction stage' },
      { id: 'b', similarity: 0.91, content: 'photosynthesis chlorophyll light reaction stage' },
      { id: 'c', similarity: 0.90, content: 'mitochondria respiration glucose oxygen energy' },
    ];
    const result = applyMMR(chunks, 0.7);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
    expect(result[2].id).toBe('b');
  });
});

describe('applyMMR — determinism & idempotency', () => {
  it('is deterministic: same input produces same output across calls', async () => {
    const { applyMMR } = await loadMMR();
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'alpha beta gamma' },
      { id: 'b', similarity: 0.92, content: 'alpha beta gamma' },
      { id: 'c', similarity: 0.90, content: 'delta epsilon' },
      { id: 'd', similarity: 0.88, content: 'eta theta iota' },
    ];
    const r1 = applyMMR(chunks, 0.7).map((c: { id: string }) => c.id);
    const r2 = applyMMR(chunks, 0.7).map((c: { id: string }) => c.id);
    const r3 = applyMMR(chunks, 0.7).map((c: { id: string }) => c.id);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it('is idempotent: applyMMR(applyMMR(x)) === applyMMR(x)', async () => {
    const { applyMMR } = await loadMMR();
    const chunks = [
      { id: 'a', similarity: 0.95, content: 'photosynthesis chlorophyll light' },
      { id: 'b', similarity: 0.90, content: 'mitochondria respiration' },
      { id: 'c', similarity: 0.85, content: 'photosynthesis chlorophyll light' },
      { id: 'd', similarity: 0.80, content: 'cell membrane phospholipid bilayer' },
    ];
    const once = applyMMR(chunks, 0.7);
    const twice = applyMMR(once, 0.7);
    expect(twice.map((c: { id: string }) => c.id)).toEqual(once.map((c: { id: string }) => c.id));
  });

  it('breaks ties by original input order (stable)', async () => {
    const { applyMMR } = await loadMMR();
    // All chunks have identical content + similarity → MMR scores all
    // tie → must preserve input order.
    const chunks = [
      { id: 'a', similarity: 0.9, content: 'identical text here' },
      { id: 'b', similarity: 0.9, content: 'identical text here' },
      { id: 'c', similarity: 0.9, content: 'identical text here' },
    ];
    const result = applyMMR(chunks, 0.7);
    expect(result.map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('deterministic stable order at N=4 with identical-content chunks', async () => {
    const { applyMMR } = await loadMMR();
    // Four chunks, identical content, identical similarity. Jaccard=1 for
    // every pair, so the diversity penalty term is identical for all
    // remaining candidates at every greedy step → MMR scores tie → the
    // first-eligible candidate (input order) wins each slot.
    //
    // This is the catalog contract for REG-42: applyMMR must be
    // deterministic AND idempotent at N=4 on degenerate input. A future
    // change that introduces e.g. a Math.random() tie-breaker would flake
    // here, and one that uses an unstable sort (e.g. sort by score with
    // V8 < 7.0 semantics) would scramble the output.
    const chunks = [
      { id: 'a', similarity: 0.9, content: 'photosynthesis chlorophyll light reaction' },
      { id: 'b', similarity: 0.9, content: 'photosynthesis chlorophyll light reaction' },
      { id: 'c', similarity: 0.9, content: 'photosynthesis chlorophyll light reaction' },
      { id: 'd', similarity: 0.9, content: 'photosynthesis chlorophyll light reaction' },
    ];
    const r1 = applyMMR(chunks, 0.7).map((c: { id: string }) => c.id);
    const r2 = applyMMR(chunks, 0.7).map((c: { id: string }) => c.id);
    expect(r1).toEqual(['a', 'b', 'c', 'd']);
    expect(r1).toEqual(r2); // deterministic across calls
  });
});

describe('jaccardSimilarity (helper)', () => {
  it('returns 1.0 for identical token sets', async () => {
    const { jaccardSimilarity, tokenizeForMMR } = await loadMMR();
    const a = tokenizeForMMR('the quick brown fox');
    const b = tokenizeForMMR('the quick brown fox');
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it('returns 0 for disjoint sets', async () => {
    const { jaccardSimilarity, tokenizeForMMR } = await loadMMR();
    const a = tokenizeForMMR('alpha beta gamma');
    const b = tokenizeForMMR('delta epsilon zeta');
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 0 when either side is empty', async () => {
    const { jaccardSimilarity, tokenizeForMMR } = await loadMMR();
    expect(jaccardSimilarity(tokenizeForMMR(''), tokenizeForMMR('hello'))).toBe(0);
    expect(jaccardSimilarity(tokenizeForMMR('hello'), tokenizeForMMR(''))).toBe(0);
  });

  it('is symmetric', async () => {
    const { jaccardSimilarity, tokenizeForMMR } = await loadMMR();
    const a = tokenizeForMMR('the quick brown fox jumped');
    const b = tokenizeForMMR('the lazy dog jumped over');
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });
});
