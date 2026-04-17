/**
 * verify-question-bank — pure logic tests.
 *
 * The Edge Function's side-effectful parts (RPC calls, grounded-answer hop,
 * ops_events writes) live in `index.ts` which imports `Deno.serve` and the
 * supabase-js ESM bundle — not loadable in Vitest. The *decision logic*
 * (peak detection, throttle, batch sizing) lives in `shared.ts` which is
 * plain TS and is the part that actually needs coverage.
 *
 * We import the shared module via a relative path into the supabase/functions
 * tree. This mirrors how other test suites reach into Deno Edge Function
 * source (e.g. config-parity.test.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  decideBatchSize,
  isPeakHourIST,
  shouldThrottle,
  BATCH_SIZE_OFF_PEAK,
  BATCH_SIZE_PEAK,
  THROTTLE_RPM_THRESHOLD,
  DEFAULT_CLAIM_TTL_SECONDS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  IST_PEAK_START_HOUR,
  IST_PEAK_END_HOUR,
} from '../../supabase/functions/verify-question-bank/shared';

describe('verify-question-bank / isPeakHourIST', () => {
  // IST = UTC + 5:30.  Peak = 14:00–22:00 IST  ⇔  08:30–16:30 UTC.

  it('returns true at 14:00 IST (08:30 UTC)', () => {
    const now = new Date(Date.UTC(2026, 3, 17, 8, 30, 0));
    expect(isPeakHourIST(now)).toBe(true);
  });

  it('returns true at 20:00 IST (14:30 UTC) — mid-peak', () => {
    const now = new Date(Date.UTC(2026, 3, 17, 14, 30, 0));
    expect(isPeakHourIST(now)).toBe(true);
  });

  it('returns false at 22:00 IST (16:30 UTC) — upper bound exclusive', () => {
    const now = new Date(Date.UTC(2026, 3, 17, 16, 30, 0));
    expect(isPeakHourIST(now)).toBe(false);
  });

  it('returns false at 13:59 IST (08:29 UTC)', () => {
    const now = new Date(Date.UTC(2026, 3, 17, 8, 29, 0));
    expect(isPeakHourIST(now)).toBe(false);
  });

  it('returns false at 03:00 IST (21:30 UTC previous day)', () => {
    const now = new Date(Date.UTC(2026, 3, 16, 21, 30, 0));
    expect(isPeakHourIST(now)).toBe(false);
  });

  it('handles DST edge: IST has no DST so 00:00 UTC = 05:30 IST (off-peak)', () => {
    const now = new Date(Date.UTC(2026, 3, 17, 0, 0, 0));
    expect(isPeakHourIST(now)).toBe(false);
  });
});

describe('verify-question-bank / shouldThrottle', () => {
  it('throttles when rpm strictly greater than threshold', () => {
    expect(shouldThrottle(THROTTLE_RPM_THRESHOLD + 1)).toBe(true);
  });

  it('does not throttle when rpm equals threshold', () => {
    expect(shouldThrottle(THROTTLE_RPM_THRESHOLD)).toBe(false);
  });

  it('does not throttle when rpm is well below threshold', () => {
    expect(shouldThrottle(100)).toBe(false);
  });

  it('does not throttle on unknown rpm (-1)', () => {
    // -1 == "we could not read grounded_ai_traces"; stay productive.
    expect(shouldThrottle(-1)).toBe(false);
  });

  it('accepts custom threshold', () => {
    expect(shouldThrottle(50, 40)).toBe(true);
    expect(shouldThrottle(50, 60)).toBe(false);
  });
});

describe('verify-question-bank / decideBatchSize', () => {
  it('peak hour + low RPM → 250', () => {
    expect(decideBatchSize({ peak: true, throttled: false })).toBe(BATCH_SIZE_PEAK);
    expect(decideBatchSize({ peak: true, throttled: false })).toBe(250);
  });

  it('off-peak + low RPM → 1000', () => {
    expect(decideBatchSize({ peak: false, throttled: false })).toBe(BATCH_SIZE_OFF_PEAK);
    expect(decideBatchSize({ peak: false, throttled: false })).toBe(1000);
  });

  it('peak + high RPM (throttled) → 125 (halved)', () => {
    expect(decideBatchSize({ peak: true, throttled: true })).toBe(125);
  });

  it('off-peak + high RPM (throttled) → 500 (halved)', () => {
    expect(decideBatchSize({ peak: false, throttled: true })).toBe(500);
  });
});

describe('verify-question-bank / constants sanity', () => {
  it('batch sizes are positive integers', () => {
    expect(BATCH_SIZE_PEAK).toBeGreaterThan(0);
    expect(BATCH_SIZE_OFF_PEAK).toBeGreaterThan(0);
    expect(Number.isInteger(BATCH_SIZE_PEAK)).toBe(true);
    expect(Number.isInteger(BATCH_SIZE_OFF_PEAK)).toBe(true);
  });

  it('off-peak batch > peak batch (more headroom off-peak)', () => {
    expect(BATCH_SIZE_OFF_PEAK).toBeGreaterThan(BATCH_SIZE_PEAK);
  });

  it('peak window is 8 hours (14:00–22:00 IST)', () => {
    expect(IST_PEAK_END_HOUR - IST_PEAK_START_HOUR).toBe(8);
  });

  it('claim TTL is long enough for a 1000-row batch (≥5 min)', () => {
    expect(DEFAULT_CLAIM_TTL_SECONDS).toBeGreaterThanOrEqual(300);
  });

  it('retry delays cover 4 attempts, exponential-ish', () => {
    expect(RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) {
      expect(RETRY_DELAYS_MS[i]).toBeGreaterThan(RETRY_DELAYS_MS[i - 1]);
    }
  });

  it('MAX_RETRIES matches the retry delays table length', () => {
    expect(MAX_RETRIES).toBe(RETRY_DELAYS_MS.length - 1);
  });

  it('throttle threshold is below Claude Haiku account RPM limit', () => {
    // Anthropic tier 3 Haiku = 4000 RPM.  We throttle at 2400 (60% headroom).
    expect(THROTTLE_RPM_THRESHOLD).toBeLessThan(4000);
    expect(THROTTLE_RPM_THRESHOLD).toBeGreaterThan(1000);
  });
});

describe('verify-question-bank / claim TTL re-claim semantics (documentation)', () => {
  // This block doesn't execute against the RPC — that's an integration concern.
  // It asserts the logical invariant we rely on in the Edge Function: a row
  // can be re-claimed iff its previous claim expiry is in the past. We verify
  // the *constant choice* supports the Edge Function's 40s max-backoff flow.
  it('TTL > total retry wall-time so a single worker never loses its own claim', () => {
    const totalRetryMs = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    const ttlMs = DEFAULT_CLAIM_TTL_SECONDS * 1000;
    expect(ttlMs).toBeGreaterThan(totalRetryMs);
  });
});