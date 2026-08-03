// supabase/functions/grounded-answer/__tests__/model-order-cache-fix.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all __tests__/model-order-cache-fix.test.ts
//
// End-to-end pipeline-level regression test for the percentage-rollout
// cache-order-blindness fix (2026-08-03, assessment finding, REG-335
// follow-up — renumbered from REG-333 during the origin/main merge; see
// .claude/regression/00-header.md's collision note). Proves the ACTUAL
// production bug scenario assessment traced
// is closed: with a WARM L1+L2 cache from a caller bucketed to one model
// order, the SAME caller after a rollout-flag bucket flip (currently
// expecting the OTHER order) must NEVER be served the stale cross-order
// response — it must miss and regenerate, and the fresh regeneration must
// be re-cached under an order-tagged key the FIRST bucket still cannot
// reach.
//
// This file exercises the pipeline end-to-end (unlike gen-ctx.test.ts /
// cache-redis.test.ts / cache-durable-l3.test.ts's unit-level pins on the
// same fix, added alongside this file) — it is the closest thing to a
// reproduction of the bug assessment traced. Requires --allow-net because
// it imports ../index.ts (Deno.serve()) transitively via runPipeline's
// caller; NOT added to CI's DENO_TEST_TARGETS for the same reason
// pipeline.test.ts / cache-durable-l3.test.ts are excluded (see ci.yml).
//
// See gen-ctx.ts's ModelOrder / GenCtx / cachedResponseMatchesModelOrder
// docs, and pipeline.ts's Step 2 for the fix mechanics under test.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  runPipeline,
  __setSupabaseClientForTests,
  __resetFeatureFlagCacheForTests,
} from '../index.ts';
import { __clearCacheForTests } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';
import {
  buildRedisCacheKey,
  buildCacheTuple,
  getFromRedisL2,
  __resetRedisClientForTests,
} from '../cache-redis.ts';
import { __resetL2CacheFlagCacheForTests } from '../_l2-cache-flags.ts';
import { buildGenCtx, genCtxKeyFragment, hashGenCtx, type ModelOrder } from '../gen-ctx.ts';
import { __resetContentVersionCacheForTests } from '../_content-version.ts';
import {
  MODEL_ROLLOUT_FLAG_NAME,
  __resetModelRolloutCacheForTests,
} from '../_model-rollout-flag.ts';
import type { GroundedRequest } from '../types.ts';

const STUDENT_ID = 'student-order-fix-canary';
const STUB_CONTENT_VERSION = 0;

function makeRequest(overrides: Partial<GroundedRequest> = {}): GroundedRequest {
  return {
    caller: 'foxy',
    student_id: STUDENT_ID,
    cache_scope: 'shared',
    query: 'What is photosynthesis?',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Life Processes',
    },
    mode: 'soft',
    generation: {
      model_preference: 'haiku',
      max_tokens: 1024,
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

function fiveChunks() {
  return [1, 2, 3, 4, 5].map((n) => ({
    id: `chunk-${n}`,
    content: `Content of chunk ${n} about photosynthesis.`,
    chapter_number: 1,
    chapter_title: 'Life Processes',
    page_number: n,
    similarity: 0.025 - n * 0.001,
  }));
}

/** Derive the exact L2 key/tuple the pipeline computes for a given resolved order. */
async function deriveIdentities(req: GroundedRequest, modelOrder: ModelOrder) {
  const genCtxHash = await hashGenCtx(buildGenCtx(req, STUB_CONTENT_VERSION, modelOrder));
  const redisKey = await buildRedisCacheKey(
    req.query,
    req.scope,
    req.mode,
    req.caller,
    genCtxKeyFragment(genCtxHash),
  );
  const tuple = buildCacheTuple({
    caller: req.caller,
    mode: req.mode,
    grade: req.scope.grade,
    subject_code: req.scope.subject_code,
    chapter_number: req.scope.chapter_number,
    query: req.query,
    gen_ctx_hash: genCtxHash,
  });
  return { genCtxHash, redisKey, tuple };
}

// deno-lint-ignore no-explicit-any
function buildSbStub(): any {
  return {
    from(table: string) {
      if (table === 'feature_flags') {
        return {
          select: () => ({
            eq: (_col: string, flagName: string) => ({
              single: () => {
                // ff_grounded_ai_enabled ON; L2 real-serving ON for foxy;
                // shadow OFF. (This is the sb.from('feature_flags') path —
                // fully independent of _model-rollout-flag.ts's raw fetch()
                // against SUPABASE_URL, which the fetch stub below handles.)
                const map: Record<string, boolean> = {
                  ff_grounded_ai_enabled: true,
                  ff_foxy_response_cache_l2_v1: true,
                  ff_foxy_response_cache_l2_shadow_v1: false,
                };
                return Promise.resolve({
                  data: { is_enabled: map[flagName] ?? false },
                  error: null,
                });
              },
            }),
          }),
        };
      }
      if (table === 'rag_content_versions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { version: STUB_CONTENT_VERSION }, error: null }),
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
                Promise.resolve({ data: { id: `trace-${crypto.randomUUID()}` }, error: null }),
            }),
          }),
        };
      }
      if (table === 'retrieval_traces') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(_name: string) {
      return Promise.resolve({
        data: fiveChunks().map((c) => ({
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

function voyageOk(): Response {
  return new Response(
    JSON.stringify({ data: [{ embedding: new Array(1024).fill(0.01) }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function claudeOk(text: string): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 50, output_tokens: 120 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

interface RolloutFlagState {
  is_enabled: boolean;
  rollout_percentage: number;
}

const originalFetch = globalThis.fetch;

/**
 * Routes: (1) _model-rollout-flag.ts's raw fetch against
 * SUPABASE_URL/rest/v1/feature_flags?...flag_name=eq.<MODEL_ROLLOUT_FLAG_NAME>
 * (mutable `rolloutState`, so a test can flip it mid-run); (2) the fake
 * Upstash L2 backend; (3) Voyage embeddings; (4) Claude/OpenAI generation
 * (no openaiApiKey is ever passed to runPipeline in this file, mirroring
 * pipeline.test.ts / cache-durable-l3.test.ts, so only the Anthropic leg is
 * ever actually reached regardless of which order resolveModelOrder picks —
 * the point under test is the STAMPED model_order tag, not which provider
 * physically answered).
 */
function installFetch(args: {
  rolloutState: RolloutFlagState;
  upstashHost: string;
  upstashStore: Map<string, string>;
  claudeCalls: string[];
}) {
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);

    if (u.includes('/rest/v1/feature_flags') && u.includes(MODEL_ROLLOUT_FLAG_NAME)) {
      return Promise.resolve(
        new Response(JSON.stringify([args.rolloutState]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (u.startsWith(args.upstashHost)) {
      const body = JSON.parse(String(init?.body ?? '[]')) as unknown[][];
      const results = body.map((cmd) => {
        const [op, ...cmdArgs] = cmd as [string, ...unknown[]];
        if (op === 'set') {
          const [key, val] = cmdArgs as [string, string];
          args.upstashStore.set(key, val);
          return { result: 'OK' };
        }
        if (op === 'get') {
          const [key] = cmdArgs as [string];
          return { result: args.upstashStore.has(key) ? args.upstashStore.get(key)! : null };
        }
        return { result: null };
      });
      return Promise.resolve(
        new Response(JSON.stringify(results), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (u.includes('voyageai.com')) {
      return Promise.resolve(voyageOk());
    }
    if (u.includes('anthropic.com') || u.includes('openai.com')) {
      args.claudeCalls.push(u.includes('openai.com') ? 'openai' : 'anthropic');
      return Promise.resolve(claudeOk(`Fresh photosynthesis answer number ${args.claudeCalls.length} [1].`));
    }
    throw new Error(`unexpected fetch to ${u} in model-order-cache-fix test`);
  }) as typeof fetch;
}

function resetAll() {
  globalThis.fetch = originalFetch;
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_URL');
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_TOKEN');
  __resetModelRolloutCacheForTests();
  __resetRedisClientForTests();
  __resetFeatureFlagCacheForTests();
  __resetL2CacheFlagCacheForTests();
  __resetContentVersionCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
}

Deno.test('percentage-rollout bucket flip on a WARM cache: guaranteed miss + fresh regeneration, never a silently-served cross-order response', async () => {
  resetAll();
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  const upstashHost = 'http://fake-upstash-model-order-e2e-test.example';
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_URL', upstashHost);
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();

  __setSupabaseClientForTests(buildSbStub());

  const rolloutState: RolloutFlagState = { is_enabled: false, rollout_percentage: 0 };
  const upstashStore = new Map<string, string>();
  const claudeCalls: string[] = [];
  installFetch({ rolloutState, upstashHost, upstashStore, claudeCalls });

  try {
    const req = makeRequest();

    // ── Call 1: rollout flag OFF → shouldUseClaudePrimary resolves false →
    // 'openai_primary' (today's shipped default). Seeds L1 + L2 under an
    // openai_primary-tagged key. ──
    const resp1 = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp1.grounded, true);
    assertEquals(claudeCalls.length, 1, 'call 1 must hit Claude exactly once (cold cache)');
    if (resp1.grounded) {
      assertEquals(resp1.meta.model_order, 'openai_primary');
    }

    const openaiIdentities = await deriveIdentities(req, 'openai_primary');
    const openaiL2Entry = await getFromRedisL2(
      openaiIdentities.redisKey,
      openaiIdentities.tuple,
      'openai_primary',
    );
    assert(openaiL2Entry !== null, 'call 1 must have written an L2 entry tagged openai_primary');

    // ── Flip the caller's bucket: is_enabled=true, rollout_percentage=100 →
    // EVERY caller with an id resolves 'claude_primary' (deterministic at
    // the 100% boundary regardless of hash value). Reset ONLY the rollout
    // flag's own in-process cache (5-min TTL) so the flip takes effect
    // immediately, exactly as a real ramp would after that TTL elapses.
    // Deliberately do NOT clear the L1/L2 response caches — the whole point
    // is that a WARM cache from call 1 must not leak into call 2. ──
    rolloutState.is_enabled = true;
    rolloutState.rollout_percentage = 100;
    __resetModelRolloutCacheForTests();

    // ── Call 2: SAME request object (identical query/scope/mode/caller),
    // now resolves 'claude_primary'. Must MISS the warm openai_primary
    // cache entry and regenerate — never silently serve call 1's answer.
    // This is the exact bug assessment traced: pre-fix, gen_ctx carried no
    // per-caller model_order signal, so this call would have been served
    // call 1's openai_primary-generated response from the warm L1/L2 cache. ──
    const resp2 = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp2.grounded, true);
    assertEquals(
      claudeCalls.length,
      2,
      'call 2 must hit Claude AGAIN — a cache hit here would mean the cross-order bug is still present',
    );
    if (resp1.grounded && resp2.grounded) {
      assertEquals(resp2.meta.model_order, 'claude_primary');
      assert(
        resp2.trace_id !== resp1.trace_id,
        'call 2 must be a genuinely fresh generation (new trace_id), not the cached call-1 response',
      );
    }

    // The fresh call-2 response must now be cached under a DIFFERENT key
    // (claude_primary-tagged) — the openai_primary and claude_primary keys
    // for the IDENTICAL request must never collide.
    const claudeIdentities = await deriveIdentities(req, 'claude_primary');
    assert(
      openaiIdentities.redisKey !== claudeIdentities.redisKey,
      'openai_primary and claude_primary must produce DIFFERENT L2 keys for the identical request',
    );
    const claudeL2Entry = await getFromRedisL2(
      claudeIdentities.redisKey,
      claudeIdentities.tuple,
      'claude_primary',
    );
    assert(claudeL2Entry !== null, 'call 2 must have written a NEW L2 entry tagged claude_primary');
    if (claudeL2Entry?.grounded && resp2.grounded) {
      assertEquals(claudeL2Entry.trace_id, resp2.trace_id);
    }

    // The ORIGINAL openai_primary entry must still be exactly what call 1
    // wrote — untouched by call 2's write-back.
    const openaiL2EntryAfter = await getFromRedisL2(
      openaiIdentities.redisKey,
      openaiIdentities.tuple,
      'openai_primary',
    );
    assert(openaiL2EntryAfter !== null);
    if (openaiL2EntryAfter?.grounded && resp1.grounded) {
      assertEquals(openaiL2EntryAfter.trace_id, resp1.trace_id, "call 1's entry must be unaffected by call 2");
    }
  } finally {
    resetAll();
  }
});

Deno.test('percentage-rollout, NO bucket flip: repeat calls under the SAME resolved order still hit the cache normally (fix does not degrade ordinary caching)', async () => {
  resetAll();
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  const upstashHost = 'http://fake-upstash-model-order-e2e-noflip-test.example';
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_URL', upstashHost);
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();

  __setSupabaseClientForTests(buildSbStub());

  const rolloutState: RolloutFlagState = { is_enabled: false, rollout_percentage: 0 };
  const upstashStore = new Map<string, string>();
  const claudeCalls: string[] = [];
  installFetch({ rolloutState, upstashHost, upstashStore, claudeCalls });

  try {
    const req = makeRequest();
    const resp1 = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp1.grounded, true);
    assertEquals(claudeCalls.length, 1);

    // No flag change, no cache reset — a second identical request under the
    // SAME resolved order should hit L1 (in-process, same test run) without
    // any additional Claude call.
    const resp2 = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp2.grounded, true);
    assertEquals(claudeCalls.length, 1, 'a same-order repeat request must still be served from cache (L1 hit)');
    if (resp1.grounded && resp2.grounded) {
      assertEquals(resp2.trace_id, resp1.trace_id, 'must be the exact cached call-1 response');
    }
  } finally {
    resetAll();
  }
});
