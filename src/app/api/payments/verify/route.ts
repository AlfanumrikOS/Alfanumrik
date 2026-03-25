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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_code, billing_cycle } = await request.json();

    // Verify signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET!;
    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Payment verified — activate subscription using service role
    const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const db = await fetch(`${adminUrl}/rest/v1/rpc/activate_subscription`, {
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

    // Also update student's subscription_plan field
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

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
