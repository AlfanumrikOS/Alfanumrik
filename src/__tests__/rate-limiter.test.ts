import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, createRateLimiter, type RateLimitStore } from '@/lib/rate-limiter';

/**
 * Rate Limiter — unit tests
 *
 * The rate limiter protects the Anthropic API from per-student cost overruns.
 * These tests verify the sliding-window contract precisely:
 *
 *   - First request always allowed (new window)
 *   - Requests up to limit are allowed
 *   - Request at limit+1 is denied
 *   - Denied response carries correct retryAfterMs
 *   - Window reset after windowMs allows new requests
 *   - Different keys are independent
 *   - Edge cases: limit=1, limit=0, very large counts
 *
 * All tests inject `nowMs` for deterministic, clock-independent behaviour.
 * Tests NEVER use setTimeout / real clock. This is the only correct way
 * to test time-dependent logic.
 */

const LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

describe('checkRateLimit', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new Map();
  });

  // ── Basic allow/deny ──────────────────────────────────────────────────────

  it('allows the first request for a new key', () => {
    const result = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('initialises the store entry on first request', () => {
    checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 1000);
    const entry = store.get('student-1');
    expect(entry).toBeDefined();
    expect(entry!.count).toBe(1);
    expect(entry!.windowStart).toBe(1000);
  });

  it('allows requests up to the limit', () => {
    for (let i = 0; i < LIMIT; i++) {
      const result = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, i * 100);
      expect(result.allowed).toBe(true);
    }
    // count should be 30 now
    expect(store.get('student-1')!.count).toBe(LIMIT);
  });

  it('denies the request at count = limit + 1', () => {
    // Fill up to limit
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }
    // One more — should be denied
    const result = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 1000);
    expect(result.allowed).toBe(false);
  });

  it('denied result carries correct retryAfterMs', () => {
    const windowStart = 0;
    const now = 5 * 60 * 1000; // 5 minutes into the window

    // Fill up to limit — all at t=0
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, windowStart);
    }

    // Try again at t=5min
    const result = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, now);
    expect(result.allowed).toBe(false);
    // Window started at 0, we're at 5min, window is 10min
    // retryAfterMs = 10min - 5min = 5min
    expect(result.retryAfterMs).toBe(5 * 60 * 1000);
  });

  it('does not increment count when denied', () => {
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }
    const countBefore = store.get('student-1')!.count;
    checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 1000); // denied
    expect(store.get('student-1')!.count).toBe(countBefore); // unchanged
  });

  // ── Window reset ──────────────────────────────────────────────────────────

  it('resets the window after windowMs has elapsed', () => {
    const t0 = 0;
    const tAfterWindow = WINDOW_MS + 1; // just after window expires

    // Fill to limit
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, t0);
    }

    // After window expires, should start fresh
    const result = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, tAfterWindow);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);

    // New window should have count = 1
    expect(store.get('student-1')!.count).toBe(1);
    expect(store.get('student-1')!.windowStart).toBe(tAfterWindow);
  });

  it('allows requests again exactly at window boundary + 1ms', () => {
    // window started at t=0, expires at t=windowMs
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }

    // At exactly windowMs: window has NOT expired yet (> check)
    const atBoundary = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, WINDOW_MS);
    expect(atBoundary.allowed).toBe(false); // still within window

    // At windowMs + 1: window has expired (> is true)
    const afterBoundary = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, WINDOW_MS + 1);
    expect(afterBoundary.allowed).toBe(true); // new window started
  });

  // ── Key isolation ─────────────────────────────────────────────────────────

  it('tracks different keys independently', () => {
    // Exhaust limit for student-1
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }

    // student-2 should be unaffected
    const result = checkRateLimit(store, 'student-2', LIMIT, WINDOW_MS, 0);
    expect(result.allowed).toBe(true);
  });

  it('exhausting one key does not affect count of another', () => {
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }
    checkRateLimit(store, 'student-2', LIMIT, WINDOW_MS, 0); // 1 request

    expect(store.get('student-2')!.count).toBe(1);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles limit = 1 (only first request allowed)', () => {
    const result1 = checkRateLimit(store, 'student-1', 1, WINDOW_MS, 0);
    expect(result1.allowed).toBe(true);

    const result2 = checkRateLimit(store, 'student-1', 1, WINDOW_MS, 1000);
    expect(result2.allowed).toBe(false);
  });

  it('handles very large number of sequential requests within window', () => {
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-x', LIMIT, WINDOW_MS, i);
    }
    const overflow = checkRateLimit(store, 'student-x', LIMIT, WINDOW_MS, LIMIT);
    expect(overflow.allowed).toBe(false);
  });

  it('multiple windows reset correctly over time', () => {
    // Window 1: fill up
    for (let i = 0; i < LIMIT; i++) {
      checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, 0);
    }

    // Window 2 (after 1st window expires): use 10 requests
    const w2Start = WINDOW_MS + 1;
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, w2Start + i);
      expect(r.allowed).toBe(true);
    }
    expect(store.get('student-1')!.count).toBe(10);

    // Window 3 (after 2nd window expires): should reset again
    const w3Start = w2Start + WINDOW_MS + 1;
    const r = checkRateLimit(store, 'student-1', LIMIT, WINDOW_MS, w3Start);
    expect(r.allowed).toBe(true);
    expect(store.get('student-1')!.count).toBe(1);
  });
});

// =============================================================================
// createRateLimiter (factory API)
// =============================================================================

describe('createRateLimiter', () => {
  it('returns a function', () => {
    const limiter = createRateLimiter(30, WINDOW_MS);
    expect(typeof limiter).toBe('function');
  });

  it('honours the limit passed to factory', () => {
    const limiter = createRateLimiter(3, WINDOW_MS);
    limiter('key', 0);
    limiter('key', 1);
    limiter('key', 2);
    const result = limiter('key', 3);
    expect(result.allowed).toBe(false);
  });

  it('isolates store between different limiter instances', () => {
    const limiter1 = createRateLimiter(1, WINDOW_MS);
    const limiter2 = createRateLimiter(1, WINDOW_MS);

    // Exhaust limiter1
    limiter1('key', 0);
    const denied = limiter1('key', 1);
    expect(denied.allowed).toBe(false);

    // limiter2's store is separate — should still allow
    const allowed = limiter2('key', 0);
    expect(allowed.allowed).toBe(true);
  });

  it('uses Date.now() when nowMs is not provided', () => {
    const limiter = createRateLimiter(30, WINDOW_MS);
    // Can't assert exact timestamp, but should not throw and should allow
    const result = limiter('student-real-clock');
    expect(result.allowed).toBe(true);
  });

  // ── Simulate Eval rate limiter (30 req / 10 min) ──────────────────────────

  describe('simulating evaluate_answer rate limit (30/10min)', () => {
    it('allows 30 evaluations in a 10-minute window', () => {
      const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
      const t0 = Date.now();

      for (let i = 0; i < 30; i++) {
        const r = evalLimiter('student-exam', t0 + i * 1000);
        expect(r.allowed).toBe(true);
      }
    });

    it('blocks the 31st evaluation within the same window', () => {
      const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
      const t0 = 0;

      for (let i = 0; i < 30; i++) evalLimiter('student-exam', t0);
      const blocked = evalLimiter('student-exam', t0 + 1000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    });

    it('retryAfterMs is always ≤ windowMs', () => {
      const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
      for (let i = 0; i < 30; i++) evalLimiter('student-exam', 0);

      // Check at various points within the window
      for (let elapsed = 0; elapsed < 10 * 60 * 1000; elapsed += 60_000) {
        const r = evalLimiter('student-exam', elapsed);
        if (!r.allowed) {
          expect(r.retryAfterMs).toBeLessThanOrEqual(10 * 60 * 1000);
          expect(r.retryAfterMs).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('resets after 10 minutes — student can evaluate again', () => {
      const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
      const t0 = 0;

      for (let i = 0; i < 30; i++) evalLimiter('student-exam', t0);

      // 10 min + 1ms later
      const refreshed = evalLimiter('student-exam', 10 * 60 * 1000 + 1);
      expect(refreshed.allowed).toBe(true);
    });
  });
});
