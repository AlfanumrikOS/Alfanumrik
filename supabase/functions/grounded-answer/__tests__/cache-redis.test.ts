// supabase/functions/grounded-answer/__tests__/cache-redis.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Covers cache-redis.ts (L2 Upstash Redis tier, response-cache v2) behaviors:
//   - buildRedisCacheKey: v2 namespace + literal grade/subject/mode/caller
//     segments, sha256-hashed query, 12-char gen_ctx fragment, deterministic
//     + case/whitespace insensitive (reuses cache.ts normalizeQuery).
//   - buildRedisCacheKey: distinct from every other Redis prefix in use
//     (including the retired rag:cache:v1 namespace).
//   - v2 env-pair split: reads ONLY UPSTASH_CACHE_REDIS_REST_URL/TOKEN.
//     NO fallback to UPSTASH_REDIS_REST_URL/TOKEN (security-critical
//     noeviction instance) — REG-240-adjacent pin.
//   - Fail-open contract (REG-240): no cache env pair → getFromRedisL2
//     returns null (miss) and putInRedisL2 is a silent no-op. Never throws.
//   - Defense-in-depth: getFromRedisL2 re-validates the stored tuple —
//     INCLUDING the full gen_ctx_hash (the v1 mode-collision fix) — against
//     the current request's tuple. Any mismatch is a miss, never served.
//   - Per-caller TTLs: foxy 20 min, ncert-solver 24 h.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  REDIS_CACHE_NAMESPACE,
  REDIS_CACHE_TTL_SECONDS_FOXY,
  REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER,
  redisCacheTtlSeconds,
  buildRedisCacheKey,
  buildCacheTuple,
  getFromRedisL2,
  putInRedisL2,
  hashNormalizedQuery,
  __resetRedisClientForTests,
} from '../cache-redis.ts';
import type { GroundedResponse } from '../types.ts';

const GEN_CTX_HASH_A = 'a'.repeat(64);
const GEN_CTX_HASH_B = 'b'.repeat(64);
const FRAG_A = GEN_CTX_HASH_A.slice(0, 12);

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
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_URL');
  Deno.env.delete('UPSTASH_CACHE_REDIS_REST_TOKEN');
  Deno.env.delete('UPSTASH_REDIS_REST_URL');
  Deno.env.delete('UPSTASH_REDIS_REST_TOKEN');
  __resetRedisClientForTests();
}

Deno.test('REDIS_CACHE_NAMESPACE is rag:cache:v2 and distinct from existing prefixes (incl. retired v1)', () => {
  assertEquals(REDIS_CACHE_NAMESPACE, 'rag:cache:v2');
  const existingPrefixes = [
    'rl:general', 'rl:parent', 'rl:admin', 'rl:apikey', 'rl:parent_login', 'sess:valid',
    'rag:cache:v1',
  ];
  for (const p of existingPrefixes) {
    assert(!p.startsWith(REDIS_CACHE_NAMESPACE) && !REDIS_CACHE_NAMESPACE.startsWith(p));
  }
});

Deno.test('per-caller TTLs: foxy 20 min, ncert-solver 24 h — both longer than L1 5-min TTL', () => {
  assertEquals(REDIS_CACHE_TTL_SECONDS_FOXY, 20 * 60);
  assertEquals(REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER, 24 * 60 * 60);
  assertEquals(redisCacheTtlSeconds('foxy'), REDIS_CACHE_TTL_SECONDS_FOXY);
  assertEquals(redisCacheTtlSeconds('ncert-solver'), REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER);
  // Any other caller falls back to the shorter/safer foxy TTL.
  assertEquals(redisCacheTtlSeconds('quiz-generator'), REDIS_CACHE_TTL_SECONDS_FOXY);
});

Deno.test('buildRedisCacheKey produces the documented v2 namespace:grade:subject:mode:caller:hash:genctx shape', async () => {
  const key = await buildRedisCacheKey(
    'What is Photosynthesis?',
    { grade: '10', subject_code: 'science' },
    'strict',
    'foxy',
    FRAG_A,
  );
  const parts = key.split(':');
  // 'rag' : 'cache' : 'v2' : grade : subject : mode : caller : hash : genctx-frag
  assertEquals(parts.length, 9);
  assertStringIncludes(key, `${REDIS_CACHE_NAMESPACE}:10:science:strict:foxy:`);
  // sha256 hex query hash is 64 chars; gen_ctx fragment is 12 chars
  assertEquals(parts[7].length, 64);
  assertEquals(parts[8], FRAG_A);
});

Deno.test('buildRedisCacheKey is deterministic + case/whitespace insensitive (shares cache.ts normalizeQuery)', async () => {
  const k1 = await buildRedisCacheKey('  What is Photosynthesis?  ', { grade: '10', subject_code: 'science' }, 'strict', 'foxy', FRAG_A);
  const k2 = await buildRedisCacheKey('what is photosynthesis?', { grade: '10', subject_code: 'science' }, 'strict', 'foxy', FRAG_A);
  assertEquals(k1, k2);
});

Deno.test('buildRedisCacheKey preserves punctuation (no regression to the dormant SQL-cache bug)', async () => {
  const scope = { grade: '8', subject_code: 'math' };
  const plus = await buildRedisCacheKey('What is 5+3?', scope, 'strict', 'ncert-solver', FRAG_A);
  const minus = await buildRedisCacheKey('What is 5-3?', scope, 'strict', 'ncert-solver', FRAG_A);
  assert(plus !== minus);
});

Deno.test('buildRedisCacheKey differs across grade/subject/mode/caller/gen_ctx (visible segments)', async () => {
  const base = { grade: '10', subject_code: 'science' };
  const a = await buildRedisCacheKey('q', base, 'strict', 'foxy', FRAG_A);
  const b = await buildRedisCacheKey('q', { grade: '11', subject_code: 'science' }, 'strict', 'foxy', FRAG_A);
  const c = await buildRedisCacheKey('q', { grade: '10', subject_code: 'math' }, 'strict', 'foxy', FRAG_A);
  const d = await buildRedisCacheKey('q', base, 'soft', 'foxy', FRAG_A);
  const e = await buildRedisCacheKey('q', base, 'strict', 'ncert-solver', FRAG_A);
  // The v1 mode-collision fix: identical text/scope/mode/caller but a
  // different generation context (e.g. Foxy learn vs practice template
  // variables) MUST produce a different key.
  const f = await buildRedisCacheKey('q', base, 'strict', 'foxy', GEN_CTX_HASH_B.slice(0, 12));
  const keys = [a, b, c, d, e, f];
  assertEquals(new Set(keys).size, keys.length);
});

Deno.test('hashNormalizedQuery is the sha256 of the NORMALIZED query (shared question identity with L3)', async () => {
  const h1 = await hashNormalizedQuery('  What Is 5+3?  ');
  const h2 = await hashNormalizedQuery('what is 5+3?');
  assertEquals(h1, h2);
  assertEquals(h1.length, 64);
});

Deno.test('fail-open: getFromRedisL2 returns null when the CACHE env pair is absent (never throws)', async () => {
  clearUpstashEnv();
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'strict',
    grade: '10',
    subject_code: 'science',
    chapter_number: 3,
    query: 'What is photosynthesis?',
    gen_ctx_hash: GEN_CTX_HASH_A,
  });
  const result = await getFromRedisL2(`rag:cache:v2:10:science:strict:foxy:deadbeef:${FRAG_A}`, tuple);
  assertEquals(result, null);
});

Deno.test('env-pair split pin: the legacy UPSTASH_REDIS_REST_URL/TOKEN pair alone must NOT be used (no fallback)', async () => {
  // The legacy pair points at the security-critical noeviction instance
  // (rate limiting + session validity). The cache must NEVER fall back to
  // it: with ONLY the legacy pair set, the client stays unconfigured and
  // every call degrades to a miss without any network I/O.
  clearUpstashEnv();
  Deno.env.set('UPSTASH_REDIS_REST_URL', 'http://security-instance.example');
  Deno.env.set('UPSTASH_REDIS_REST_TOKEN', 'security-token');
  __resetRedisClientForTests();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls++;
    return Promise.reject(new Error('cache must not touch the security Redis instance'));
  }) as typeof fetch;
  try {
    const tuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 3,
      query: 'q',
      gen_ctx_hash: GEN_CTX_HASH_A,
    });
    const key = `rag:cache:v2:10:science:strict:foxy:deadbeef:${FRAG_A}`;
    const result = await getFromRedisL2(key, tuple);
    assertEquals(result, null, 'legacy env pair alone must behave as unconfigured (miss)');
    await putInRedisL2(key, groundedResponse('hi'), tuple);
    assertEquals(fetchCalls, 0, 'no network I/O may target the legacy/security Redis instance');
  } finally {
    globalThis.fetch = originalFetch;
    clearUpstashEnv();
  }
});

Deno.test('fail-open: putInRedisL2 is a silent no-op when the cache env pair is absent (never throws)', async () => {
  clearUpstashEnv();
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'strict',
    grade: '10',
    subject_code: 'science',
    chapter_number: 3,
    query: 'What is photosynthesis?',
    gen_ctx_hash: GEN_CTX_HASH_A,
  });
  // Must not throw.
  await putInRedisL2(`rag:cache:v2:10:science:strict:foxy:deadbeef:${FRAG_A}`, groundedResponse('hi'), tuple);
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
    gen_ctx_hash: GEN_CTX_HASH_A,
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
  opts?: { throwOnFetch?: boolean; commandLog?: unknown[][] },
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
      opts?.commandLog?.push(cmd);
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

function setCacheEnv(host: string) {
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_URL', host);
  Deno.env.set('UPSTASH_CACHE_REDIS_REST_TOKEN', 'test-token');
  __resetRedisClientForTests();
}

Deno.test('getFromRedisL2 rejects a mismatched stored tuple (hash collision / corrupted value) — treated as a miss, never served', async () => {
  const fakeHost = 'http://fake-upstash-tuple-mismatch-test.example';
  setCacheEnv(fakeHost);
  const store = new Map<string, string>();
  const restore = installFetchStubForUpstash(store, fakeHost);
  try {
    const key = `rag:cache:v2:10:science:strict:foxy:collided-hash:${FRAG_A}`;
    const storedTuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'What is photosynthesis?',
      gen_ctx_hash: GEN_CTX_HASH_A,
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
      gen_ctx_hash: GEN_CTX_HASH_A,
    });
    const result = await getFromRedisL2(key, currentTuple);
    assertEquals(result, null, 'a mismatched stored tuple must be treated as a miss, never served');
  } finally {
    restore();
    clearUpstashEnv();
  }
});

Deno.test('getFromRedisL2 rejects a gen_ctx_hash mismatch — the v1 mode-collision fix is enforced at read time', async () => {
  // Two Foxy turns with identical query/scope/mode/caller but different
  // generation contexts (learn vs practice template variables) get
  // different keys via the 12-char fragment — but even if the fragments
  // collided, the FULL 64-char hash in the tuple must reject the serve.
  const fakeHost = 'http://fake-upstash-genctx-mismatch-test.example';
  setCacheEnv(fakeHost);
  const store = new Map<string, string>();
  const restore = installFetchStubForUpstash(store, fakeHost);
  try {
    const key = `rag:cache:v2:10:science:soft:foxy:same-query-hash:${FRAG_A}`;
    const base = {
      caller: 'foxy' as const,
      mode: 'soft' as const,
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'Explain photosynthesis',
    };
    const storedTuple = buildCacheTuple({ ...base, gen_ctx_hash: GEN_CTX_HASH_A });
    await putInRedisL2(key, groundedResponse('learn-shaped answer'), storedTuple);

    const currentTuple = buildCacheTuple({ ...base, gen_ctx_hash: GEN_CTX_HASH_B });
    const result = await getFromRedisL2(key, currentTuple);
    assertEquals(result, null, 'a gen_ctx_hash mismatch must be a miss — never serve across generation contexts');
  } finally {
    restore();
    clearUpstashEnv();
  }
});

Deno.test('putInRedisL2 uses the per-caller TTL (24 h for ncert-solver, 20 min for foxy)', async () => {
  const fakeHost = 'http://fake-upstash-ttl-test.example';
  setCacheEnv(fakeHost);
  const store = new Map<string, string>();
  const commandLog: unknown[][] = [];
  const restore = installFetchStubForUpstash(store, fakeHost, { commandLog });
  try {
    const ncertTuple = buildCacheTuple({
      caller: 'ncert-solver',
      mode: 'strict',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'q',
      gen_ctx_hash: GEN_CTX_HASH_A,
    });
    await putInRedisL2('k-ncert', groundedResponse('a'), ncertTuple);
    const foxyTuple = buildCacheTuple({
      caller: 'foxy',
      mode: 'soft',
      grade: '10',
      subject_code: 'science',
      chapter_number: 1,
      query: 'q',
      gen_ctx_hash: GEN_CTX_HASH_A,
    });
    await putInRedisL2('k-foxy', groundedResponse('a'), foxyTuple);

    const flat = commandLog.map((cmd) => cmd.map(String).join(' '));
    assert(
      flat.some((c) => c.startsWith('set k-ncert') && c.includes(String(REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER))),
      `expected the ncert-solver set command to carry TTL ${REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER}: ${JSON.stringify(flat)}`,
    );
    assert(
      flat.some((c) => c.startsWith('set k-foxy') && c.includes(String(REDIS_CACHE_TTL_SECONDS_FOXY))),
      `expected the foxy set command to carry TTL ${REDIS_CACHE_TTL_SECONDS_FOXY}: ${JSON.stringify(flat)}`,
    );
  } finally {
    restore();
    clearUpstashEnv();
  }
});

Deno.test('Redis reachable but erroring (network failure, not absent secrets) → fail-open miss/no-op, never throws', async () => {
  const fakeHost = 'http://fake-upstash-network-error-test.example';
  setCacheEnv(fakeHost);
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
      gen_ctx_hash: GEN_CTX_HASH_A,
    });
    const key = `rag:cache:v2:10:science:strict:foxy:deadbeef:${FRAG_A}`;
    const getResult = await getFromRedisL2(key, tuple);
    assertEquals(getResult, null, 'a Redis network error must degrade to a miss, not throw');
    // Must resolve, not reject.
    await putInRedisL2(key, groundedResponse('hi'), tuple);
  } finally {
    restore();
    clearUpstashEnv();
  }
});

Deno.test('buildCacheTuple normalizes the query the same way as the key hash input + carries the gen_ctx hash', () => {
  const tuple = buildCacheTuple({
    caller: 'foxy',
    mode: 'soft',
    grade: '9',
    subject_code: 'math',
    chapter_number: 1,
    query: '  What Is 5+3?  ',
    gen_ctx_hash: GEN_CTX_HASH_A,
  });
  assertEquals(tuple.query_normalized, 'what is 5+3?');
  assertEquals(tuple.chapter_number, 1);
  assertEquals(tuple.caller, 'foxy');
  assertEquals(tuple.mode, 'soft');
  assertEquals(tuple.gen_ctx_hash, GEN_CTX_HASH_A);
});
