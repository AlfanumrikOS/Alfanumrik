/**
 * Shared Redis client + idempotency helpers.
 *
 * Uses Upstash Redis (REST-based, Edge-compatible).
 * All idempotency functions degrade gracefully when Redis is unavailable:
 * they return `true` (allow the operation) so the system never blocks
 * on a Redis outage.
 *
 * Key schema: see docs/redis-key-schema.md
 */

import { Redis } from '@upstash/redis';

// Singleton Redis client — reuses the same instance across requests
let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Redis not configured — degrade gracefully
  redis = new Redis({ url, token });
  return redis;
}

/**
 * Idempotency guard using Redis SET NX (set-if-not-exists).
 *
 * Returns true if THIS call acquired the lock (proceed with operation).
 * Returns false if another call already holds the lock (skip/return cached result).
 * Returns true if Redis is unavailable (safe default — allow operation).
 *
 * @param key — unique idempotency key (e.g., "webhook:payment:{id}")
 * @param ttlSeconds — how long the lock lives
 */
export async function acquireIdempotencyLock(key: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return true; // Redis unavailable — allow operation (safe default)

  try {
    // SET key "1" NX EX ttl — returns "OK" if set, null if already exists
    const result = await r.set(key, '1', { nx: true, ex: ttlSeconds });
    return result === 'OK';
  } catch {
    return true; // Redis error — allow operation (safe default)
  }
}

/**
 * Release an idempotency lock early (e.g., if the operation failed and should be retried).
 */
export async function releaseIdempotencyLock(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    // Best-effort — failing to release just means the TTL will expire naturally
  }
}