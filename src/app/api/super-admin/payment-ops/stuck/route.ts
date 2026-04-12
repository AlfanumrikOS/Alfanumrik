import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/payment-ops/stuck
 *
 * Detects "stuck" payments: payment_history shows status='captured'
 * but the student's subscription_plan does not match the paid plan_code.
 *
 * This mirrors the logic in supabase/reconcile_stuck_payments.sql.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Query payment_history with captured status, join students for plan comparison.
    // We pull all captured payments and filter client-side for the mismatch,
    // because Supabase JS client doesn't support cross-table WHERE conditions
    // in a single .select() call.
    const { data: capturedPayments, error: phError } = await supabaseAdmin
      .from('payment_history')
      .select(`
        id,
        student_id,
        plan_code,
        billing_cycle,
        razorpay_payment_id,
        razorpay_order_id,
        amount,
        status,
        created_at
      `)
      .eq('status', 'captured')
      .order('created_at', { ascending: false });

    if (phError) {
      return NextResponse.json(
        { success: false, error: `Failed to query payment_history: ${phError.message}` },
        { status: 500 },
      );
    }

    if (!capturedPayments || capturedPayments.length === 0) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

    // Get unique student IDs from captured payments
    const studentIds = [...new Set(capturedPayments.map((p) => p.student_id))];

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

    const studentMap = new Map(
      (students || []).map((s) => [s.id, s]),
    );

    // Filter for stuck payments: student plan is null, 'free', or doesn't match payment plan_code
    const stuckPayments = capturedPayments
      .filter((p) => {
        const student = studentMap.get(p.student_id);
        if (!student) return true; // student not found is also stuck
        const currentPlan = student.subscription_plan;
        return (
          !currentPlan ||
          currentPlan === 'free' ||
          currentPlan !== p.plan_code
        );
      })
      .map((p) => {
        const student = studentMap.get(p.student_id);
        return {
          paymentId: p.id,
          studentId: p.student_id,
          paidPlan: p.plan_code,
          billingCycle: p.billing_cycle,
          razorpayPaymentId: p.razorpay_payment_id,
          razorpayOrderId: p.razorpay_order_id,
          amount: p.amount,
          paymentStatus: p.status,
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