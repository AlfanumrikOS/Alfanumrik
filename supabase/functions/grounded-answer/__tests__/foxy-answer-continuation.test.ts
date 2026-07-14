// supabase/functions/grounded-answer/__tests__/foxy-answer-continuation.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Phase 0.2: bounded max_tokens continuation for truncated Foxy structured
// answers. Locks the acceptance criteria for ff_foxy_answer_continuation_v1:
//
//   1. Flag ON + stop_reason='max_tokens' → EXACTLY ONE continuation call,
//      merged payload validates → the recovered tail (lost to rescue today)
//      is present in `structured`.
//   2. Flag OFF + stop_reason='max_tokens' → NO continuation call; byte-
//      identical to today (rescueFromTruncatedJson salvages only the complete
//      blocks before the cut).
//   3. Flag ON + continuation ALSO truncates → never regress the safety net:
//      `structured` is always defined, no raw JSON leaks, and the loop is
//      bounded to a SINGLE continuation round (2 Claude calls total).
//   4. Flag ON + complete answer (stop_reason='end_turn') → NO continuation
//      (the flag read is short-circuited on the happy path).

import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  runPipeline,
  __setSupabaseClientForTests,
  __resetFeatureFlagCacheForTests,
} from '../index.ts';
import { __clearCacheForTests } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';
import { __resetL2CacheFlagCacheForTests } from '../_l2-cache-flags.ts';
import { __resetTwinFlagCacheForTests } from '../_twin-flag.ts';
import { __resetContinuationFlagCacheForTests } from '../_continuation-flag.ts';
import type { FoxyResponse } from '../structured-schema.ts';
import type { GroundedRequest, GroundedResponse } from '../types.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// A structured turn cut off by max_tokens mid-way through the second block's
// text string. rescueFromTruncatedJson can only salvage the FIRST (paragraph)
// block; the step + answer blocks are lost without a continuation.
const PRIMARY_TRUNCATED =
  '{"title":"Photosynthesis","subject":"science","blocks":[' +
  '{"type":"paragraph","text":"Photosynthesis converts light energy into chemical energy stored in glucose."},' +
  '{"type":"step","label":"Step 1","text":"Chlorophyll in the leaves absorbs sunlig';

// The exact remaining JSON suffix. PRIMARY_TRUNCATED + CONTINUATION_TAIL is one
// complete, valid FoxyResponse with 3 blocks (including the answer block).
const CONTINUATION_TAIL =
  'ht."},' +
  '{"type":"answer","text":"The products are glucose and oxygen."}]}';

// A continuation that ITSELF truncates: it completes the step block but is cut
// mid-way through the answer block. Merged is still invalid JSON; rescue on the
// merged text recovers 2 blocks (paragraph + step) — never worse than the
// primary-only rescue (1 block).
const CONTINUATION_PARTIAL =
  'ht."},' +
  '{"type":"answer","text":"The products are gluc';

// A complete, non-truncated structured answer (stop_reason='end_turn').
const COMPLETE_ANSWER =
  '{"title":"Photosynthesis","subject":"science","blocks":[' +
  '{"type":"paragraph","text":"Photosynthesis converts light energy into chemical energy."},' +
  '{"type":"answer","text":"The products are glucose and oxygen."}]}';

// ── Upstream fetch stub ──────────────────────────────────────────────────────
const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function voyageOk(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function anthropicResponse(text: string, stopReason: string): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      model: 'claude-test',
      stop_reason: stopReason,
      usage: { input_tokens: 50, output_tokens: 200 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// Installs a fetch stub. `claude` is a sequence of {text, stopReason}; the Nth
// Claude/OpenAI fetch consumes the Nth entry. A `claudeCalls` counter records
// how many Claude fetches actually happened so we can assert the continuation
// fired (or did not).
function installFetchStub(claude: Array<{ text: string; stopReason: string }>): { claudeCalls: () => number } {
  let idx = 0;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes('voyageai.com')) return Promise.resolve(voyageOk());
    if (u.includes('anthropic.com') || u.includes('openai.com')) {
      const entry = claude[idx++];
      if (!entry) throw new Error(`no claude stub for call ${idx - 1}`);
      return Promise.resolve(anthropicResponse(entry.text, entry.stopReason));
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as typeof fetch;
  return { claudeCalls: () => idx };
}

// ── Supabase stub ────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function buildSbStub(flagMap: Record<string, boolean>): any {
  return {
    from(table: string) {
      if (table === 'feature_flags') {
        return {
          select: () => ({
            eq: (_col: string, flagName: string) => ({
              single: () =>
                Promise.resolve({
                  // Unlisted flags default ON (matches the real ff_grounded_ai
                  // kill switch being enabled in prod). The continuation +
                  // twin + MOL flags are set explicitly per-test.
                  data: { is_enabled: flagName in flagMap ? flagMap[flagName] : true },
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
              single: () => Promise.resolve({ data: { id: 'trace-continuation' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'retrieval_traces') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(_name: string) {
      return Promise.resolve({
        data: [1, 2, 3, 4, 5].map((n) => ({
          id: `chunk-${n}`,
          content: `Content of chunk ${n} about photosynthesis.`,
          chapter_number: 1,
          chapter_title: 'Life Processes',
          page_number: n,
          similarity: 0.025 - n * 0.001,
          media_url: null,
          media_description: null,
        })),
        error: null,
      });
    },
  };
}

function resetAllCaches() {
  __resetFeatureFlagCacheForTests();
  __resetL2CacheFlagCacheForTests();
  __resetTwinFlagCacheForTests();
  __resetContinuationFlagCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
}

// Soft mode: skips the strict grounding-check second Claude call, so the ONLY
// second Claude call that can occur is the continuation itself.
function foxyRequest(overrides: Partial<GroundedRequest> = {}): GroundedRequest {
  return {
    caller: 'foxy',
    student_id: null,
    query: 'Explain photosynthesis step by step.',
    scope: { board: 'CBSE', grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: 'Life Processes' },
    mode: 'soft',
    generation: {
      model_preference: 'haiku',
      max_tokens: 256,
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

// MOL shadow/telemetry + digital-twin OFF keeps the Claude-call sequence
// deterministic (no fire-and-forget shadow, no transfer-retrieval widening).
const BASE_FLAGS = {
  ff_digital_twin_v1: false,
  ff_grounded_answer_mol_shadow_v1: false,
  ff_grounded_answer_mol_telemetry_v1: false,
  ff_mol_shadow_text_capture_v1: false,
};

function blocksOf(resp: GroundedResponse): FoxyResponse['blocks'] {
  assert(resp.grounded, 'response must be grounded');
  if (!resp.grounded) throw new Error('unreachable');
  assert(resp.structured, 'structured must always be defined for Foxy (P12)');
  return resp.structured.blocks;
}

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test('flag ON + max_tokens → ONE continuation, merged validates, tail recovered', async () => {
  __setSupabaseClientForTests(buildSbStub({ ...BASE_FLAGS, ff_foxy_answer_continuation_v1: true }));
  resetAllCaches();
  const stub = installFetchStub([
    { text: PRIMARY_TRUNCATED, stopReason: 'max_tokens' },
    { text: CONTINUATION_TAIL, stopReason: 'end_turn' },
  ]);
  try {
    const resp = await runPipeline(foxyRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    // Exactly ONE continuation call fired (2 Claude fetches total).
    assertEquals(stub.claudeCalls(), 2);
    const blocks = blocksOf(resp);
    // Merged JSON validated → all 3 blocks present, including the answer block
    // that rescue-on-primary alone would have dropped.
    assertEquals(blocks.length, 3);
    const answer = blocks.find((b) => b.type === 'answer');
    assert(answer, 'answer block should be recovered from the continuation');
    assert(answer!.text!.includes('glucose and oxygen'));
  } finally {
    restoreFetch();
  }
});

Deno.test('flag OFF + max_tokens → NO continuation, byte-identical rescue (1 block)', async () => {
  __setSupabaseClientForTests(buildSbStub({ ...BASE_FLAGS, ff_foxy_answer_continuation_v1: false }));
  resetAllCaches();
  const stub = installFetchStub([
    { text: PRIMARY_TRUNCATED, stopReason: 'max_tokens' },
    // No second entry — if the pipeline tries a continuation with the flag OFF
    // this throws, failing the test loudly.
  ]);
  try {
    const resp = await runPipeline(foxyRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    // No continuation: exactly ONE Claude fetch.
    assertEquals(stub.claudeCalls(), 1);
    const blocks = blocksOf(resp);
    // Today's behavior: rescue salvages only the first complete (paragraph)
    // block; the truncated step + the answer never appear.
    assertEquals(blocks.length, 1);
    assertEquals(blocks[0].type, 'paragraph');
    assertFalse(blocks.some((b) => b.type === 'answer'));
  } finally {
    restoreFetch();
  }
});

Deno.test('flag ON + continuation ALSO truncates → never regress, bounded to ONE round', async () => {
  __setSupabaseClientForTests(buildSbStub({ ...BASE_FLAGS, ff_foxy_answer_continuation_v1: true }));
  resetAllCaches();
  const stub = installFetchStub([
    { text: PRIMARY_TRUNCATED, stopReason: 'max_tokens' },
    { text: CONTINUATION_PARTIAL, stopReason: 'max_tokens' },
    // A THIRD entry would only be consumed if the pipeline looped — it must
    // NOT. Leaving it out means an unbounded loop throws and fails the test.
  ]);
  try {
    const resp = await runPipeline(foxyRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    // Bounded to a SINGLE continuation round: 2 Claude fetches, never 3.
    assertEquals(stub.claudeCalls(), 2);
    const blocks = blocksOf(resp);
    // Never regress: at least the primary rescue's blocks survive, and NO raw
    // JSON leaks into any paragraph (the May-2026 regression guard).
    assert(blocks.length >= 1, `expected >= 1 salvaged block, got ${blocks.length}`);
    for (const b of blocks) {
      if (b.type === 'paragraph' && b.text) {
        assertFalse(b.text.trim().startsWith('{'), 'paragraph must not leak raw JSON');
        assertFalse(b.text.includes('"blocks"'), 'paragraph must not leak JSON keys');
      }
    }
  } finally {
    restoreFetch();
  }
});

Deno.test('flag ON + complete answer (end_turn) → NO continuation', async () => {
  __setSupabaseClientForTests(buildSbStub({ ...BASE_FLAGS, ff_foxy_answer_continuation_v1: true }));
  resetAllCaches();
  const stub = installFetchStub([
    { text: COMPLETE_ANSWER, stopReason: 'end_turn' },
    // No second entry: a complete answer must never trigger a continuation.
  ]);
  try {
    const resp = await runPipeline(foxyRequest(), Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    assertEquals(stub.claudeCalls(), 1);
    const blocks = blocksOf(resp);
    assertEquals(blocks.length, 2);
    assert(blocks.some((b) => b.type === 'answer'));
  } finally {
    restoreFetch();
  }
});
