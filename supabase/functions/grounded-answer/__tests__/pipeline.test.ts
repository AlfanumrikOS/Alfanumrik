// supabase/functions/grounded-answer/__tests__/pipeline.test.ts
// Integration test for the end-to-end pipeline in index.ts.
// Runs in Deno with upstream fetches stubbed and the Supabase client
// replaced via __setSupabaseClientForTests.
//
// High-value scenarios per spec §6.4:
//   1. chapter_not_ready → abstain + trace written
//   2. strict happy path → grounded:true with citations
//   3. strict grounding-check fail → abstain no_supporting_chunks
//   4. retrieve_only → no Claude, citations from all chunks
//   5. soft mode with few chunks → grounded with confidence < strict bar
//   6. feature flag disabled → abstain upstream_error
//
// The stubbed Supabase supports exactly the queries the pipeline makes:
//   - cbse_syllabus: coverage precheck
//   - feature_flags: ff_grounded_ai_enabled lookup
//   - rpc('match_rag_chunks_ncert'): retrieval
//   - grounded_ai_traces insert: writeTrace

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  runPipeline,
  __setSupabaseClientForTests,
  __resetFeatureFlagCacheForTests,
} from '../index.ts';
import { __clearCacheForTests } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';
import type { GroundedRequest } from '../types.ts';

// ── Upstream fetch stub ──────────────────────────────────────────────────────
const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

interface StubResponses {
  voyage?: () => Response;
  claude?: Array<() => Response>; // Claude may be called twice (answer + grounding-check)
}

function installFetchStub(resp: StubResponses) {
  let claudeIdx = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai.com')) {
      return Promise.resolve(resp.voyage ? resp.voyage() : voyageOk());
    }
    if (u.includes('anthropic.com')) {
      const handler = resp.claude?.[claudeIdx++];
      if (!handler) throw new Error(`no claude stub for call ${claudeIdx - 1}`);
      return Promise.resolve(handler());
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as typeof fetch;
}

function voyageOk(): Response {
  return new Response(
    JSON.stringify({
      data: [{ embedding: new Array(1024).fill(0.01) }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function claudeOk(text: string, inputTokens = 50, outputTokens = 120): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Supabase stub builder ───────────────────────────────────────────────────
interface SbFixtures {
  chapter_ready?: boolean;
  alternatives?: Array<{
    grade: string;
    subject_code: string;
    chapter_number: number;
    chapter_title: string;
  }>;
  flag_enabled?: boolean;
  chunks?: Array<{
    id: string;
    content: string;
    chapter_number: number;
    chapter_title: string;
    page_number: number | null;
    similarity: number;
    media_url?: string | null;
    media_description?: string | null;
  }>;
  trace_insert_id?: string;
}

// deno-lint-ignore no-explicit-any
function buildSbStub(fx: SbFixtures): any {
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
            // alternatives query: four .eq() then .order().limit()
            return chainEq(4, () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({ data: fx.alternatives ?? [], error: null }),
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
                  data: { id: fx.trace_insert_id ?? 'trace-uuid-stub' },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(_name: string) {
      return Promise.resolve({
        data: (fx.chunks ?? []).map((c) => ({
          id: c.id,
          content: c.content,
          chapter_number: c.chapter_number,
          chapter_title: c.chapter_title,
          page_number: c.page_number,
          similarity: c.similarity,
          media_url: c.media_url ?? null,
          media_description: c.media_description ?? null,
        })),
        error: null,
      });
    },
  };
}

// Helper: chain N `.eq()` calls, then return `terminal()`.
// deno-lint-ignore no-explicit-any
function chainEq(n: number, terminal: () => any): any {
  if (n === 0) return terminal();
  return { eq: () => chainEq(n - 1, terminal) };
}

// ── Request factory ─────────────────────────────────────────────────────────
function makeRequest(overrides: Partial<GroundedRequest> = {}): GroundedRequest {
  return {
    caller: 'foxy',
    student_id: null,
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Light Reflection',
    },
    mode: 'strict',
    generation: {
      model_preference: 'haiku',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {},
    },
    retrieval: {
      match_count: 5,
    },
    retrieve_only: false,
    timeout_ms: 30_000,
    ...overrides,
  };
}

function fiveChunks() {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `chunk-${n}`,
    content: `Content of chunk ${n} about photosynthesis.`,
    chapter_number: 1,
    chapter_title: 'Light Reflection',
    page_number: n,
    similarity: 0.9 - n * 0.02,
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test('chapter_not_ready → trace written, abstain returned', async () => {
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: false,
      alternatives: [
        {
          grade: '10',
          subject_code: 'science',
          chapter_number: 2,
          chapter_title: 'Acids',
        },
      ],
      flag_enabled: true,
      trace_insert_id: 'trace-1',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();

  const started = Date.now();
  const resp = await runPipeline(makeRequest(), started, 'anthropic-key', 'voyage-key');

  assertEquals(resp.grounded, false);
  if (!resp.grounded) {
    assertEquals(resp.abstain_reason, 'chapter_not_ready');
    assertEquals(resp.suggested_alternatives.length, 1);
    assertEquals(resp.trace_id, 'trace-1');
  }
});

Deno.test('strict happy path → grounded:true with citations', async () => {
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: true,
      flag_enabled: true,
      chunks: fiveChunks(),
      trace_insert_id: 'trace-ok',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
  installFetchStub({
    voyage: voyageOk,
    claude: [
      () =>
        claudeOk(
          'Photosynthesis is the process where plants make food [1]. Chlorophyll absorbs light [2].',
        ),
      () =>
        claudeOk(
          JSON.stringify({ verdict: 'pass', unsupported_sentences: [] }),
        ),
    ],
  });

  try {
    const resp = await runPipeline(makeRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      assert(resp.answer.includes('Photosynthesis'));
      assert(resp.citations.length >= 2);
      assert(resp.confidence > 0);
      assertEquals(resp.trace_id, 'trace-ok');
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('strict grounding check fail → abstain no_supporting_chunks', async () => {
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: true,
      flag_enabled: true,
      chunks: fiveChunks(),
      trace_insert_id: 'trace-fail',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
  installFetchStub({
    voyage: voyageOk,
    claude: [
      () => claudeOk('Photosynthesis involves complex cellular biology.'),
      () =>
        claudeOk(
          JSON.stringify({
            verdict: 'fail',
            unsupported_sentences: ['Photosynthesis involves complex cellular biology.'],
          }),
        ),
    ],
  });

  try {
    const resp = await runPipeline(makeRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, false);
    if (!resp.grounded) {
      assertEquals(resp.abstain_reason, 'no_supporting_chunks');
      assertEquals(resp.trace_id, 'trace-fail');
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('retrieve_only=true → skips Claude, returns grounded with citations + empty answer', async () => {
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: true,
      flag_enabled: true,
      chunks: fiveChunks(),
      trace_insert_id: 'trace-ro',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();

  // No fetch stub — if Claude is called, fetch will hit the restored
  // original and blow up during a unit-test run; we want that signal.
  const resp = await runPipeline(
    makeRequest({ retrieve_only: true }),
    Date.now(),
    'anthropic-key',
    '', // no voyage key → pipeline continues with null embedding, that's OK
  );
  assertEquals(resp.grounded, true);
  if (resp.grounded) {
    assertEquals(resp.answer, '');
    assertEquals(resp.citations.length, 5);
    assertEquals(resp.meta.claude_model, '');
    assertEquals(resp.meta.tokens_used, 0);
    assertEquals(resp.trace_id, 'trace-ro');
  }
});

Deno.test('soft mode with 2 chunks → grounded, no grounding check, confidence capped', async () => {
  const twoChunks = fiveChunks().slice(0, 2);
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: true,
      flag_enabled: true,
      chunks: twoChunks,
      trace_insert_id: 'trace-soft',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
  installFetchStub({
    voyage: voyageOk,
    claude: [
      () => claudeOk('Photosynthesis makes food [1].'),
      // soft mode does NOT call grounding check; if a second claude call
      // happens, this entry will throw due to missing handler.
    ],
  });

  try {
    const resp = await runPipeline(
      makeRequest({ mode: 'soft' }),
      Date.now(),
      'anthropic-key',
      'voyage-key',
    );
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      // 2 chunks out of target 5 → count coverage is 0.4, so confidence
      // should be well below the strict 0.75 bar.
      assert(resp.confidence < 0.75);
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('feature flag disabled → abstain upstream_error, no upstream calls', async () => {
  __setSupabaseClientForTests(
    buildSbStub({
      chapter_ready: true,
      flag_enabled: false,
      chunks: [],
      trace_insert_id: 'trace-off',
    }),
  );
  __resetFeatureFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();

  const resp = await runPipeline(makeRequest(), Date.now(), 'anthropic-key', 'voyage-key');
  assertEquals(resp.grounded, false);
  if (!resp.grounded) {
    assertEquals(resp.abstain_reason, 'upstream_error');
    assertEquals(resp.trace_id, 'trace-off');
  }
});