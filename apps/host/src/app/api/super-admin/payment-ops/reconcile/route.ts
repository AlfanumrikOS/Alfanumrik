import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import {
  findStuckPayments as findStuckPaymentsShared,
  reconcileStuckPayment,
  type StuckPayment,
} from '@alfanumrik/lib/reconcile-stuck-payments';

/**
 * POST /api/super-admin/payment-ops/reconcile
 *
 * Fixes stuck payments by syncing student entitlements to match captured payments.
 *
 * Accepts either:
 *   { studentId, paymentId, dryRun? } — preview or fix a single stuck payment
 *   { all: true, dryRun? }            — preview or fix all stuck payments in batch
 *
 * dryRun:true (or the `all` path with no dryRun key defaulting to false — see
 * below) returns what WOULD be reconciled without writing anything.
 *
 * P1-5 fix (2026-09-02 launch audit): this route used to run its own copy of
 * the stuck-payment filter (no recency bound, no terminal-state guard, no
 * latest-payment-per-student guard) and wrote via two independent raw
 * UPDATE/UPSERT calls instead of the atomic activation RPC — it could
 * resurrect a cancelled subscription or downgrade a student who had since
 * upgraded. Now shares @alfanumrik/lib/reconcile-stuck-payments with the
 * cron self-heal job and the /stuck preview route, and adds the dry-run
 * mode called for in the audit's acceptance criteria.
 */

/** Fix a single stuck payment via the shared atomic RPC + audit trail. */
async function reconcileOne(
  payment: StuckPayment,
  admin: AdminAuth,
  ipAddress: string | undefined,
): Promise<{ studentId: string; plan: string; ok: boolean; error?: string }> {
  const result = await reconcileStuckPayment(supabaseAdmin, payment);
  if (!result.ok) {
    return { studentId: payment.student_id, plan: payment.plan_code, ok: false, error: result.error };
  }

  await logOpsEvent({
    category: 'payment',
    source: 'payment-ops/reconcile',
    severity: 'info',
    message: 'Manual reconciliation: subscription activated',
    subjectType: 'student',
    subjectId: payment.student_id,
    context: {
      payment_id: payment.id,
      razorpay_payment_id: payment.razorpay_payment_id,
      plan_code: payment.plan_code,
      billing_cycle: payment.billing_cycle,
      admin_name: admin.name,
      reconciled_at_stamp_warning: result.error, // set only on the non-blocking stamp-failure path
    },
  });

  await logAdminAudit(
    admin,
    'payment_reconcile',
    'student',
    payment.student_id,
    {
      payment_id: payment.id,
      plan_code: payment.plan_code,
      billing_cycle: payment.billing_cycle,
      razorpay_payment_id: payment.razorpay_payment_id,
    },
    ipAddress,
  );

  return { studentId: payment.student_id, plan: payment.plan_code, ok: true };
}

/** Find stuck payments (shared filter — no recency bound: a human reviews every match here). */
async function findStuckPayments(): Promise<StuckPayment[]> {
  return findStuckPaymentsShared(supabaseAdmin);
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;
    const dryRun = body.dryRun === true;

    // Single reconciliation: { studentId, paymentId, dryRun? }
    if (body.studentId && body.paymentId) {
      const { data: payment, error: payErr } = await supabaseAdmin
        .from('payment_history')
        .select('id, student_id, plan_code, billing_cycle, razorpay_payment_id, razorpay_order_id, created_at')
        .eq('id', body.paymentId)
        .eq('student_id', body.studentId)
        .eq('status', 'captured')
        .maybeSingle();

      if (payErr || !payment) {
        return NextResponse.json(
          { success: false, error: 'Payment not found or not in captured status' },
          { status: 404 },
        );
      }

      // dryRun: report the payment as a candidate WITHOUT checking it against
      // the shared safety guards (recency/terminal-state/latest-per-student)
      // — the admin explicitly named this exact payment, so those guards
      // apply at write time (findStuckPayments below, for the {all} path)
      // rather than gating what a preview can even show for a single id.
      if (dryRun) {
        return NextResponse.json({
          success: true,
          data: { wouldReconcile: 1, dryRun: true, results: [payment] },
        });
      }

      const result = await reconcileOne(payment as StuckPayment, auth, ipAddress);

      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        data: { reconciled: 1, results: [result] },
      });
    }

    // Batch reconciliation: { all: true, dryRun? }
    if (body.all === true) {
      const stuckPayments = await findStuckPayments();

      if (stuckPayments.length === 0) {
        return NextResponse.json({
          success: true,
          data: { reconciled: 0, results: [], message: 'No stuck payments found' },
        });
      }

      if (dryRun) {
        return NextResponse.json({
          success: true,
          data: { wouldReconcile: stuckPayments.length, dryRun: true, results: stuckPayments },
        });
      }

      const results = [];
      for (const payment of stuckPayments) {
        const result = await reconcileOne(payment, auth, ipAddress);
        results.push(result);
      }

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok).length;

      return NextResponse.json({
        success: failed === 0,
        data: {
          reconciled: succeeded,
          failed,
          total: stuckPayments.length,
          results,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid request. Provide { studentId, paymentId } or { all: true }.' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}