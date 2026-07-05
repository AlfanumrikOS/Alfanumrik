// supabase/functions/grounded-answer/__tests__/cache.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Covers cache.ts behaviors:
//   - buildCacheKey: sha256-stable, whitespace/case-normalized
//   - buildCacheKey: different modes/scopes/callers produce different keys
//   - buildCacheKey: preserves math/symbol-significant punctuation (REG-237)
//   - getFromCache: miss, hit, expired miss
//   - putInCache: ignores abstain responses
//   - putInCache: LRU eviction when exceeding max entries

import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  __cacheSizeForTests,
  __clearCacheForTests,
  buildCacheKey,
  getFromCache,
  putInCache,
} from '../cache.ts';
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

Deno.test('buildCacheKey is deterministic + case/whitespace insensitive', async () => {
  const k1 = await buildCacheKey(
    '  What is Photosynthesis?  ',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'strict',
    'foxy',
  );
  const k2 = await buildCacheKey(
    'what is photosynthesis?',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'strict',
    'foxy',
  );
  assertEquals(k1, k2);
  // sha256 hex is 64 chars
  assertEquals(k1.length, 64);
});

Deno.test('buildCacheKey differs across modes', async () => {
  const strict = await buildCacheKey(
    'q',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'strict',
    'foxy',
  );
  const soft = await buildCacheKey(
    'q',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'soft',
    'foxy',
  );
  assertNotEquals(strict, soft);
});

Deno.test('buildCacheKey differs across grades + subjects + chapters', async () => {
  const a = await buildCacheKey('q', { grade: '10', subject_code: 'science', chapter_number: 1 }, 'strict', 'foxy');
  const b = await buildCacheKey('q', { grade: '11', subject_code: 'science', chapter_number: 1 }, 'strict', 'foxy');
  const c = await buildCacheKey('q', { grade: '10', subject_code: 'math', chapter_number: 1 }, 'strict', 'foxy');
  const d = await buildCacheKey('q', { grade: '10', subject_code: 'science', chapter_number: 2 }, 'strict', 'foxy');
  assertNotEquals(a, b);
  assertNotEquals(a, c);
  assertNotEquals(a, d);
});

Deno.test('buildCacheKey differs across callers (REG-fix: caller-collision bug)', async () => {
  // Regression coverage for the bug this task fixes: two different callers
  // (e.g. concept-engine and foxy) submitting the identical normalized
  // query/scope/mode must NOT collide on the same cache key, because
  // pipeline.ts generates materially different output shapes per caller
  // (isFoxyStructured strict-JSON contract + boosted max_tokens, foxy-only).
  const scope = { grade: '10', subject_code: 'science', chapter_number: 1 } as const;
  const foxyKey = await buildCacheKey('what is photosynthesis?', scope, 'soft', 'foxy');
  const conceptEngineKey = await buildCacheKey('what is photosynthesis?', scope, 'soft', 'concept-engine');
  const ncertSolverKey = await buildCacheKey('what is photosynthesis?', scope, 'soft', 'ncert-solver');
  const quizGeneratorKey = await buildCacheKey('what is photosynthesis?', scope, 'soft', 'quiz-generator');
  const diagnosticKey = await buildCacheKey('what is photosynthesis?', scope, 'soft', 'diagnostic');
  const keys = [foxyKey, conceptEngineKey, ncertSolverKey, quizGeneratorKey, diagnosticKey];
  assertEquals(new Set(keys).size, keys.length);
});

Deno.test('buildCacheKey preserves mathematically/semantically significant punctuation (REG-237)', async () => {
  // Why this matters: buildCacheKey's normalizer is
  // `.toLowerCase().trim().replace(/\s+/g, ' ')` — it does NOT strip
  // punctuation/symbols, which is the CORRECT behavior for a CBSE math/
  // science platform where "5+3" and "5-3" are different questions.
  //
  // Cautionary precedent this test guards against: a DORMANT, unused SQL
  // RPC pair in supabase/migrations/00000000000000_baseline_from_prod.sql
  // (`write_foxy_cache` / `lookup_foxy_cache`, an earmarked-but-never-wired
  // candidate for a future Postgres L3 cache tier) normalizes queries with
  // `regexp_replace(p_q, '[^a-zA-Z0-9\s]', '', 'g')` — which strips ALL
  // punctuation/operators. Under that regex, "What is 5+3?" and
  // "What is 5-3?" both collapse to "what is 53" and collide. That SQL is
  // not called by any live code path today (0 rows in the table), but if
  // someone later revives it by porting the existing SQL normalization
  // logic verbatim, it will reintroduce this exact collision class. This
  // test does NOT exercise that SQL — it can't catch the SQL bug directly —
  // but it pins the invariant the live TS cache key already satisfies and
  // that any future ported/revived cache layer MUST also satisfy: distinct
  // operators/symbols in an otherwise-identical query must never collapse
  // to the same cache key.
  const scope = { grade: '8', subject_code: 'math', chapter_number: 3 } as const;

  const plus = await buildCacheKey('What is 5+3?', scope, 'strict', 'ncert-solver');
  const minus = await buildCacheKey('What is 5-3?', scope, 'strict', 'ncert-solver');
  assertNotEquals(plus, minus);

  // Percentages: "20% of 50" vs "20 of 50" are different questions.
  const percent = await buildCacheKey('20% of 50', scope, 'strict', 'ncert-solver');
  const noPercent = await buildCacheKey('20 of 50', scope, 'strict', 'ncert-solver');
  assertNotEquals(percent, noPercent);

  // Algebra: "2x=10" vs "2x 10" — the equals sign is load-bearing.
  const equation = await buildCacheKey('2x=10', scope, 'strict', 'ncert-solver');
  const noEquals = await buildCacheKey('2x 10', scope, 'strict', 'ncert-solver');
  assertNotEquals(equation, noEquals);

  // Boundary punctuation: a trailing "?" must not be normalized away.
  const withQuestionMark = await buildCacheKey('What is force?', scope, 'strict', 'ncert-solver');
  const withoutQuestionMark = await buildCacheKey('What is force', scope, 'strict', 'ncert-solver');
  assertNotEquals(withQuestionMark, withoutQuestionMark);
});

Deno.test('getFromCache returns null on miss', () => {
  __clearCacheForTests();
  assertEquals(getFromCache('missing'), null);
});

Deno.test('putInCache + getFromCache round-trips grounded response', () => {
  __clearCacheForTests();
  putInCache('k1', groundedResponse('hello'));
  const hit = getFromCache('k1');
  assert(hit !== null);
  if (hit && hit.grounded) {
    assertEquals(hit.answer, 'hello');
  }
});

Deno.test('putInCache ignores abstain responses', () => {
  __clearCacheForTests();
  putInCache('k-abstain', abstainResponse());
  assertEquals(getFromCache('k-abstain'), null);
  assertEquals(__cacheSizeForTests(), 0);
});

Deno.test('getFromCache returns null after TTL expiry', async () => {
  __clearCacheForTests();
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  try {
    putInCache('k-ttl', groundedResponse('fresh'));
    assert(getFromCache('k-ttl') !== null);
    // Fast-forward past CACHE_TTL_MS (5 min).
    t += 6 * 60_000;
    assertEquals(getFromCache('k-ttl'), null);
  } finally {
    Date.now = realNow;
  }
});

Deno.test('LRU eviction: adding beyond MAX drops oldest', () => {
  __clearCacheForTests();
  // Fill cache to 500 + 1 to force eviction.
  for (let i = 0; i < 501; i++) {
    putInCache(`k${i}`, groundedResponse(`a${i}`));
  }
  assertEquals(__cacheSizeForTests(), 500);
  // k0 should have been evicted.
  assertEquals(getFromCache('k0'), null);
  // Most-recent still present.
  assert(getFromCache('k500') !== null);
});

Deno.test('LRU touch: accessing a key makes it most-recent', () => {
  __clearCacheForTests();
  putInCache('k-old', groundedResponse('old'));
  for (let i = 0; i < 499; i++) {
    putInCache(`k${i}`, groundedResponse(`a${i}`));
  }
  // Touch k-old so it becomes most-recent.
  getFromCache('k-old');
  // Adding one more evicts the now-oldest (k0), not k-old.
  putInCache('k-new', groundedResponse('new'));
  assert(getFromCache('k-old') !== null);
  assertEquals(getFromCache('k0'), null);
});