// supabase/functions/grounded-answer/__tests__/cache-durable-l3.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Dedicated pipeline-level pins for the durable L3 solution store
// (cache-durable.ts + ncert_solver_solutions, response-cache v2 design
// item 6). Proves, against the REAL runPipeline with a stubbed Supabase
// client + fake Upstash REST backend:
//
//   (a) REG-50 position: L3 is checked only AFTER an L2 miss and strictly
//       BEFORE retrieval — an L3 hit performs ZERO retrieveChunks (rpc)
//       calls and writes ZERO new grounded_ai_traces / retrieval_traces
//       rows; the stored trace_id is returned verbatim.
//   (b) An L3 hit backfills BOTH L2 (Upstash) and L1 (in-memory).
//   (c) Content-version invalidation: a solution stored under
//       content_version N is a MISS once the current version is N+1 —
//       the gen_ctx hash (which folds in the version) rotates the lookup
//       key, so stale-content answers can never be served (P12).
//   (d) ff_ncert_solver_solution_store_v1 OFF → the L3 table is fully
//       inert: never read, never written, even for cache_scope:'shared'
//       ncert-solver requests.
//   (d2) Serve-flag conjunct (quality gate finding 1): the L3 READ/SERVE
//        path requires the caller's serving flag TOO
//        (ff_response_cache_serve_ncert_v1 for ncert-solver). Serve OFF +
//        store ON → L3 is NEVER read/served (fresh generation runs) BUT
//        the write-back still lands — the warm-the-store-before-serving
//        ramp the architect's contract mandates.
//   (e) P13: the persisted L3 row carries NO student identifiers — even
//       when a (misbehaving) caller passes a non-null student_id, the
//       upserted payload is scope + question identity + version +
//       model/tokens_used/created_at + response only (the exact
//       DO-UPDATE column set from migration 20260716090100's COMMENT).
//
// Plus unit-level defense-in-depth pins on getDurableSolution /
// putDurableSolution (tuple mismatch → miss; abstain never written).

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  runPipeline,
  __setSupabaseClientForTests,
  __resetFeatureFlagCacheForTests,
} from '../index.ts';
import { __clearCacheForTests, buildCacheKey, getFromCache } from '../cache.ts';
import { __resetAllForTests as __resetCircuitsForTests } from '../circuit.ts';
import {
  buildRedisCacheKey,
  buildCacheTuple,
  getFromRedisL2,
  hashNormalizedQuery,
  __resetRedisClientForTests,
  type CacheTuple,
} from '../cache-redis.ts';
import { __resetL2CacheFlagCacheForTests } from '../_l2-cache-flags.ts';
import { buildGenCtx, genCtxKeyFragment, hashGenCtx } from '../gen-ctx.ts';
import { __resetContentVersionCacheForTests } from '../_content-version.ts';
import { getDurableSolution, putDurableSolution } from '../cache-durable.ts';
import type { GroundedRequest, GroundedResponse } from '../types.ts';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function makeSolverRequest(overrides: Partial<GroundedRequest> = {}): GroundedRequest {
  return {
    caller: 'ncert-solver',
    student_id: null,
    cache_scope: 'shared',
    query: 'Solve exercise 1.2 question 3 on rational numbers',
    scope: {
      board: 'CBSE',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      chapter_title: 'Light Reflection',
    },
    // soft mode keeps the stub surface minimal (no cbse_syllabus coverage
    // precheck, single Claude call, no grounding check). The L3 tier gates
    // on CALLER + flag, not on mode, so the mechanics under test are
    // identical to the production strict-mode solver path.
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
    content: `Content of chunk ${n} about rational numbers.`,
    chapter_number: 1,
    chapter_title: 'Light Reflection',
    page_number: n,
    similarity: 0.025 - n * 0.001,
  }));
}

function groundedResponse(answer: string, traceId: string) {
  return {
    grounded: true as const,
    answer,
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: traceId,
    meta: { claude_model: 'haiku', tokens_used: 42, latency_ms: 10 },
  };
}

/** Derive the exact key/tuple identities the pipeline computes. */
async function deriveIdentities(req: GroundedRequest, contentVersion: number) {
  const genCtxHash = await hashGenCtx(buildGenCtx(req, contentVersion));
  const questionHash = await hashNormalizedQuery(req.query);
  const redisKey = await buildRedisCacheKey(
    req.query,
    req.scope,
    req.mode,
    req.caller,
    genCtxKeyFragment(genCtxHash),
  );
  const l1Key = await buildCacheKey(req.query, req.scope, req.mode, req.caller, genCtxHash);
  const tuple = buildCacheTuple({
    caller: req.caller,
    mode: req.mode,
    grade: req.scope.grade,
    subject_code: req.scope.subject_code,
    chapter_number: req.scope.chapter_number,
    query: req.query,
    gen_ctx_hash: genCtxHash,
  });
  return { genCtxHash, questionHash, redisKey, l1Key, tuple };
}

interface L3StubOpts {
  flagMap: Record<string, boolean>;
  contentVersion: number;
  /** key = `${grade}|${subject_code}|${question_hash}|${gen_ctx_hash}` */
  l3Store: Map<string, { tuple: CacheTuple; response: GroundedResponse }>;
  events: string[];
  upserts: Array<Record<string, unknown>>;
  // deno-lint-ignore no-explicit-any
  chunks?: any[];
  traceId?: string;
}

// deno-lint-ignore no-explicit-any
function buildL3Sb(o: L3StubOpts): any {
  return {
    from(table: string) {
      if (table === 'feature_flags') {
        return {
          select: () => ({
            eq: (_col: string, flagName: string) => ({
              single: () => {
                o.events.push(`flag:${flagName}`);
                return Promise.resolve({
                  data: { is_enabled: o.flagMap[flagName] === true },
                  error: null,
                });
              },
            }),
          }),
        };
      }
      if (table === 'rag_content_versions') {
        o.events.push('content_version:read');
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { version: o.contentVersion }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'ncert_solver_solutions') {
        return {
          select: () => {
            const filters: string[] = [];
            // deno-lint-ignore no-explicit-any
            const chain: any = {
              eq: (_col: string, val: unknown) => {
                filters.push(String(val));
                return chain;
              },
              maybeSingle: () => {
                o.events.push('l3:select');
                const payload = o.l3Store.get(filters.join('|')) ?? null;
                return Promise.resolve({
                  data: payload ? { response: payload } : null,
                  error: null,
                });
              },
            };
            return chain;
          },
          upsert: (row: Record<string, unknown>, _opts: unknown) => {
            o.events.push('l3:upsert');
            o.upserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'grounded_ai_traces') {
        o.events.push('trace:insert');
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: o.traceId ?? 'trace-l3-stub' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'retrieval_traces') {
        o.events.push('retrieval_trace:insert');
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string) {
      o.events.push(`rpc:${name}`);
      return Promise.resolve({
        // deno-lint-ignore no-explicit-any
        data: (o.chunks ?? []).map((c: any) => ({
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

/**
 * Fetch stub: fake Upstash pipeline backend (logs l2:get / l2:set into the
 * shared event list) + optional voyage/claude handlers. Any other URL throws
 * — an unexpected upstream call is itself the failure signal.
 */
function installFetch(opts: {
  events: string[];
  upstashHost?: string;
  upstashStore?: Map<string, string>;
  allowGeneration?: boolean;
  claudeText?: string;
}) {
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (opts.upstashHost && u.startsWith(opts.upstashHost)) {
      const body = JSON.parse(String(init?.body ?? '[]')) as unknown[][];
      const results = body.map((cmd) => {
        const [op, ...args] = cmd as [string, ...unknown[]];
        if (op === 'set') {
          opts.events.push('l2:set');
          const [key, val] = args as [string, string];
          opts.upstashStore?.set(key, val);
          return { result: 'OK' };
        }
        if (op === 'get') {
          opts.events.push('l2:get');
          const [key] = args as [string];
          return { result: opts.upstashStore?.has(key) ? opts.upstashStore.get(key)! : null };
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
    if (opts.allowGeneration && u.includes('voyageai.com')) {
      return Promise.resolve(voyageOk());
    }
    if (opts.allowGeneration && (u.includes('anthropic.com') || u.includes('openai.com'))) {
      opts.events.push('claude:call');
      return Promise.resolve(claudeOk(opts.claudeText ?? 'Fresh generated answer [1].'));
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as typeof fetch;
}

function resetAll() {
  globalThis.fetch = originalFetch;
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_URL');
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_TOKEN');
  __resetRedisClientForTests();
  __resetFeatureFlagCacheForTests();
  __resetL2CacheFlagCacheForTests();
  __resetContentVersionCacheForTests();
  __clearCacheForTests();
  __resetCircuitsForTests();
}

const FLAGS_L3_ON = {
  ff_grounded_ai_enabled: true,
  ff_response_cache_serve_ncert_v1: true, // ncert per-caller L2 serving ON → L2 read runs first
  ff_ncert_solver_solution_store_v1: true, // L3 ON
  ff_foxy_response_cache_l2_v1: false,
  ff_foxy_response_cache_l2_shadow_v1: false,
};

// ── (a) + (b): L3 hit — REG-50 position, ordering, backfills ────────────────

Deno.test('L3 hit: checked only after L2 miss, zero retrieval + zero trace rows, backfills L2 and L1', async () => {
  resetAll();
  const fakeUpstashHost = 'http://fake-upstash-l3-hit-test.example';
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_URL', fakeUpstashHost);
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();

  const CONTENT_VERSION = 3;
  const req = makeSolverRequest();
  const { genCtxHash, questionHash, redisKey, l1Key, tuple } = await deriveIdentities(
    req,
    CONTENT_VERSION,
  );

  const seeded = groundedResponse(
    'Seeded durable L3 solution.',
    'seeded-l3-trace-must-be-returned',
  );
  const l3Store = new Map([
    [`10|science|${questionHash}|${genCtxHash}`, { tuple, response: seeded }],
  ]);

  const events: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  const upstashStore = new Map<string, string>();
  __setSupabaseClientForTests(
    buildL3Sb({ flagMap: FLAGS_L3_ON, contentVersion: CONTENT_VERSION, l3Store, events, upserts }),
  );
  installFetch({ events, upstashHost: fakeUpstashHost, upstashStore });

  try {
    const resp = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      assertEquals(resp.answer, seeded.answer);
      assertEquals(resp.trace_id, seeded.trace_id, 'the STORED trace_id is the source of truth');
    }

    // (a) REG-50 position: L2 read happened BEFORE the L3 select…
    const l2GetIdx = events.indexOf('l2:get');
    const l3SelectIdx = events.indexOf('l3:select');
    assert(l2GetIdx !== -1, 'L2 must be consulted first (serving flag ON)');
    assert(l3SelectIdx !== -1, 'L3 must be consulted after the L2 miss');
    assert(l2GetIdx < l3SelectIdx, 'L3 may only be read AFTER an L2 miss');
    // …and NO retrieval, NO new trace rows, NO generation happened.
    assertEquals(events.filter((e) => e.startsWith('rpc:')).length, 0, 'zero retrieveChunks calls on an L3 hit');
    assertEquals(events.filter((e) => e === 'trace:insert').length, 0, 'zero new grounded_ai_traces rows on an L3 hit');
    assertEquals(events.filter((e) => e === 'retrieval_trace:insert').length, 0, 'zero retrieval_traces rows on an L3 hit');
    assertEquals(events.filter((e) => e === 'claude:call').length, 0, 'zero model calls on an L3 hit');

    // (b) Backfills: L1…
    assert(getFromCache(l1Key) !== null, 'an L3 hit must backfill L1');
    // …and L2 (serving flag is ON so the backfill gate is open).
    const l2Entry = await getFromRedisL2(redisKey, tuple);
    assert(l2Entry !== null, 'an L3 hit must backfill L2');
    if (l2Entry) assertEquals(l2Entry.grounded, true);
  } finally {
    resetAll();
  }
});

// ── (c): content-version invalidation ────────────────────────────────────────

Deno.test('L3 content-version invalidation: a solution stored under version N is a MISS at version N+1 (fresh generation + re-store under the new gen_ctx)', async () => {
  resetAll();

  const req = makeSolverRequest();
  // Row was stored while the (grade, subject) content_version was 0…
  const stale = await deriveIdentities(req, 0);
  const seeded = groundedResponse('STALE answer built on old chunks.', 'stale-trace');
  const l3Store = new Map([
    [`10|science|${stale.questionHash}|${stale.genCtxHash}`, { tuple: stale.tuple, response: seeded }],
  ]);

  // …but the current version is 1 (an ingestion writer bumped it).
  const CURRENT_VERSION = 1;
  const current = await deriveIdentities(req, CURRENT_VERSION);
  assert(stale.genCtxHash !== current.genCtxHash, 'a version bump must rotate the gen_ctx hash');

  const events: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  __setSupabaseClientForTests(
    buildL3Sb({
      // Serve flag stays ON — the L3 READ path requires it (conjunct gate).
      // No Upstash env is configured in this test, so the L2 lookup is an
      // instant client-less miss and the L3 mechanics stay isolated.
      flagMap: FLAGS_L3_ON,
      contentVersion: CURRENT_VERSION,
      l3Store,
      events,
      upserts,
      chunks: fiveChunks(),
      traceId: 'trace-fresh-generation',
    }),
  );
  installFetch({ events, allowGeneration: true, claudeText: 'Fresh answer for re-ingested content [1].' });

  try {
    const resp = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      assert(
        resp.answer.includes('Fresh answer'),
        'the stale stored solution must NOT be served after a content-version bump',
      );
      assert(resp.trace_id !== 'stale-trace');
    }
    // The lookup DID run (L3 was consulted) but under the NEW gen_ctx hash → miss.
    assert(events.includes('l3:select'), 'L3 must still be consulted');
    assert(events.some((e) => e.startsWith('rpc:')), 'full retrieval must run on the version-mismatch miss');
    // Write-back re-stores under the CURRENT version + new gen_ctx hash.
    assertEquals(upserts.length, 1, 'the fresh solution must be re-stored');
    assertEquals(upserts[0].content_version, CURRENT_VERSION);
    assertEquals(upserts[0].gen_ctx_hash, current.genCtxHash);
    assertEquals(upserts[0].question_hash, current.questionHash);
  } finally {
    resetAll();
  }
});

// ── (d): flag OFF → L3 fully inert ───────────────────────────────────────────

Deno.test('ff_ncert_solver_solution_store_v1 OFF → ncert_solver_solutions is never read and never written', async () => {
  resetAll();

  const req = makeSolverRequest();
  const identities = await deriveIdentities(req, 0);
  const seeded = groundedResponse('Would-be L3 hit that must stay unread.', 'unread-trace');
  const l3Store = new Map([
    [`10|science|${identities.questionHash}|${identities.genCtxHash}`, { tuple: identities.tuple, response: seeded }],
  ]);

  const events: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  __setSupabaseClientForTests(
    buildL3Sb({
      flagMap: {
        ff_grounded_ai_enabled: true,
        ff_response_cache_serve_ncert_v1: false,
        ff_ncert_solver_solution_store_v1: false, // ← the gate under test
        ff_foxy_response_cache_l2_v1: false,
        ff_foxy_response_cache_l2_shadow_v1: false,
      },
      contentVersion: 0,
      l3Store,
      events,
      upserts,
      chunks: fiveChunks(),
    }),
  );
  installFetch({ events, allowGeneration: true, claudeText: 'Generated because L3 is inert [1].' });

  try {
    const resp = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      assert(resp.answer.includes('Generated because L3 is inert'));
    }
    assertEquals(events.filter((e) => e === 'l3:select').length, 0, 'flag OFF: L3 must never be read');
    assertEquals(events.filter((e) => e === 'l3:upsert').length, 0, 'flag OFF: L3 must never be written');
    assertEquals(upserts.length, 0);
  } finally {
    resetAll();
  }
});

// ── (d2): serve-flag conjunct — store-only mode warms but never serves ───────

Deno.test('serve flag OFF + store flag ON → L3 is NEVER read/served (fresh generation) BUT the write-back still lands (store warming)', async () => {
  resetAll();

  const req = makeSolverRequest();
  const CONTENT_VERSION = 5;
  const identities = await deriveIdentities(req, CONTENT_VERSION);

  // A perfectly matching row is ALREADY in the store — pre-fix (read gated
  // on the store flag alone) this would have been served. Post-fix it must
  // stay unread until ff_response_cache_serve_ncert_v1 flips ON.
  const seeded = groundedResponse('Warmed row that must NOT be served yet.', 'warm-trace');
  const l3Store = new Map([
    [`10|science|${identities.questionHash}|${identities.genCtxHash}`, { tuple: identities.tuple, response: seeded }],
  ]);

  const events: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  __setSupabaseClientForTests(
    buildL3Sb({
      flagMap: {
        ff_grounded_ai_enabled: true,
        ff_response_cache_serve_ncert_v1: false, // ← serve OFF
        ff_ncert_solver_solution_store_v1: true, // ← store ON (warming ramp)
        ff_foxy_response_cache_l2_v1: false,
        ff_foxy_response_cache_l2_shadow_v1: false,
      },
      contentVersion: CONTENT_VERSION,
      l3Store,
      events,
      upserts,
      chunks: fiveChunks(),
      traceId: 'trace-warming-generation',
    }),
  );
  installFetch({ events, allowGeneration: true, claudeText: 'Freshly generated, not served from L3 [1].' });

  try {
    const resp = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    if (resp.grounded) {
      assert(
        resp.answer.includes('Freshly generated'),
        'serve OFF: the warmed L3 row must never be served',
      );
      assert(resp.trace_id !== 'warm-trace', 'the stored trace must not leak into the response');
    }

    // The READ path never ran…
    assertEquals(events.filter((e) => e === 'l3:select').length, 0, 'serve OFF: L3 must never be read');
    // …full generation happened…
    assert(events.some((e) => e.startsWith('rpc:')), 'retrieval must run (no cache short-circuit)');
    assertEquals(events.filter((e) => e === 'claude:call').length >= 1, true, 'fresh model generation must run');
    // …and the WRITE-BACK still landed (warming works while serving is OFF).
    assertEquals(events.filter((e) => e === 'l3:upsert').length, 1, 'store ON: the write-back must land');
    assertEquals(upserts.length, 1);
    assertEquals(upserts[0].question_hash, identities.questionHash);
    assertEquals(upserts[0].gen_ctx_hash, identities.genCtxHash);
    assertEquals(upserts[0].content_version, CONTENT_VERSION);
  } finally {
    resetAll();
  }
});

// ── (e): P13 — no student identifiers in the persisted payload ───────────────

Deno.test('L3 write-back payload carries NO student identifiers (P13) — even when a caller passes student_id', async () => {
  resetAll();

  const STUDENT_ID_CANARY = 'stu-pii-canary-4242';
  const req = makeSolverRequest({ student_id: STUDENT_ID_CANARY });
  const CONTENT_VERSION = 2;
  const identities = await deriveIdentities(req, CONTENT_VERSION);

  const events: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  __setSupabaseClientForTests(
    buildL3Sb({
      flagMap: { ...FLAGS_L3_ON, ff_response_cache_serve_ncert_v1: false },
      contentVersion: CONTENT_VERSION,
      l3Store: new Map(), // L3 miss → full generation → write-back
      events,
      upserts,
      chunks: fiveChunks(),
    }),
  );
  installFetch({ events, allowGeneration: true, claudeText: 'A grounded solution [1].' });

  try {
    const resp = await runPipeline(req, Date.now(), 'anthropic-key', 'voyage-key');
    assertEquals(resp.grounded, true);
    assertEquals(upserts.length, 1, 'expected exactly one L3 write-back');
    const row = upserts[0];

    // Exact column contract (migration 20260716090100 COMMENT: DO UPDATE
    // SET response/content_version/model/tokens_used/created_at) — nothing
    // beyond scope + question identity + version + model/tokens_used/
    // created_at + payload may ever be persisted.
    assertEquals(
      Object.keys(row).sort(),
      [
        'content_version',
        'created_at',
        'gen_ctx_hash',
        'grade',
        'model',
        'question_hash',
        'response',
        'subject_code',
        'tokens_used',
      ],
    );
    assertEquals(row.grade, '10');
    assertEquals(row.subject_code, 'science');
    assertEquals(row.question_hash, identities.questionHash);
    assertEquals(row.gen_ctx_hash, identities.genCtxHash);
    assertEquals(row.content_version, CONTENT_VERSION);
    if (resp.grounded) {
      assertEquals(row.model, resp.meta.claude_model, 'model column mirrors response.meta');
      assertEquals(row.tokens_used, resp.meta.tokens_used, 'tokens_used column mirrors response.meta');
    }
    assert(
      typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at)),
      'created_at must be an explicit ISO timestamp (refreshed on conflict — DEFAULT only fires on INSERT)',
    );

    // P13 sweep over the FULL serialized row (tuple + response included).
    const serialized = JSON.stringify(row);
    assert(!serialized.includes(STUDENT_ID_CANARY), 'student_id value must never reach the L3 payload');
    assert(
      !/student_id|user_id|email|phone/i.test(serialized),
      `L3 payload must carry no identifier-shaped keys: ${serialized.slice(0, 300)}`,
    );
  } finally {
    resetAll();
  }
});

// ── Unit-level defense-in-depth pins ─────────────────────────────────────────

Deno.test('getDurableSolution rejects a stored tuple mismatch — treated as a miss, never served', async () => {
  const req = makeSolverRequest();
  const stored = await deriveIdentities(req, 0);
  const payload = { tuple: stored.tuple, response: groundedResponse('answer', 't1') };
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    from: () => ({
      select: () => {
        // deno-lint-ignore no-explicit-any
        const chain: any = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: { response: payload }, error: null }),
        };
        return chain;
      },
    }),
  };
  // Current request differs in chapter_number → full-tuple re-validation must miss.
  const currentTuple: CacheTuple = { ...stored.tuple, chapter_number: 9 };
  const result = await getDurableSolution(
    sb,
    {
      grade: '10',
      subject_code: 'science',
      question_hash: stored.questionHash,
      gen_ctx_hash: stored.genCtxHash,
    },
    currentTuple,
  );
  assertEquals(result, null, 'a mismatched stored tuple must never be served from L3');
});

Deno.test('putDurableSolution never stores an abstain (grounded:false) response', async () => {
  let upsertCalls = 0;
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    from: () => ({
      upsert: () => {
        upsertCalls++;
        return Promise.resolve({ error: null });
      },
    }),
  };
  const req = makeSolverRequest();
  const { questionHash, genCtxHash, tuple } = await deriveIdentities(req, 0);
  const abstain = {
    grounded: false as const,
    abstain_reason: 'no_chunks_retrieved' as const,
    suggested_alternatives: [],
    trace_id: 't-abstain',
    meta: { claude_model: '', tokens_used: 0, latency_ms: 5 },
  };
  await putDurableSolution(
    sb,
    { grade: '10', subject_code: 'science', question_hash: questionHash, gen_ctx_hash: genCtxHash },
    abstain as unknown as GroundedResponse,
    tuple,
    0,
  );
  assertEquals(upsertCalls, 0, 'abstains must never be written to the durable store');
});
