// supabase/functions/grounded-answer/cache.ts
// In-memory LRU cache for grounded-answer responses.
// Spec §6.9.
//
// Contract:
//   - Keyed by sha256(query || scope || mode).
//   - TTL = CACHE_TTL_MS (5 min). Expired entries are purged on access.
//   - Max 500 entries. LRU eviction: on overflow, drop the least-recently-
//     inserted key. (JS Map preserves insertion order, and we delete +
//     re-insert on every touch, so "oldest key" = head of iterator.)
//   - Only caches grounded:true responses. Abstain responses vary by
//     upstream state and are cheap to recompute.
//   - Cache hits do NOT write a new trace row (avoids trace table bloat).
//     Callers log 'cache_hit' via console.log for observability.
//
// Design decision: we store the full GroundedResponse (not just answer)
// so callers get identical citations + confidence + trace_id. The
// trace_id echoes the ORIGINAL grounded response — downstream readers
// treat this as "this query was answered at time T, trace T' is the
// source of truth."

import type { GroundedResponse } from './types.ts';
import { CACHE_TTL_MS } from './config.ts';

const MAX_ENTRIES = 500;

interface CacheEntry {
  response: GroundedResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Build a stable cache key. Mode + scope matter (same query in strict vs
 * soft mode, or across grades/subjects, should NOT collide).
 */
export async function buildCacheKey(
  query: string,
  scope: { grade: string; subject_code: string; chapter_number: number | null },
  mode: 'strict' | 'soft',
): Promise<string> {
  const normalized = (query ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const payload = JSON.stringify({
    q: normalized,
    g: scope.grade,
    s: scope.subject_code,
    c: scope.chapter_number,
    m: mode,
  });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Return a cached response if present AND fresh. Updates LRU recency. */
export function getFromCache(key: string): GroundedResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // LRU touch: re-insert so this key is most-recent.
  cache.delete(key);
  cache.set(key, entry);
  return entry.response;
}

/**
 * Store a response. Only call for grounded:true — we explicitly skip
 * abstain because abstain reasons depend on live upstream state.
 */
export function putInCache(key: string, response: GroundedResponse): void {
  if (!response.grounded) return;

  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    // Evict oldest (= first) key. Map iteration is in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  cache.set(key, {
    response,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** For tests + incident response. */
export function __clearCacheForTests(): void {
  cache.clear();
}

/** For tests: current size. */
export function __cacheSizeForTests(): number {
  return cache.size;
}