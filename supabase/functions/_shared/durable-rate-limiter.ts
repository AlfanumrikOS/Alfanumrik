/**
 * Durable Rate Limiter for Supabase Edge Functions (Deno)
 *
 * Cross-instance durable rate limiting via Upstash Redis, with a TRANSPARENT
 * in-memory fallback. This is the Deno-native twin of the Next.js
 * `src/lib/api-rate-limit.ts` pattern — same Upstash + in-memory-fallback
 * shape — but reads secrets via `Deno.env.get` (Node's `process.env` does not
 * exist in the Edge runtime).
 *
 * Why this exists: the per-instance in-memory limiter from `./rate-limiter.ts`
 * resets on every Edge cold start, so a brute-force attacker who lands on a
 * fresh instance gets a fresh budget. Upstash gives a single shared counter
 * across all instances, making the bound (e.g. parent_login's 5/hour) durable.
 *
 * Fallback contract (P15-safe — the limiter must NEVER fail open and NEVER
 * throw on the request path):
 *   - Upstash secrets absent          → in-memory limiter (same limit/window)
 *   - Upstash present but Redis errors → in-memory limiter (same limit/window)
 * In both degraded cases requests are still bounded by the same N/window cap.
 * The limiter never returns "unlimited" and never throws.
 *
 * The returned `check` is ASYNC (Redis round-trip) and returns the SAME result
 * shape as `createRateLimiter`'s sync check (`{ allowed, retryAfterMs }`), so
 * call sites only need to add `await`.
 */
import { Ratelimit } from 'https://esm.sh/@upstash/ratelimit@2'
import { Redis } from 'https://esm.sh/@upstash/redis@1'
import { createRateLimiter } from './rate-limiter.ts'

export interface DurableRateLimitResult {
  allowed: boolean
  retryAfterMs: number
}

/**
 * Build a durable rate limiter bound to a limit, window, and Redis key prefix.
 *
 * @param limit    Max requests allowed within the window
 * @param windowMs Window duration in milliseconds
 * @param prefix   Upstash key prefix (e.g. 'rl:parent_login')
 * @returns async `check(key)` → `{ allowed, retryAfterMs }`
 */
export function createDurableRateLimiter(
  limit: number,
  windowMs: number,
  prefix: string,
) {
  const url = Deno.env.get('UPSTASH_REDIS_REST_URL')
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')

  // In-memory fallback — SAME limit/window as the durable limiter. Used when
  // Upstash secrets are absent OR a Redis call fails. Bounds enumeration
  // through a warm instance; never fails open.
  const memCheck = createRateLimiter(limit, windowMs)

  // ── Distributed limiter (Upstash Redis), mirror of api-rate-limit.ts ──
  let redisLimiter: Ratelimit | null = null
  if (url && token) {
    try {
      redisLimiter = new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.fixedWindow(limit, `${Math.round(windowMs / 1000)} s`),
        prefix,
      })
    } catch {
      redisLimiter = null
    }
  }

  return async function check(key: string): Promise<DurableRateLimitResult> {
    if (redisLimiter) {
      try {
        const { success, reset } = await redisLimiter.limit(key)
        return {
          allowed: success,
          retryAfterMs: success ? 0 : Math.max(0, reset - Date.now()),
        }
      } catch {
        // Redis unavailable — fall through to in-memory (never fail open).
      }
    }
    return memCheck(key)
  }
}
