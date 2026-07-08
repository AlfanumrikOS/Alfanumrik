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
let redisLimiter: Ratelimit | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    redisLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, '1 m'),
      prefix: 'rl:apikey',
    });
  }
} catch {
  redisLimiter = null;
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
  if (redisLimiter) {
    try {
      const result = await redisLimiter.limit(keyId);
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
