/**
 * ALFANUMRIK -- Tenant-Aware Cache Layer
 *
 * Provides school-scoped cache key generation and invalidation for the
 * B2B multi-tenant platform. Built on top of the Redis-backed cache
 * (src/lib/cache.ts).
 *
 * Key schema:
 *   t:{schoolId}:{dataKey}  — school-scoped data
 *   g:{dataKey}             — global data (no school context)
 *
 * Usage:
 *   import { schoolCacheKey, schoolCacheFetch, invalidateSchoolCache } from '@/lib/school-cache';
 *
 *   // Read with tenant-aware key
 *   const key = schoolCacheKey(schoolId, 'leaderboard');
 *   const data = await cacheGetAsync<LeaderboardData>(key);
 *
 *   // Get-or-fetch with tenant scope
 *   const roster = await schoolCacheFetch(schoolId, 'roster', CACHE_TTL.SHORT, fetchRoster);
 *
 *   // Invalidate all cache entries for a school (e.g., after settings change)
 *   await invalidateSchoolCache(schoolId);
 */

import {
  cacheGetAsync,
  cacheSetAsync,
  cacheDeleteAsync,
  cacheInvalidatePrefixAsync,
  cacheStats,
  CACHE_TTL,
} from '@/lib/cache';

// ── Per-school hit/miss tracking ──
const _schoolStats = new Map<string, { hits: number; misses: number }>();

function trackSchoolHit(schoolId: string): void {
  const stats = _schoolStats.get(schoolId) ?? { hits: 0, misses: 0 };
  stats.hits++;
  _schoolStats.set(schoolId, stats);
}

function trackSchoolMiss(schoolId: string): void {
  const stats = _schoolStats.get(schoolId) ?? { hits: 0, misses: 0 };
  stats.misses++;
  _schoolStats.set(schoolId, stats);
}

// ── Key Generation ──

/**
 * Generate a tenant-aware cache key.
 *
 * @param schoolId - School UUID, or null for global (B2C) data
 * @param dataKey  - The data identifier (e.g., 'leaderboard', 'roster', 'config')
 * @returns Prefixed cache key: `t:{schoolId}:{dataKey}` or `g:{dataKey}`
 */
export function schoolCacheKey(schoolId: string | null, dataKey: string): string {
  return schoolId ? `t:${schoolId}:${dataKey}` : `g:${dataKey}`;
}

// ── Tenant-Scoped Operations ──

/**
 * Get a cached value scoped to a school tenant.
 * Tracks per-school hit/miss stats.
 */
export async function schoolCacheGet<T>(
  schoolId: string | null,
  dataKey: string,
): Promise<T | null> {
  const key = schoolCacheKey(schoolId, dataKey);
  const result = await cacheGetAsync<T>(key);

  if (schoolId) {
    if (result !== null) {
      trackSchoolHit(schoolId);
    } else {
      trackSchoolMiss(schoolId);
    }
  }

  return result;
}

/**
 * Set a cached value scoped to a school tenant.
 * Writes to both in-memory and Redis (via cacheSetAsync).
 */
export async function schoolCacheSet<T>(
  schoolId: string | null,
  dataKey: string,
  data: T,
  ttlMs: number = CACHE_TTL.TENANT,
): Promise<void> {
  const key = schoolCacheKey(schoolId, dataKey);
  await cacheSetAsync(key, data, ttlMs);
}

/**
 * Delete a specific cached value scoped to a school tenant.
 */
export async function schoolCacheDelete(
  schoolId: string | null,
  dataKey: string,
): Promise<void> {
  const key = schoolCacheKey(schoolId, dataKey);
  await cacheDeleteAsync(key);
}

/**
 * Get-or-fetch with tenant-aware caching.
 * If the value is in cache, returns it immediately.
 * Otherwise, calls the fetcher and caches the result.
 */
export async function schoolCacheFetch<T>(
  schoolId: string | null,
  dataKey: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await schoolCacheGet<T>(schoolId, dataKey);
  if (cached !== null) return cached;

  const data = await fetcher();
  await schoolCacheSet(schoolId, dataKey, data, ttlMs);

  return data;
}

// ── Invalidation ──

/**
 * Invalidate ALL cache entries for a specific school.
 * Deletes keys matching prefix `t:{schoolId}:` from both in-memory and Redis.
 *
 * Use when:
 * - School settings change (branding, config)
 * - School subscription plan changes
 * - Admin force-refreshes school data
 */
export async function invalidateSchoolCache(schoolId: string): Promise<void> {
  await cacheInvalidatePrefixAsync(`t:${schoolId}:`);
  // Also clear per-school stats on invalidation
  _schoolStats.delete(schoolId);
}

/**
 * Invalidate a specific data type across ALL schools.
 * Useful when a global config change affects all tenants.
 *
 * Example: invalidateGlobalCacheKey('feature-flags') clears
 * both `t:*:feature-flags` (all schools) and `g:feature-flags` (global).
 *
 * Note: This only clears the global key and relies on TTL for school-scoped
 * keys. For immediate cross-school invalidation, iterate known school IDs.
 */
export async function invalidateGlobalCacheKey(dataKey: string): Promise<void> {
  await cacheDeleteAsync(`g:${dataKey}`);
}

// ── Stats ──

/**
 * Get cache hit/miss stats per school for monitoring dashboards.
 *
 * Returns:
 * - Per-school stats (hits, misses, hit_rate)
 * - Aggregated global cache stats
 * - Total number of tracked schools
 */
export function getSchoolCacheStats(): {
  schools: Record<string, { hits: number; misses: number; hit_rate: number }>;
  school_count: number;
  global: ReturnType<typeof cacheStats>;
} {
  const schools: Record<string, { hits: number; misses: number; hit_rate: number }> = {};

  _schoolStats.forEach((stats, schoolId) => {
    const total = stats.hits + stats.misses;
    schools[schoolId] = {
      hits: stats.hits,
      misses: stats.misses,
      hit_rate: total > 0 ? Math.round((stats.hits / total) * 10000) / 10000 : 0,
    };
  });

  return {
    schools,
    school_count: _schoolStats.size,
    global: cacheStats(),
  };
}

/**
 * Reset per-school cache stats. Does NOT clear cached data.
 * Useful for periodic stats rotation (e.g., daily reset from cron).
 */
export function resetSchoolCacheStats(): void {
  _schoolStats.clear();
}
