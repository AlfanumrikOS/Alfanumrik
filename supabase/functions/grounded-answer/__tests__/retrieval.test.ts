// supabase/functions/grounded-answer/__tests__/retrieval.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies retrieval contract:
//   - happy path: all returned chunks survive scope check
//   - defense in depth: mismatched grade/subject/chapter chunks are dropped and counted
//   - RPC error path: returns empty + 0 drops (never throws)
//   - subject-wide (chapter_number=null): chapter mismatch is NOT a drop
//   - chapter_number is passed as int to the RPC, not as text

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { retrieveChunks } from '../retrieval.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface StubOptions {
  rows?: Row[];
  error?: { message: string } | null;
  captureArgs?: { name?: string; args?: Record<string, unknown> };
}

function stubSupabase(opts: StubOptions) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (opts.captureArgs) {
        opts.captureArgs.name = name;
        opts.captureArgs.args = args;
      }
      return Promise.resolve({
        data: opts.rows ?? [],
        error: opts.error ?? null,
      });
    },
  };
}

function buildRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'chunk-1',
    content: 'Sample content',
    chapter_number: 1,
    chapter_title: 'Light — Reflection and Refraction',
    page_number: 12,
    similarity: 0.82,
    media_url: null,
    media_description: null,
    grade_short: '10',
    subject_code: 'science',
    ...overrides,
  };
}

Deno.test('returns all chunks when RPC returns 5 matching rows', async () => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    buildRow({ id: `chunk-${i + 1}`, similarity: 0.9 - i * 0.01 }),
  );
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'what is refraction',
    embedding: Array(1024).fill(0.1),
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(result.chunks.length, 5);
  assertEquals(result.scopeDrops, 0);
});

Deno.test('drops chunk with wrong grade, counts as scope drop', async () => {
  const rows = [
    buildRow({ id: 'a', grade_short: '10' }),
    buildRow({ id: 'b', grade_short: '10' }),
    buildRow({ id: 'c', grade_short: '9' }), // wrong grade — defense-in-depth drop
    buildRow({ id: 'd', grade_short: '10' }),
    buildRow({ id: 'e', grade_short: '10' }),
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.0,
  });
  assertEquals(result.chunks.length, 4);
  assertEquals(result.scopeDrops, 1);
  assertEquals(result.chunks.find((c) => c.id === 'c'), undefined);
});

Deno.test('drops chunk with wrong subject_code', async () => {
  const rows = [
    buildRow({ id: 'a', subject_code: 'science' }),
    buildRow({ id: 'b', subject_code: 'math' }), // wrong subject
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'test',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.0,
  });
  assertEquals(result.chunks.length, 1);
  assertEquals(result.scopeDrops, 1);
});

Deno.test('drops chunk with wrong chapter_number when chapter is scoped', async () => {
  const rows = [
    buildRow({ id: 'a', chapter_number: 1 }),
    buildRow({ id: 'b', chapter_number: 2 }), // wrong chapter
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'test',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.0,
  });
  assertEquals(result.chunks.length, 1);
  assertEquals(result.scopeDrops, 1);
});

Deno.test('RPC error → returns empty chunks + 0 drops, no throw', async () => {
  const stub = stubSupabase({ error: { message: 'connection failure' } });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(result.chunks.length, 0);
  assertEquals(result.scopeDrops, 0);
});

Deno.test('RPC throws → returns empty chunks + 0 drops, no throw', async () => {
  const stub = {
    rpc() {
      throw new Error('network down');
    },
  };
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(result.chunks.length, 0);
  assertEquals(result.scopeDrops, 0);
});

Deno.test('subject-wide retrieval: chapter mismatch is NOT a drop', async () => {
  const rows = [
    buildRow({ id: 'a', chapter_number: 1 }),
    buildRow({ id: 'b', chapter_number: 2 }),
    buildRow({ id: 'c', chapter_number: 3 }),
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    // subject-wide: chapter_number = null
    scope: { grade: '10', subject_code: 'science', chapter_number: null, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.0,
  });
  assertEquals(result.chunks.length, 3);
  assertEquals(result.scopeDrops, 0);
});

Deno.test('subject-wide retrieval: wrong-grade chunks are still dropped', async () => {
  // Grade/subject enforcement is unconditional — only chapter is conditional
  // on a chapter being specified. This distinction is load-bearing: we must
  // never cross-contaminate grades even when doing subject-wide lookups.
  const rows = [
    buildRow({ id: 'a', grade_short: '10' }),
    buildRow({ id: 'b', grade_short: '11' }), // wrong grade, still dropped
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: null, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.0,
  });
  assertEquals(result.chunks.length, 1);
  assertEquals(result.scopeDrops, 1);
});

Deno.test('chapter_number is forwarded to RPC as an integer, not a string', async () => {
  // The RPC signature is `p_chapter_number INTEGER DEFAULT NULL`. Passing
  // a string would throw inside postgres. Guard against future devs
  // stringifying scope.chapter_number on the way in.
  const capture: { name?: string; args?: Record<string, unknown> } = {};
  const stub = stubSupabase({ rows: [], captureArgs: capture });
  await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 7, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(capture.name, 'match_rag_chunks_ncert');
  assertEquals(capture.args?.p_chapter_number, 7);
  assertEquals(typeof capture.args?.p_chapter_number, 'number');
});

Deno.test('chapter_number null is forwarded as null', async () => {
  const capture: { name?: string; args?: Record<string, unknown> } = {};
  const stub = stubSupabase({ rows: [], captureArgs: capture });
  await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: null, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(capture.args?.p_chapter_number, null);
});

Deno.test('chunks below minSimilarity are filtered but NOT counted as scope drops', async () => {
  const rows = [
    buildRow({ id: 'a', similarity: 0.9 }),
    buildRow({ id: 'b', similarity: 0.3 }), // below floor
    buildRow({ id: 'c', similarity: 0.85 }),
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(result.chunks.length, 2);
  assertEquals(result.scopeDrops, 0); // similarity filtering ≠ scope drop
});

Deno.test('rows missing grade_short/subject_code (current RPC shape) pass scope check', async () => {
  // The production match_rag_chunks_ncert RPC doesn't return grade_short
  // or subject_code in its result. We trust the RPC's internal filters on
  // those fields; if undefined/null on the row, treat as matched.
  const rows = [
    { id: 'a', content: 'x', chapter_number: 1, chapter_title: 't', page_number: 1,
      similarity: 0.8, media_url: null, media_description: null },
    { id: 'b', content: 'y', chapter_number: 1, chapter_title: 't', page_number: 2,
      similarity: 0.75, media_url: null, media_description: null },
  ];
  const stub = stubSupabase({ rows });
  const result = await retrieveChunks(stub, {
    query: 'refraction',
    embedding: null,
    scope: { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: null },
    matchCount: 5,
    minSimilarity: 0.55,
  });
  assertEquals(result.chunks.length, 2);
  assertEquals(result.scopeDrops, 0);
});