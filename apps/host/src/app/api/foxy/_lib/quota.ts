/**
 * /api/foxy — M3 extracted quota + tenant-AI-override helpers.
 *
 * H1 REFACTOR Step 3 (behavior-preserving). These functions were lifted
 * verbatim out of `src/app/api/foxy/route.ts`. They perform service-role
 * Supabase I/O (daily-quota check/increment via the `check_and_record_usage`
 * RPC, quota refund on upstream failure, and tenant AI-override resolution).
 * The route imports them and uses them identically at the same call sites —
 * zero behavior change. Quota constants live in `./constants` (Step 1); this
 * module imports them rather than redefining. Pinned by the 25 route-
 * characterization tests from Step 0.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { getAllTenantConfig } from '@alfanumrik/lib/tenant-config';
import { coerceTenantType } from '@alfanumrik/lib/tenant-domain';
import { UNLIMITED_QUOTA } from './constants';

// ─── Helper: check and increment daily quota (atomic via RPC) ────────────────

/**
 * Atomically check-and-increment the student's daily `foxy_chat` usage.
 *
 * AUTHORITY MODEL (important — do not reintroduce a Node-side limit table):
 * The DB is the single source of truth for enforcement. `check_and_record_usage`
 * derives the cap internally via `get_plan_limit()` → `subscription_plans.
 * foxy_chats_per_day` (a value of `-1` means unlimited and is mapped to
 * {@link UNLIMITED_QUOTA} inside the RPC). The RPC IGNORES any `p_limit`
 * argument, so we no longer pass one — passing a Node-side number here used to
 * imply the old local `DAILY_QUOTA` map governed enforcement. It never did;
 * that was a misleading dead path and has been removed.
 *
 * The RPC's return column is `used_count` (NOT `current_count` — that name never
 * existed in the return shape; reading it made `remaining` always resolve to the
 * full limit). We read `used_count` (the post-increment count on an allowed turn)
 * and derive `remaining` against the SAME DB authority the RPC enforced with, by
 * calling `get_plan_limit`. One extra indexed RPC on a path that already awaits a
 * multi-second LLM round-trip — negligible latency, and it keeps `remaining`
 * honest (astronomically large, never negative, for the now-unlimited paid plans).
 */
export async function checkAndIncrementQuota(
  studentId: string,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const today = new Date().toISOString().split('T')[0];

  const { data: rows, error } = await supabaseAdmin.rpc('check_and_record_usage', {
    p_student_id: studentId,
    p_feature: 'foxy_chat',
    p_usage_date: today,
    // NOTE: p_limit intentionally omitted — the RPC derives the authoritative
    // cap from get_plan_limit() and ignores this argument. See the doc above.
  });

  if (error) {
    logger.error('foxy_quota_check_failed', { error: error.message, studentId });
    return { allowed: false, remaining: 0, limit: 0 };
  }

  const row = (rows as Array<{ allowed?: boolean; used_count?: number }> | null)?.[0];
  if (!row?.allowed) {
    return { allowed: false, remaining: 0, limit: 0 };
  }

  const limit = await resolveDailyLimit(studentId);
  const usedCount = row.used_count ?? 0;
  return { allowed: true, remaining: Math.max(0, limit - usedCount), limit };
}

/**
 * Resolve the student's DB-authoritative daily `foxy_chat` cap via the same
 * `get_plan_limit` RPC that `check_and_record_usage` uses internally (so the two
 * never disagree). Returns {@link UNLIMITED_QUOTA} for the unlimited paid plans
 * (`foxy_chats_per_day = -1`).
 *
 * Fail-soft: the authoritative check_and_record_usage already returned
 * allowed=true for this turn, so a transient limit-lookup failure must not turn
 * a served answer into a spurious "0 left / upgrade now" nudge. On error we treat
 * the cap as unlimited — the display degrades to "plenty left, no upsell", which
 * is the safe direction (we never wrongly block and never spuriously upsell).
 */
async function resolveDailyLimit(studentId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('get_plan_limit', {
    p_student_id: studentId,
    p_feature: 'foxy_chat',
  });
  if (error || typeof data !== 'number') {
    logger.warn('foxy_quota_limit_lookup_failed', {
      error: error?.message,
      studentId,
    });
    return UNLIMITED_QUOTA;
  }
  return data;
}

/**
 * Refund one foxy_chat usage count on the student's daily usage row. Called
 * after an upstream failure (circuit open, grounded-answer service down,
 * chapter not yet ingested) so the student doesn't "lose" a message to an
 * error they didn't cause. Best-effort — a DB failure here is logged but
 * doesn't propagate.
 */
export async function refundQuota(studentId: string, feature: string): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: row } = await supabaseAdmin
      .from('student_daily_usage')
      .select('usage_count')
      .eq('student_id', studentId)
      .eq('feature', feature)
      .eq('usage_date', today)
      .single();
    if (row && typeof row.usage_count === 'number' && row.usage_count > 0) {
      await supabaseAdmin
        .from('student_daily_usage')
        .update({ usage_count: row.usage_count - 1, updated_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('feature', feature)
        .eq('usage_date', today);
    }
  } catch (err) {
    logger.warn('foxy_quota_refund_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
      feature,
    });
  }
}

/**
 * Resolve the tenant AI overrides (personality / tone / pedagogy) for
 * the school this student belongs to. Returns an empty record for B2C
 * students, students whose school can't be resolved, or any failure
 * along the path — never throws.
 *
 * Cached at the tenant_config layer (5-min TTL); plus the school_id
 * lookup is one extra round-trip per legacy-foxy call which is on the
 * cold path (`ff_grounded_ai_foxy` OFF). The grounded-answer primary
 * path is unaffected by this code.
 */
export async function resolveTenantAiOverrides(studentId: string): Promise<{
  tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
  tenantTone?: 'formal' | 'neutral' | 'casual';
  tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
}> {
  try {
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('school_id, schools(tenant_type)')
      .eq('id', studentId)
      .maybeSingle();

    const schoolId = student?.school_id as string | undefined;
    if (!schoolId) return {};

    const tenantTypeRaw = (student?.schools as { tenant_type?: string } | undefined)?.tenant_type ?? null;
    const tenantType = coerceTenantType(tenantTypeRaw);

    const config = await getAllTenantConfig(schoolId, tenantType);
    return {
      tenantPersonality: config['ai.personality'],
      tenantTone: config['ai.tone'],
      tenantPedagogy: config['ai.pedagogy'],
    };
  } catch (err) {
    logger.warn('resolve_tenant_ai_overrides_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return {};
  }
}
