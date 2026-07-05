// supabase/functions/grounded-answer/cache-redis.ts
//
// Shared Redis (Upstash) L2 cache tier for grounded-answer responses. Sits
// BEHIND the existing in-memory L1 cache (cache.ts) so cache hits are
// shared across Edge Function instances/regions instead of being trapped
// per-instance (L1 is process-local and resets on every cold start).
//
// This mirrors the EXACT integration pattern already used for durable rate
// limiting (`_shared/durable-rate-limiter.ts`): imports `@upstash/redis`
// directly via esm.sh in Deno, reads secrets via `Deno.env.get`, and NEVER
// throws on the request path. Fail-open contract (safe direction for a
// cache, unlike a rate limiter): absent secrets OR any Redis error is
// treated as a cache MISS — a miss just means the normal pipeline runs,
// nothing breaks.
//
// Key format: rag:cache:v1:<grade>:<subject_code>:<mode>:<caller>:<sha256>
//   - `rag:` (not `foxy:`) because this cache serves 5 callers — see
//     config.ts VALID_CALLERS (foxy, ncert-solver, quiz-generator,
//     concept-engine, diagnostic).
//   - grade/subject_code/mode/caller are literal, VISIBLE segments (not
//     just hidden inside the hash) so two requests can only ever collide
//     in the key namespace if all four markers already match.
//   - Distinct from every other Redis key prefix already in use on the
//     same Upstash instance: rl:general / rl:parent / rl:admin (proxy.ts),
//     rl:apikey (api-rate-limit.ts), rl:parent_login (parent-portal),
//     sess:valid:* (proxy.ts).
//   - chapter_number is deliberately NOT part of the key (per design) —
//     it is instead part of the defense-in-depth tuple re-validated on
//     every read (see below). This keeps the visible key short while
//     still catching any chapter-level mismatch before serving.
//
// Defense-in-depth (required, not optional): the stored Redis payload
// carries the ORIGINAL request tuple `{ caller, mode, grade, subject_code,
// chapter_number, query_normalized }` alongside the cached GroundedResponse.
// getFromRedisL2 re-compares the CURRENT request's tuple against the
// stored tuple before treating a hit as valid — ANY mismatch is treated as
// a miss, never served. This guards against a future bug in key derivation
// causing wrong content to be served, independent of hash correctness.
//
// Only grounded:true responses are ever written (same rule as L1 — never
// cache abstains; abstain reasons depend on live upstream state).
//
// Query normalization reuses cache.ts's normalizeQuery EXACTLY (case +
// whitespace only — punctuation/symbols are load-bearing for math/science
// questions) so L1 and L2 can never drift apart on "same query" semantics.

import { Redis } from 'https://esm.sh/@upstash/redis@1';
import type { Caller, GroundedResponse } from './types.ts';
import { normalizeQuery } from './cache.ts';

/** Redis key namespace. See file header for collision-avoidance rationale. */
export const REDIS_CACHE_NAMESPACE = 'rag:cache:v1';

/**
 * L2 TTL — longer than L1's CACHE_TTL_MS (5 min, config.ts) because L2 is
 * meant to survive Edge Function cold starts and be shared across
 * instances/regions. Bounded (not indefinite) so stale content can't linger.
 */
export const REDIS_CACHE_TTL_SECONDS = 20 * 60; // 20 minutes

export interface CacheTuple {
  caller: Caller;
  mode: 'strict' | 'soft';
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query_normalized: string;
}

interface RedisPayload {
  tuple: CacheTuple;
  response: GroundedResponse;
}

// Module-level singleton, lazily initialized on first use (mirrors
// src/lib/redis.ts's getRedis() pattern). `undefined` = not yet attempted;
// `null` = attempted and unavailable (missing secrets or construction
// threw) — in both cases every call degrades to a cache miss.
let redisClient: Redis | null | undefined;

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) {
    redisClient = null;
    return redisClient;
  }
  try {
    redisClient = new Redis({ url, token });
  } catch {
    redisClient = null;
  }
  return redisClient;
}

/** Test-only: force re-evaluation of the module-level client + env vars. */
export function __resetRedisClientForTests(): void {
  redisClient = undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the visible Redis key. Grade/subject_code/mode/caller are literal
 * segments; only the (normalized) query is hashed. See file header for why
 * chapter_number is intentionally excluded from the key (it's covered by
 * the defense-in-depth tuple check instead).
 */
export async function buildRedisCacheKey(
  query: string,
  scope: { grade: string; subject_code: string },
  mode: 'strict' | 'soft',
  caller: Caller,
): Promise<string> {
  const hash = await sha256Hex(normalizeQuery(query));
  return `${REDIS_CACHE_NAMESPACE}:${scope.grade}:${scope.subject_code}:${mode}:${caller}:${hash}`;
}

/** Build the defense-in-depth tuple stored alongside the cached response. */
export function buildCacheTuple(args: {
  caller: Caller;
  mode: 'strict' | 'soft';
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query: string;
}): CacheTuple {
  return {
    caller: args.caller,
    mode: args.mode,
    grade: args.grade,
    subject_code: args.subject_code,
    chapter_number: args.chapter_number,
    query_normalized: normalizeQuery(args.query),
  };
}

function tuplesMatch(a: CacheTuple, b: CacheTuple): boolean {
  return (
    a.caller === b.caller &&
    a.mode === b.mode &&
    a.grade === b.grade &&
    a.subject_code === b.subject_code &&
    a.chapter_number === b.chapter_number &&
    a.query_normalized === b.query_normalized
  );
}

/**
 * Look up a key in the L2 cache. Returns null on: missing Upstash secrets,
 * any Redis error, no entry, a defense-in-depth tuple mismatch, or a
 * non-grounded stored payload. NEVER throws — callers can await this
 * unconditionally and fall through to the normal pipeline on null.
 */
export async function getFromRedisL2(
  key: string,
  expectedTuple: CacheTuple,
): Promise<GroundedResponse | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get<RedisPayload>(key);
    if (!raw || !raw.tuple || !raw.response) return null;
    if (!tuplesMatch(raw.tuple, expectedTuple)) {
      // Defense-in-depth: never serve a payload whose stored tuple doesn't
      // match the current request, even though the hash-derived key
      // matched. Treat as a miss.
      console.warn('cache_l2_tuple_mismatch', {
        caller: expectedTuple.caller,
        grade: expectedTuple.grade,
        subject: expectedTuple.subject_code,
      });
      return null;
    }
    if (raw.response.grounded !== true) return null;
    return raw.response;
  } catch (err) {
    console.warn(`cache_l2 read failed — ${String(err)}`);
    return null;
  }
}

/**
 * Store a response in L2. Only call for grounded:true — abstain responses
 * are never cached (same rule as L1). Never throws; a write failure is a
 * silent no-op (the next request just misses L2 and recomputes normally).
 */
export async function putInRedisL2(
  key: string,
  response: GroundedResponse,
  tuple: CacheTuple,
): Promise<void> {
  if (!response.grounded) return;
  const client = getRedisClient();
  if (!client) return;
  try {
    const payload: RedisPayload = { tuple, response };
    await client.set(key, payload, { ex: REDIS_CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn(`cache_l2 write failed — ${String(err)}`);
  }
}
