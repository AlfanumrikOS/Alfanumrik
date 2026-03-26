import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET!;
    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Use Supabase admin client (service_role) for all DB operations
    const admin = createClient(supabaseUrl, serviceKey);

    // Duplicate protection
    const { data: existing } = await admin
      .from('payment_history')
      .select('id')
      .eq('razorpay_payment_id', razorpay_payment_id)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, plan: plan_code, note: 'already_processed' });
    }

    // Look up student ID
    const { data: studentRow } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    const studentId = studentRow?.id;

    // Record payment (ignore if webhook already inserted it)
    if (studentId) {
      const PRICING: Record<string, Record<string, number>> = {
        starter: { monthly: 29900, yearly: 239900 },
        pro: { monthly: 69900, yearly: 559900 },
        unlimited: { monthly: 149900, yearly: 1199900 },
      };

      // Insert payment record — ignore conflict if webhook already recorded it
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
        console.error('payment_history insert error:', insertErr.message);
      }
    }

    // Activate subscription via RPC
    const { error: rpcError } = await admin.rpc('activate_subscription', {
      p_auth_user_id: user.id,
      p_plan_code: plan_code,
      p_billing_cycle: billing_cycle,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
    });

    if (rpcError) {
      console.error('activate_subscription RPC failed:', rpcError.message);
      // Fallback: directly update students table
      await admin
        .from('students')
        .update({ subscription_plan: plan_code })
        .eq('auth_user_id', user.id);
    }

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
