import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { findStuckPayments } from '@alfanumrik/lib/reconcile-stuck-payments';

/**
 * GET /api/super-admin/payment-ops/stuck
 *
 * Detects "stuck" payments: payment_history shows status='captured'
 * but the student's subscription_plan does not match the paid plan_code.
 *
 * P1-5 fix (2026-09-02 launch audit): this route used to run its own
 * unbounded copy of the filter (no recency bound, no terminal-state guard,
 * no latest-payment-per-student guard) — a THIRD independently-drifted copy
 * alongside the two the audit found in the reconcile POST route and the
 * cron self-heal job. This is the admin's preview before triggering a
 * reconcile, so it must show exactly what @alfanumrik/lib/reconcile-stuck-
 * payments's shared filter would act on — a preview that shows different
 * (unsafe) rows than what actually gets reconciled is worse than no
 * preview at all.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const stuck = await findStuckPayments(supabaseAdmin);

    if (stuck.length === 0) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

    const studentIds = [...new Set(stuck.map((p) => p.student_id))];
    const { data: students, error: sError } = await supabaseAdmin
      .from('students')
      .select('id, name, email, subscription_plan, subscription_expiry, auth_user_id')
      .in('id', studentIds);

    if (sError) {
      return NextResponse.json(
        { success: false, error: `Failed to query students: ${sError.message}` },
        { status: 500 },
      );
    }

    const studentMap = new Map((students || []).map((s) => [s.id, s]));

    const stuckPayments = stuck.map((p) => {
      const student = studentMap.get(p.student_id);
      return {
        paymentId: p.id,
        studentId: p.student_id,
        paidPlan: p.plan_code,
        billingCycle: p.billing_cycle,
        razorpayPaymentId: p.razorpay_payment_id,
        razorpayOrderId: p.razorpay_order_id,
        amount: p.amount,
        paymentStatus: 'captured',
        paymentDate: p.created_at,
        currentPlan: student?.subscription_plan || null,
        subscriptionExpiry: student?.subscription_expiry || null,
        studentName: student?.name || null,
        studentEmail: student?.email || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: stuckPayments,
      count: stuckPayments.length,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}