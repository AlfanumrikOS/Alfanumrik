import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { createRazorpaySubscription, createRazorpayOrder } from '@/lib/razorpay';
import { logger } from '@/lib/logger';
import { paymentSubscribeSchema, validateBody } from '@/lib/validation';

/**
 * Subscribe Endpoint
 *
 * Creates a Razorpay Subscription (for monthly recurring) or
 * a Razorpay Order (for yearly one-time) based on billing_cycle.
 *
 * Client sends: { plan_code, billing_cycle }
 * Client NEVER sends amount.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      return NextResponse.json({ error: 'Payment system not configured' }, { status: 503 });
    }

    // Auth
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

    const rawBody = await request.json();
    const validation = validateBody(paymentSubscribeSchema, rawBody);
    if (!validation.success) return validation.error;
    const { plan_code, billing_cycle } = validation.data;

    // Zod allows 'free' as a valid plan_code, but subscribing to free is not permitted
    if (plan_code === 'free') {
      return NextResponse.json({ error: 'Cannot subscribe to the free plan' }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Look up plan from DB
    const { data: plan, error: planErr } = await admin
      .from('subscription_plans')
      .select('id, plan_code, name, price_monthly, price_yearly, razorpay_plan_id_monthly, is_active')
      .eq('plan_code', plan_code)
      .eq('is_active', true)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
    }

    // Check for existing active subscription to prevent duplicates
    const { data: studentRow } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (studentRow) {
      const { data: existingSub } = await admin
        .from('student_subscriptions')
        .select('id, status, razorpay_subscription_id, plan_code, billing_cycle')
        .eq('student_id', studentRow.id)
        .single();

      // If already on same plan+cycle with active recurring, return early
      if (existingSub?.status === 'active' &&
          existingSub.plan_code === plan_code &&
          existingSub.billing_cycle === billing_cycle &&
          existingSub.razorpay_subscription_id) {
        return NextResponse.json({
          error: 'You already have an active subscription to this plan',
        }, { status: 409 });
      }
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;

    // ─── Monthly: Create Razorpay Subscription (recurring) ───
    if (billing_cycle === 'monthly') {
      if (!plan.razorpay_plan_id_monthly) {
        return NextResponse.json({
          error: 'Monthly recurring billing is being set up. Please try again shortly.',
        }, { status: 503 });
      }

      const subscription = await createRazorpaySubscription({
        razorpayPlanId: plan.razorpay_plan_id_monthly,
        totalBillingCycles: 12,
        customerNotify: false,
        notes: {
          user_id: user.id,
          plan_code,
          billing_cycle: 'monthly',
          email: user.email || '',
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          type: 'subscription',
          subscription_id: subscription.id,
          key: razorpayKeyId,
          plan_code,
          billing_cycle: 'monthly',
          price_inr: plan.price_monthly,
        },
      });
    }

    // ─── Yearly: Create Razorpay Order (one-time) ────────────
    const order = await createRazorpayOrder({
      amountInr: plan.price_yearly,
      receipt: `${user.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
      notes: {
        user_id: user.id,
        plan_code,
        billing_cycle: 'yearly',
        email: user.email || '',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        type: 'order',
        order_id: order.id,
        amount: order.amount, // paisa — required by Razorpay checkout widget
        price_inr: plan.price_yearly,
        currency: order.currency,
        key: razorpayKeyId,
        plan_code,
        billing_cycle: 'yearly',
      },
    });
  } catch (err) {
    logger.error('Subscribe error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Payment initialization failed' }, { status: 500 });
  }
}
