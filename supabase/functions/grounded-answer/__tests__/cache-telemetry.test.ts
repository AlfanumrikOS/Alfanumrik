// supabase/functions/grounded-answer/__tests__/cache-telemetry.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// P13 pins for cache-telemetry.ts (response-cache v2 design item 8).
// The cache metric emitter is the ONLY structured logging surface the v2
// cache tiers add, so this file pins its whitelist:
//   - Exactly four metric names (all cache_l2_*/cache_l3_* enums).
//   - The emitted dimensions object carries ONLY the whitelisted keys
//     (caller / grade / subject / optional tokens_avoided) — any extra
//     property smuggled onto the dims object is DROPPED, so a future
//     caller cannot accidentally leak a student identifier or answer text
//     through this channel.
//   - The serialized emission never matches the P13 sentinel regex
//     /name|email|phone|message|answer/i.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { logCacheMetric, type CacheMetric, type CacheMetricDims } from '../cache-telemetry.ts';

function captureWarn(run: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    run();
  } finally {
    console.warn = original;
  }
  return calls;
}

Deno.test('logCacheMetric emits ONLY whitelisted dimension keys — smuggled extras are dropped (P13)', () => {
  const dirtyDims = {
    caller: 'foxy',
    grade: '10',
    subject: 'science',
    tokens_avoided: 42,
    // Deliberately smuggled — none of these may ever surface.
    student_name: 'Asha K',
    email: 'asha@example.com',
    phone: '+91-9999999999',
    message: 'raw student turn text',
    answer: 'cached answer text',
  } as unknown as CacheMetricDims;

  const calls = captureWarn(() => logCacheMetric('cache_l2_hit', dirtyDims));
  assertEquals(calls.length, 1);
  const [metric, dims] = calls[0] as [string, Record<string, unknown>];
  assertEquals(metric, 'cache_l2_hit');
  assertEquals(Object.keys(dims).sort(), ['caller', 'grade', 'subject', 'tokens_avoided']);
  assertEquals(dims.tokens_avoided, 42);

  const serialized = JSON.stringify(calls[0]);
  assert(
    !/name|email|phone|message|answer/i.test(serialized),
    `cache telemetry emission matched the P13 sentinel regex: ${serialized}`,
  );
  assert(!serialized.includes('Asha'), 'smuggled PII value leaked through cache telemetry');
});

Deno.test('logCacheMetric omits tokens_avoided when absent (miss-shaped emission stays minimal)', () => {
  const calls = captureWarn(() =>
    logCacheMetric('cache_l2_miss', { caller: 'ncert-solver', grade: '8', subject: 'math' }),
  );
  assertEquals(calls.length, 1);
  const [metric, dims] = calls[0] as [string, Record<string, unknown>];
  assertEquals(metric, 'cache_l2_miss');
  assertEquals(Object.keys(dims).sort(), ['caller', 'grade', 'subject']);
});

Deno.test('every CacheMetric name is a cache_l2_*/cache_l3_* enum and itself PII-regex-clean', () => {
  const metrics: CacheMetric[] = ['cache_l2_hit', 'cache_l2_miss', 'cache_l2_shadow_hit', 'cache_l3_hit'];
  for (const m of metrics) {
    assert(/^cache_l[23]_(hit|miss|shadow_hit)$/.test(m), `unexpected metric name shape: ${m}`);
    assert(!/name|email|phone|message|answer/i.test(m));
    const calls = captureWarn(() => logCacheMetric(m, { caller: 'foxy', grade: '6', subject: 'science' }));
    assertEquals(calls.length, 1);
    assertEquals(calls[0][0], m);
  }
});
