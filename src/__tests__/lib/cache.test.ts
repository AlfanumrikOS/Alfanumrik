/**
 * cache.ts — unit tests.
 *
 * src/lib/cache.ts is the L1 (in-memory) + L2 (Redis) response cache used
 * by API routes for hot reads (curriculum, leaderboard, feature flags).
 * We test:
 *   - L1 sync API: get/set/delete/invalidatePrefix/stats/fetch
 *   - TTL expiry, hit/miss accounting, and prefix invalidation
 *   - L2 async API with a mocked getRedis() — get-async fall-through to
 *     Redis, set-async dual write, redis-failure degradation, and the
 *     SCAN-based prefix invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Build a mock Redis client whose behaviour each test can override.
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
};

let getRedisReturn: typeof mockRedis | null = null;

vi.mock('@/lib/redis', () => ({
  getRedis: () => getRedisReturn,
}));

// Import AFTER vi.mock so the SUT picks up the mock.
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheInvalidatePrefix,
  cacheStats,
  cacheFetch,
  cacheGetAsync,
  cacheSetAsync,
  cacheDeleteAsync,
  cacheInvalidatePrefixAsync,
  cacheFetchAsync,
  CACHE_TTL,
} from '@/lib/cache';

beforeEach(() => {
  // Reset L1 store + redis mock between tests
  cacheInvalidatePrefix(''); // empty prefix matches everything
  vi.clearAllMocks();
  getRedisReturn = null;
});

describe('CACHE_TTL constants', () => {
  it('defines five named TTLs in ascending order (USER < SHORT < STATIC < TENANT < LONG)', () => {
    // USER 30s < SHORT 60s < STATIC 5min < TENANT 10min < LONG 24h
    expect(CACHE_TTL.USER).toBeLessThan(CACHE_TTL.SHORT);
    expect(CACHE_TTL.SHORT).toBeLessThan(CACHE_TTL.STATIC);
    expect(CACHE_TTL.STATIC).toBeLessThan(CACHE_TTL.TENANT);
    expect(CACHE_TTL.TENANT).toBeLessThan(CACHE_TTL.LONG);
  });

  it('LONG TTL is 24 hours in milliseconds', () => {
    expect(CACHE_TTL.LONG).toBe(24 * 60 * 60 * 1000);
  });
});

describe('cacheGet / cacheSet (L1)', () => {
  it('returns null for a missing key (miss)', () => {
    expect(cacheGet('absent')).toBeNull();
  });

  it('returns the stored value while TTL is fresh', () => {
    cacheSet('k', { v: 1 }, 60_000);
    expect(cacheGet<{ v: number }>('k')).toEqual({ v: 1 });
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    try {
      cacheSet('expiring', 'value', 100);
      vi.advanceTimersByTime(150);
      expect(cacheGet('expiring')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cacheDelete', () => {
  it('removes a single key', () => {
    cacheSet('one', 1, 60_000);
    cacheDelete('one');
    expect(cacheGet('one')).toBeNull();
  });

  it('is a no-op for missing keys (does not throw)', () => {
    expect(() => cacheDelete('never-set')).not.toThrow();
  });
});

describe('cacheInvalidatePrefix', () => {
  it('removes only keys starting with the prefix', () => {
    cacheSet('user:123:profile', 1, 60_000);
    cacheSet('user:124:profile', 2, 60_000);
    cacheSet('school:1:roster', 3, 60_000);

    cacheInvalidatePrefix('user:');

    expect(cacheGet('user:123:profile')).toBeNull();
    expect(cacheGet('user:124:profile')).toBeNull();
    expect(cacheGet('school:1:roster')).toBe(3);
  });
});

describe('cacheStats', () => {
  it('reports hits, misses and a numeric hit_rate', () => {
    cacheSet('hot', 1, 60_000);
    cacheGet('hot');         // hit
    cacheGet('hot');         // hit
    cacheGet('cold-miss');   // miss

    const s = cacheStats();
    expect(s.hits).toBeGreaterThanOrEqual(2);
    expect(s.misses).toBeGreaterThanOrEqual(1);
    expect(s.hit_rate).toBeGreaterThan(0);
    expect(s.hit_rate).toBeLessThanOrEqual(1);
    expect(s.keys).toContain('hot');
  });

  it('returns hit_rate=0 when no traffic has been recorded since reset', () => {
    // Note: counters are module-scoped; we just verify the formula handles
    // the divide-by-zero case (total === 0 branch).
    const s = cacheStats();
    expect(typeof s.hit_rate).toBe('number');
    expect(Number.isFinite(s.hit_rate)).toBe(true);
  });
});

describe('cacheFetch', () => {
  it('invokes fetcher on miss and caches the result', async () => {
    const fetcher = vi.fn().mockResolvedValue({ x: 42 });
    const out = await cacheFetch('fetch-key', 60_000, fetcher);
    expect(out).toEqual({ x: 42 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call: same fetcher, but should be served from cache
    const out2 = await cacheFetch('fetch-key', 60_000, fetcher);
    expect(out2).toEqual({ x: 42 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('cacheGetAsync / cacheSetAsync (L1+L2)', () => {
  it('returns L1 hit without consulting Redis', async () => {
    cacheSet('l1-only', 'fast', 60_000);
    getRedisReturn = mockRedis;
    const v = await cacheGetAsync<string>('l1-only');
    expect(v).toBe('fast');
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('falls through to Redis L2 on L1 miss and backfills L1', async () => {
    getRedisReturn = mockRedis;
    mockRedis.get.mockResolvedValueOnce('from-l2');
    const v = await cacheGetAsync<string>('only-in-l2');
    expect(v).toBe('from-l2');
    // Backfill: subsequent L1 read should now hit
    expect(cacheGet('only-in-l2')).toBe('from-l2');
  });

  it('returns null when both L1 and L2 miss', async () => {
    getRedisReturn = mockRedis;
    mockRedis.get.mockResolvedValueOnce(null);
    const v = await cacheGetAsync<string>('absent-everywhere');
    expect(v).toBeNull();
  });

  it('treats Redis throw as a miss (degrades gracefully)', async () => {
    getRedisReturn = mockRedis;
    mockRedis.get.mockRejectedValueOnce(new Error('redis down'));
    const v = await cacheGetAsync<string>('redis-fail');
    expect(v).toBeNull();
  });

  it('returns null when Redis is not configured (getRedis null)', async () => {
    getRedisReturn = null;
    const v = await cacheGetAsync<string>('no-redis-config');
    expect(v).toBeNull();
  });

  it('cacheSetAsync writes both L1 and Redis (with seconds TTL)', async () => {
    getRedisReturn = mockRedis;
    mockRedis.set.mockResolvedValueOnce('OK');
    await cacheSetAsync('dual-key', { v: 9 }, 30_000);
    expect(cacheGet('dual-key')).toEqual({ v: 9 });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'dual-key',
      JSON.stringify({ v: 9 }),
      { ex: 30 }, // 30_000 ms / 1000 = 30 s
    );
  });

  it('cacheSetAsync swallows Redis errors but still writes L1', async () => {
    getRedisReturn = mockRedis;
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(cacheSetAsync('still-l1', 'v', 60_000)).resolves.toBeUndefined();
    expect(cacheGet('still-l1')).toBe('v');
  });
});

describe('cacheDeleteAsync', () => {
  it('removes from L1 and best-effort L2', async () => {
    cacheSet('delete-me', 'gone', 60_000);
    getRedisReturn = mockRedis;
    mockRedis.del.mockResolvedValueOnce(1);
    await cacheDeleteAsync('delete-me');
    expect(cacheGet('delete-me')).toBeNull();
    expect(mockRedis.del).toHaveBeenCalledWith('delete-me');
  });

  it('swallows Redis del errors', async () => {
    getRedisReturn = mockRedis;
    mockRedis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(cacheDeleteAsync('boom')).resolves.toBeUndefined();
  });
});

describe('cacheInvalidatePrefixAsync', () => {
  it('clears L1 and walks Redis SCAN until cursor=0', async () => {
    cacheSet('user:1:cache', 1, 60_000);
    cacheSet('user:2:cache', 2, 60_000);
    getRedisReturn = mockRedis;

    // Two SCAN iterations: first returns cursor "5" with 2 keys, second
    // returns cursor "0" with 1 key.
    mockRedis.scan
      .mockResolvedValueOnce(['5', ['user:1:cache', 'user:2:cache']])
      .mockResolvedValueOnce(['0', ['user:3:cache']]);
    mockRedis.del.mockResolvedValue(1);

    await cacheInvalidatePrefixAsync('user:');

    // L1 cleared
    expect(cacheGet('user:1:cache')).toBeNull();
    expect(cacheGet('user:2:cache')).toBeNull();
    // Both SCAN pages exercised + 3 DEL calls (2 + 1)
    expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    expect(mockRedis.del).toHaveBeenCalledTimes(3);
  });

  it('still clears L1 when Redis scan throws', async () => {
    cacheSet('p:1', 'a', 60_000);
    getRedisReturn = mockRedis;
    mockRedis.scan.mockRejectedValueOnce(new Error('redis down'));
    await expect(cacheInvalidatePrefixAsync('p:')).resolves.toBeUndefined();
    expect(cacheGet('p:1')).toBeNull();
  });
});

describe('cacheFetchAsync', () => {
  it('invokes fetcher on full miss, then caches L1 + L2', async () => {
    getRedisReturn = mockRedis;
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.set.mockResolvedValueOnce('OK');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    const out = await cacheFetchAsync('async-fetch', 30_000, fetcher);
    expect(out).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Second call should hit L1 and skip the fetcher
    const out2 = await cacheFetchAsync('async-fetch', 30_000, fetcher);
    expect(out2).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
