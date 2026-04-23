import { NextRequest, NextResponse } from 'next/server';
import { createRazorpayOrder } from '@/lib/razorpay';
import { logger } from '@/lib/logger';
import { paymentSubscribeSchema, validateBody } from '@/lib/validation';
import {
  canonicalizePlanCode,
  createBillingAdminClient,
  getAuthedUserFromRequest,
  getBillingEnv,
  getActivePlan,
} from '@/lib/domains/billing';

export async function POST(request: NextRequest) {
  try {
    const envRes = getBillingEnv();
    if (!envRes.ok) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    const userRes = await getAuthedUserFromRequest(request, envRes.data);
    if (!userRes.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const validation = validateBody(paymentSubscribeSchema, rawBody);
    if (!validation.success) return validation.error;
    const { plan_code: rawPlan, billing_cycle } = validation.data;

    const plan_code = canonicalizePlanCode(rawPlan);
    if (plan_code === 'free') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (billing_cycle !== 'yearly') {
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
    }

    const admin = createBillingAdminClient(envRes.data);
    const planRes = await getActivePlan(admin, plan_code);
    if (!planRes.ok) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    if (!razorpayKeyId) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    const order = await createRazorpayOrder({
      amountInr: planRes.data.price_yearly,
      receipt: `${userRes.data.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
      notes: {
        user_id: userRes.data.id,
        plan_code,
        billing_cycle: 'yearly',
        email: userRes.data.email ?? '',
      },
    });

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKeyId,
      plan_code,
      billing_cycle: 'yearly',
    });
  } catch (err) {
    logger.error('Create order error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
