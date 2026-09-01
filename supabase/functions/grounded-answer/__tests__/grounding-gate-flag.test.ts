// supabase/functions/grounded-answer/__tests__/grounding-gate-flag.test.ts
//
// Pins the decision logic for the strict-mode grounding-check confidence gate
// (_grounding-gate-flag.ts). The gate skips a P12 safety rail to save money,
// so every ambiguous input must resolve toward RUNNING the check.

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  shouldSkipGroundingCheck,
  groundingGateMinCosine,
} from '../_grounding-gate-flag.ts';

Deno.test('gate disabled → never skips, however high the similarity', () => {
  assertEquals(shouldSkipGroundingCheck(false, 0.99, 0.75), false);
  assertEquals(shouldSkipGroundingCheck(false, 1, 0.75), false);
});

Deno.test('gate enabled → skips only at or above the threshold', () => {
  assertEquals(shouldSkipGroundingCheck(true, 0.80, 0.75), true);
  assertEquals(shouldSkipGroundingCheck(true, 0.75, 0.75), true, 'boundary is inclusive');
  assertEquals(shouldSkipGroundingCheck(true, 0.7499, 0.75), false);
  assertEquals(shouldSkipGroundingCheck(true, 0.10, 0.75), false);
});

// The case that matters most: a retrieval path that never stamped the signal.
// "We don't know how similar the chunks were" must mean "run the check", not
// "assume it's fine" — otherwise a telemetry gap silently disables the rail.
Deno.test('missing or non-numeric similarity → runs the check', () => {
  assertEquals(shouldSkipGroundingCheck(true, null, 0.75), false);
  assertEquals(shouldSkipGroundingCheck(true, undefined, 0.75), false);
  assertEquals(shouldSkipGroundingCheck(true, NaN, 0.75), false);
  assertEquals(shouldSkipGroundingCheck(true, Infinity, 0.75), false);
});

Deno.test('threshold default is 0.75 when the env var is absent', () => {
  Deno.env.delete('GROUNDING_GATE_MIN_COSINE');
  assertEquals(groundingGateMinCosine(), 0.75);
});

Deno.test('threshold honours a valid env override', () => {
  Deno.env.set('GROUNDING_GATE_MIN_COSINE', '0.9');
  assertEquals(groundingGateMinCosine(), 0.9);
  Deno.env.delete('GROUNDING_GATE_MIN_COSINE');
});

// A malformed override must not silently widen the skip window. Falling back
// to the conservative default is the only safe reading of "0", "abc" or "5".
Deno.test('malformed or out-of-range threshold falls back to the default', () => {
  for (const bad of ['abc', '0', '-1', '5', '']) {
    Deno.env.set('GROUNDING_GATE_MIN_COSINE', bad);
    assertEquals(groundingGateMinCosine(), 0.75, `input ${JSON.stringify(bad)}`);
  }
  Deno.env.delete('GROUNDING_GATE_MIN_COSINE');
});
