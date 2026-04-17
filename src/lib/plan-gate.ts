/**
 * ALFANUMRIK -- Plan Gate Module
 *
 * Checks plan_permission_overrides to determine whether a user's plan
 * allows a specific permission.  Integrates with the DB-side
 * `check_and_increment_permission_usage` RPC for daily-limit enforcement.
 *
 * Design principles:
 *   - Fail-open: if anything goes wrong, grant access (log the error).
 *   - In-memory cache for override lookups (5 min TTL, max 500 entries).
 *   - Plan normalization handles aliases and billing-cycle suffixes.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ─── Types ──────────────────────────────────────────────────────

export interface PlanGateResult {
  granted: boolean;
  code?: 'PLAN_UPGRADE_REQUIRED' | 'DAILY_LIMIT_REACHED';
  remaining?: number;
  limit?: number;
  count?: number;
  planNeeded?: string;
}

interface OverrideRow {
  is_granted: boolean;
  usage_limit: { max: number; period: string } | null;
}

// ─── Plan normalization ─────────────────────────────────────────

const PLAN_ALIAS: Record<string, string> = {
  basic: 'starter',
  premium: 'pro',
  ultimate: 'unlimited',
  school_premium: 'unlimited',
};

const UPGRADE_TARGET: Record<string, string> = {
  free: 'starter',
  starter: 'pro',
  pro: 'unlimited',
};

function normalizePlan(plan: string): string {
  const base = plan.replace(/_(monthly|yearly)$/, '');
  return PLAN_ALIAS[base] ?? base;
}

// ─── Override cache (in-memory, 5 min TTL, max 500) ─────────────

interface CacheEntry {
  data: OverrideRow | null;
  expiresAt: number;
}

const overrideCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 500;

function cacheKey(plan: string, permissionCode: string): string {
  return `${plan}:${permissionCode}`;
}

function getCached(plan: string, permissionCode: string): OverrideRow | null | undefined {
  const entry = overrideCache.get(cacheKey(plan, permissionCode));
  if (!entry) return undefined; // cache miss
  if (entry.expiresAt < Date.now()) {
    overrideCache.delete(cacheKey(plan, permissionCode));
    return undefined; // expired
  }
  return entry.data; // may be null (negative cache)
}

function setCache(plan: string, permissionCode: string, data: OverrideRow | null): void {
  // Evict expired entries if over limit
  if (overrideCache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of overrideCache.entries()) {
      if (v.expiresAt < now) overrideCache.delete(k);
    }
    // If still over, drop oldest half
    if (overrideCache.size >= CACHE_MAX) {
      const keys = Array.from(overrideCache.keys());
      for (let i = 0; i < Math.floor(keys.length / 2); i++) {
        overrideCache.delete(keys[i]);
      }
    }
  }
  overrideCache.set(cacheKey(plan, permissionCode), {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Clear the entire override cache (e.g. after plan config changes). */
export function clearPlanGateCache(): void {
  overrideCache.clear();
}

// ─── Override lookup ────────────────────────────────────────────

/**
 * Query the `plan_permission_overrides` table for a (plan, permissionCode) pair.
 * Returns the override row or null if no row exists.
 */
export async function getOverride(
  plan: string,
  permissionCode: string,
): Promise<OverrideRow | null> {
  // Check cache first
  const cached = getCached(plan, permissionCode);
  if (cached !== undefined) return cached;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('plan_permission_overrides')
    .select('is_granted, usage_limit')
    .eq('plan', plan)
    .eq('permission_code', permissionCode)
    .maybeSingle();

  if (error) {
    logger.error('plan_gate_override_query_failed', {
      error: error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error)),
      route: 'plan-gate',
      plan,
      permissionCode,
    });
    return null;
  }

  const row: OverrideRow | null = data
    ? { is_granted: data.is_granted, usage_limit: data.usage_limit }
    : null;

  setCache(plan, permissionCode, row);
  return row;
}

// ─── Main gate check ────────────────────────────────────────────

/**
 * Check whether the given plan allows the permission, optionally incrementing usage.
 *
 * Logic:
 *   1. Normalize plan name.
 *   2. Look up override row.  If none exists, grant (no restriction).
 *   3. If is_granted=false, deny with PLAN_UPGRADE_REQUIRED.
 *   4. If is_granted=true and no usage_limit, grant (unlimited).
 *   5. If usage_limit has max + period='day', call the RPC to check/increment.
 *   6. On any error, be permissive and log.
 */
export async function checkPlanGate(
  userId: string,
  permissionCode: string,
  plan: string,
  schoolId?: string,
  increment?: boolean,
): Promise<PlanGateResult> {
  try {
    const normalizedPlan = normalizePlan(plan);

    // Step 2: get override
    const override = await getOverride(normalizedPlan, permissionCode);

    // No override row = no restriction
    if (override === null) {
      return { granted: true };
    }

    // Step 3: explicitly denied
    if (!override.is_granted) {
      return {
        granted: false,
        code: 'PLAN_UPGRADE_REQUIRED',
        planNeeded: UPGRADE_TARGET[normalizedPlan] ?? 'pro',
      };
    }

    // Step 4: granted with no usage limit = unlimited
    if (override.usage_limit === null) {
      return { granted: true };
    }

    // Step 5: daily limit enforcement via RPC
    const { max, period } = override.usage_limit;
    if (period === 'day' && typeof max === 'number') {
      const supabase = getSupabaseAdmin();
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'check_and_increment_permission_usage',
        {
          p_user_id: userId,
          p_permission_code: permissionCode,
          p_daily_limit: max,
          ...(schoolId ? { p_school_id: schoolId } : {}),
          ...(increment !== undefined ? { p_increment: increment } : {}),
        },
      );

      if (rpcError) {
        logger.error('plan_gate_rpc_failed', {
          error: rpcError instanceof Error ? rpcError : new Error(String(rpcError)),
          route: 'plan-gate',
          userId,
          permissionCode,
        });
        // Fail open
        return { granted: true };
      }

      // RPC returns { allowed, current_count, daily_limit }
      const allowed = rpcResult?.allowed ?? true;
      const currentCount = rpcResult?.current_count ?? 0;
      const dailyLimit = rpcResult?.daily_limit ?? max;

      return {
        granted: allowed,
        code: allowed ? undefined : 'DAILY_LIMIT_REACHED',
        remaining: Math.max(0, dailyLimit - currentCount),
        limit: dailyLimit,
        count: currentCount,
      };
    }

    // Unrecognized period — fail open
    return { granted: true };
  } catch (err) {
    logger.error('plan_gate_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'plan-gate',
      userId,
      permissionCode,
      plan,
    });
    // Fail open
    return { granted: true };
  }
}

// ─── Parent Plan Gate ──────────────────────────────────────────

/**
 * Check plan gate for a parent permission.
 * Resolves the child's plan and checks the mapped child permission.
 *
 * @param parentUserId - The parent's auth user ID
 * @param parentPermission - e.g., 'child.download_report'
 * @param childStudentId - The specific child being accessed
 */
export async function checkParentPlanGate(
  parentUserId: string,
  parentPermission: string,
  childStudentId: string,
): Promise<PlanGateResult> {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Look up the mapped child permission
    const { data: mapping } = await supabase
      .from('parent_plan_permission_map')
      .select('required_child_permission')
      .eq('parent_permission', parentPermission)
      .maybeSingle();

    if (!mapping) {
      // No mapping = no plan restriction on this parent permission
      return { granted: true };
    }

    // 2. Get the child's subscription plan
    const { data: student } = await supabase
      .from('students')
      .select('subscription_plan')
      .eq('id', childStudentId)
      .maybeSingle();

    if (!student) {
      // Child not found — fail open
      return { granted: true };
    }

    const childPlan = student.subscription_plan || 'free';

    // 3. Check the child's plan against the mapped permission
    return checkPlanGate(childStudentId, mapping.required_child_permission, childPlan);
  } catch (e) {
    logger.error('parent_plan_gate_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'plan-gate',
    });
    // Fail open
    return { granted: true };
  }
}
