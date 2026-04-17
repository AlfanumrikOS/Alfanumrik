// supabase/functions/grounded-answer/__tests__/circuit.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// State machine verification for the circuit breaker (spec §6.7):
//   closed → open after 3 failures in 10s
//   open → stays open for 30s
//   open → half-open after 30s (first canProceed call advances state)
//   half-open → closed after 2 consecutive probe successes
//   half-open → open on any probe failure (resets 30s timer)

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  __resetAllForTests,
  canProceed,
  circuitKey,
  getState,
  recordFailure,
  recordSuccess,
} from '../circuit.ts';
import {
  CIRCUIT_BREAKER_OPEN_MS,
  CIRCUIT_BREAKER_WINDOW_MS,
} from '../config.ts';

// Small helper: stub Date.now so we can fast-forward time deterministically.
function withFakeClock(fn: (advance: (ms: number) => void) => void | Promise<void>) {
  const realNow = Date.now;
  let t = 1_000_000; // arbitrary starting point
  Date.now = () => t;
  const advance = (ms: number) => {
    t += ms;
  };
  try {
    return fn(advance);
  } finally {
    Date.now = realNow;
  }
}

function key() {
  return circuitKey('foxy', 'science', '10');
}

Deno.test('circuit starts closed', () => {
  __resetAllForTests();
  assertEquals(canProceed(key()), true);
  assertEquals(getState(key()), 'closed');
});

Deno.test('closed → open after 3 failures in 10s window', () => {
  __resetAllForTests();
  withFakeClock(() => {
    recordFailure(key());
    recordFailure(key());
    assertEquals(getState(key()), 'closed');
    recordFailure(key());
    assertEquals(getState(key()), 'open');
    assertEquals(canProceed(key()), false);
  });
});

Deno.test('failures outside 10s window do NOT trip', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    recordFailure(key());
    advance(CIRCUIT_BREAKER_WINDOW_MS + 1);
    recordFailure(key());
    advance(1_000);
    recordFailure(key());
    // Only 2 failures are inside any 10s window at this point
    // (the first one fell out), so breaker stays closed.
    assertEquals(getState(key()), 'closed');
  });
});

Deno.test('open stays open for 30s', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    recordFailure(key());
    recordFailure(key());
    recordFailure(key());
    assertEquals(getState(key()), 'open');

    advance(10_000);
    assertEquals(canProceed(key()), false);

    advance(CIRCUIT_BREAKER_OPEN_MS - 10_000 - 1);
    assertEquals(canProceed(key()), false);
  });
});

Deno.test('open → half-open after 30s; probe allowed', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    recordFailure(key());
    recordFailure(key());
    recordFailure(key());
    advance(CIRCUIT_BREAKER_OPEN_MS + 1);
    assertEquals(canProceed(key()), true);
    assertEquals(getState(key()), 'half-open');
  });
});

Deno.test('half-open → closed after 2 consecutive probe successes', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    recordFailure(key());
    recordFailure(key());
    recordFailure(key());
    advance(CIRCUIT_BREAKER_OPEN_MS + 1);
    canProceed(key()); // advance to half-open
    assertEquals(getState(key()), 'half-open');

    recordSuccess(key());
    assertEquals(getState(key()), 'half-open'); // need 2 successes
    recordSuccess(key());
    assertEquals(getState(key()), 'closed');
    assertEquals(canProceed(key()), true);
  });
});

Deno.test('half-open → open on probe failure (resets 30s timer)', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    recordFailure(key());
    recordFailure(key());
    recordFailure(key());
    advance(CIRCUIT_BREAKER_OPEN_MS + 1);
    canProceed(key()); // half-open
    recordFailure(key()); // probe fails
    assertEquals(getState(key()), 'open');
    assertEquals(canProceed(key()), false);

    // Needs a full fresh OPEN_MS to half-open again.
    advance(CIRCUIT_BREAKER_OPEN_MS - 1);
    assertEquals(canProceed(key()), false);
    advance(2);
    assertEquals(canProceed(key()), true);
  });
});

Deno.test('breaker is keyed per (caller, subject, grade)', () => {
  __resetAllForTests();
  withFakeClock(() => {
    const k1 = circuitKey('foxy', 'science', '10');
    const k2 = circuitKey('foxy', 'science', '11');
    recordFailure(k1);
    recordFailure(k1);
    recordFailure(k1);
    assertEquals(getState(k1), 'open');
    assertEquals(getState(k2), 'closed');
    assertEquals(canProceed(k2), true);
  });
});

Deno.test('isolated failure in closed does NOT accumulate after a success', () => {
  __resetAllForTests();
  withFakeClock(() => {
    recordFailure(key());
    recordFailure(key());
    recordSuccess(key()); // clears transient failures
    recordFailure(key());
    recordFailure(key());
    // Only 2 failures since the success; breaker stays closed.
    assertEquals(getState(key()), 'closed');
  });
});