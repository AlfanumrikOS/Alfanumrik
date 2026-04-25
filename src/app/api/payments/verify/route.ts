import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { paymentVerifySchema, validateBody } from '@/lib/validation';

/**
 * Payment Verification Route
 *
 * Called by the client after Razorpay checkout succeeds.
 * 1. Verifies HMAC signature (proves payment is genuine)
 * 2. Records payment in payment_history (idempotent)
 * 3. Activates subscription via RPC (idempotent)
 * 4. Returns success ONLY if entitlement is actually granted
 *
 * NEVER returns success:true if subscription activation failed.
 */

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      logger.error('verify: MISSING ENV VARS', { hasServiceKey: !!serviceKey, hasUrl: !!supabaseUrl });
      return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
    }

    // Auth: cookie-based first, Bearer token fallback
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
    const validation = validateBody(paymentVerifySchema, rawBody);
    if (!validation.success) return validation.error;
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      razorpay_subscription_id,
      plan_code, billing_cycle, type,
    } = validation.data;

    // Verify Razorpay HMAC signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpaySecret) {
      logger.error('verify: MISSING RAZORPAY_KEY_SECRET env var');
      return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
    }

    // Subscription verification: HMAC of subscription_id|payment_id
    // Order verification: HMAC of order_id|payment_id
    const signaturePayload = type === 'subscription'
      ? `${razorpay_subscription_id}|${razorpay_payment_id}`
      : `${razorpay_order_id}|${razorpay_payment_id}`;

    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(signaturePayload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks on signature verification
    const sigBuffer = Buffer.from(razorpay_signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 401 });
    }

    // Use Supabase admin client (service_role) for all DB operations
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Duplicate protection — if already processed, return success
    const { data: existing } = await admin
      .from('payment_history')
      .select('id, status')
      .eq('razorpay_payment_id', razorpay_payment_id)
      .limit(1);

    if (existing && existing.length > 0 && existing[0].status === 'captured') {
      return NextResponse.json({ success: true, plan: plan_code, note: 'already_processed' });
    }

    // Look up student ID — try auth_user_id first, then check if multiple records exist
    let studentId: string | undefined;
    const { data: studentRow, error: studentErr } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();

    studentId = studentRow?.id;

    // If not found, log details for debugging
    if (!studentId) {
      logger.error('verify: student not found for auth_user_id', { authUserId: user.id, error: studentErr?.message });

      // Fallback: try finding by email (handles cases where auth_user_id changed after re-signup)
      if (user.email) {
        const { data: emailRow } = await admin
          .from('students')
          .select('id')
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (emailRow) {
          studentId = emailRow.id;
          // Fix the stale auth_user_id
          await admin.from('students').update({ auth_user_id: user.id }).eq('id', studentId);
          logger.warn('verify: found student by email, fixed auth_user_id', { studentId });
        }
      }
    }

    if (!studentId) {
      logger.error('verify: student not found by auth_user_id or email', { authUserId: user.id });
      // Do NOT return success:true — no entitlement was granted (P11).
      // The webhook will handle activation when it arrives.
      return NextResponse.json({
        success: false,
        error: 'Payment verified but account setup is completing. Your plan will activate within a few minutes.',
        payment_id: razorpay_payment_id,
        status: 'activation_pending',
      }, { status: 202 });
    }

    // Get amount from subscription_plans (source of truth)
    const { data: planRow, error: planError } = await admin
      .from('subscription_plans')
      .select('price_monthly, price_yearly')
      .eq('plan_code', plan_code)
      .maybeSingle();

    if (planError) {
      logger.error('verify: subscription_plans lookup failed', { error: planError.message, plan_code });
      return NextResponse.json({ error: 'Plan lookup failed' }, { status: 500 });
    }
    if (!planRow) {
      logger.error('verify: unknown plan_code', { plan_code });
      return NextResponse.json({ error: `Unknown plan: ${plan_code}` }, { status: 400 });
    }

    const priceRupees = billing_cycle === 'yearly' ? planRow.price_yearly : planRow.price_monthly;

    // Record payment — ignore duplicate constraint (webhook may have already inserted)
    const { error: insertErr } = await admin.from('payment_history').insert({
      student_id: studentId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      plan_code,
      billing_cycle,
      currency: 'INR',
      amount: priceRupees, // store in rupees (INR)
      status: 'captured',
      payment_method: 'razorpay',
    });
    if (insertErr && !insertErr.message.includes('duplicate')) {
      logger.error('verify: payment_history insert failed', { error: insertErr.message });
    }

    // Activate subscription via RPC — this is the critical step
    const { error: rpcError } = await admin.rpc('activate_subscription_locked', {
      p_auth_user_id: user.id,
      p_plan_code: plan_code,
      p_billing_cycle: billing_cycle,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_subscription_id: razorpay_subscription_id || null,
    });

    if (rpcError) {
      logger.error('verify: activate_subscription RPC failed', { error: rpcError.message });
      // Do NOT fall back to patching students table alone — that creates split-brain
      // where students.subscription_plan says 'pro' but student_subscriptions is stale.
      // Instead, rely on the webhook for activation and tell the user to wait.
      logger.error('verify: RECONCILIATION REQUIRED', { paymentId: razorpay_payment_id, authUserId: user.id, planCode: plan_code });

      logOpsEvent({
        category: 'payment',
        source: 'verify/route.ts',
        severity: 'warning',
        message: 'Payment verify returned 503 — RPC failed, reconciliation required',
        subjectType: 'student',
        subjectId: studentId,
        context: { payment_id: razorpay_payment_id, plan_code, rpc_error: rpcError.message },
      });

      return NextResponse.json({
        success: false,
        error: 'Payment received but access update is in progress. Your payment is safe — your plan will activate shortly.',
        payment_id: razorpay_payment_id,
        status: 'reconciliation_required',
      }, { status: 503 });
    }

    // Verify the update actually took effect by reading back
    const { data: verify } = await admin
      .from('students')
      .select('subscription_plan')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (verify?.subscription_plan !== plan_code) {
      logger.error('verify: post-update check failed', { expected: plan_code, got: verify?.subscription_plan });
      return NextResponse.json({
        error: 'Payment received but access update is being confirmed. Please refresh the page.',
        payment_id: razorpay_payment_id,
        status: 'pending_confirmation',
      }, { status: 202 });
    }

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    logger.error('Verify payment error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
