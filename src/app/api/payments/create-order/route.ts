import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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

    const { plan_code, billing_cycle } = await request.json();

    if (!plan_code || !['starter', 'pro', 'unlimited'].includes(plan_code)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (!billing_cycle || !['monthly', 'yearly'].includes(billing_cycle)) {
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
    }

    // Get plan from DB
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!razorpayKey || !razorpaySecret) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    // Plan pricing (in paisa — Razorpay uses smallest currency unit)
    const PRICING: Record<string, { monthly: number; yearly: number }> = {
      starter:   { monthly: 29900,   yearly: 239900 },   // ₹299/mo, ₹2399/yr
      pro:       { monthly: 69900,   yearly: 559900 },   // ₹699/mo, ₹5599/yr
      unlimited: { monthly: 149900,  yearly: 1199900 },  // ₹1499/mo, ₹11999/yr
    };

    const amount = PRICING[plan_code][billing_cycle as 'monthly' | 'yearly'];

    // Create Razorpay order
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${razorpayKey}:${razorpaySecret}`),
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: `${user.id}_${plan_code}_${Date.now()}`,
        notes: {
          user_id: user.id,
          plan_code,
          billing_cycle,
          email: user.email,
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('Razorpay order creation failed:', err);
      return NextResponse.json({ error: 'Payment gateway error' }, { status: 502 });
    }

    const order = await orderRes.json();

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKey,
      plan_code,
      billing_cycle,
    });
  } catch (err) {
    console.error('Create order error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
