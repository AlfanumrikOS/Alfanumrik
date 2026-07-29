/**
 * Per-API-key rate limiting for public v1 routes.
 *
 * Uses Upstash Redis when available (distributed, production).
 * Falls back to in-memory Map with TTL (dev / Redis unavailable).
 * Called AFTER API key authentication so the key is the API key ID (not IP).
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp in seconds
}

// ── Distributed limiter (Upstash Redis) ──
//
// IMPORTANT: callers pass their own (limit, windowMs) pair per call site
// (e.g. schools/trial → 5/hour, schools/claim-admin → 10/15min). A single
// fixed-window Ratelimit instance can't honor per-call limits — Upstash's
// Ratelimit binds `limit`/`window` at construction time via
// Ratelimit.slidingWindow(). So instead of one shared instance we lazily
// build and cache one Ratelimit per distinct (limit, windowMs) pair. These
// pairs come from a small, fixed set of hardcoded call-site literals (not
// user input), so the cache has bounded, low cardinality — no eviction
// needed.
let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch {
  redis = null;
}

const limiterCache = new Map<string, Ratelimit>();

function getRedisLimiter(limit: number, windowMs: number): Ratelimit | null {
  if (!redis) return null;
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      // Upstash Duration format: `${number} ms|s|m|h|d`. Using the raw ms
      // value keeps this exact to the caller's requested window instead of
      // rounding to a coarser unit.
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: 'rl:apikey',
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// ── In-memory fallback ──
const MAX_MAP_SIZE = 5_000;
const memStore = new Map<string, { count: number; resetAt: number }>();

function checkLocal(key: string, limit: number, windowMs: number): ApiRateLimitResult {
  const now = Date.now();
  const entry = memStore.get(key);
  if (!entry || now >= entry.resetAt * 1000) {
    if (memStore.size >= MAX_MAP_SIZE) {
      const firstKey = memStore.keys().next().value;
      if (firstKey) memStore.delete(firstKey);
    }
    const resetAt = Math.ceil((now + windowMs) / 1000);
    memStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Check rate limit for an API key.
 * @param keyId     - The API key record ID (from authenticateApiKey)
 * @param limit     - Max requests per window (default 100)
 * @param windowMs  - Window duration in ms (default 60_000 = 1 minute)
 */
export async function checkApiRateLimit(
  keyId: string,
  limit: number = 100,
  windowMs: number = 60_000
): Promise<ApiRateLimitResult> {
  const limiter = getRedisLimiter(limit, windowMs);
  if (limiter) {
    try {
      const result = await limiter.limit(keyId);
      return {
        allowed: result.success,
        remaining: result.remaining,
        resetAt: Math.ceil(result.reset / 1000),
      };
    } catch {
      // Redis unavailable -- fall through to in-memory
    }
  }
  return checkLocal(keyId, limit, windowMs);
}
