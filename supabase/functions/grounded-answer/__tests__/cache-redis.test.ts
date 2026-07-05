// supabase/functions/grounded-answer/__tests__/cache-redis.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Covers cache-redis.ts (L2 Upstash Redis tier) behaviors:
//   - buildRedisCacheKey: namespace + literal grade/subject/mode/caller
//     segments, sha256-hashed query, deterministic + case/whitespace
//     insensitive (reuses cache.ts normalizeQuery).
//   - buildRedisCacheKey: distinct from every other Redis prefix in use.
//   - Fail-open contract: no UPSTASH_* env vars → getFromRedisL2 returns
//     null (miss) and putInRedisL2 is a silent no-op. Never throws.
//   - Defense-in-depth: getFromRedisL2 must re-validate the stored tuple
//     against the current request's tuple even when it never reaches
//     Redis in this env (tested at the tuplesMatch-shape level via the
//     exported buildCacheTuple + the documented contract).
//   - Named constants: REDIS_CACHE_NAMESPACE, REDIS_CACHE_TTL_SECONDS.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  REDIS_CACHE_NAMESPACE,
  REDIS_CACHE_TTL_SECONDS,
  buildRedisCacheKey,
  buildCacheTuple,
  getFromRedisL2,
  putInRedisL2,
  __resetRedisClientForTests,
} from '../cache-redis.ts';
import type { GroundedResponse } from '../types.ts';

function groundedResponse(answer: string): GroundedResponse {
  return {
    grounded: true,
    answer,
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-x',
    meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 500 },
  };
}

function abstainResponse(): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: 'upstream_error',
    suggested_alternatives: [],
    trace_id: 'trace-abstain',
    meta: { latency_ms: 200 },
  };
}

// Ensure no Upstash secrets leak in from the ambient test environment so
// every test in this file exercises the fail-open (no-Redis) path
// deterministically, unless a test explicitly sets them.
function clearUpstashEnv() {
  Deno.env.delete('UPSTASH_REDIS_REST_URL');
  Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
  __resetRedisClientForTests();
}

Deno.test('REDIS_CACHE_NAMESPACE is rag:cache:v1 and distinct from existing rl:*/sess:* prefixes', () => {
  assertEquals(REDIS_CACHE_NAMESPACE, 'rag:cache:v1');
  const existingPrefixes = ['rl:general', 'rl:parent', 'rl:admin', 'rl:apikey', 'rl:parent_login', 'sess:valid'];
  for (const p of existingPrefixes) {
    assert(!p.startsWith(REDIS_CACHE_NAMESPACE) && !REDIS_CACHE_NAMESPACE.startsWith(p));
  }
});

Deno.test('REDIS_CACHE_TTL_SECONDS is 1200 (20 min) — longer than L1 5-min TTL', () => {
  assertEquals(REDIS_CACHE_TTL_SECONDS, 20 * 60);
});

Deno.test('buildRedisCacheKey produces the documented namespace:grade:subject:mode:caller:hash shape', async () => {
  const key = await buildRedisCacheKey(
    'What is Photosynthesis?',
    { grade: '10', subject_code: 'science' },
    'strict',
    'foxy',
  );
  const parts = key.split(':');
  // 'rag' : 'cache' : 'v1' : grade : subject : mode : caller : hash
  assertEquals(parts.length, 8);
  assertStringIncludes(key, `${REDIS_CACHE_NAMESPACE}:10:science:strict:foxy:`);
  // sha256 hex tail is 64 chars
  assertEquals(parts[parts.length - 1].length, 64);
});

Deno.test('buildRedisCacheKey is deterministic + case/whitespace insensitive (shares cache.ts normalizeQuery)', async () => {
  const k1 = await buildRedisCacheKey('  What is Photosynthesis?  ', { grade: '10', subject_code: 'science' }, 'strict', 'foxy');
  const k2 = await buildRedisCacheKey('what is photosynthesis?', { grade: '10', subject_code: 'science' }, 'strict', 'foxy');
  assertEquals(k1, k2);
});

Deno.test('buildRedisCacheKey preserves punctuation (no regression to the dormant SQL-cache bug)', async () => {
  const scope = { grade: '8', subject_code: 'math' };
  const plus = await buildRedisCacheKey('What is 5+3?', scope, 'strict', 'ncert-solver');
  const minus = await buildRedisCacheKey('What is 5-3?', scope, 'strict', 'ncert-solver');
  assert(plus !== minus);
});

Deno.test('buildRedisCacheKey differs across grade/subject/mode/caller (visible segments)', async () => {
  const base = { grade: '10', subject_code: 'science' };
  const a = await buildRedisCacheKey('q', base, 'strict', 'foxy');
  const b = await buildRedisCacheKey('q', { grade: '11', subject_code: 'science' }, 'strict', 'foxy');
  const c = await buildRedisCacheKey('q', { grade: '10', subject_code: 'math' }, 'strict', 'foxy');
  const d = await buildRedisCacheKey('q', base, 'soft', 'foxy');
  const e = await buildRedisCacheKey('q', base, 'strict', 'ncert-solver');
  const keys = [a, b, c, d, e];
  assertEquals(new Set(keys).size, keys.length);
});

Deno.test('fail-open: getFromRedisL2 returns null when UPSTASH secrets are absent (never throws)', async () => {
  clearUpstashEnv();
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'strict',
    grade: '10',
    subject_code: 'science',
    chapter_number: 3,
    query: 'What is photosynthesis?',
  });
  const result = await getFromRedisL2('rag:cache:v1:10:science:strict:foxy:deadbeef', tuple);
  assertEquals(result, null);
});

Deno.test('fail-open: putInRedisL2 is a silent no-op when UPSTASH secrets are absent (never throws)', async () => {
  clearUpstashEnv();
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'strict',
    grade: '10',
    subject_code: 'science',
    chapter_number: 3,
    query: 'What is photosynthesis?',
  });
  // Must not throw.
  await putInRedisL2('rag:cache:v1:10:science:strict:foxy:deadbeef', groundedResponse('hi'), tuple);
});

Deno.test('putInRedisL2 skips abstain responses even with no client (defense in depth ordering)', async () => {
  clearUpstashEnv();
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'strict',
    grade: '10',
    subject_code: 'science',
    chapter_number: 3,
    query: 'q',
  });
  // Should return before ever touching the (absent) client — no throw.
  await putInRedisL2('k', abstainResponse(), tuple);
});

// ── Fake Upstash REST backend ────────────────────────────────────────────
// Minimal stand-in for the real Upstash REST endpoint so we can test
// behaviors that require an ACTUAL round trip through the @upstash/redis
// client (tuple mismatch on a real stored payload; network failure), not
// just the "no secrets configured" fail-open path already covered above.
// Mirrors the shape verified against the live esm.sh@1 client in
// pipeline.test.ts's installFetchStubWithFakeUpstash: every command (single
// get/set included) is batched through one `POST {url}/pipeline` call whose
// body is `[[op, ...args], ...]` and whose response is `[{ result }, ...]`.
function installFetchStubForUpstash(
  store: Map<string, string>,
  upstashHost: string,
  opts?: { throwOnFetch?: boolean },
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(upstashHost)) {
      return Promise.reject(new Error(`unexpected fetch to ${u} in cache-redis test stub`));
    }
    if (opts?.throwOnFetch) {
      return Promise.reject(new Error('simulated Redis network failure'));
    }
    const body = JSON.parse(String(init?.body ?? '[]')) as unknown[][];
    const results = body.map((cmd) => {
      const [op, ...args] = cmd as [string, ...unknown[]];
      if (op === 'set') {
        const [key, val] = args as [string, string];
        store.set(key, val);
        return { result: 'OK' };
      }
      if (op === 'get') {
        const [key] = args as [string];
        return { result: store.has(key) ? store.get(key)! : null };
      }
      return { result: null };
    });
    return Promise.resolve(
      new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test('getFromRedisL2 rejects a mismatched stored tuple (hash collision / corrupted value) — treated as a miss, never served', async () => {
  const fakeHost = 'http://fake-upstash-tuple-mismatch-test.example';
  Deno.env.set('UPSTASH_REDIS_REST_URL', fakeHost);
  Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();
  const store = new Map<string, string>();
  const restore = installFetchStubForUpstash(store, fakeHost);
  try {
    const key = 'rag:cache:v1:10:science:strict:foxy:collided-hash';
    const storedTuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'What is photosynthesis?',
    });
    await putInRedisL2(key, groundedResponse('Photosynthesis answer'), storedTuple);

    // Simulate a hash collision / corrupted Redis value: the key matches
    // (same hash) but the CURRENT request's tuple differs from what's
    // actually stored (different chapter_number here; any field differing
    // must reject).
    const currentTuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 2, // mismatch vs storedTuple.chapter_number === 1
      query: 'What is photosynthesis?',
    });
    const result = await getFromRedisL2(key, currentTuple);
    assertEquals(result, null, 'a mismatched stored tuple must be treated as a miss, never served');
  } finally {
    restore();
    Deno.env.delete('UPSTASH_REDIS_REST_URL');
    Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
    __resetRedisClientForTests();
  }
});

Deno.test('Redis reachable but erroring (network failure, not absent secrets) → fail-open miss/no-op, never throws', async () => {
  const fakeHost = 'http://fake-upstash-network-error-test.example';
  Deno.env.set('UPSTASH_REDIS_REST_URL', fakeHost);
  Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();
  const store = new Map<string, string>();
  const restore = installFetchStubForUpstash(store, fakeHost, { throwOnFetch: true });
  try {
    const tuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'What is photosynthesis?',
    });
    const key = 'rag:cache:v1:10:science:strict:foxy:deadbeef';
    const getResult = await getFromRedisL2(key, tuple);
    assertEquals(getResult, null, 'a Redis network error must degrade to a miss, not throw');
    // Must resolve, not reject.
    await putInRedisL2(key, groundedResponse('hi'), tuple);
  } finally {
    restore();
    Deno.env.delete('UPSTASH_REDIS_REST_URL');
    Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
    __resetRedisClientForTests();
  }
});

Deno.test('buildCacheTuple normalizes the query the same way as the key hash input', () => {
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'soft',
    grade: '9',
    subject_code: 'math',
    chapter_number: 1,
    query: '  What Is 5+3?  ',
  });
  assertEquals(tuple.query_normalized, 'what is 5+3?');
  assertEquals(tuple.chapter_number, 1);
  assertEquals(tuple.caller, 'foxy');
  assertEquals(tuple.mode, 'soft');
});
