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
// nothing breaks. (REG-240 pins this contract.)
//
// ── v2 env-pair split ────────────────────────────────────────────────────
// The cache reads ONLY the dedicated cache instance pair:
//   UPSTASH_CACHE_REDIS_REST_URL / UPSTASH_CACHE_REDIS_REST_TOKEN
// There is deliberately NO fallback to UPSTASH_REDIS_REST_URL/TOKEN — that
// instance is the security-critical noeviction instance backing rate
// limiting + session validity (rl:* / sess:valid:* keys). A cache workload
// on a noeviction instance can fill it and start failing rate-limiter
// WRITES, which is a security regression. Absent cache secrets → every
// call degrades to a miss (fail-open preserved), never a throw.
//
// ── v2 key format ────────────────────────────────────────────────────────
// rag:cache:v2:<grade>:<subject_code>:<mode>:<caller>:<sha256(normalizeQuery(query))>:<sha256_12(gen_ctx)>
//   - `rag:` (not `foxy:`) because this cache serves multiple callers — see
//     config.ts VALID_CALLERS.
//   - grade/subject_code/mode/caller are literal, VISIBLE segments (not
//     just hidden inside a hash) so two requests can only ever collide in
//     the key namespace if all four markers already match.
//   - The trailing 12-hex-char fragment is the gen_ctx hash (see
//     gen-ctx.ts). This is the v2 fix for the v1 mode-collision bug:
//     Foxy learn/practice/quiz_me turns share query text + caller + mode
//     but differ in template_variables / max_tokens — under v1 they
//     collided on one key; under v2 they get distinct keys.
//   - Distinct from every other Redis key prefix in use anywhere:
//     rl:general / rl:parent / rl:admin (proxy.ts), rl:apikey
//     (api-rate-limit.ts), rl:parent_login (parent-portal),
//     sess:valid:* (proxy.ts), and the retired rag:cache:v1 namespace
//     (whose entries age out via TTL on the old instance).
//   - chapter_number is deliberately NOT part of the key (per design) —
//     it is part of the defense-in-depth tuple re-validated on every read.
//
// ── Defense-in-depth (required, not optional) ────────────────────────────
// The stored Redis payload carries the ORIGINAL request tuple { caller,
// mode, grade, subject_code, chapter_number, query_normalized,
// gen_ctx_hash } alongside the cached GroundedResponse. getFromRedisL2
// re-compares the CURRENT request's tuple — including the FULL 64-char
// gen_ctx hash, not just the 12-char key fragment — before treating a hit
// as valid. ANY mismatch is a miss, never served. This guards against key
// derivation bugs AND against fragment-level hash collisions.
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
export const REDIS_CACHE_NAMESPACE = 'rag:cache:v2';

/**
 * Per-caller L2 TTLs (design item 7). Both are longer than L1's CACHE_TTL_MS
 * (5 min, config.ts) because L2 is meant to survive Edge Function cold
 * starts and be shared across instances/regions.
 *   - foxy: 20 min — conversational content, short window keeps behavior
 *     close to v1 while content/prompt iterations are frequent.
 *   - ncert-solver: 24 h — NCERT exercise solutions are stable, strict-mode,
 *     personalization-free; content re-ingestion invalidates via the
 *     content_version component of gen_ctx, so a long TTL is safe.
 */
export const REDIS_CACHE_TTL_SECONDS_FOXY = 20 * 60; // 20 minutes
export const REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER = 24 * 60 * 60; // 24 hours

export function redisCacheTtlSeconds(caller: Caller): number {
  return caller === 'ncert-solver'
    ? REDIS_CACHE_TTL_SECONDS_NCERT_SOLVER
    : REDIS_CACHE_TTL_SECONDS_FOXY;
}

export interface CacheTuple {
  caller: Caller;
  mode: 'strict' | 'soft';
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query_normalized: string;
  /** Full 64-hex-char sha256 of the canonical gen_ctx JSON (gen-ctx.ts). */
  gen_ctx_hash: string;
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
  // v2 env-pair split: ONLY the dedicated cache instance. NO fallback to
  // UPSTASH_REDIS_REST_URL/TOKEN (security-critical noeviction instance) —
  // see file header. Absent secrets → degrade to miss, never throw.
  const url = Deno.env.get('UPSTASH_CACHE_REDIS_REST_URL');
  const token = Deno.env.get('UPSTASH_CACHE_REDIS_REST_TOKEN');
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
 * sha256 of the NORMALIZED query. Exported so the durable L3 tier
 * (cache-durable.ts / ncert_solver_solutions.question_hash) uses the exact
 * same question identity as the L2 key.
 */
export async function hashNormalizedQuery(query: string): Promise<string> {
  return await sha256Hex(normalizeQuery(query));
}

/**
 * Build the visible Redis key (v2). Grade/subject_code/mode/caller are
 * literal segments; the (normalized) query is hashed; the trailing segment
 * is the 12-hex-char gen_ctx hash fragment (gen-ctx.ts genCtxKeyFragment).
 * chapter_number is intentionally excluded from the key (covered by the
 * defense-in-depth tuple check instead).
 */
export async function buildRedisCacheKey(
  query: string,
  scope: { grade: string; subject_code: string },
  mode: 'strict' | 'soft',
  caller: Caller,
  genCtxKeyFragment: string,
): Promise<string> {
  const hash = await hashNormalizedQuery(query);
  return `${REDIS_CACHE_NAMESPACE}:${scope.grade}:${scope.subject_code}:${mode}:${caller}:${hash}:${genCtxKeyFragment}`;
}

/** Build the defense-in-depth tuple stored alongside the cached response. */
export function buildCacheTuple(args: {
  caller: Caller;
  mode: 'strict' | 'soft';
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  query: string;
  gen_ctx_hash: string;
}): CacheTuple {
  return {
    caller: args.caller,
    mode: args.mode,
    grade: args.grade,
    subject_code: args.subject_code,
    chapter_number: args.chapter_number,
    query_normalized: normalizeQuery(args.query),
    gen_ctx_hash: args.gen_ctx_hash,
  };
}

export function tuplesMatch(a: CacheTuple, b: CacheTuple): boolean {
  return (
    a.caller === b.caller &&
    a.mode === b.mode &&
    a.grade === b.grade &&
    a.subject_code === b.subject_code &&
    a.chapter_number === b.chapter_number &&
    a.query_normalized === b.query_normalized &&
    // Full-hash comparison — the key only carries a 12-char fragment, the
    // tuple re-validation compares all 64 chars. Any gen_ctx difference
    // (mode directives, max_tokens, content_version, prompt rev, …) is a
    // miss, never served. This is the enforcement half of the v1
    // mode-collision fix.
    a.gen_ctx_hash === b.gen_ctx_hash
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
 * are never cached (same rule as L1). TTL is per-caller (design item 7).
 * Never throws; a write failure is a silent no-op (the next request just
 * misses L2 and recomputes normally).
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
    await client.set(key, payload, { ex: redisCacheTtlSeconds(tuple.caller) });
  } catch (err) {
    console.warn(`cache_l2 write failed — ${String(err)}`);
  }
}
