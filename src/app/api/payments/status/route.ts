import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  createBillingAdminClient,
  getAuthedUserFromRequest,
  getBillingEnv,
  resolveStudentIdForUser,
} from '@/lib/domains/billing';

/**
 * Subscription Status Endpoint
 *
 * Returns the authenticated user's subscription status,
 * billing info, and entitlement state. All prices in rupees.
 */
export async function GET(request: NextRequest) {
  try {
    const envRes = getBillingEnv();
    if (!envRes.ok) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    const userRes = await getAuthedUserFromRequest(request, envRes.data);
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createBillingAdminClient(envRes.data);
    const studentIdRes = await resolveStudentIdForUser(admin, userRes.data);
    if (!studentIdRes.ok) {
      return NextResponse.json({
        plan_code: 'free',
        plan_name: 'Explorer',
        status: 'active',
        billing_cycle: null,
        auto_renew: false,
        price_inr: 0,
        current_period_end: null,
        next_billing_at: null,
        is_in_grace: false,
      });
    }

    const studentId = studentIdRes.data;

    const { data: sub } = await admin
      .from('student_subscriptions')
      .select(`
        plan_code, status, billing_cycle, auto_renew,
        current_period_start, current_period_end, next_billing_at,
        grace_period_end, cancelled_at, cancel_reason,
        renewal_attempts, amount_paid, razorpay_subscription_id
      `)
      .eq('student_id', studentId)
      .single();

    if (!sub || sub.plan_code === 'free') {
      return NextResponse.json({
        plan_code: 'free',
        plan_name: 'Explorer',
        status: 'active',
        billing_cycle: null,
        auto_renew: false,
        price_inr: 0,
        current_period_end: null,
        next_billing_at: null,
        is_in_grace: false,
      });
    }

    // Get plan details for display
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('name, price_monthly, price_yearly')
      .eq('plan_code', sub.plan_code)
      .single();

    const isInGrace = sub.status === 'past_due' &&
      sub.grace_period_end != null &&
      new Date() < new Date(sub.grace_period_end);

    const isCancelScheduled = sub.cancelled_at != null && sub.status !== 'cancelled';

    return NextResponse.json({
      plan_code: sub.plan_code,
      plan_name: plan?.name || sub.plan_code,
      status: sub.status,
      billing_cycle: sub.billing_cycle,
      auto_renew: sub.auto_renew,
      is_recurring: !!sub.razorpay_subscription_id,
      price_inr: sub.billing_cycle === 'yearly' ? plan?.price_yearly : plan?.price_monthly,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      next_billing_at: sub.next_billing_at,
      is_in_grace: isInGrace,
      grace_period_end: isInGrace ? sub.grace_period_end : null,
      is_cancel_scheduled: isCancelScheduled,
      cancelled_at: sub.cancelled_at,
      renewal_attempts: sub.renewal_attempts,
    });
  } catch (err) {
    logger.error('Status error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
