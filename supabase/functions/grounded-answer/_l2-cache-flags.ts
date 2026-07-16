// supabase/functions/grounded-answer/_l2-cache-flags.ts
//
// Lightweight feature-flag cache for the L2 (Upstash Redis) response-cache
// tier. Mirrors the isServiceEnabled (pipeline.ts) / isMMRDiversityEnabled
// (_mmr-flag.ts) / isDigitalTwinEnabled (_twin-flag.ts) pattern: a 60s
// in-process memoized DB read against `feature_flags`, kept in its own file
// so each flag's TTL + fail-open/closed semantics are independently tunable.
//
// Two INDEPENDENT flags (both seeded OFF by a parallel architect migration
// task — this file only references the flag_name string constants; it does
// not create the rows):
//   - ff_foxy_response_cache_l2_v1: gates REAL L2 serving. When ON, an L2
//     hit short-circuits the pipeline exactly like an L1 hit (backfills L1,
//     returns immediately, zero retrieval calls, zero new trace row).
//   - ff_foxy_response_cache_l2_shadow_v1: gates SHADOW/observability-only
//     mode. When ON (and the real-serving flag is OFF), the pipeline still
//     performs the L2 lookup and logs a "would-have-hit" signal, but NEVER
//     serves the cached value — it always falls through to the normal
//     pipeline. This can never affect the REG-50 single-retrieval contract
//     because it never short-circuits.
//
// Default: OFF for both. Fail-CLOSED — if the DB read fails for ANY reason,
// both stay OFF. This flag gates a serving-path behavior change (like
// ff_grounded_ai_enabled / ff_digital_twin_v1), so the safe default on an
// unreadable flag is "behave exactly like today" (no L2 involvement at all).

export const FF_FOXY_RESPONSE_CACHE_L2_V1 = 'ff_foxy_response_cache_l2_v1';
export const FF_FOXY_RESPONSE_CACHE_L2_SHADOW_V1 = 'ff_foxy_response_cache_l2_shadow_v1';
// Response-cache v2 (design item 5): per-caller SERVE gating. Serving a
// cached response to caller 'ncert-solver' requires its own flag so the
// solver's 24h-TTL lane can ramp independently of Foxy's 20-min lane.
// Seeded OFF by a parallel architect migration.
export const FF_RESPONSE_CACHE_SERVE_NCERT_V1 = 'ff_response_cache_serve_ncert_v1';
// Response-cache v2 (design item 6): durable L3 solution store for
// ncert-solver (table ncert_solver_solutions). Gates the L3 write-back
// on its own; the L3 lookup (after an L2 miss, strictly before
// retrieveChunks) additionally requires the caller's SERVING flag
// (isL2CacheServingEnabledForCaller) — store ON + serve OFF warms the
// table without ever serving from it. Seeded OFF by a parallel architect
// migration.
export const FF_NCERT_SOLVER_SOLUTION_STORE_V1 = 'ff_ncert_solver_solution_store_v1';

interface FlagCache {
  value: boolean;
  expiresAt: number;
}

const FLAG_CACHE_TTL_MS = 60_000;

let servingFlagCache: FlagCache | null = null;
let shadowFlagCache: FlagCache | null = null;
let ncertServingFlagCache: FlagCache | null = null;
let ncertStoreFlagCache: FlagCache | null = null;

// deno-lint-ignore no-explicit-any
async function readFlag(sb: any, flagName: string): Promise<boolean> {
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', flagName)
    .single();
  // Default OFF: only a row with is_enabled === true enables the behavior.
  // A missing row (migration not applied / dev DB) → OFF (fail-closed).
  return data?.is_enabled === true;
}

// deno-lint-ignore no-explicit-any
export async function isL2CacheServingEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (servingFlagCache && servingFlagCache.expiresAt > now) return servingFlagCache.value;
  try {
    const value = await readFlag(sb, FF_FOXY_RESPONSE_CACHE_L2_V1);
    servingFlagCache = { value, expiresAt: now + FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${FF_FOXY_RESPONSE_CACHE_L2_V1} lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep L2 serving OFF if we can't read the flag.
    servingFlagCache = { value: false, expiresAt: now + FLAG_CACHE_TTL_MS };
    return false;
  }
}

// deno-lint-ignore no-explicit-any
export async function isL2CacheShadowEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (shadowFlagCache && shadowFlagCache.expiresAt > now) return shadowFlagCache.value;
  try {
    const value = await readFlag(sb, FF_FOXY_RESPONSE_CACHE_L2_SHADOW_V1);
    shadowFlagCache = { value, expiresAt: now + FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${FF_FOXY_RESPONSE_CACHE_L2_SHADOW_V1} lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep shadow mode OFF if we can't read the flag.
    shadowFlagCache = { value: false, expiresAt: now + FLAG_CACHE_TTL_MS };
    return false;
  }
}

// deno-lint-ignore no-explicit-any
export async function isNcertL2CacheServingEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (ncertServingFlagCache && ncertServingFlagCache.expiresAt > now) {
    return ncertServingFlagCache.value;
  }
  try {
    const value = await readFlag(sb, FF_RESPONSE_CACHE_SERVE_NCERT_V1);
    ncertServingFlagCache = { value, expiresAt: now + FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${FF_RESPONSE_CACHE_SERVE_NCERT_V1} lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep ncert-solver cache serving OFF if we can't read it.
    ncertServingFlagCache = { value: false, expiresAt: now + FLAG_CACHE_TTL_MS };
    return false;
  }
}

// deno-lint-ignore no-explicit-any
export async function isNcertSolutionStoreEnabled(sb: any): Promise<boolean> {
  const now = Date.now();
  if (ncertStoreFlagCache && ncertStoreFlagCache.expiresAt > now) {
    return ncertStoreFlagCache.value;
  }
  try {
    const value = await readFlag(sb, FF_NCERT_SOLVER_SOLUTION_STORE_V1);
    ncertStoreFlagCache = { value, expiresAt: now + FLAG_CACHE_TTL_MS };
    return value;
  } catch (err) {
    console.warn(`${FF_NCERT_SOLVER_SOLUTION_STORE_V1} lookup failed — ${String(err)}`);
    // Fail-CLOSED: keep the durable solution store OFF if we can't read it.
    ncertStoreFlagCache = { value: false, expiresAt: now + FLAG_CACHE_TTL_MS };
    return false;
  }
}

/**
 * Per-caller SERVE gate (design item 5): which flag must be ON for a
 * cached response to be SERVED to this caller.
 *   - foxy         → ff_foxy_response_cache_l2_v1 (unchanged from v1)
 *   - ncert-solver → ff_response_cache_serve_ncert_v1
 *   - every other caller → false (no serve lane defined yet; fail-closed)
 * Shadow-mode behavior is unchanged and is checked separately by the
 * pipeline (isL2CacheShadowEnabled) — shadow never serves for any caller.
 */
// deno-lint-ignore no-explicit-any
export async function isL2CacheServingEnabledForCaller(sb: any, caller: string): Promise<boolean> {
  if (caller === 'foxy') return await isL2CacheServingEnabled(sb);
  if (caller === 'ncert-solver') return await isNcertL2CacheServingEnabled(sb);
  return false;
}

export function __resetL2CacheFlagCacheForTests(): void {
  servingFlagCache = null;
  shadowFlagCache = null;
  ncertServingFlagCache = null;
  ncertStoreFlagCache = null;
}
