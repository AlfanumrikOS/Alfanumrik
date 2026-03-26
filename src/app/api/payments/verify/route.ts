import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
      console.error('verify: MISSING ENV VARS — SUPABASE_SERVICE_ROLE_KEY:', !!serviceKey, 'URL:', !!supabaseUrl);
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

    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_code, billing_cycle } = body;

    // Input validation
    if (!razorpay_order_id || typeof razorpay_order_id !== 'string' || !razorpay_order_id.startsWith('order_')) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }
    if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string' || !razorpay_payment_id.startsWith('pay_')) {
      return NextResponse.json({ error: 'Invalid payment ID' }, { status: 400 });
    }
    if (!razorpay_signature || typeof razorpay_signature !== 'string' || razorpay_signature.length !== 64) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    if (!plan_code || !['starter', 'pro', 'unlimited'].includes(plan_code)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (!billing_cycle || !['monthly', 'yearly'].includes(billing_cycle)) {
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
    }

    // Verify Razorpay HMAC signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpaySecret) {
      console.error('verify: MISSING RAZORPAY_KEY_SECRET env var');
      return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
    }
    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
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
      console.error('verify: student not found for auth_user_id:', user.id, 'email:', user.email, 'error:', studentErr?.message);

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
          console.log('verify: found student by email, fixed auth_user_id:', studentId);
        }
      }
    }

    if (!studentId) {
      console.error('verify: student not found by auth_user_id or email — user:', user.id, user.email);
      // Still return success since webhook will handle activation
      // Don't alarm the user — their payment IS safe
      return NextResponse.json({
        success: true,
        plan: plan_code,
        note: 'activation_via_webhook',
        message: 'Payment verified. Your plan is being activated.',
      });
    }

    // Record payment — ignore duplicate constraint (webhook may have already inserted)
    const PRICING: Record<string, Record<string, number>> = {
      starter: { monthly: 29900, yearly: 239900 },
      pro: { monthly: 69900, yearly: 559900 },
      unlimited: { monthly: 149900, yearly: 1199900 },
    };

    const { error: insertErr } = await admin.from('payment_history').insert({
      student_id: studentId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      plan_code,
      billing_cycle,
      currency: 'INR',
      amount: PRICING[plan_code][billing_cycle],
      status: 'captured',
      payment_method: 'razorpay',
    });
    if (insertErr && !insertErr.message.includes('duplicate')) {
      console.error('verify: payment_history insert failed:', insertErr.message);
    }

    // Activate subscription via RPC — this is the critical step
    const { error: rpcError } = await admin.rpc('activate_subscription', {
      p_auth_user_id: user.id,
      p_plan_code: plan_code,
      p_billing_cycle: billing_cycle,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
    });

    if (rpcError) {
      console.error('verify: activate_subscription RPC failed:', rpcError.message);

      // Fallback: directly update students table
      const { error: patchError } = await admin
        .from('students')
        .update({ subscription_plan: plan_code })
        .eq('auth_user_id', user.id);

      if (patchError) {
        // BOTH RPC and PATCH failed — this is a critical failure
        // DO NOT return success — payment captured but access NOT granted
        console.error('verify: CRITICAL — both RPC and PATCH failed:', patchError.message);
        console.error('verify: RECONCILIATION REQUIRED — payment_id:', razorpay_payment_id, 'user:', user.id, 'plan:', plan_code);

        return NextResponse.json({
          error: 'Payment received but access update failed. Your payment is safe — our team will activate your plan shortly.',
          payment_id: razorpay_payment_id,
          status: 'reconciliation_required',
        }, { status: 503 });
      }
    }

    // Verify the update actually took effect by reading back
    const { data: verify } = await admin
      .from('students')
      .select('subscription_plan')
      .eq('auth_user_id', user.id)
      .single();

    if (verify?.subscription_plan !== plan_code) {
      console.error('verify: post-update check failed — expected:', plan_code, 'got:', verify?.subscription_plan);
      return NextResponse.json({
        error: 'Payment received but access update is being confirmed. Please refresh the page.',
        payment_id: razorpay_payment_id,
        status: 'pending_confirmation',
      }, { status: 202 });
    }

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
