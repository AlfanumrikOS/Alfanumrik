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

    // Try cookie-based auth first, fall back to Bearer token
    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      // Fallback: use Authorization header (client passes access token directly)
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

    const { plan_code, billing_cycle } = await request.json();

    if (!plan_code || !['starter', 'pro', 'unlimited'].includes(plan_code)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (!billing_cycle || !['monthly', 'yearly'].includes(billing_cycle)) {
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
    }

    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!razorpayKey || !razorpaySecret) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }
    if (!serviceKey) {
      console.error('create-order: MISSING SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json({ error: 'Payment system not configured' }, { status: 503 });
    }

    // Read pricing from subscription_plans table (source of truth)
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: plan, error: planErr } = await admin
      .from('subscription_plans')
      .select('price_monthly, price_yearly')
      .eq('plan_code', plan_code)
      .eq('is_active', true)
      .single();

    if (planErr || !plan) {
      console.error('create-order: plan not found in DB:', plan_code, planErr?.message);
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
    }

    // Resolve canonical price in rupees from DB
    const priceRupees = billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
    // Convert to paisa ONLY for Razorpay API (this is the sole conversion point)
    const razorpayAmount = priceRupees * 100;

    // Create Razorpay order
    const authString = Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64');
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify({
        amount: razorpayAmount,
        currency: 'INR',
        receipt: `${user.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
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
      console.error('Razorpay order creation failed:', orderRes.status, err);
      console.error('Razorpay key used:', razorpayKey?.substring(0, 12) + '...');
      return NextResponse.json({ error: 'Payment gateway error. Please try again.' }, { status: 502 });
    }

    const order = await orderRes.json();

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount, // paisa — required by Razorpay checkout widget
      price_inr: priceRupees, // rupees — for display only
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
