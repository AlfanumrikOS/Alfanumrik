// supabase/functions/verify-question-bank/shared.ts
//
// Pure logic module — no Deno-only imports. Imported by index.ts (Deno) and
// by src/__tests__/verify-question-bank-logic.test.ts (Vitest).
//
// Kept as a separate file because the rest of index.ts pulls in
// `Deno.serve` / `createClient` / service URLs that Vitest cannot load
// without heavy mocking. The decision logic (peak detection, throttle, batch
// sizing) is the part that actually needs unit-level coverage.

// ─── Constants ───────────────────────────────────────────────────────────────

/** Peak window in IST: 14:00–22:00. */
export const IST_PEAK_START_HOUR = 14;
export const IST_PEAK_END_HOUR = 22;

/** Batch sizes (spec §8.3). Off-peak higher because Claude RPM headroom is wider. */
export const BATCH_SIZE_OFF_PEAK = 1000;
export const BATCH_SIZE_PEAK = 250;

/** If grounded_ai_traces inserts/min exceed this in the last minute, halve the batch. */
export const THROTTLE_RPM_THRESHOLD = 2400;

/** Claim TTL: 10 minutes. Long enough for 1000-row batch, short enough that a
 *  crashed worker's claims get re-claimed on the next run. */
export const DEFAULT_CLAIM_TTL_SECONDS = 600;

/** Exponential backoff on upstream_error: 5, 10, 20, 40 seconds. */
export const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000] as const;
export const MAX_RETRIES = RETRY_DELAYS_MS.length - 1;

// ─── Pure decision helpers ──────────────────────────────────────────────────

/**
 * Return true if the instant `now` falls inside 14:00–22:00 Asia/Kolkata.
 * IST = UTC+5:30 with no DST. We compute the IST hour from the UTC date
 * directly so tests can inject any Date without relying on the host TZ.
 */
export function isPeakHourIST(now: Date): boolean {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // IST offset +5:30 = +330 min
  const istTotalMinutes = (utcMinutes + 330) % (24 * 60);
  const istHour = Math.floor(istTotalMinutes / 60);
  return istHour >= IST_PEAK_START_HOUR && istHour < IST_PEAK_END_HOUR;
}

/**
 * Return true if the observed last-minute RPM exceeds the threshold.
 * -1 (unknown) is treated as "don't throttle" so the worker stays productive
 * when the traces query fails.
 */
export function shouldThrottle(rpm: number, threshold: number = THROTTLE_RPM_THRESHOLD): boolean {
  if (rpm < 0) return false;
  return rpm > threshold;
}

/**
 * Pick the batch size for this run.
 *   - peak + throttled  → 125  (halved peak)
 *   - peak              → 250
 *   - off-peak + throttled → 500 (halved off-peak)
 *   - off-peak          → 1000
 */
export function decideBatchSize(input: { peak: boolean; throttled: boolean }): number {
  const base = input.peak ? BATCH_SIZE_PEAK : BATCH_SIZE_OFF_PEAK;
  return input.throttled ? Math.floor(base / 2) : base;
}