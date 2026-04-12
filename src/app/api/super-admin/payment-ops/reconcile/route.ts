import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logOpsEvent } from '@/lib/ops-events';

/**
 * POST /api/super-admin/payment-ops/reconcile
 *
 * Fixes stuck payments by syncing student entitlements to match captured payments.
 *
 * Accepts either:
 *   { studentId, paymentId } — fix a single stuck payment
 *   { all: true }           — fix all stuck payments in batch
 *
 * For each stuck payment it:
 * 1. Updates students.subscription_plan to the payment's plan_code
 * 2. Updates students.subscription_expiry (+30d monthly, +365d yearly)
 * 3. Upserts student_subscriptions with status='active'
 * 4. Logs to ops_events and admin_audit_log
 */

interface StuckPayment {
  id: string;
  student_id: string;
  plan_code: string;
  billing_cycle: string;
  razorpay_payment_id: string;
  razorpay_order_id: string | null;
  created_at: string;
}

/** Compute subscription expiry from payment date and billing cycle. */
function computeExpiry(paymentCreatedAt: string, billingCycle: string): string {
  const base = new Date(paymentCreatedAt);
  const days = billingCycle === 'yearly' ? 365 : 30;
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

/** Fix a single stuck payment: sync student plan + upsert subscription. */
async function reconcileOne(
  payment: StuckPayment,
  admin: AdminAuth,
  ipAddress: string | undefined,
): Promise<{ studentId: string; plan: string; ok: boolean; error?: string }> {
  const expiry = computeExpiry(payment.created_at, payment.billing_cycle);

  // 1. Update students.subscription_plan and subscription_expiry
  const { error: studentErr } = await supabaseAdmin
    .from('students')
    .update({
      subscription_plan: payment.plan_code,
      subscription_expiry: expiry,
    })
    .eq('id', payment.student_id);

  if (studentErr) {
    return {
      studentId: payment.student_id,
      plan: payment.plan_code,
      ok: false,
      error: `students update failed: ${studentErr.message}`,
    };
  }

  // 2. Look up plan_id from subscription_plans
  const { data: planRow } = await supabaseAdmin
    .from('subscription_plans')
    .select('id')
    .eq('plan_code', payment.plan_code)
    .limit(1)
    .maybeSingle();

  // 3. Upsert student_subscriptions (matches webhook fallback pattern: onConflict student_id)
  const periodEnd = expiry;
  const periodStart = payment.created_at;

  const { error: subErr } = await supabaseAdmin
    .from('student_subscriptions')
    .upsert(
      {
        student_id: payment.student_id,
        plan_id: planRow?.id ?? null,
        plan_code: payment.plan_code,
        status: 'active',
        billing_cycle: payment.billing_cycle,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        razorpay_payment_id: payment.razorpay_payment_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id' },
    );

  if (subErr) {
    return {
      studentId: payment.student_id,
      plan: payment.plan_code,
      ok: false,
      error: `student_subscriptions upsert failed: ${subErr.message}`,
    };
  }

  // 4. Log ops event
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
      expiry,
      admin_name: admin.name,
    },
  });

  // 5. Log admin audit
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
      expiry,
    },
    ipAddress,
  );

  return { studentId: payment.student_id, plan: payment.plan_code, ok: true };
}

/** Find all stuck payments (same logic as the stuck detection route). */
async function findStuckPayments(): Promise<StuckPayment[]> {
  const { data: capturedPayments, error: phError } = await supabaseAdmin
    .from('payment_history')
    .select('id, student_id, plan_code, billing_cycle, razorpay_payment_id, razorpay_order_id, created_at')
    .eq('status', 'captured')
    .order('created_at', { ascending: false });

  if (phError || !capturedPayments || capturedPayments.length === 0) {
    return [];
  }

  const studentIds = [...new Set(capturedPayments.map((p) => p.student_id))];
  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, subscription_plan')
    .in('id', studentIds);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));

  return capturedPayments.filter((p) => {
    const student = studentMap.get(p.student_id);
    if (!student) return true;
    const currentPlan = student.subscription_plan;
    return !currentPlan || currentPlan === 'free' || currentPlan !== p.plan_code;
  }) as StuckPayment[];
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    // Single reconciliation: { studentId, paymentId }
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

    // Batch reconciliation: { all: true }
    if (body.all === true) {
      const stuckPayments = await findStuckPayments();

      if (stuckPayments.length === 0) {
        return NextResponse.json({
          success: true,
          data: { reconciled: 0, results: [], message: 'No stuck payments found' },
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