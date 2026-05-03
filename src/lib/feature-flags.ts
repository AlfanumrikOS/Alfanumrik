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

/**
 * Registry of flag names that payment-integrity code references.
 * Defaults (when the flag is absent from the DB) are documented inline —
 * `isFeatureEnabled` already returns false for unknown flags, but this
 * registry keeps the source of truth close to the code that reads it.
 *
 * Seeded by migration 20260414120000_payment_subscribe_atomic_fix.sql.
 */
export const PAYMENT_FLAGS = {
  /** Enables the reconcile_stuck_subscriptions action in the payments Edge Function.
   *  Default: false (off). Flip via super-admin console after drift metrics confirmed. */
  RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED: 'reconcile_stuck_subscriptions_enabled',
} as const;

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
    _flagCache = await res.json();
    _flagCacheExpiry = now + CACHE_TTL.STATIC; // 5 min
    return _flagCache || [];
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
  const flag = flags.find(f => f.flag_name === flagName);

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

// ─── Flag Registries ──────────────────────────────────────────────────────────

/**
 * Maintenance banner flag. When enabled, a dismissible amber banner is shown
 * across all portals (student, parent, teacher, admin).
 *
 * Enable via super-admin console or direct DB:
 *   UPDATE feature_flags
 *   SET is_enabled = true,
 *       metadata = '{"message_en":"Scheduled maintenance 10-11 PM IST","message_hi":"रखरखाव 10-11 PM IST"}'
 *   WHERE flag_name = 'maintenance_banner';
 *
 * The MaintenanceBanner component reads `is_enabled` + `metadata.message_en/message_hi`
 * directly from the client Supabase instance (public read via RLS).
 */
export const MAINTENANCE_FLAGS = {
  MAINTENANCE_BANNER: 'maintenance_banner',
} as const;

/**
 * Marketing/landing-page flags.
 *
 * `ff_welcome_v2` gates the mobile-first editorial redesign of the `/welcome`
 * landing page (Indian Editorial Tutor aesthetic). Default OFF.
 *
 * Routing approach (recommended for the upcoming frontend port):
 *   The `/welcome` server component reads this flag and renders either
 *   <WelcomeV1 /> or <WelcomeV2 />. The URL stays `/welcome` — no SEO split,
 *   no link breakage, no marketing redirect. The `?v=2` query-string param
 *   should force v2 even when the flag is off (QA preview escape hatch);
 *   `?v=1` should force v1 when the flag is on (rollback escape hatch).
 *
 *   Pseudocode for src/app/welcome/page.tsx:
 *     const force = searchParams.v;
 *     const flagOn = await isFeatureEnabled('ff_welcome_v2', { userId, environment });
 *     const showV2 = force === '2' || (flagOn && force !== '1');
 *     return showV2 ? <WelcomeV2 /> : <WelcomeV1 />;
 *
 * Seeded by migration 20260426150000_add_ff_welcome_v2.sql.
 * Operator runbook for staged rollout / rollback lives in that migration's header.
 */
export const WELCOME_FLAGS = {
  /** Mobile-first editorial redesign of /welcome. Default: false (off).
   *  When true, /welcome renders WelcomeV2 instead of WelcomeV1. */
  WELCOME_V2: 'ff_welcome_v2',
} as const;

/**
 * Goal-Adaptive Learning Layers flags (Phase 0 + Phase 1 + Phase 2).
 *
 * `ff_goal_profiles` gates the super-admin Goal Profile Preview page that
 * lets admins inspect each of the 6 goal personas + their config tables.
 *
 * `ff_goal_aware_foxy` gates two user-visible behaviors that ship together:
 *   1. Foxy's system prompt swaps the legacy single-line goal sentence for
 *      a multi-paragraph persona tailored to (goal × mode).
 *   2. QuizResults renders a goal-aware scorecard sentence after every quiz.
 *
 * `ff_goal_aware_selection` (Phase 2) gates two backend behaviors:
 *   1. Quiz-generate workflow uses pickQuizParams + the additive
 *      get_adaptive_questions_v2 RPC instead of legacy constants + v1 RPC.
 *   2. Mastery display thresholds switch from the global 0.8 default to
 *      goal-specific thresholds (see src/lib/goals/mastery-display.ts).
 *
 * All three flags fall back to the legacy default when off, so disabling at
 * any time is an instant rollback.
 *
 * Seeded by migrations:
 *   - 20260503120000_add_ff_goal_adaptive_layers.sql       (Phase 0+1)
 *   - 20260503140000_add_phase2_goal_aware_selection.sql   (Phase 2)
 */
export const GOAL_ADAPTIVE_FLAGS = {
  GOAL_PROFILES: 'ff_goal_profiles',
  GOAL_AWARE_FOXY: 'ff_goal_aware_foxy',
  GOAL_AWARE_SELECTION: 'ff_goal_aware_selection',
  GOAL_DAILY_PLAN: 'ff_goal_daily_plan',  // Phase 3
  GOAL_AWARE_RAG: 'ff_goal_aware_rag',  // Phase 4
} as const;

/**
 * Default values for known flags. `isFeatureEnabled()` already returns false
 * for any flag not present in the DB, but this map is the documented source
 * of truth for SSR behavior before the first DB hit completes.
 *
 * Keep in sync with the migration that seeds each flag.
 */
export const FLAG_DEFAULTS: Readonly<Record<string, boolean>> = {
  [WELCOME_FLAGS.WELCOME_V2]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN]: false,
  [GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG]: false,
} as const;
