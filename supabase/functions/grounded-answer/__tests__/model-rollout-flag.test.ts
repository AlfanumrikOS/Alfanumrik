// supabase/functions/grounded-answer/__tests__/model-rollout-flag.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all __tests__/model-rollout-flag.test.ts
//
// Verifies the ff_foxy_openai_primary_rollout_v1 percentage-rollout mechanism
// (_model-rollout-flag.ts): deterministic bucketing, roughly-uniform
// distribution, rollout_pct=0/100 boundary cases, and every fail-safe-toward-
// OpenAI-primary path (no caller id, flag OFF, row absent, read error, env
// not configured).

import { assertEquals, assert } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  hashForRollout,
  shouldUseClaudePrimary,
  MODEL_ROLLOUT_FLAG_NAME,
  __resetModelRolloutCacheForTests,
} from '../_model-rollout-flag.ts';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
}
function clearEnv() {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

function stubRow(row: { is_enabled: boolean; rollout_percentage: number | null } | null) {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(row === null ? [] : [row]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )) as typeof fetch;
}

function stubFetchThrows() {
  globalThis.fetch = (() => {
    throw new Error('model-rollout-flag test: fetch should not have been called');
  }) as typeof fetch;
}

function stubFetchRejects() {
  globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
}

function stubFetchNon200() {
  globalThis.fetch = (() => Promise.resolve(new Response('error', { status: 500 }))) as typeof fetch;
}

// ─── hashForRollout: determinism, range, distribution ───────────────────────

Deno.test('hashForRollout: same input always yields the same bucket', () => {
  const a = hashForRollout('student-abc-123', MODEL_ROLLOUT_FLAG_NAME);
  const b = hashForRollout('student-abc-123', MODEL_ROLLOUT_FLAG_NAME);
  assertEquals(a, b);
});

Deno.test('hashForRollout: always returns an integer in [0, 99]', () => {
  const ids = ['s1', 's2', 'a-long-uuid-like-value-0000-1111', '', 'unicode-éè'];
  for (const id of ids) {
    const bucket = hashForRollout(id, MODEL_ROLLOUT_FLAG_NAME);
    assert(Number.isInteger(bucket), `bucket for "${id}" must be an integer`);
    assert(bucket >= 0 && bucket < 100, `bucket ${bucket} for "${id}" out of [0,99]`);
  }
});

Deno.test('hashForRollout: roughly uniform distribution across a large sample', () => {
  const decileCounts = new Array(10).fill(0);
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const bucket = hashForRollout(`synthetic-student-${i}`, MODEL_ROLLOUT_FLAG_NAME);
    decileCounts[Math.floor(bucket / 10)]++;
  }
  // Expected ~200 per decile (N/10). Generous, non-flaky tolerance band —
  // this is a sanity check against a badly broken/degenerate hash (e.g.
  // always-zero or heavily skewed), not a strict statistical test.
  for (let d = 0; d < 10; d++) {
    assert(
      decileCounts[d] > N * 0.05 && decileCounts[d] < N * 0.15,
      `decile ${d} count ${decileCounts[d]} is outside the expected uniform-ish band`,
    );
  }
});

Deno.test('hashForRollout: matches the canonical salted algorithm (parity with TS hashForRollout)', () => {
  // Inline replica of packages/lib/src/feature-flags.ts's hashForRollout, to
  // pin THIS file's algorithm without a cross-package import (Deno cannot
  // import packages/lib). The real cross-runtime parity test lives at
  // apps/host/src/__tests__/lib/ai/gateway/model-rollout-hash-parity.test.ts.
  function tsHashForRollout(id: string, flagName: string): number {
    let hash = 0;
    const str = `${id}:${flagName}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 100;
  }
  for (const id of ['student-1', 'student-2', 'deadbeef-dead-4eef-8eef-deadbeefdead']) {
    assertEquals(hashForRollout(id, MODEL_ROLLOUT_FLAG_NAME), tsHashForRollout(id, MODEL_ROLLOUT_FLAG_NAME));
  }
});

// ─── shouldUseClaudePrimary: fail-safe paths (always → false / OpenAI-primary) ─

Deno.test('shouldUseClaudePrimary: no caller id → false, and the flag is NEVER consulted', async () => {
  __resetModelRolloutCacheForTests();
  clearEnv();
  stubFetchThrows(); // proves the flag read is skipped entirely
  try {
    assertEquals(await shouldUseClaudePrimary(null), false);
    assertEquals(await shouldUseClaudePrimary(undefined), false);
    assertEquals(await shouldUseClaudePrimary(''), false);
  } finally {
    restoreFetch();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: SUPABASE_URL/KEY not configured → false (fail-safe)', async () => {
  __resetModelRolloutCacheForTests();
  clearEnv();
  stubFetchThrows(); // proves no network attempt is made when env is unset
  try {
    assertEquals(await shouldUseClaudePrimary('student-1'), false);
  } finally {
    restoreFetch();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: flag row not found → false (fail-safe)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow(null);
  try {
    assertEquals(await shouldUseClaudePrimary('student-1'), false);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: non-200 response → false (fail-safe)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubFetchNon200();
  try {
    assertEquals(await shouldUseClaudePrimary('student-1'), false);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: network error → false (fail-safe)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubFetchRejects();
  try {
    assertEquals(await shouldUseClaudePrimary('student-1'), false);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: is_enabled=false → false regardless of rollout_percentage', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow({ is_enabled: false, rollout_percentage: 100 });
  try {
    assertEquals(await shouldUseClaudePrimary('student-1'), false);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

// ─── Boundary cases: rollout_percentage = 0 and 100 ──────────────────────────

Deno.test('shouldUseClaudePrimary: rollout_percentage=0, is_enabled=true → false for every caller (boundary)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow({ is_enabled: true, rollout_percentage: 0 });
  try {
    for (let i = 0; i < 25; i++) {
      assertEquals(await shouldUseClaudePrimary(`student-${i}`), false);
    }
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: rollout_percentage=100, is_enabled=true → true for every caller (boundary)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow({ is_enabled: true, rollout_percentage: 100 });
  try {
    for (let i = 0; i < 25; i++) {
      assertEquals(await shouldUseClaudePrimary(`student-${i}`), true);
    }
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

Deno.test('shouldUseClaudePrimary: rollout_percentage out of [0,100] is clamped', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow({ is_enabled: true, rollout_percentage: 500 }); // clamps to 100
  try {
    assertEquals(await shouldUseClaudePrimary('any-student'), true);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
  __resetModelRolloutCacheForTests();
  setEnv();
  stubRow({ is_enabled: true, rollout_percentage: -10 }); // clamps to 0
  try {
    assertEquals(await shouldUseClaudePrimary('any-student'), false);
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

// ─── Mid-ramp: exact bucket boundary respected ───────────────────────────────

Deno.test('shouldUseClaudePrimary: mid-ramp respects bucket < rollout_percentage exactly', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  const PCT = 30;
  stubRow({ is_enabled: true, rollout_percentage: PCT });
  try {
    let inBucket = 0;
    let outOfBucket = 0;
    for (let i = 0; i < 200; i++) {
      const id = `student-${i}`;
      const bucket = hashForRollout(id, MODEL_ROLLOUT_FLAG_NAME);
      const expected = bucket < PCT;
      const actual = await shouldUseClaudePrimary(id);
      assertEquals(actual, expected, `student-${i}: bucket=${bucket} pct=${PCT}`);
      if (actual) inBucket++;
      else outOfBucket++;
    }
    // Non-vacuous: with pct=30 over 200 samples we expect BOTH groups
    // populated (not everyone landing on one side of the boundary).
    assert(inBucket > 0, 'expected at least one student rolled back to Claude-primary');
    assert(outOfBucket > 0, 'expected at least one student to stay on OpenAI-primary');
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});

// ─── Caching: repeated calls within TTL reuse the cached row (no re-fetch) ───

Deno.test('shouldUseClaudePrimary: caches the row across calls (fetch invoked once)', async () => {
  __resetModelRolloutCacheForTests();
  setEnv();
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(
      new Response(JSON.stringify([{ is_enabled: true, rollout_percentage: 100 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  try {
    await shouldUseClaudePrimary('student-a');
    await shouldUseClaudePrimary('student-b');
    await shouldUseClaudePrimary('student-c');
    assertEquals(fetchCalls, 1, 'expected the 5-minute in-process cache to serve calls 2 and 3');
  } finally {
    restoreFetch();
    clearEnv();
    __resetModelRolloutCacheForTests();
  }
});
