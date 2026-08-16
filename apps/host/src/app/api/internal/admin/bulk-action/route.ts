import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logAdminAction } from '@alfanumrik/lib/admin-auth';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { validateBody, zPlanCode } from '@alfanumrik/lib/validation';

export const runtime = 'nodejs';

// Bulk-action body schema. `upgrade_plan` requires a `plan` field constrained
// to the canonical plan codes; the previous version accepted ['free','basic','premium']
// — `basic` and `premium` are legacy values that the chk_student_plan_code DB
// constraint still accepts for backwards compat but no downstream entitlement
// code recognises. Setting subscription_plan='premium' silently broke Foxy
// limits, leaderboard tier badges, and renewal flow until reconciliation.
// Now constrained to zPlanCode (free/starter/pro/unlimited) — the same enum
// used everywhere else (payments/verify, payments/create-order, plan_subject_access
// CHECK constraint).
const BulkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('restore'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('upgrade_plan'),
    ids: z.array(z.string().uuid()).min(1).max(500),
    plan: zPlanCode,
  }),
  z.object({
    action: z.literal('downgrade_plan'),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
]);

// POST /api/internal/admin/bulk-action
export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'user.manage');
  if (!auth.authorized) return auth.errorResponse!;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const validation = validateBody(BulkActionSchema, rawBody);
  if (!validation.success) return validation.error;
  const body = validation.data;

  try {
    switch (body.action) {
      case 'suspend': {
        const { error } = await supabase
          .from('students')
          .update({ is_active: false, account_status: 'suspended' })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
      case 'restore': {
        const { error } = await supabase
          .from('students')
          .update({ is_active: true, account_status: 'active' })
          .in('id', body.ids);
        if (error) throw error;
        break;
      }
      case 'upgrade_plan': {
        // P11 split-brain safety: route each student through the
        // `atomic_plan_change` RPC (pg_advisory_xact_lock + students +
        // student_subscriptions updated in one transaction + audit event),
        // exactly like super-admin/bulk-actions/plan-change. Loop per student
        // so one failure does not poison the whole batch; aggregate rpcError.
        const failures: Array<{ student_id: string; error: string }> = [];
        const reason = `internal.bulk.upgrade_plan: ${body.plan}`;
        for (const studentId of body.ids) {
          const { error: rpcError } = await supabase.rpc('atomic_plan_change', {
            p_student_id: studentId,
            p_new_plan: body.plan,
            p_reason: reason,
          });
          if (rpcError) failures.push({ student_id: studentId, error: rpcError.message });
        }
        if (failures.length > 0) {
          throw new Error(
            `atomic_plan_change failed for ${failures.length}/${body.ids.length} students: ` +
              failures.slice(0, 5).map((f) => `${f.student_id}: ${f.error}`).join('; '),
          );
        }
        break;
      }
      case 'downgrade_plan': {
        // P11 split-brain safety: same atomic RPC path, target plan 'free'.
        const failures: Array<{ student_id: string; error: string }> = [];
        const reason = 'internal.bulk.downgrade_plan: free';
        for (const studentId of body.ids) {
          const { error: rpcError } = await supabase.rpc('atomic_plan_change', {
            p_student_id: studentId,
            p_new_plan: 'free',
            p_reason: reason,
          });
          if (rpcError) failures.push({ student_id: studentId, error: rpcError.message });
        }
        if (failures.length > 0) {
          throw new Error(
            `atomic_plan_change failed for ${failures.length}/${body.ids.length} students: ` +
              failures.slice(0, 5).map((f) => `${f.student_id}: ${f.error}`).join('; '),
          );
        }
        break;
      }
    }

    await logAdminAction({
      action: `bulk_${body.action}`,
      entity_type: 'students',
      details: {
        ids_count: body.ids.length,
        ...(body.action === 'upgrade_plan' ? { plan: body.plan } : {}),
      },
      ip,
      actorUserId: auth.userId,
    });

    return NextResponse.json({ success: true, action: body.action, affected: body.ids.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
