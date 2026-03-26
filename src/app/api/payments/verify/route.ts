import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll().map(c => ({ name: c.name, value: c.value }));
        },
        setAll() {},
      },
    });

    // Try cookie-based auth first, fall back to Bearer token
    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const { createClient } = await import('@supabase/supabase-js');
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

    // Verify signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET!;
    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Payment verified — check for duplicate before activating
    const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    // Duplicate protection: check if this payment_id was already processed
    const dupCheck = await fetch(
      `${adminUrl}/rest/v1/payment_history?razorpay_payment_id=eq.${razorpay_payment_id}&select=id&limit=1`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } },
    );
    const dupData = await dupCheck.json().catch(() => []);
    if (Array.isArray(dupData) && dupData.length > 0) {
      return NextResponse.json({ success: true, plan: plan_code, note: 'already_processed' });
    }

    // Record payment in payment_history BEFORE activating (idempotency marker)
    const studentLookup = await fetch(
      `${adminUrl}/rest/v1/students?auth_user_id=eq.${user.id}&select=id&limit=1`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } },
    );
    const studentRows = await studentLookup.json().catch(() => []);
    const studentId = studentRows?.[0]?.id;

    if (studentId) {
      await fetch(`${adminUrl}/rest/v1/payment_history`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          student_id: studentId,
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
          plan_code,
          billing_cycle,
          currency: 'INR',
          amount: plan_code === 'starter' ? (billing_cycle === 'yearly' ? 239900 : 29900)
            : plan_code === 'pro' ? (billing_cycle === 'yearly' ? 559900 : 69900)
            : (billing_cycle === 'yearly' ? 1199900 : 149900),
          status: 'captured',
          payment_method: 'razorpay',
        }),
      });
    }

    // Activate subscription using service role
    const rpcRes = await fetch(`${adminUrl}/rest/v1/rpc/activate_subscription`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_auth_user_id: user.id,
        p_plan_code: plan_code,
        p_billing_cycle: billing_cycle,
        p_razorpay_payment_id: razorpay_payment_id,
        p_razorpay_order_id: razorpay_order_id,
      }),
    });

    if (!rpcRes.ok) {
      const rpcErr = await rpcRes.text().catch(() => 'Unknown RPC error');
      console.error('activate_subscription RPC failed:', rpcRes.status, rpcErr);
      // Fallback: directly update subscription_plan so user isn't stuck
      await fetch(`${adminUrl}/rest/v1/students?auth_user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ subscription_plan: plan_code }),
      });
    }

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
