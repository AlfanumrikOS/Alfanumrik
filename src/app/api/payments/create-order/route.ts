import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabase as globalSupabase } from '@/lib/supabase-client';
import { capture as posthogCapture } from '@/lib/posthog/server';
import { paymentSubscribeSchema, validateBody } from '@/lib/validation';

// P11: payment endpoints are the highest-blast-radius write surface.
// We share validateBody / paymentSubscribeSchema with the
// payments/verify route so plan_code + billing_cycle stay constrained
// to the same enum literals everywhere in the payment lifecycle.

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
        const token = authHeader.substring(7);
        user = (await globalSupabase.auth.getUser(token)).data.user;
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validation = validateBody(paymentSubscribeSchema, rawBody);
    if (!validation.success) return validation.error;
    const { plan_code, billing_cycle } = validation.data;

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
    const authString = Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64');
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify({
        amount,
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

    // PostHog: payment_initiated. Distinct id is the auth user id (Supabase
    // UUID). Server-side telemetry is acceptable per posthog/server.ts —
    // logger redacts PII before any further egress. $insert_id keyed on
    // order_id so accidental double-clicks dedup at PostHog ingest.
    void posthogCapture(
      'payment_initiated',
      user.id,
      {
        amount,
        currency: 'INR',
        plan: plan_code,
        billing_cycle: billing_cycle as 'monthly' | 'yearly',
        order_id: order.id,
      },
      `payment_initiated:${order.id}`,
    ).catch(() => { /* swallow — telemetry never blocks payment flow */ });

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
