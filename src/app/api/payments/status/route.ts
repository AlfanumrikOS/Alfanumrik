import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Subscription Status Endpoint
 *
 * Returns the authenticated user's subscription status,
 * billing info, and entitlement state. All prices in rupees.
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return request.cookies.getAll().map(c => ({ name: c.name, value: c.value })); },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const directClient = createClient(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: authHeader } },
        });
        user = (await directClient.auth.getUser()).data.user;
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: studentRow } = await admin
      .from('students')
      .select('id, subscription_plan')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!studentRow) {
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

    const { data: sub } = await admin
      .from('student_subscriptions')
      .select(`
        plan_code, status, billing_cycle, auto_renew,
        current_period_start, current_period_end, next_billing_at,
        grace_period_end, cancelled_at, cancel_reason,
        renewal_attempts, amount_paid, razorpay_subscription_id
      `)
      .eq('student_id', studentRow.id)
      .maybeSingle();

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
      .maybeSingle();

    const isInGrace = sub.status === 'past_due' &&
      sub.grace_period_end != null &&
      new Date() < new Date(sub.grace_period_end);

    // A "cancel-scheduled" sub is one whose user has turned auto-renew off but
    // is still inside the paid period. That state only exists when status is
    // 'active' AND cancelled_at is set. For status='pending' (a fresh subscribe
    // awaiting Razorpay's first-charge webhook) cancelled_at — if non-null —
    // is stale data left over from a previous subscription generation and
    // must NOT be treated as a current cancel.
    const isCancelScheduled = sub.status === 'active' && sub.cancelled_at != null;

    // Suppress lifecycle dates and stale cancellation markers while pending.
    // Until the webhook activates, the period dates either don't exist or
    // belong to a previous subscription — surfacing them produces the
    // contradictory "Access Until <past date>" + "Cancellation Scheduled"
    // banner that triggered this fix.
    const isPending = sub.status === 'pending';

    return NextResponse.json({
      plan_code: sub.plan_code,
      plan_name: plan?.name || sub.plan_code,
      status: sub.status,
      billing_cycle: sub.billing_cycle,
      auto_renew: sub.auto_renew,
      is_recurring: !!sub.razorpay_subscription_id,
      price_inr: sub.billing_cycle === 'yearly' ? plan?.price_yearly : plan?.price_monthly,
      current_period_start: isPending ? null : sub.current_period_start,
      current_period_end: isPending ? null : sub.current_period_end,
      next_billing_at: isPending ? null : sub.next_billing_at,
      is_in_grace: isInGrace,
      grace_period_end: isInGrace ? sub.grace_period_end : null,
      is_cancel_scheduled: isCancelScheduled,
      cancelled_at: isCancelScheduled ? sub.cancelled_at : null,
      renewal_attempts: sub.renewal_attempts,
    });
  } catch (err) {
    logger.error('Status error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
