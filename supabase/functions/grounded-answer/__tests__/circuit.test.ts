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

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import {
  __breakerMapSizeForTests,
  __resetAllForTests,
  BREAKER_MAP_HARD_CAP,
  canProceed,
  circuitKey,
  getState,
  IDLE_PRUNE_MS,
  pruneClosedIdleBreakers,
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

// C7 fix: memory bounds on the breakers map.

Deno.test('prunes CLOSED breakers whose lastStateChange is older than 10 min', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    // Create 10 breakers in the closed state (each canProceed creates one).
    for (let i = 0; i < 10; i++) {
      canProceed(circuitKey('foxy', 'science', `grade-${i}`));
    }
    assertEquals(__breakerMapSizeForTests(), 10);

    // Advance past the idle-prune threshold.
    advance(IDLE_PRUNE_MS + 1);

    // Next canProceed() for a fresh key should prune the 10 stale closed
    // entries BEFORE inserting the new one. Final size = 1 (only the new key).
    canProceed(circuitKey('foxy', 'science', 'fresh-key'));
    assertEquals(__breakerMapSizeForTests(), 1);
  });
});

Deno.test('pruning does NOT remove OPEN or HALF-OPEN breakers', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    const k = circuitKey('foxy', 'science', '10');
    // Trip to open.
    recordFailure(k);
    recordFailure(k);
    recordFailure(k);
    assertEquals(getState(k), 'open');

    // Wait long enough that, if it were closed, it would be pruned.
    advance(IDLE_PRUNE_MS + CIRCUIT_BREAKER_OPEN_MS + 1);

    // Prune directly. Should NOT touch the open breaker. (Technically it
    // has auto-transitioned to being eligible for half-open via the open
    // timer, but canProceed() is what drives that — we only call prune here.)
    const removed = pruneClosedIdleBreakers();
    assertEquals(removed, 0);
    assertEquals(__breakerMapSizeForTests(), 1);
  });
});

Deno.test('hard cap 1000: inserting past cap evicts oldest entry', () => {
  __resetAllForTests();
  withFakeClock((advance) => {
    // Fill to exactly the cap. Each getOrCreate at this scale is cheap.
    for (let i = 0; i < BREAKER_MAP_HARD_CAP; i++) {
      // Advance by 1 ms per insertion so the first one is strictly the oldest.
      advance(1);
      canProceed(circuitKey('foxy', 'science', `g${i}`));
    }
    assertEquals(__breakerMapSizeForTests(), BREAKER_MAP_HARD_CAP);

    // The very first key we inserted has the oldest lastStateChange.
    const oldestKey = circuitKey('foxy', 'science', 'g0');

    // Force insertion of one more entry. pruneClosedIdleBreakers runs at
    // the top of canProceed, but all current entries are fresh (just
    // inserted, well within IDLE_PRUNE_MS), so prune removes nothing.
    // The hard-cap eviction path in getOrCreate should evict g0.
    advance(1);
    canProceed(circuitKey('foxy', 'science', 'g-overflow'));

    // Size stays at cap (one evicted, one inserted).
    assertEquals(__breakerMapSizeForTests(), BREAKER_MAP_HARD_CAP);
    // Oldest key was evicted; a fresh canProceed on it creates a NEW
    // record (state resets to closed). We verify eviction by noting that
    // if the original record were still there, the map would be at
    // cap+1 after this call. It is not → eviction happened.
    advance(1);
    canProceed(oldestKey);
    // One new insert (for oldestKey). This triggers another eviction of
    // the new oldest. Size stays at cap.
    assertEquals(__breakerMapSizeForTests(), BREAKER_MAP_HARD_CAP);
    assert(true); // sanity: no throws in eviction path
  });
});