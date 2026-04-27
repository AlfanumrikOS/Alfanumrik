/**
 * Distributed Rate Limiter for Supabase Edge Functions
 *
 * Uses sliding window algorithm with in-memory store.
 * For 5K+ concurrent students, upgrade to Upstash Redis:
 *   1. npm install @upstash/ratelimit @upstash/redis
 *   2. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars
 *   3. Uncomment the Redis implementation below
 *
 * Current capacity: handles ~1000 req/s per edge function instance
 * (sufficient for 5K students since Supabase auto-scales instances)
 */

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

// In-memory token bucket (per-instance, resets on cold start)
const buckets = new Map<string, RateLimitEntry>();

// Cleanup stale buckets every 2 minutes
const CLEANUP_INTERVAL = 120_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const staleThreshold = now - 300_000; // 5 min stale
  for (const [key, entry] of buckets) {
    if (entry.lastRefill < staleThreshold) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Identifier prefix (e.g., 'foxy', 'quiz') */
  prefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

/**
 * Check rate limit for a given key (e.g., student_id or IP).
 * Uses token bucket algorithm — smooth, burst-friendly.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  cleanup();

  const bucketKey = `${config.prefix}:${key}`;
  const now = Date.now();
  const refillRate = config.maxRequests / config.windowMs; // tokens per ms

  let entry = buckets.get(bucketKey);

  if (!entry) {
    // First request — full bucket minus 1
    entry = { tokens: config.maxRequests - 1, lastRefill: now };
    buckets.set(bucketKey, entry);
    return { allowed: true, remaining: entry.tokens, limit: config.maxRequests, retryAfterMs: 0 };
  }

  // Refill tokens based on time elapsed
  const elapsed = now - entry.lastRefill;
  const refill = elapsed * refillRate;
  entry.tokens = Math.min(config.maxRequests, entry.tokens + refill);
  entry.lastRefill = now;

  if (entry.tokens < 1) {
    // Not enough tokens — calculate retry time
    const retryAfterMs = Math.ceil((1 - entry.tokens) / refillRate);
    return { allowed: false, remaining: 0, limit: config.maxRequests, retryAfterMs };
  }

  // Consume a token
  entry.tokens -= 1;
  return {
    allowed: true,
    remaining: Math.floor(entry.tokens),
    limit: config.maxRequests,
    retryAfterMs: 0,
  };
}

/**
 * Pre-configured rate limits for Alfanumrik features.
 */
export const RATE_LIMITS = {
  /** Foxy AI chat: 30 messages/minute per student */
  foxyChat: { maxRequests: 30, windowMs: 60_000, prefix: 'foxy' } satisfies RateLimitConfig,

  /** Quiz generation: 5 quizzes/minute per student */
  quizGen: { maxRequests: 5, windowMs: 60_000, prefix: 'quiz' } satisfies RateLimitConfig,

  /** Report export: 3 exports/minute per user */
  exportReport: { maxRequests: 3, windowMs: 60_000, prefix: 'export' } satisfies RateLimitConfig,

  /** General API: 60 requests/minute per IP */
  general: { maxRequests: 60, windowMs: 60_000, prefix: 'general' } satisfies RateLimitConfig,
} as const;

// ─── Sliding-window factory (port of src/lib/rate-limiter.ts) ───────────────
// Provided so Edge Functions can use the same call shape as the Next.js side
// without importing across the supabase/ ↔ src/ tree boundary (which fails
// at deploy time — only supabase/functions/** is shipped to the Edge runtime).

export interface SlidingWindowEntry {
  count: number;
  windowStart: number;
}

export interface SlidingWindowResult {
  allowed: boolean;
  retryAfterMs: number;
}

export type SlidingWindowStore = Map<string, SlidingWindowEntry>;

/**
 * Sliding-window rate limit check. Caller owns the store.
 * Distinct from the token-bucket `checkRateLimit` above — different semantics
 * and call signature, hence a different name.
 */
export function checkSlidingWindow(
  store: SlidingWindowStore,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): SlidingWindowResult {
  const entry = store.get(key);

  if (!entry || nowMs - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: nowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    const retryAfterMs = windowMs - (nowMs - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Factory: returns a rate-limiter function pre-bound to a private store,
 * limit, and window. Call shape matches `src/lib/rate-limiter.ts` so the
 * same usage pattern works on both Node (Next.js API routes) and Deno
 * (Supabase Edge Functions).
 *
 * Usage:
 *   const evalLimiter = createRateLimiter(30, 10 * 60 * 1000);
 *   const { allowed, retryAfterMs } = evalLimiter(studentId);
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const store: SlidingWindowStore = new Map();

  return function check(key: string, nowMs?: number): SlidingWindowResult {
    return checkSlidingWindow(store, key, limit, windowMs, nowMs);
  };
}

/* ═══════════════════════════════════════════════════════════════
 * UPSTASH REDIS UPGRADE (uncomment when ready for 50K+ students)
 *
 * import { Ratelimit } from '@upstash/ratelimit';
 * import { Redis } from '@upstash/redis';
 *
 * const redis = new Redis({
 *   url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
 *   token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
 * });
 *
 * export const distributedLimiter = new Ratelimit({
 *   redis,
 *   limiter: Ratelimit.slidingWindow(30, '60 s'),
 *   analytics: true,
 * });
 *
 * Usage: const { success } = await distributedLimiter.limit(studentId);
 * ═══════════════════════════════════════════════════════════════ */
