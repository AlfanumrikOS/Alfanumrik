/**
 * Alfanumrik Offline Store
 *
 * Indian students in tier-2/3 cities lose connectivity while studying.
 * Duolingo solved this with aggressive local caching.
 * Alfanumrik caches the learning state so students can:
 * 1. See their progress even offline
 * 2. Continue reviewing flashcards
 * 3. Never lose a quiz response to a dropped connection
 *
 * This is localStorage-based (works on all devices, no IndexedDB complexity).
 * Upgrade to IndexedDB if data exceeds 5MB.
 */

const PREFIX = 'alf_';
const TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: number;
}

const CACHE_VERSION = 1;

/**
 * Save data to local cache with TTL.
 */
export function cacheSet<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Storage full — clear old entries
    clearExpired();
  }
}

/**
 * Get cached data. Returns null if expired or missing.
 */
export function cacheGet<T>(key: string, ttlMs = TTL): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    if (Date.now() - entry.timestamp > ttlMs) return null;

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Remove a cached item.
 */
export function cacheRemove(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${key}`);
  } catch { /* ignore */ }
}

/**
 * Clear all expired cache entries.
 */
export function clearExpired(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry: CacheEntry<unknown> = JSON.parse(raw);
        if (entry.version !== CACHE_VERSION || Date.now() - entry.timestamp > TTL) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
}

/**
 * Queue a failed API call for retry when online.
 * Used for quiz submissions that fail due to connectivity.
 */
export function queueOfflineAction(action: {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}): void {
  try {
    const queue = getOfflineQueue();
    queue.push(action);
    localStorage.setItem(`${PREFIX}offline_queue`, JSON.stringify(queue));
  } catch { /* ignore */ }
}

/**
 * Get all queued offline actions.
 */
export function getOfflineQueue(): Array<{
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}> {
  try {
    const raw = localStorage.getItem(`${PREFIX}offline_queue`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clear the offline queue (after successful sync).
 */
export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(`${PREFIX}offline_queue`);
  } catch { /* ignore */ }
}

/**
 * Cache learning snapshot for offline dashboard display.
 */
export function cacheSnapshot(studentId: string, snapshot: Record<string, unknown>): void {
  cacheSet(`snapshot_${studentId}`, snapshot);
}

/**
 * Get cached snapshot for offline display.
 */
export function getCachedSnapshot(studentId: string): Record<string, unknown> | null {
  return cacheGet(`snapshot_${studentId}`, 4 * 60 * 60 * 1000); // 4 hour TTL
}
