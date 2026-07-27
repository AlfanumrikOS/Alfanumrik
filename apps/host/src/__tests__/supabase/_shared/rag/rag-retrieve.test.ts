/**
 * Tests for the unified RAG retrieve() interface.
 * File under test: supabase/functions/_shared/rag/retrieve.ts
 *
 * Why Vitest (not Deno test):
 *   The unified retrieve() module is intentionally written with zero `https://`
 *   imports — it only uses Deno globals (Deno.env, fetch) which we stub here.
 *   That lets it run inside both Vitest (CI) and `deno test` (local Edge dev)
 *   from a single source. Deno tests for the existing grounded-answer
 *   retrieval contract still live in supabase/functions/grounded-answer/__tests__.
 *
 * Audit context: F10 (2026-04-27 production readiness). Phase 1 ships this
 * unified TS contract; SQL-layer consolidation is Phase 2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Stub Deno global so retrieve.ts can read VOYAGE_API_KEY ────────────────
// Vitest runs in jsdom/node — `Deno` is undefined by default. The retrieve
// module reads `globalThis.Deno?.env.get('VOYAGE_API_KEY')` defensively.
// We default to "no key" so embedding/rerank network calls are skipped
// unless a test opts in.

interface DenoLike {
  env: { get: (k: string) => string | undefined };
}
declare global {
  // eslint-disable-next-line no-var
  var Deno: DenoLike | undefined;
}

const noEnvDeno: DenoLike = { env: { get: () => undefined } };

beforeEach(() => {
  globalThis.Deno = noEnvDeno;
});

afterEach(() => {
  delete (globalThis as { Deno?: DenoLike }).Deno;
  vi.restoreAllMocks();
});

// ── Stub supabase client ────────────────────────────────────────────────────

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function makeStubClient(opts: {
  rows?: Record<string, unknown>[];
  error?: { message: string } | null;
  throwSync?: boolean;
}): { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      if (opts.throwSync) throw new Error('network down');
      return Promise.resolve({
        data: opts.rows ?? [],
        error: opts.error ?? null,
      });
    },
  };
}

// ── Dynamic import — happens inside each test so Deno stub is in scope ──────

// We type the dynamic import as `any` so TS doesn't trace into the Edge
// Function module (which is excluded from the project tsconfig and must
// remain runnable under both Vitest and `deno test`). Validation contract
// is exercised at runtime — this file's job is to verify behavior, not to
// re-prove the static type contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadRetrieve(): Promise<any> {
  return await import(
    '../../../../../supabase/functions/_shared/rag/retrieve'
  );
}

describe('unified retrieve() — input validation (P5 grade format)', () => {
  it('rejects integer grade with RetrievalError', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await expect(
      retrieve({
        query: 'what is refraction',
        // P5 violation: integer grade. Caught at runtime by validateOptions.
        grade: 10,
        subject: 'science',
        caller: 'test',
        supabase: sb,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it('rejects out-of-range grade string', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await expect(
      retrieve({
        query: 'x',
        grade: '5',
        subject: 'science',
        caller: 'test',
        supabase: sb,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it('rejects empty subject', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await expect(
      retrieve({
        query: 'x',
        grade: '10',
        subject: '',
        caller: 'test',
        supabase: sb,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it('rejects empty caller', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await expect(
      retrieve({
        query: 'x',
        grade: '10',
        subject: 'science',
        caller: '',
        supabase: sb,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it('rejects non-integer chapterNumber', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await expect(
      retrieve({
        query: 'x',
        grade: '10',
        subject: 'science',
        chapterNumber: 1.5,
        caller: 'test',
        supabase: sb,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it('rejects missing supabase client', async () => {
    const { retrieve, RetrievalError } = await loadRetrieve();
    await expect(
      retrieve({
        query: 'x',
        grade: '10',
        subject: 'science',
        caller: 'test',
        // Missing supabase client — caught at runtime by validateOptions.
        supabase: undefined,
      }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });
});

describe('unified retrieve() — RPC contract', () => {
  it('calls match_rag_chunks_ncert by default with snake_case params', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'what is refraction',
      grade: '10',
      subject: 'science',
      chapterNumber: 7,
      chapterTitle: null,
      limit: 5,
      minSimilarity: 0.55,
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0].name).toBe('match_rag_chunks_ncert');
    expect(sb.calls[0].args).toMatchObject({
      query_text: 'what is refraction',
      p_subject_code: 'science',
      p_grade: '10',
      p_chapter_number: 7,
      p_chapter_title: null,
      // 2026-07-27: `p_min_quality: 0.55` used to be asserted here. That arg
      // bound PostgREST to the STALE floor-less overload and fed a similarity
      // threshold into a content-quality gate. See the overload-binding
      // regression block at the bottom of this file.
      p_quality_score_gate: 0.4,
      p_min_similarity: 0.22,
    });
    // chapter_number must be number, never string
    expect(typeof sb.calls[0].args.p_chapter_number).toBe('number');
    // The caller-side RRF floor must NEVER leak into the RPC args.
    expect(sb.calls[0].args).not.toHaveProperty('p_min_quality');
  });

  it('forwards null chapterNumber as null', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      chapterNumber: null,
      caller: 'test',
      supabase: sb,
    });
    expect(sb.calls[0].args.p_chapter_number).toBeNull();
  });

  it('forwards a pre-computed embedding without calling Voyage', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const embedding = Array(1024).fill(0.1);
    await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      embedding,
      caller: 'test',
      supabase: sb,
    });
    // No Voyage embed call — embedding was supplied
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sb.calls[0].args.query_embedding).toBe(embedding);
  });
});

describe('unified retrieve() — result shape', () => {
  it('returns timing breakdown and rpc_used label', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({
      rows: [
        {
          id: 'a',
          content: 'Refraction is the bending of light…',
          chapter_number: 10,
          chapter_title: 'Light',
          page_number: 145,
          similarity: 0.82,
          source: 'ncert_2025',
        },
      ],
    });
    const result = await retrieve({
      query: 'refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.rpc_used).toBe('match_rag_chunks_ncert');
    expect(typeof result.embedding_ms).toBe('number');
    expect(typeof result.retrieval_ms).toBe('number');
    expect(typeof result.rerank_ms).toBe('number');
    expect(typeof result.total_ms).toBe('number');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].chunk_id).toBe('a');
    expect(result.chunks[0].source_rpc).toBe('match_rag_chunks_ncert');
  });

  it('counts scope drops for wrong-grade rows', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({
      rows: [
        { id: 'a', content: 'x', chapter_number: 1, similarity: 0.8, grade_short: '10', subject_code: 'science' },
        { id: 'b', content: 'y', chapter_number: 1, similarity: 0.8, grade_short: '11', subject_code: 'science' },
        { id: 'c', content: 'z', chapter_number: 1, similarity: 0.8, grade_short: '10', subject_code: 'math' },
      ],
    });
    const result = await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.scope_drops).toBe(2);
    expect(result.chunks[0].chunk_id).toBe('a');
  });

  it('does not drop on chapter mismatch when chapterNumber is null', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({
      rows: [
        { id: 'a', content: 'x', chapter_number: 1, similarity: 0.8 },
        { id: 'b', content: 'y', chapter_number: 2, similarity: 0.8 },
      ],
    });
    const result = await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      chapterNumber: null,
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.scope_drops).toBe(0);
  });
});

describe('unified retrieve() — failure modes (never throws)', () => {
  it('returns error on RPC error and empty chunks', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ error: { message: 'connection failure' } });
    const result = await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.error).not.toBeNull();
    expect(result.error?.phase).toBe('retrieval');
    expect(result.error?.message).toContain('connection failure');
  });

  it('returns error on RPC throw and empty chunks (no propagation)', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ throwSync: true });
    const result = await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.error?.phase).toBe('retrieval');
  });

  it('produces no error when chunks come back successfully', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({
      rows: [{ id: 'a', content: 'x', chapter_number: 1, similarity: 0.8 }],
    });
    const result = await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(result.error).toBeNull();
    expect(result.chunks).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// REGRESSION: match_rag_chunks_ncert overload binding (2026-07-27)
//
// Production carries TWO overloads of this RPC (`CREATE OR REPLACE` with a
// changed signature OVERLOADS, it does not replace):
//   - OLD (baseline, oid 201818): `p_min_quality`. Vector CTE has NO absolute
//     cosine floor.
//   - NEW (migration 20260707010000, oid 359405): `p_quality_score_gate` +
//     `p_min_similarity`. Vector CTE HAS
//     `AND 1 - (embedding <=> query_embedding) >= p_min_similarity`.
//
// PostgREST resolves overloads by argument NAME. Sending `p_min_quality` binds
// the OLD overload, so the relevance floor becomes dead code AND a similarity
// threshold is fed into a content `quality_score` gate. Sending NEITHER
// distinguishing arg matches BOTH overloads and is ambiguous.
//
// These tests are the pin: the RPC call MUST carry `p_min_similarity` and
// `p_quality_score_gate`, and MUST NEVER carry `p_min_quality`.
// ────────────────────────────────────────────────────────────────────────────
describe('REGRESSION — match_rag_chunks_ncert overload binding', () => {
  it('never sends p_min_quality (would bind the stale floor-less overload)', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'explain refraction',
      grade: '10',
      subject: 'science',
      // RRF-scale caller floor — the exact value grounded-answer passes in
      // strict mode. It must NOT reach the RPC on any parameter.
      minSimilarity: 0.012,
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    const args = sb.calls[0].args;
    expect(args).not.toHaveProperty('p_min_quality');
    expect(Object.values(args)).not.toContain(0.012);
  });

  it('sends BOTH new-overload discriminators so the call is unambiguous', async () => {
    const { retrieve } = await loadRetrieve();
    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'explain refraction',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    const args = sb.calls[0].args;
    expect(args).toHaveProperty('p_min_similarity');
    expect(args).toHaveProperty('p_quality_score_gate');
  });

  it('defaults the cosine floor to the MEASURED 0.22, never the RPC 0.5 default', async () => {
    const { retrieve, NCERT_MIN_COSINE_SIMILARITY } = await loadRetrieve();
    // Measured on production: a 0.5 floor drops rank-1 10% of the time and
    // rank-10 37.5% of the time; within-chapter chunk-pair cosine median is
    // 0.554. 0.35 is the hard ceiling.
    expect(NCERT_MIN_COSINE_SIMILARITY).toBe(0.22);
    expect(NCERT_MIN_COSINE_SIMILARITY).toBeGreaterThan(0.2);
    expect(NCERT_MIN_COSINE_SIMILARITY).toBeLessThanOrEqual(0.35);

    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(sb.calls[0].args.p_min_similarity).toBe(0.22);
  });

  it('keeps the quality gate DECOUPLED from the similarity floor', async () => {
    const { retrieve, NCERT_QUALITY_SCORE_GATE } = await loadRetrieve();
    expect(NCERT_QUALITY_SCORE_GATE).toBe(0.4);

    const sb = makeStubClient({ rows: [] });
    await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      // Move ONE knob; the other must not follow.
      minCosineSimilarity: 0.3,
      rerank: false,
      caller: 'test',
      supabase: sb,
    });
    expect(sb.calls[0].args.p_min_similarity).toBe(0.3);
    expect(sb.calls[0].args.p_quality_score_gate).toBe(0.4);

    const sb2 = makeStubClient({ rows: [] });
    await retrieve({
      query: 'x',
      grade: '10',
      subject: 'science',
      qualityScoreGate: 0.6,
      rerank: false,
      caller: 'test',
      supabase: sb2,
    });
    expect(sb2.calls[0].args.p_quality_score_gate).toBe(0.6);
    expect(sb2.calls[0].args.p_min_similarity).toBe(0.22);
  });

  it('the Next.js cold-path retriever obeys the same contract (static pin)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    // Walk up from this test file to the monorepo root (the dir holding
    // `packages/`), so the pin is independent of vitest's cwd.
    let dir = path.dirname(fileURLToPath(import.meta.url));
    while (
      !fs.existsSync(path.join(dir, 'packages', 'lib', 'src')) &&
      path.dirname(dir) !== dir
    ) {
      dir = path.dirname(dir);
    }
    const target = path.join(
      dir,
      'packages/lib/src/ai/retrieval/ncert-retriever.ts',
    );
    expect(fs.existsSync(target)).toBe(true);
    const src = fs.readFileSync(target, 'utf-8');
    // Strip comments so the explanatory prose mentioning p_min_quality does
    // not trip the assertion.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/p_min_quality\s*:/);
    expect(code).toMatch(/p_min_similarity\s*:/);
    expect(code).toMatch(/p_quality_score_gate\s*:/);
  });
});
