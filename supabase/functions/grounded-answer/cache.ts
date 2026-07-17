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

import type { Caller, GroundedResponse } from './types.ts';
import { CACHE_TTL_MS } from './config.ts';

const MAX_ENTRIES = 500;

interface CacheEntry {
  response: GroundedResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Shared query normalization for cache keying. Used by BOTH the L1
 * (in-memory) cache here and the L2 (Redis) cache in cache-redis.ts so the
 * two tiers can never drift apart on what counts as "the same query".
 *
 * IMPORTANT: this intentionally does NOT strip punctuation/symbols. A
 * dormant SQL-side cache (see REG-237 test comment in
 * __tests__/cache.test.ts) had that bug — stripping punctuation collapses
 * "What is 5+3?" and "What is 5-3?" into the same key, which is wrong for
 * a CBSE math/science platform. Only case + whitespace are normalized.
 */
export function normalizeQuery(query: string): string {
  return (query ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Build a stable cache key. Mode + scope matter (same query in strict vs
 * soft mode, or across grades/subjects, should NOT collide). Caller also
 * matters: the pipeline generates materially different output shapes per
 * caller (e.g. `isFoxyStructured` gates a strict-JSON structured-output
 * contract + a boosted max_tokens multiplier ONLY for caller === 'foxy').
 * Two different callers submitting the same normalized query against the
 * same grade/subject/chapter/mode must NOT collide on the same cache
 * entry, or one caller's contract-shaped response leaks into another's
 * parser (e.g. Foxy's structured-JSON consumer receiving a plain-text
 * concept-engine-shaped answer).
 *
 * Response-cache v2: `genCtxHash` (the full sha256 of the canonical
 * gen_ctx tuple — see gen-ctx.ts) is folded into the key so requests that
 * share query text + scope + mode + caller but differ in template
 * variables / generation params / content version get DISTINCT L1 entries.
 * This is the L1 half of the v1 mode-collision fix (Foxy learn/practice/
 * quiz_me turns previously collided on one key). Optional so legacy
 * callers/tests keep byte-identical keys when they don't pass it.
 */
export async function buildCacheKey(
  query: string,
  scope: { grade: string; subject_code: string; chapter_number: number | null },
  mode: 'strict' | 'soft',
  caller: Caller,
  genCtxHash?: string,
): Promise<string> {
  const normalized = normalizeQuery(query);
  const payload = JSON.stringify({
    q: normalized,
    g: scope.grade,
    s: scope.subject_code,
    c: scope.chapter_number,
    m: mode,
    caller,
    ...(genCtxHash ? { gc: genCtxHash } : {}),
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