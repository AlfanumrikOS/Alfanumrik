// supabase/functions/_shared/quiz-oracle.test.ts
//
// Deno test for the quiz-oracle cache primitives (Q4 — REG-54 follow-up).
//
// The TS twin (`src/__tests__/quiz-oracle.test.ts`) covers the deterministic
// checks, parser, and end-to-end validateCandidate flow because vitest is
// the project's test runner. This file pins the two cache behaviours that
// are observable only in the Deno mirror:
//   1. `makeCandidateCacheKey` differs when `correct_answer_index` differs
//      (otherwise-identical candidates would otherwise collide).
//   2. `setCachedResult` evicts the oldest entry once the cap is hit (LRU
//      tie-breaker — Map preserves insertion order so we drop first-key).
//
// CI runbook (Q4):
//   `deno test` is NOT yet wired into `.github/workflows/ci.yml`. The
//   project ships Edge Function code via `supabase functions deploy` and
//   relies on the TS twin for logic coverage. Run this file locally:
//     deno test --allow-none supabase/functions/_shared/quiz-oracle.test.ts
//   When Deno test infra lands in CI (tracked separately — TODO(testing)),
//   this file will be picked up automatically.

import {
  makeCandidateCacheKey,
  getCachedResult,
  setCachedResult,
  clearOracleCache,
  type CandidateQuestion,
  type OracleResult,
} from './quiz-oracle.ts';

function makeCandidate(overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    question_text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    correct_answer_index: 1,
    explanation: 'Two plus two equals four.',
    ...overrides,
  };
}

function acceptResult(): OracleResult {
  return { ok: true, llm_calls: 0 };
}

Deno.test('makeCandidateCacheKey: different correct_answer_index → different key', () => {
  const a = makeCandidate({ correct_answer_index: 0 });
  const b = makeCandidate({ correct_answer_index: 1 });
  const c = makeCandidate({ correct_answer_index: 2 });

  const ka = makeCandidateCacheKey(a);
  const kb = makeCandidateCacheKey(b);
  const kc = makeCandidateCacheKey(c);

  if (ka === kb) {
    throw new Error(`expected different keys, got ${ka} === ${kb}`);
  }
  if (kb === kc) {
    throw new Error(`expected different keys, got ${kb} === ${kc}`);
  }
});

Deno.test('makeCandidateCacheKey: identical candidates produce identical keys', () => {
  const a = makeCandidate();
  const b = makeCandidate();
  const ka = makeCandidateCacheKey(a);
  const kb = makeCandidateCacheKey(b);
  if (ka !== kb) {
    throw new Error(`expected identical keys, got ${ka} !== ${kb}`);
  }
});

Deno.test('makeCandidateCacheKey: different options → different keys', () => {
  const a = makeCandidate({ options: ['3', '4', '5', '6'] });
  const b = makeCandidate({ options: ['3', '4', '5', '7'] });
  if (makeCandidateCacheKey(a) === makeCandidateCacheKey(b)) {
    throw new Error('expected different keys when options differ');
  }
});

Deno.test('setCachedResult: LRU eviction kicks in at cap=200', () => {
  clearOracleCache();

  // Fill cache to cap. We use unique question_text per entry so each gets
  // a distinct cache key.
  for (let i = 0; i < 200; i++) {
    const c = makeCandidate({ question_text: `Q${i}` });
    setCachedResult(makeCandidateCacheKey(c), acceptResult());
  }

  // The first entry must still be present at exactly 200.
  const firstKey = makeCandidateCacheKey(makeCandidate({ question_text: 'Q0' }));
  if (getCachedResult(firstKey) === undefined) {
    throw new Error('expected first entry still in cache at exactly cap');
  }

  // Add one more — first entry must now be evicted.
  const overflow = makeCandidate({ question_text: 'Q200' });
  setCachedResult(makeCandidateCacheKey(overflow), acceptResult());

  if (getCachedResult(firstKey) !== undefined) {
    throw new Error('expected first entry to be evicted after cap+1 insert');
  }

  // The new entry must be present.
  const overflowKey = makeCandidateCacheKey(overflow);
  if (getCachedResult(overflowKey) === undefined) {
    throw new Error('expected the overflow entry to be in cache');
  }

  clearOracleCache();
});

Deno.test('clearOracleCache: empties the cache', () => {
  const c = makeCandidate({ question_text: 'unique-clear' });
  const k = makeCandidateCacheKey(c);
  setCachedResult(k, acceptResult());
  if (getCachedResult(k) === undefined) {
    throw new Error('precondition: entry must be present before clear');
  }
  clearOracleCache();
  if (getCachedResult(k) !== undefined) {
    throw new Error('expected cache to be empty after clearOracleCache');
  }
});
