import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * Razorpay Webhook Handler
 *
 * Safety net for the payment lifecycle. If the client-side verify callback
 * fails (network issue, browser close, etc.), this webhook ensures the
 * subscription is still activated.
 *
 * Handles:
 * - payment.captured → activate subscription (idempotent)
 * - payment.failed → record failure
 * - subscription.cancelled/expired → downgrade to free
 *
 * All writes are idempotent — safe for duplicate webhook deliveries.
 */

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
      console.error('Webhook signature mismatch');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(body);
    const eventType = event.event;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error('webhook: MISSING ENV VARS — SUPABASE_SERVICE_ROLE_KEY:', !!serviceKey, 'URL:', !!supabaseUrl);
      return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── payment.captured: activate subscription (safety net) ──
    if (eventType === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const userId = payment.notes?.user_id;
      const planCode = payment.notes?.plan_code;
      const billingCycle = payment.notes?.billing_cycle || 'monthly';

      console.log(`Webhook: payment.captured ${paymentId}, order: ${orderId}, plan: ${planCode}`);

      if (userId && planCode) {
        // Check if already processed (idempotency)
        const { data: existing } = await admin
          .from('payment_history')
          .select('id, status')
          .eq('razorpay_payment_id', paymentId)
          .limit(1);

        if (existing && existing.length > 0 && existing[0].status === 'captured') {
          // Already processed by verify route — skip
          console.log(`Webhook: payment ${paymentId} already processed, skipping`);
          return NextResponse.json({ received: true, note: 'already_processed' });
        }

        // Record payment if not already recorded
        if (!existing || existing.length === 0) {
          const { data: studentRow } = await admin
            .from('students')
            .select('id')
            .eq('auth_user_id', userId)
            .single();

          if (studentRow) {
            await admin.from('payment_history').insert({
              student_id: studentRow.id,
              razorpay_payment_id: paymentId,
              razorpay_order_id: orderId,
              plan_code: planCode,
              billing_cycle: billingCycle,
              currency: payment.currency || 'INR',
              amount: Math.round((payment.amount || 0) / 100), // Razorpay sends paisa; store as rupees
              status: 'captured',
              payment_method: 'razorpay',
              notes: { source: 'webhook' },
            });
          }
        }

        // Activate subscription (idempotent — upserts)
        const { error: rpcError } = await admin.rpc('activate_subscription', {
          p_auth_user_id: userId,
          p_plan_code: planCode,
          p_billing_cycle: billingCycle,
          p_razorpay_payment_id: paymentId,
          p_razorpay_order_id: orderId,
        });

        if (rpcError) {
          console.error(`Webhook: activate_subscription failed for ${userId}:`, rpcError.message);
          // Fallback: direct update
          await admin
            .from('students')
            .update({ subscription_plan: planCode })
            .eq('auth_user_id', userId);
        } else {
          console.log(`Webhook: subscription activated for ${userId} → ${planCode}`);
        }
      }
    }

    // ── payment.failed: record failure ──
    if (eventType === 'payment.failed') {
      const payment = event.payload.payment.entity;
      console.log(`Webhook: payment.failed ${payment.id}, reason: ${payment.error_description}`);

      const userId = payment.notes?.user_id;
      if (userId) {
        const { data: studentRow } = await admin
          .from('students')
          .select('id')
          .eq('auth_user_id', userId)
          .single();

        if (studentRow) {
          const { error: failInsertErr } = await admin.from('payment_history').insert({
            student_id: studentRow.id,
            razorpay_payment_id: payment.id,
            razorpay_order_id: payment.order_id,
            plan_code: payment.notes?.plan_code || 'unknown',
            billing_cycle: payment.notes?.billing_cycle || 'monthly',
            currency: payment.currency || 'INR',
            amount: Math.round((payment.amount || 0) / 100), // Razorpay sends paisa; store as rupees
            status: 'failed',
            payment_method: 'razorpay',
            notes: { source: 'webhook', error: payment.error_description },
          });
          // Ignore duplicate constraint violations
          if (failInsertErr && !failInsertErr.message.includes('duplicate')) {
            console.error('Webhook: failed payment insert error:', failInsertErr.message);
          }
        }
      }
    }

    // ── subscription.cancelled / subscription.expired: downgrade ──
    if (eventType === 'subscription.cancelled' || eventType === 'subscription.expired') {
      const subscription = event.payload.subscription?.entity;
      const userId = subscription?.notes?.user_id;

      if (userId) {
        console.log(`Webhook: ${eventType} for user ${userId}`);

        await admin
          .from('students')
          .update({ subscription_plan: 'free' })
          .eq('auth_user_id', userId);

        await admin
          .from('student_subscriptions')
          .update({
            status: eventType === 'subscription.cancelled' ? 'cancelled' : 'expired',
            cancelled_at: new Date().toISOString(),
          })
          .eq('student_id', (
            await admin.from('students').select('id').eq('auth_user_id', userId).single()
          ).data?.id);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
