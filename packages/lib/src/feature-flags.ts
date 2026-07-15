import { cacheFetch, CACHE_TTL } from './cache';

// Scoping precedence: environment → role → institution → global enabled.
// Empty scoping arrays = applies to all. Cached 5 minutes.

interface FeatureFlagRow {
  flag_name: string;
  is_enabled: boolean;
  target_roles: string[] | null;
  target_environments: string[] | null;
  target_institutions: string[] | null;
  rollout_percentage: number | null;
}

interface FlagContext {
  role?: string;           // 'student' | 'teacher' | 'parent' | etc.
  environment?: string;    // 'production' | 'staging' | 'development'
  institutionId?: string;  // school UUID
  userId?: string;         // user UUID for deterministic per-user rollout
}

/**
 * Deterministic hash for per-user feature flag rollout.
 * Given the same userId + flagName, always returns the same number 0-99.
 * Different userId values distribute roughly uniformly across 0-99.
 */
export function hashForRollout(userId: string, flagName: string): number {
  let hash = 0;
  const str = `${userId}:${flagName}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

let _flagCache: FeatureFlagRow[] | null = null;
let _flagCacheExpiry = 0;

/**
 * Invalidate the in-memory flag cache so that the next evaluation
 * re-fetches from Supabase. Call this after admin mutations to
 * feature_flags so toggles take effect immediately.
 */
export function invalidateFlagCache(): void {
  _flagCache = null;
  _flagCacheExpiry = 0;
}

/**
 * Load all flags from Supabase (server-side, uses service role).
 * Cached for 5 minutes.
 */
async function loadFlags(): Promise<FeatureFlagRow[]> {
  const now = Date.now();
  if (_flagCache && now < _flagCacheExpiry) return _flagCache;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return [];

    const res = await fetch(
      `${url}/rest/v1/feature_flags?select=flag_name,is_enabled,target_roles,target_environments,target_institutions,rollout_percentage`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );

    if (!res.ok) return _flagCache || [];
    // Coerce ANY non-array / malformed flags payload to a safe empty list so a
    // bad response can never make `_flagCache` a non-array (which would throw
    // out of the `.find()` / `for...of` consumers below). On a malformed body
    // every flag then falls back to its default (OFF for all ff_* flags).
    const parsed: unknown = await res.json();
    _flagCache = Array.isArray(parsed) ? (parsed as FeatureFlagRow[]) : [];
    _flagCacheExpiry = now + CACHE_TTL.STATIC; // 5 min
    return _flagCache;
  } catch {
    return _flagCache || [];
  }
}

/**
 * Evaluate a single feature flag with scoping.
 *
 * Returns true if the flag is enabled for the given context.
 * Returns false if disabled, scoped out, or not found.
 */
export async function isFeatureEnabled(
  flagName: string,
  context: FlagContext = {}
): Promise<boolean> {
  const flags = await loadFlags();
  // Defensive: never let a non-array flags payload throw out of this function.
  // A malformed/unexpected response must fall back to the flag's default
  // (OFF for all ff_* flags) rather than crash the caller.
  const flag = Array.isArray(flags) ? flags.find(f => f.flag_name === flagName) : undefined;

  if (!flag) return false; // Flag doesn't exist → disabled
  if (!flag.is_enabled) return false; // Globally disabled

  // Environment scoping
  if (flag.target_environments && flag.target_environments.length > 0) {
    const env = context.environment || process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
    if (!flag.target_environments.includes(env)) return false;
  }

  // Role scoping
  if (flag.target_roles && flag.target_roles.length > 0) {
    if (!context.role || !flag.target_roles.includes(context.role)) return false;
  }

  // Institution scoping
  if (flag.target_institutions && flag.target_institutions.length > 0) {
    if (!context.institutionId || !flag.target_institutions.includes(context.institutionId)) return false;
  }

  // Rollout percentage: deterministic per-user using consistent hashing.
  // 0% → always false. 100% or null → always true.
  // 1-99% with userId → hash(userId, flagName) determines inclusion.
  // 1-99% without userId → treated as enabled (backward compat).
  if (flag.rollout_percentage !== null && flag.rollout_percentage < 100) {
    if (flag.rollout_percentage <= 0) return false;
    if (context.userId) {
      return hashForRollout(context.userId, flagName) < flag.rollout_percentage;
    }
    // No userId provided: treat any percentage > 0 as enabled for backward compatibility
  }

  return true;
}

/**
 * Get all enabled flags for a context (e.g., for a student session).
 * Returns a Record<string, boolean> for all flags.
 */
export async function getEvaluatedFlags(
  context: FlagContext = {}
): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};

  for (const flag of flags) {
    result[flag.flag_name] = await isFeatureEnabled(flag.flag_name, context);
  }

  return result;
}

/**
 * Client-side compatible: get all flags as simple key→boolean.
 * Does NOT evaluate scoping (client doesn't have context).
 * Use this only for initial page load; server should re-evaluate with context.
 */
export async function getFeatureFlagsSimple(): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};
  for (const flag of flags) {
    result[flag.flag_name] = flag.is_enabled;
  }
  return result;
}

// ─── Flag Registries (link-preserving barrel) ─────────────────────────────────
//
// The 36 flag-name registries + FLAG_DEFAULTS + isAtlasEnabled were extracted
// (byte-identically) into the acyclic `./flags/` DAG (M3 decomposition, architect-
// approved): registries import nothing; defaults import registries; this barrel
// re-exports everything. EVERY symbol historically importable from
// `@alfanumrik/lib/feature-flags` (97 source + 88 test consumers, all named) stays
// importable from it. The evaluation ENGINE above (hashForRollout /
// invalidateFlagCache / isFeatureEnabled / getEvaluatedFlags /
// getFeatureFlagsSimple + the private loadFlags + the _flagCache singleton)
// deliberately stays here — the cache must remain a single module instance, and
// the vitest path-keyed coverage threshold is keyed on this file.
//
// All export names are globally unique, so `export *` introduces no ambiguity.
export * from './flags/registries/payment';
export * from './flags/registries/platform';
export * from './flags/registries/pedagogy';
export * from './flags/registries/consumer';
export * from './flags/registries/teacher';
export * from './flags/registries/school';
export * from './flags/registries/foxy';
export * from './flags/defaults';
