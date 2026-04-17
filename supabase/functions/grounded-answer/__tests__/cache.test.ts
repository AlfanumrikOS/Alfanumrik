// supabase/functions/grounded-answer/__tests__/cache.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Covers cache.ts behaviors:
//   - buildCacheKey: sha256-stable, whitespace/case-normalized
//   - buildCacheKey: different modes/scopes produce different keys
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
  );
  const k2 = await buildCacheKey(
    'what is photosynthesis?',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'strict',
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
  );
  const soft = await buildCacheKey(
    'q',
    { grade: '10', subject_code: 'science', chapter_number: 1 },
    'soft',
  );
  assertNotEquals(strict, soft);
});

Deno.test('buildCacheKey differs across grades + subjects + chapters', async () => {
  const a = await buildCacheKey('q', { grade: '10', subject_code: 'science', chapter_number: 1 }, 'strict');
  const b = await buildCacheKey('q', { grade: '11', subject_code: 'science', chapter_number: 1 }, 'strict');
  const c = await buildCacheKey('q', { grade: '10', subject_code: 'math', chapter_number: 1 }, 'strict');
  const d = await buildCacheKey('q', { grade: '10', subject_code: 'science', chapter_number: 2 }, 'strict');
  assertNotEquals(a, b);
  assertNotEquals(a, c);
  assertNotEquals(a, d);
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