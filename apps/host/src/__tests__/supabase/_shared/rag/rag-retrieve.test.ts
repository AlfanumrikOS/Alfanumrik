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
      p_min_quality: 0.55,
    });
    // chapter_number must be number, never string
    expect(typeof sb.calls[0].args.p_chapter_number).toBe('number');
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
