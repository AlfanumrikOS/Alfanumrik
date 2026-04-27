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

    // ── Execute bulk update via atomic RPC (P11 split-brain safety) ──
    // Each student is processed via `atomic_plan_change(p_student_id, p_new_plan, p_reason)`
    // which holds a pg_advisory_xact_lock and updates students + student_subscriptions
    // in a single transaction with a domain_events audit row.
    // We loop per student so a single failure does not poison the entire batch.
    const failures: Array<{ student_id: string; error: string }> = [];
    let succeeded = 0;

    const reason = `bulk.${action}: ${targetPlan} via super-admin`;

    for (const studentId of studentIds as string[]) {
      const { error: rpcError } = await supabaseAdmin.rpc('atomic_plan_change', {
        p_student_id: studentId,
        p_new_plan: targetPlan,
        p_reason: reason,
      });

      if (rpcError) {
        failures.push({ student_id: studentId, error: rpcError.message });
      } else {
        succeeded += 1;
      }
    }

    const failed = failures.length;
    // Surface a flat error list for backwards-compatible UI consumers.
    const errors: string[] = failures.map((f) => `${f.student_id}: ${f.error}`);

    // ── Log events ───────────────────────────────────────────────
    await logOpsEvent({
      category: 'admin',
      source: 'bulk-actions/plan-change',
      severity: failed > 0 ? 'warning' : 'info',
      message: `bulk plan change: ${action} to ${targetPlan} for ${studentIds.length} students (${succeeded} ok, ${failed} failed)`,
      context: { action, targetPlan, requested: studentIds.length, succeeded, failed },
    });

    await logAdminAudit(
      auth,
      `bulk.${action}`,
      'students',
      `batch_${studentIds.length}`,
      { targetPlan, requested: studentIds.length, succeeded, failed, failures: failures.slice(0, 50) },
    );

    return NextResponse.json({
      success: true,
      data: {
        processed: studentIds.length,
        succeeded,
        failed,
        errors,
        failures,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
