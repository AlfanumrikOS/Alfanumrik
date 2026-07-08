/**
 * In-memory sliding-window rate limiter.
 *
 * Designed for Edge Function / serverless contexts where a lightweight,
 * per-instance counter is acceptable. At scale (multi-instance), replace
 * the Map with Upstash Redis via the same interface.
 *
 * NOTE: This module is intentionally dependency-free so it can be imported
 * both from Next.js API routes (Node) and from Supabase Edge Functions (Deno).
 */

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export type RateLimitStore = Map<string, RateLimitEntry>;

/**
 * Check and update a sliding-window rate limit counter.
 *
 * @param store    - The Map used as the in-memory store (caller owns it)
 * @param key      - The limiter key (e.g. student_id)
 * @param limit    - Max requests per window
 * @param windowMs - Window duration in milliseconds
 * @param nowMs    - Current timestamp (injectable for testing)
 */
export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now()
): RateLimitResult {
  const entry = store.get(key);

  // No entry, or window has expired → start fresh window
  if (!entry || nowMs - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: nowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  // Over limit
  if (entry.count >= limit) {
    const retryAfterMs = windowMs - (nowMs - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  // Within limit — increment
  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Factory: create a rate limiter pre-bound to a specific store, limit, and window.
 *
 * Usage:
 *   const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
 *   const result = evalLimiter(studentId);
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const store: RateLimitStore = new Map();

  return function check(key: string, nowMs?: number): RateLimitResult {
    return checkRateLimit(store, key, limit, windowMs, nowMs);
  };
}
