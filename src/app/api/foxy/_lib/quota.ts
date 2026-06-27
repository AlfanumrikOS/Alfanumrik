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

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { getAllTenantConfig } from '@/lib/tenant-config';
import { coerceTenantType } from '@/lib/tenant-domain';
import { DAILY_QUOTA, DEFAULT_QUOTA, normalizePlan } from './constants';

// ─── Helper: check and increment daily quota (atomic via RPC) ────────────────

export async function checkAndIncrementQuota(
  studentId: string,
  plan: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const normalizedPlan = normalizePlan(plan);
  const limit = DAILY_QUOTA[normalizedPlan] ?? DEFAULT_QUOTA;
  const today = new Date().toISOString().split('T')[0];

  const { data: rows, error } = await supabaseAdmin.rpc('check_and_record_usage', {
    p_student_id: studentId,
    p_feature: 'foxy_chat',
    p_limit: limit,
    p_usage_date: today,
  });

  if (error) {
    logger.error('foxy_quota_check_failed', { error: error.message, studentId });
    return { allowed: false, remaining: 0 };
  }

  const row = rows?.[0];
  if (!row?.allowed) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: Math.max(0, limit - (row.current_count ?? 0)) };
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
