import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { createRazorpaySubscription, createRazorpayOrder } from '@/lib/razorpay';
import { logger } from '@/lib/logger';
import { paymentSubscribeSchema, validateBody } from '@/lib/validation';
import { logOpsEvent } from '@/lib/ops-events';

/**
 * Subscribe Endpoint
 *
 * Creates a Razorpay Subscription (for monthly recurring) or
 * a Razorpay Order (for yearly one-time) based on billing_cycle.
 *
 * P11 fix (2026-04-14):
 * - For monthly: we now atomically write a pending payment_history row AND
 *   upsert student_subscriptions with the razorpay_subscription_id BEFORE
 *   returning to the client. This lets the webhook resolve the student later
 *   via notes.student_id OR student_subscriptions.razorpay_subscription_id.
 * - Razorpay notes now include student_id (canonical) in addition to user_id.
 * - plan_code is canonicalized so pending and active rows always agree.
 *
 * Client sends: { plan_code, billing_cycle }
 * Client NEVER sends amount.
 */

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code.
 *  Keep in sync with the same helper in the webhook route. */
function canonicalizePlan(raw: string): string {
  return raw
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

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
    const { plan_code: rawPlan, billing_cycle } = validation.data;

    // Zod allows 'free' as a valid plan_code, but subscribing to free is not permitted
    if (rawPlan === 'free') {
      return NextResponse.json({ error: 'Cannot subscribe to the free plan' }, { status: 400 });
    }

    // Canonicalize plan_code BEFORE any DB write so pending & active rows match.
    const plan_code = canonicalizePlan(rawPlan);

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

      // 1. Create the Razorpay subscription first. We put BOTH student_id
      //    (resolved via the RPC below) and user_id in notes for belt-and-suspenders
      //    resolution in the webhook. student_id is canonical; user_id kept for
      //    backward compat with older webhook code paths.
      //
      //    We need the student_id BEFORE calling Razorpay so we can put it in
      //    notes. Resolve it here (mirrors verify route: auth_user_id → email fallback).
      let resolvedStudentId: string | undefined = studentRow?.id;
      if (!resolvedStudentId && user.email) {
        const { data: byEmail } = await admin
          .from('students')
          .select('id')
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedStudentId = byEmail?.id;
      }

      const subscription = await createRazorpaySubscription({
        razorpayPlanId: plan.razorpay_plan_id_monthly,
        totalBillingCycles: 12,
        customerNotify: false,
        notes: {
          // Canonical resolution key — read by webhook first.
          student_id: resolvedStudentId ?? '',
          // Legacy keys (still read as fallbacks).
          user_id: user.id,
          plan_code,
          billing_cycle: 'monthly',
        },
      });

      // 2. Atomically write pending payment_history + upsert student_subscriptions
      //    with razorpay_subscription_id persisted. If this fails, DO NOT return
      //    200 — client will retry and we'll create a fresh Razorpay sub + row.
      //    The orphan Razorpay sub will be cleaned up by reconcile_stuck_subscriptions.
      const { error: rpcErr } = await admin.rpc('create_pending_subscription', {
        p_auth_user_id: user.id,
        p_email: user.email ?? '',
        p_plan_code: plan_code,
        p_billing_cycle: 'monthly',
        p_razorpay_subscription_id: subscription.id,
        p_razorpay_plan_id: plan.razorpay_plan_id_monthly,
        p_amount_inr: plan.price_monthly,
      });

      if (rpcErr) {
        logger.error('subscribe: create_pending_subscription RPC failed', {
          error: rpcErr.message,
          razorpay_subscription_id: subscription.id,
        });
        await logOpsEvent({
          category: 'payment',
          severity: 'error',
          source: 'subscribe/route.ts',
          message: 'create_pending_subscription RPC failed',
          context: {
            rz_sub_id: subscription.id,
            plan_code,
            billing_cycle: 'monthly',
            error: rpcErr.message,
          },
        });
        return NextResponse.json({
          error: 'Subscription creation failed. Your card has not been charged. Please try again.',
        }, { status: 503 });
      }

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
    // Yearly path is unchanged: verify route writes the payment_history row
    // after Razorpay signature verification succeeds.
    const order = await createRazorpayOrder({
      amountInr: plan.price_yearly,
      receipt: `${user.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
      notes: {
        student_id: studentRow?.id ?? '',
        user_id: user.id,
        plan_code,
        billing_cycle: 'yearly',
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
