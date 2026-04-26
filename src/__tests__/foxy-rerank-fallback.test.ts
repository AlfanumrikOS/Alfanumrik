/**
 * Voyage rerank fallback contract — REG-37.
 *
 * Phase 1 of the Foxy moat plan wires Voyage rerank-2 in front of the
 * RRF-fused candidates inside the grounded-answer Edge Function. Rerank
 * gives a meaningful relevance lift but it's also a SPOF: the Voyage API
 * has 99.5%-ish availability, and on outages we MUST NOT crash the
 * student's chat — we fall back to similarity-ranked top-N.
 *
 * Safety contract under test:
 *
 *   1. When VOYAGE_API_KEY is unset → rerank is skipped, similarity-ranked
 *      top-N is returned (no fetch attempted).
 *   2. When the rerank fetch throws  → the error is swallowed, similarity-
 *      ranked top-N is returned (request DOES NOT fail).
 *   3. When rerank returns a non-2xx → fall back to similarity ranking.
 *   4. When rerank returns malformed JSON → fall back to similarity ranking.
 *   5. When rerank succeeds          → reordered results are returned.
 *
 * Per the user's instruction: the canonical implementation is in
 * supabase/functions/grounded-answer (Deno). Deno tests for that module
 * exist in supabase/functions/grounded-answer/__tests__/ and are NOT run
 * by `npm test`. This Vitest file is therefore a contract/parity test on
 * the ranking-decision logic, mirroring the foxy-plan-normalization.test.ts
 * pattern. Keep this in lockstep with the Deno implementation; quality
 * review rejects if they diverge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Types mirrored from supabase/functions/grounded-answer/retrieval.ts ─

interface Candidate {
  id: string;
  content: string;
  similarity: number;
}

interface RerankParams {
  query: string;
  candidates: Candidate[];
  topN: number;
  voyageApiKey: string | null;
  fetchImpl: typeof fetch;
}

// ─── Replicated rerank logic (parity copy) ──────────────────────────────
//
// The real implementation lives in the grounded-answer Deno function. The
// shape below is the contract any in-process port must satisfy. If the
// Deno code changes, update this copy.

async function rerankWithFallback(params: RerankParams): Promise<Candidate[]> {
  const { query, candidates, topN, voyageApiKey, fetchImpl } = params;

  // similarity-ranked top-N — used as the safe fallback below.
  const similarityTopN = [...candidates]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);

  // 1. No API key → skip rerank entirely, do not even attempt fetch.
  if (!voyageApiKey) {
    return similarityTopN;
  }

  // 2. Attempt rerank — wrapped in try/catch so any throw falls back.
  try {
    const response = await fetchImpl('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voyageApiKey}`,
      },
      body: JSON.stringify({
        query,
        documents: candidates.map((c) => c.content),
        model: 'rerank-2',
        top_k: topN,
      }),
    });

    if (!response.ok) {
      // 3. Non-2xx → fall back, do not throw upstream.
      return similarityTopN;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // 4. Malformed JSON → fall back.
      return similarityTopN;
    }

    const results = (payload as { data?: Array<{ index: number; relevance_score: number }> }).data;
    if (!Array.isArray(results) || results.length === 0) {
      return similarityTopN;
    }

    // Map rerank results back to candidates by index, in order.
    const reordered: Candidate[] = [];
    for (const r of results) {
      const c = candidates[r.index];
      if (c) reordered.push(c);
    }
    if (reordered.length === 0) return similarityTopN;
    return reordered.slice(0, topN);
  } catch {
    // 2. Network/throw → fall back.
    return similarityTopN;
  }
}

// ─── Test fixtures ──────────────────────────────────────────────────────

const candidates: Candidate[] = [
  { id: 'c1', content: 'Photosynthesis converts light to chemical energy.', similarity: 0.42 },
  { id: 'c2', content: 'Reflection of light at plane mirrors.', similarity: 0.85 },
  { id: 'c3', content: 'Cellular respiration releases energy from glucose.', similarity: 0.61 },
  { id: 'c4', content: 'Refraction through a glass prism.', similarity: 0.78 },
  { id: 'c5', content: 'Mitosis divides somatic cells.', similarity: 0.30 },
];

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Voyage rerank — REG-37 fallback contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('no VOYAGE_API_KEY', () => {
    it('skips rerank entirely and returns similarity-ranked top-N', async () => {
      const fetchSpy = vi.fn(); // must NOT be called
      const out = await rerankWithFallback({
        query: 'how does light bend through glass?',
        candidates,
        topN: 3,
        voyageApiKey: null,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(out).toHaveLength(3);
      // similarity-sorted: c2 (0.85), c4 (0.78), c3 (0.61)
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });

    it('empty string API key is treated as missing (no fetch attempted)', async () => {
      const fetchSpy = vi.fn();
      await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 2,
        voyageApiKey: '',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('rerank fetch throws (network error / DNS / abort)', () => {
    it('swallows the error and returns similarity-ranked top-N', async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error('ENOTFOUND api.voyageai.com'));

      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(out).toHaveLength(3);
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });

    it('AbortError (timeout) does not crash — falls back to similarity ranking', async () => {
      const abortErr = new DOMException('aborted', 'AbortError');
      const fetchSpy = vi.fn().mockRejectedValue(abortErr);

      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 2,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(out).toHaveLength(2);
      // c2 and c4 are top-2 by similarity
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4']);
    });
  });

  describe('rerank returns non-2xx', () => {
    it('500 from Voyage → falls back to similarity ranking', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('{"error":"internal"}', { status: 500 }),
      );

      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });

    it('429 rate-limit → falls back to similarity ranking (no retries here)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('{"error":"rate limited"}', { status: 429 }),
      );
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });
  });

  describe('rerank returns malformed/empty payload', () => {
    it('non-JSON body → falls back', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('not json at all', { status: 200 }),
      );
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });

    it('empty data array → falls back', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(out.map((c) => c.id)).toEqual(['c2', 'c4', 'c3']);
    });

    it('out-of-bounds index in rerank result is skipped', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { index: 99, relevance_score: 0.99 }, // invalid
              { index: 0, relevance_score: 0.95 },  // c1
            ],
          }),
          { status: 200 },
        ),
      );
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      // Only the valid index survives — and that's a non-empty list, so we
      // do NOT fall back to similarity ranking.
      expect(out.map((c) => c.id)).toEqual(['c1']);
    });
  });

  describe('rerank succeeds — happy path', () => {
    it('returns rerank-ordered candidates (different order from similarity)', async () => {
      // Voyage is allowed to disagree with cosine: assume the rerank thinks
      // c4 (refraction) is most relevant to "how does light bend?" even
      // though c2 (reflection) had higher similarity.
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { index: 3, relevance_score: 0.97 }, // c4 — refraction
              { index: 1, relevance_score: 0.81 }, // c2 — reflection
              { index: 2, relevance_score: 0.42 }, // c3 — respiration
            ],
          }),
          { status: 200 },
        ),
      );

      const out = await rerankWithFallback({
        query: 'how does light bend through glass?',
        candidates,
        topN: 3,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(out.map((c) => c.id)).toEqual(['c4', 'c2', 'c3']);
    });

    it('respects topN limit even if rerank returns more', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { index: 0, relevance_score: 0.9 },
              { index: 1, relevance_score: 0.8 },
              { index: 2, relevance_score: 0.7 },
              { index: 3, relevance_score: 0.6 },
              { index: 4, relevance_score: 0.5 },
            ],
          }),
          { status: 200 },
        ),
      );
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 2,
        voyageApiKey: 'sk-vo-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
      expect(out).toHaveLength(2);
      expect(out.map((c) => c.id)).toEqual(['c1', 'c2']);
    });
  });

  describe('similarity-ranked fallback — invariants', () => {
    it('preserves all candidate fields (no truncation/mutation)', async () => {
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 5,
        voyageApiKey: null,
        fetchImpl: (() => {}) as unknown as typeof fetch,
      });
      expect(out).toHaveLength(5);
      for (const c of out) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('content');
        expect(c).toHaveProperty('similarity');
      }
    });

    it('does not mutate the input candidates array', async () => {
      const before = candidates.map((c) => c.id);
      await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 3,
        voyageApiKey: null,
        fetchImpl: (() => {}) as unknown as typeof fetch,
      });
      expect(candidates.map((c) => c.id)).toEqual(before);
    });

    it('topN larger than candidates returns all of them', async () => {
      const out = await rerankWithFallback({
        query: 'q',
        candidates,
        topN: 100,
        voyageApiKey: null,
        fetchImpl: (() => {}) as unknown as typeof fetch,
      });
      expect(out).toHaveLength(candidates.length);
    });
  });
});
