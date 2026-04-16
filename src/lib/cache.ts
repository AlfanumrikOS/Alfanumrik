/**
 * ALFANUMRIK -- Server-Side Response Cache
 *
 * Lightweight in-memory cache for API route responses.
 * Reduces Supabase round-trips for frequently accessed data.
 *
 * For 5K students: saves ~2000 DB queries/sec on hot paths like:
 * - Curriculum topics (static, rarely changes)
 * - Leaderboard (cached 60s, same for all users)
 * - Feature flags (cached 5min)
 *
 * For 50K+: upgrade to Upstash Redis (drop-in replacement via KV API)
 *
 * Caching Strategy (current):
 * +--------------------------+--------+-------------------------------------------+
 * | Data                     | TTL    | Reason                                    |
 * +--------------------------+--------+-------------------------------------------+
 * | Curriculum structure     | 24h    | Changes only on content deploys           |
 * | Subjects/topics list     | 5min   | Semi-static, rare updates                 |
 * | Feature flags            | 5min   | Admin-toggled, eventual consistency OK     |
 * | Leaderboard              | 60s    | Shared across users, frequent reads        |
 * | Per-student usage counts | 30s    | Must reflect recent activity               |
 * +--------------------------+--------+-------------------------------------------+
 *
 * NOT cached (always fresh from DB):
 * - Quiz questions (must avoid repeat questions)
 * - Quiz submissions (write-path, atomic)
 * - Payment/subscription status (must be accurate)
 * - Auth sessions (handled by Supabase auth layer)
 * - Student profile updates (write-through)
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  hitCount: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// ── Observability counters ──
let _hits = 0;
let _misses = 0;
let _evictions = 0;

// Cleanup expired entries every 60 seconds
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  store.forEach((entry, key) => {
    if (now > entry.expiresAt) {
      store.delete(key);
      _evictions++;
    }
  });
}

/** Get a cached value, or null if expired/missing */
export function cacheGet<T>(key: string): T | null {
  cleanup();
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    _misses++;
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    _evictions++;
    _misses++;
    return null;
  }

  entry.hitCount++;
  _hits++;
  return entry.data;
}

/** Set a cached value with TTL in milliseconds */
export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    hitCount: 0,
  });
}

/** Delete a specific cache key */
export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Delete all keys matching a prefix */
export function cacheInvalidatePrefix(prefix: string): void {
  const keysToDelete: string[] = [];
  store.forEach((_entry, key) => {
    if (key.startsWith(prefix)) keysToDelete.push(key);
  });
  keysToDelete.forEach(key => store.delete(key));
}

/** Get cache stats for monitoring and health endpoint */
export function cacheStats(): {
  size: number;
  keys: string[];
  hits: number;
  misses: number;
  evictions: number;
  hit_rate: number;
} {
  cleanup();
  const total = _hits + _misses;
  return {
    size: store.size,
    keys: Array.from(store.keys()),
    hits: _hits,
    misses: _misses,
    evictions: _evictions,
    hit_rate: total > 0 ? Math.round((_hits / total) * 10000) / 10000 : 0,
  };
}

/** Convenience: get-or-fetch with automatic caching */
export async function cacheFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return cached;

  const data = await fetcher();
  cacheSet(key, data, ttlMs);
  return data;
}

// ── Pre-defined TTL constants ──
export const CACHE_TTL = {
  /** 5 minutes — for semi-static data (subjects, feature flags) */
  STATIC: 5 * 60 * 1000,
  /** 60 seconds — for frequently changing data (leaderboard) */
  SHORT: 60 * 1000,
  /** 30 seconds — for per-student data (usage counts) */
  USER: 30 * 1000,
  /** 24 hours — for truly static data (curriculum structure) */
  LONG: 24 * 60 * 60 * 1000,
  /** 10 minutes — for tenant/school configuration */
  TENANT: 10 * 60 * 1000,
} as const;

// ── Async L2 (Redis) Cache Functions ──
// These check in-memory L1 first, then fall through to Redis L2.
// Redis failures degrade gracefully — L1 still works.

import { getRedis } from '@/lib/redis';

/** L1 backfill TTL when promoting from Redis L2 (60 seconds) */
const L2_BACKFILL_TTL = 60_000;

/**
 * Async cache get — checks in-memory L1 first, then Redis L2.
 * Drop-in async replacement for cacheGet.
 */
export async function cacheGetAsync<T>(key: string): Promise<T | null> {
  // L1: in-memory (fastest)
  const local = cacheGet<T>(key);
  if (local !== null) return local;

  // L2: Redis
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get<T>(key);
      if (val !== null && val !== undefined) {
        // Backfill L1 with shorter TTL so subsequent reads are fast
        cacheSet(key, val, L2_BACKFILL_TTL);
        return val;
      }
    } catch {
      // Redis failure — treat as cache miss
    }
  }

  return null;
}

/**
 * Async cache set — writes to both in-memory L1 and Redis L2.
 */
export async function cacheSetAsync<T>(key: string, data: T, ttlMs: number): Promise<void> {
  // Always write L1
  cacheSet(key, data, ttlMs);

  // Best-effort L2 write
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(data), { ex: Math.ceil(ttlMs / 1000) });
    } catch {
      // Redis failure — L1 still has the data
    }
  }
}

/**
 * Async cache delete — removes from both in-memory L1 and Redis L2.
 */
export async function cacheDeleteAsync(key: string): Promise<void> {
  cacheDelete(key);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // Best effort — key will expire via TTL
    }
  }
}

/**
 * Async prefix invalidation — removes matching keys from both L1 and Redis L2.
 * Uses Redis SCAN to avoid blocking the server on large keyspaces.
 */
export async function cacheInvalidatePrefixAsync(prefix: string): Promise<void> {
  // Always invalidate L1
  cacheInvalidatePrefix(prefix);

  // Best-effort L2 invalidation via SCAN + DEL
  const redis = getRedis();
  if (redis) {
    try {
      let cursor: string | number = 0;
      do {
        const result: [string, string[]] = await redis.scan(cursor, {
          match: `${prefix}*`,
          count: 100,
        });
        cursor = parseInt(result[0], 10);
        const keys = result[1];
        if (keys.length > 0) {
          await Promise.all(keys.map((k) => redis.del(k)));
        }
      } while (cursor !== 0);
    } catch {
      // Best effort — keys will expire via TTL
    }
  }
}

/**
 * Async get-or-fetch with L1+L2 caching.
 * Checks in-memory first, then Redis, then calls fetcher.
 */
export async function cacheFetchAsync<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGetAsync<T>(key);
  if (cached !== null) return cached;

  const data = await fetcher();
  await cacheSetAsync(key, data, ttlMs);
  return data;
}
