import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['upgrade_plan', 'downgrade_plan'] as const;
type PlanAction = (typeof VALID_ACTIONS)[number];

const VALID_PLANS = [
  'free', 'starter', 'starter_monthly', 'starter_yearly',
  'pro', 'pro_monthly', 'pro_yearly',
  'ultimate_monthly', 'ultimate_yearly',
  'unlimited', 'unlimited_monthly', 'unlimited_yearly',
  'basic', 'premium',
];

const MAX_BATCH = 500;

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { studentIds, targetPlan, action } = body;

    // ── Validate inputs ──────────────────────────────────────────
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'studentIds must be a non-empty array' },
        { status: 400 },
      );
    }
    if (studentIds.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Max ${MAX_BATCH} students per request` },
        { status: 400 },
      );
    }
    if (!targetPlan || typeof targetPlan !== 'string' || !VALID_PLANS.includes(targetPlan)) {
      return NextResponse.json(
        { success: false, error: `Invalid targetPlan. Must be one of: ${VALID_PLANS.join(', ')}` },
        { status: 400 },
      );
    }
    if (!action || !VALID_ACTIONS.includes(action as PlanAction)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = studentIds.filter((id: unknown) => typeof id !== 'string' || !uuidRegex.test(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid UUIDs: ${invalidIds.slice(0, 5).join(', ')}${invalidIds.length > 5 ? '...' : ''}` },
        { status: 400 },
      );
    }

    // ── Execute bulk update ──────────────────────────────────────
    const errors: string[] = [];
    let succeeded = 0;

    const { data, error } = await supabaseAdmin
      .from('students')
      .update({ subscription_plan: targetPlan })
      .in('id', studentIds)
      .select('id');

    if (error) {
      errors.push(error.message);
    } else {
      succeeded = data?.length ?? 0;
      if (succeeded < studentIds.length) {
        errors.push(`${studentIds.length - succeeded} student(s) not found or unchanged`);
      }
    }

    // Also sync student_subscriptions.plan_code for affected students
    const canonicalPlan = targetPlan
      .replace(/_(monthly|yearly)$/, '')
      .replace(/^ultimate$/, 'unlimited')
      .replace(/^basic$/, 'starter')
      .replace(/^premium$/, 'pro');

    const { error: subSyncError } = await supabaseAdmin
      .from('student_subscriptions')
      .update({ plan_code: canonicalPlan })
      .in('student_id', studentIds);

    if (subSyncError) {
      errors.push(`subscription sync: ${subSyncError.message}`);
    }

    // ── Log events ───────────────────────────────────────────────
    await logOpsEvent({
      category: 'admin',
      source: 'bulk-actions/plan-change',
      severity: 'info',
      message: `bulk plan change: ${action} to ${targetPlan} for ${studentIds.length} students`,
      context: { action, targetPlan, requested: studentIds.length, succeeded, failed: studentIds.length - succeeded },
    });

    await logAdminAudit(
      auth,
      `bulk.${action}`,
      'students',
      `batch_${studentIds.length}`,
      { targetPlan, requested: studentIds.length, succeeded, errors },
    );

    return NextResponse.json({
      success: true,
      data: {
        processed: studentIds.length,
        succeeded,
        failed: studentIds.length - succeeded,
        errors,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
