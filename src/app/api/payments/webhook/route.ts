import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || !signature) {
      return NextResponse.json({ error: 'Not configured' }, { status: 400 });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(body);
    const eventType = event.event;

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    if (eventType === 'payment.captured') {
      // Payment successful — log it
      const payment = event.payload.payment.entity;
      console.log(`Payment captured: ${payment.id}, amount: ${payment.amount}, email: ${payment.email}`);
    }

    if (eventType === 'payment.failed') {
      // Payment failed — log for follow-up
      const payment = event.payload.payment.entity;
      console.log(`Payment failed: ${payment.id}, reason: ${payment.error_description}`);
    }

    if (eventType === 'subscription.cancelled' || eventType === 'subscription.expired') {
      // Downgrade user to free
      const subscription = event.payload.subscription?.entity;
      const userId = subscription?.notes?.user_id;
      if (userId) {
        await fetch(`${supabaseUrl}/rest/v1/students?auth_user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ subscription_plan: 'free' }),
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
