/**
 * REGRESSION — shadow relevance-signal PLUMBING (rerank score + absolute cosine).
 *
 * Files under test:
 *   supabase/functions/_shared/reranking.ts       (grounded-answer's reranker)
 *   supabase/functions/_shared/rag/retrieve.ts    (unified retrieval module)
 *   supabase/functions/grounded-answer/retrieval.ts (adaptChunk hop)
 *
 * Pins:
 *   (2) NULL survives every hop. `mapNcertRow` must keep
 *       `typeof x === 'number' && Number.isFinite(x) ? x : null` for
 *       cosine_similarity — explicitly NOT the adjacent `? x : 0` used for
 *       `similarity`. Same for `adaptChunk`. A 0 here would assert "measured
 *       and maximally irrelevant" about a chunk that was never measured, and
 *       would silently poison every shadow row this instrumentation exists to
 *       collect.
 *   (3) `rankedScores` is POSITIONALLY ALIGNED with `rankedIndices`, and every
 *       fall-through path (no API key, docCount <= topK, non-2xx, malformed
 *       body, throw) returns a `rankedScores` of the SAME LENGTH filled with
 *       nulls. A length mismatch would mis-attribute cross-encoder scores to
 *       the wrong chunks — an error that is invisible in aggregate and fatal
 *       to the analysis.
 *
 * P12 (AI safety / grounding honesty).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface DenoLike {
  env: { get: (k: string) => string | undefined };
}
declare global {
  // eslint-disable-next-line no-var
  var Deno: DenoLike | undefined;
}

function setDenoEnv(vars: Record<string, string>) {
  globalThis.Deno = { env: { get: (k: string) => vars[k] } };
}

beforeEach(() => {
  setDenoEnv({});
});

afterEach(() => {
  delete (globalThis as { Deno?: DenoLike }).Deno;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadReranking(): Promise<any> {
  return await import('../../../../../supabase/functions/_shared/reranking');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadRetrieve(): Promise<any> {
  return await import('../../../../../supabase/functions/_shared/rag/retrieve');
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  } as unknown as Response;
}

// ───────────────────────────────────────────────────────────────────────────
// _shared/reranking.ts — the reranker grounded-answer's two pipelines use
// ───────────────────────────────────────────────────────────────────────────

describe('REGRESSION — rerankDocuments: rankedScores aligns with rankedIndices', () => {
  it('pairs each score with the index Voyage returned it for (not with position)', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 4, relevance_score: 0.91 },
            { index: 0, relevance_score: 0.55 },
            { index: 2, relevance_score: 0.12 },
          ],
        }),
      ),
    );

    const res = await rerankDocuments(
      { query: 'refraction', documents: ['a', 'b', 'c', 'd', 'e'] },
      3,
    );

    expect(res.reranked).toBe(true);
    expect(res.rankedIndices).toEqual([4, 0, 2]);
    expect(res.rankedScores).toEqual([0.91, 0.55, 0.12]);
    expect(res.rankedScores).toHaveLength(res.rankedIndices.length);
  });

  it('drops a non-integer index from BOTH arrays or from neither (no drift)', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 1, relevance_score: 0.9 },
            { index: 3, relevance_score: 0.4 },
          ],
        }),
      ),
    );
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 2);
    expect(res.rankedScores).toHaveLength(res.rankedIndices.length);
  });

  it('an entry with a non-numeric relevance_score becomes null, not 0, and keeps its slot', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 2, relevance_score: 0.8 },
            { index: 1 }, // Voyage omitted the score
            { index: 0, relevance_score: 'high' },
            { index: 3, relevance_score: Number.NaN },
          ],
        }),
      ),
    );
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd', 'e'] }, 4);
    expect(res.rankedIndices).toEqual([2, 1, 0, 3]);
    expect(res.rankedScores).toEqual([0.8, null, null, null]);
    // The distinction that matters: unknown ≠ maximally irrelevant.
    expect(res.rankedScores).not.toContain(0);
  });

  it('slices scores and indices to finalCount together', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.8 },
            { index: 2, relevance_score: 0.7 },
            { index: 3, relevance_score: 0.6 },
            { index: 4, relevance_score: 0.5 },
          ],
        }),
      ),
    );
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd', 'e', 'f'] }, 2);
    expect(res.rankedIndices).toEqual([0, 1]);
    expect(res.rankedScores).toEqual([0.9, 0.8]);
  });
});

describe('REGRESSION — rerankDocuments fall-through paths: same length, all null', () => {
  it('no documents ⇒ two empty arrays', async () => {
    const { rerankDocuments } = await loadReranking();
    const res = await rerankDocuments({ query: 'q', documents: [] }, 5);
    expect(res).toEqual({ rankedIndices: [], rankedScores: [], reranked: false });
  });

  it('no VOYAGE_API_KEY ⇒ identity order, nulls, same length', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({});
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 3);
    expect(res.reranked).toBe(false);
    expect(res.rankedIndices).toEqual([0, 1, 2]);
    expect(res.rankedScores).toEqual([null, null, null]);
  });

  it('docCount <= finalCount ⇒ identity order, nulls, same length', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b'] }, 5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.reranked).toBe(false);
    expect(res.rankedIndices).toEqual([0, 1]);
    expect(res.rankedScores).toEqual([null, null]);
  });

  it('non-2xx ⇒ identity order, nulls, same length (never throws)', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad model' }, 400)));
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 3);
    expect(res.reranked).toBe(false);
    expect(res.rankedIndices).toEqual([0, 1, 2]);
    expect(res.rankedScores).toEqual([null, null, null]);
  });

  it('malformed body (no data array) ⇒ identity order, nulls, same length', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nonsense: true })));
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 3);
    expect(res.reranked).toBe(false);
    expect(res.rankedScores).toEqual([null, null, null]);
  });

  it('empty data array ⇒ identity order, nulls, same length', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 3);
    expect(res.reranked).toBe(false);
    expect(res.rankedScores).toEqual([null, null, null]);
  });

  it('network throw ⇒ identity order, nulls, same length (never throws)', async () => {
    const { rerankDocuments } = await loadReranking();
    setDenoEnv({ VOYAGE_API_KEY: 'test-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 3);
    expect(res.reranked).toBe(false);
    expect(res.rankedIndices).toEqual([0, 1, 2]);
    expect(res.rankedScores).toEqual([null, null, null]);
  });

  it('every path returns rankedScores.length === rankedIndices.length', async () => {
    const { rerankDocuments } = await loadReranking();
    const paths: Array<() => void> = [
      () => setDenoEnv({}),
      () => {
        setDenoEnv({ VOYAGE_API_KEY: 'k' });
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
      },
      () => {
        setDenoEnv({ VOYAGE_API_KEY: 'k' });
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
      },
      () => {
        setDenoEnv({ VOYAGE_API_KEY: 'k' });
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => jsonResponse({ data: [{ index: 1, relevance_score: 0.5 }] })),
        );
      },
    ];
    for (const setup of paths) {
      setup();
      const res = await rerankDocuments({ query: 'q', documents: ['a', 'b', 'c', 'd'] }, 2);
      expect(res.rankedScores).toHaveLength(res.rankedIndices.length);
      for (const s of res.rankedScores) {
        expect(s === null || typeof s === 'number').toBe(true);
      }
    }
  }, 60000);
});

// ───────────────────────────────────────────────────────────────────────────
// _shared/rag/retrieve.ts — RPC row → RetrievalChunk, and its own rerank stage
// ───────────────────────────────────────────────────────────────────────────

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function makeStubClient(rows: Record<string, unknown>[]): {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    content: `content of ${id}`,
    chapter_number: 1,
    chapter_title: 'Light',
    page_number: 10,
    similarity: 0.03,
    source: 'ncert_2025',
    ...extra,
  };
}

describe('REGRESSION — mapNcertRow: a missing cosine stays NULL (never 0)', () => {
  it('maps a numeric cosine_similarity through unchanged', async () => {
    const { retrieve } = await loadRetrieve();
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a', { cosine_similarity: 0.4123 })]),
    });
    expect(res.chunks[0].cosineSimilarity).toBe(0.4123);
  });

  it('maps an ABSENT cosine_similarity column (pre-migration DB) to null, not 0', async () => {
    const { retrieve } = await loadRetrieve();
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a')]),
    });
    expect(res.chunks[0].cosineSimilarity).toBeNull();
    expect(res.chunks[0].cosineSimilarity).not.toBe(0);
    // …while `similarity` KEEPS its deliberate 0 coalesce. The two hops must
    // stay different.
    expect(res.chunks[0].similarity).toBe(0.03);
  });

  it('maps a SQL NULL cosine_similarity to null, not 0', async () => {
    const { retrieve } = await loadRetrieve();
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a', { cosine_similarity: null })]),
    });
    expect(res.chunks[0].cosineSimilarity).toBeNull();
  });

  it('maps a non-finite / non-numeric cosine to null, not 0', async () => {
    const { retrieve } = await loadRetrieve();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '0.5', {}]) {
      const res = await retrieve({
        query: 'refraction',
        grade: '10',
        subject: 'science',
        rerank: false,
        caller: 'test',
        supabase: makeStubClient([row('a', { cosine_similarity: bad })]),
      });
      expect(res.chunks[0].cosineSimilarity).toBeNull();
    }
  });

  it('preserves a genuine 0 cosine (measured, maximally irrelevant)', async () => {
    const { retrieve } = await loadRetrieve();
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a', { cosine_similarity: 0 })]),
    });
    expect(res.chunks[0].cosineSimilarity).toBe(0);
  });

  it('an FTS-recovered cosine BELOW the configured floor is reported, not filtered', async () => {
    const { retrieve } = await loadRetrieve();
    // p_min_similarity gates only the vector CTE, never the FTS CTE. A tier-1
    // FTS-recovered row legitimately carries a sub-floor cosine. Dropping it
    // here would be a behaviour change AND would bias the shadow sample.
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      minCosineSimilarity: 0.22,
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a', { cosine_similarity: 0.05 })]),
    });
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0].cosineSimilarity).toBe(0.05);
  });

  it('rerankScore starts null when no rerank stage ran', async () => {
    const { retrieve } = await loadRetrieve();
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: makeStubClient([row('a', { cosine_similarity: 0.5 })]),
    });
    expect(res.chunks[0].rerankScore).toBeNull();
  });
});

describe("REGRESSION — retrieve()'s own rerank stage stamps the right score on the right chunk", () => {
  const rows = [row('r0'), row('r1'), row('r2'), row('r3'), row('r4')];

  it('each chunk carries the score of the index Voyage promoted it by', async () => {
    const { retrieve } = await loadRetrieve();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 4, relevance_score: 0.93 },
            { index: 0, relevance_score: 0.61 },
            { index: 2, relevance_score: 0.08 },
          ],
        }),
      ),
    );
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      limit: 3,
      rerank: true,
      // Pre-supplied embedding skips the Voyage embed call, so the stubbed
      // fetch only ever serves the rerank request.
      embedding: [0.1],
      voyageApiKey: 'test-key',
      caller: 'test',
      supabase: makeStubClient(rows),
    });

    // MMR may reorder the reranked top-K, so assert the PAIRING, not the order.
    const byId = new Map(
      res.chunks.map((c: { chunk_id: string; rerankScore: number | null }) => [
        c.chunk_id,
        c.rerankScore,
      ]),
    );
    expect(byId.get('r4')).toBe(0.93);
    expect(byId.get('r0')).toBe(0.61);
    expect(byId.get('r2')).toBe(0.08);
    expect(res.chunks).toHaveLength(3);
    // Chunks the cross-encoder never judged must not appear with a score.
    expect(byId.has('r1')).toBe(false);
    expect(byId.has('r3')).toBe(false);
  });

  it('a rerank fall-through leaves every rerankScore null (never 0)', async () => {
    const { retrieve } = await loadRetrieve();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      limit: 3,
      rerank: true,
      embedding: [0.1],
      voyageApiKey: 'test-key',
      caller: 'test',
      supabase: makeStubClient(rows),
    });
    expect(res.chunks).toHaveLength(3);
    for (const c of res.chunks) {
      expect(c.rerankScore).toBeNull();
    }
  });

  it('a promoted chunk with a missing Voyage score keeps null, not 0', async () => {
    const { retrieve } = await loadRetrieve();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 3, relevance_score: 0.7 },
            { index: 1 }, // no score
            { index: 0, relevance_score: 0.2 },
          ],
        }),
      ),
    );
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      limit: 3,
      rerank: true,
      embedding: [0.1],
      voyageApiKey: 'test-key',
      caller: 'test',
      supabase: makeStubClient(rows),
    });
    const byId = new Map(
      res.chunks.map((c: { chunk_id: string; rerankScore: number | null }) => [
        c.chunk_id,
        c.rerankScore,
      ]),
    );
    expect(byId.get('r3')).toBe(0.7);
    expect(byId.get('r1')).toBeNull();
    expect(byId.get('r0')).toBe(0.2);
  });

  it('rerank does not disturb the absolute cosine already mapped onto each chunk (unified module)', async () => {
    const { retrieve } = await loadRetrieve();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.5 },
          ],
        }),
      ),
    );
    const res = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      limit: 2,
      rerank: true,
      embedding: [0.1],
      voyageApiKey: 'test-key',
      caller: 'test',
      supabase: makeStubClient([
        row('r0', { cosine_similarity: 0.11 }),
        row('r1', { cosine_similarity: 0.22 }),
        row('r2', { cosine_similarity: 0.33 }),
      ]),
    });
    const byId = new Map(
      res.chunks.map((c: { chunk_id: string; cosineSimilarity: number | null }) => [
        c.chunk_id,
        c.cosineSimilarity,
      ]),
    );
    expect(byId.get('r2')).toBe(0.33);
    expect(byId.get('r0')).toBe(0.11);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// grounded-answer/retrieval.ts — the adaptChunk hop between the unified
// RetrievalChunk shape and grounded-answer's local RetrievedChunk shape.
// This is the last place a null could be quietly folded to 0 before it
// reaches computeConfidenceV2.
// ───────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadGroundedRetrieval(): Promise<any> {
  return await import('../../../../../supabase/functions/grounded-answer/retrieval');
}

describe('REGRESSION — adaptChunk carries both shadow signals through as null', () => {
  const params = {
    query: 'refraction',
    embedding: [0.1],
    scope: {
      grade: '10',
      subject_code: 'science',
      chapter_number: null,
      chapter_title: null,
    },
    matchCount: 5,
    minSimilarity: 0.005,
  };

  it('a numeric cosine reaches grounded-answer as cosine_similarity', async () => {
    const { retrieveChunks } = await loadGroundedRetrieval();
    const res = await retrieveChunks(
      makeStubClient([row('a', { cosine_similarity: 0.4123 })]),
      params,
    );
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0].cosine_similarity).toBe(0.4123);
  });

  it('an absent/NULL cosine reaches grounded-answer as null, NOT 0', async () => {
    const { retrieveChunks } = await loadGroundedRetrieval();
    for (const rpcRow of [row('a'), row('a', { cosine_similarity: null })]) {
      const res = await retrieveChunks(makeStubClient([rpcRow]), params);
      expect(res.chunks[0].cosine_similarity).toBeNull();
      expect(res.chunks[0].cosine_similarity).not.toBe(0);
    }
  });

  it('rerank_score is null on this hop (grounded-answer defers reranking)', async () => {
    const { retrieveChunks } = await loadGroundedRetrieval();
    const res = await retrieveChunks(
      makeStubClient([row('a', { cosine_similarity: 0.5 })]),
      params,
    );
    expect(res.chunks[0].rerank_score).toBeNull();
  });

  it('a null cosine on this hop yields source none in computeConfidenceV2 (end-to-end)', async () => {
    const { retrieveChunks } = await loadGroundedRetrieval();
    const { computeConfidenceV2 } = await import(
      '../../../../../supabase/functions/grounded-answer/confidence-v2'
    );
    const res = await retrieveChunks(makeStubClient([row('a'), row('b')]), params);
    const v2 = computeConfidenceV2({
      chunks: res.chunks,
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    // The honest outcome for an evidence-free row: excluded from analysis
    // rather than recorded as a confident 0.
    expect(v2.confidence_v2).toBeNull();
    expect(v2.confidence_v2_source).toBe('none');
    expect(v2.top_cosine_similarity).toBeNull();
  });

  it('a cosine-bearing row yields source cosine end-to-end', async () => {
    const { retrieveChunks } = await loadGroundedRetrieval();
    const { computeConfidenceV2 } = await import(
      '../../../../../supabase/functions/grounded-answer/confidence-v2'
    );
    const res = await retrieveChunks(
      makeStubClient([
        row('a', { cosine_similarity: 0.61 }),
        row('b', { cosine_similarity: null }),
        row('c', { cosine_similarity: 0.41 }),
      ]),
      params,
    );
    const v2 = computeConfidenceV2({
      chunks: res.chunks,
      matchCountTarget: 5,
      groundingCheckPassRatio: 1,
    });
    expect(v2.confidence_v2_source).toBe('cosine');
    expect(v2.top_cosine_similarity).toBe(0.61);
    expect(v2.signal_coverage).toBe(2); // the null neighbour is omitted
  });
});
