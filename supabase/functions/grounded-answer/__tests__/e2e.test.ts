// supabase/functions/grounded-answer/__tests__/e2e.test.ts
// End-to-end stubbed test that exercises the full handleRequest HTTP entry
// point for every response path the service produces:
//
//   1. chapter_not_ready   (coverage precheck fails)
//   2. no_chunks_retrieved (strict mode, fewer than 3 chunks)
//   3. low_similarity      (strict mode, confidence below threshold)
//   4. no_supporting_chunks (grounding check returns fail)
//   5. upstream_error      (Claude returns 529 on both Haiku + Sonnet)
//   6. circuit_open        (after tripping the breaker via 3 failures)
//   7. grounded:true       (happy path with citations)
//
// All upstream calls are fetch-stubbed. Supabase client is stubbed via
// __setSupabaseClientForTests. Feature flags + circuits + cache are reset
// at the top of every test.
//
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  handleRequest,
  __resetFeatureFlagCacheForTests,
  __setSupabaseClientForTests,
} from '../index.ts';
import { __clearCacheForTests } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function resetAll() {
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
}

function voyageOk(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function claudeOk(text: string, inputTokens = 50, outputTokens = 100): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function claude529(): Response {
  return new Response('overloaded', { status: 529 });
}

interface StubBuild {
  chapter_ready?: boolean;
  flag_enabled?: boolean;
  chunks?: Array<{
    id: string;
    content: string;
    chapter_number: number;
    chapter_title: string;
    page_number: number | null;
    similarity: number;
  }>;
  trace_id?: string;
}

// deno-lint-ignore no-explicit-any
function sbStub(fx: StubBuild): any {
  return {
    from(table: string) {
      if (table === 'cbse_syllabus') {
        return {
          select(cols: string) {
            if (cols.trim() === 'rag_status') {
              return chainEq(3, () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: fx.chapter_ready ? { rag_status: 'ready' } : null,
                    error: null,
                  }),
              }));
            }
            return chainEq(4, () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }));
          },
        };
      }
      if (table === 'feature_flags') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { is_enabled: fx.flag_enabled !== false },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'grounded_ai_traces') {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: fx.trace_id ?? 'e2e-trace' },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc() {
      return Promise.resolve({
        data: (fx.chunks ?? []).map((c) => ({
          id: c.id,
          content: c.content,
          chapter_number: c.chapter_number,
          chapter_title: c.chapter_title,
          page_number: c.page_number,
          similarity: c.similarity,
          media_url: null,
          media_description: null,
        })),
        error: null,
      });
    },
  };
}

// deno-lint-ignore no-explicit-any
function chainEq(n: number, terminal: () => any): any {
  if (n === 0) return terminal();
  return { eq: () => chainEq(n - 1, terminal) };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    caller: 'foxy',
    student_id: null,
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Light',
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: 512,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: { match_count: 5 },
    retrieve_only: false,
    timeout_ms: 30_000,
    ...overrides,
  };
}

function mkRequest(body: unknown): Request {
  return new Request('http://localhost/grounded-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fiveChunks(sim = 0.9) {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `chunk-${n}`,
    content: `NCERT content about photosynthesis (chunk ${n}).`,
    chapter_number: 1,
    chapter_title: 'Light',
    page_number: n,
    similarity: sim - n * 0.02,
  }));
}

// ── 1. chapter_not_ready ────────────────────────────────────────────────────
Deno.test('e2e: chapter_not_ready', async () => {
  resetAll();
  __setSupabaseClientForTests(sbStub({ chapter_ready: false, flag_enabled: true }));
  const resp = await handleRequest(mkRequest(validBody()));
  assertEquals(resp.status, 200);
  const payload = await resp.json();
  assertEquals(payload.grounded, false);
  assertEquals(payload.abstain_reason, 'chapter_not_ready');
});

// ── 2. no_chunks_retrieved (strict, <3 chunks) ──────────────────────────────
Deno.test('e2e: no_chunks_retrieved (strict mode, 0 chunks)', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: [] }),
  );
  globalThis.fetch = ((_u: string | URL) => Promise.resolve(voyageOk())) as typeof fetch;
  try {
    const resp = await handleRequest(mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'no_chunks_retrieved');
  } finally {
    restoreFetch();
  }
});

// ── 3. low_similarity (strict, confidence below threshold) ──────────────────
Deno.test('e2e: low_similarity abstains in strict mode', async () => {
  resetAll();
  // Low-similarity chunks (well below strict threshold of 0.75 for topSim).
  // But retrieval.ts also enforces minSimilarity — to bypass, override
  // min_similarity_override to allow low-sim chunks through, then rely on
  // confidence calculation to push below 0.75.
  const weakChunks = [1, 2, 3].map((n) => ({
    id: `weak-${n}`,
    content: `Weak chunk ${n}`,
    chapter_number: 1,
    chapter_title: 'Light',
    page_number: n,
    similarity: 0.4,
  }));
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: weakChunks }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic')) {
      return Promise.resolve(
        claudeOk(
          JSON.stringify({ verdict: 'pass', unsupported_sentences: [] }),
        ),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const body = validBody({
      retrieval: { match_count: 10, min_similarity_override: 0.1 },
    });
    // Claude will be called once for answer, once for grounding check.
    // Our simple stub returns the same JSON both times; the "answer" call
    // happens to return valid JSON, which Claude interprets as the
    // answer. Grounding check then passes. Low topSim (0.4) + count
    // coverage (3/10) ⇒ confidence well below 0.75.
    const resp = await handleRequest(mkRequest(body));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'low_similarity');
  } finally {
    restoreFetch();
  }
});

// ── 4. no_supporting_chunks (grounding check fail) ──────────────────────────
Deno.test('e2e: no_supporting_chunks on grounding-check fail', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  let call = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic')) {
      call++;
      if (call === 1) return Promise.resolve(claudeOk('An answer not supported by chunks.'));
      return Promise.resolve(
        claudeOk(
          JSON.stringify({
            verdict: 'fail',
            unsupported_sentences: ['An answer not supported by chunks.'],
          }),
        ),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'no_supporting_chunks');
  } finally {
    restoreFetch();
  }
});

// ── 5. upstream_error (Claude 529 on both attempts) ─────────────────────────
Deno.test('e2e: upstream_error when Claude returns 529 on both models', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic')) return Promise.resolve(claude529());
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'upstream_error');
  } finally {
    restoreFetch();
  }
});

// ── 6. circuit_open ─────────────────────────────────────────────────────────
Deno.test('e2e: circuit_open after 3 consecutive upstream failures', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic')) return Promise.resolve(claude529());
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    // 3 upstream failures in a row trip the breaker.
    for (let i = 0; i < 3; i++) {
      const r = await handleRequest(mkRequest(validBody()));
      const p = await r.json();
      assertEquals(p.abstain_reason, 'upstream_error');
    }
    // 4th request: circuit open → no upstream call, abstain with circuit_open.
    const resp = await handleRequest(mkRequest(validBody()));
    const payload = await resp.json();
    assertEquals(payload.grounded, false);
    assertEquals(payload.abstain_reason, 'circuit_open');
  } finally {
    restoreFetch();
  }
});

// ── 7. grounded:true (happy path) ───────────────────────────────────────────
Deno.test('e2e: grounded:true on happy path with citations', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  let call = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic')) {
      call++;
      if (call === 1) {
        return Promise.resolve(
          claudeOk('Photosynthesis produces food [1]. Chlorophyll absorbs light [2].'),
        );
      }
      return Promise.resolve(
        claudeOk(JSON.stringify({ verdict: 'pass', unsupported_sentences: [] })),
      );
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;

  try {
    const resp = await handleRequest(mkRequest(validBody()));
    assertEquals(resp.status, 200);
    const payload = await resp.json();
    assertEquals(payload.grounded, true);
    assert(Array.isArray(payload.citations));
    assert(payload.citations.length >= 2);
    assert(typeof payload.confidence === 'number');
    assert(payload.trace_id);
  } finally {
    restoreFetch();
  }
});

// ── Retrieve-only happy path (for completeness) ─────────────────────────────
Deno.test('e2e: retrieve_only returns citations without Claude', async () => {
  resetAll();
  __setSupabaseClientForTests(
    sbStub({ chapter_ready: true, flag_enabled: true, chunks: fiveChunks() }),
  );
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai')) return Promise.resolve(voyageOk());
    throw new Error('Claude should NOT be called in retrieve_only mode');
  }) as typeof fetch;

  try {
    const resp = await handleRequest(mkRequest(validBody({ retrieve_only: true })));
    const payload = await resp.json();
    assertEquals(payload.grounded, true);
    assertEquals(payload.answer, '');
    assertEquals(payload.citations.length, 5);
  } finally {
    restoreFetch();
  }
});