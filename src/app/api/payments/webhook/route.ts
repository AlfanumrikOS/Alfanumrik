import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * Razorpay Webhook Handler — Recurring + One-Time
 *
 * Handles the full subscription lifecycle:
 *   subscription.authenticated → subscription created, awaiting first charge
 *   subscription.activated    → first charge succeeded, subscription active
 *   subscription.charged      → recurring renewal succeeded
 *   subscription.pending      → renewal charge pending/retrying
 *   subscription.halted       → all retries exhausted, subscription stopped
 *   subscription.cancelled    → user/admin cancelled
 *   subscription.completed    → all billing cycles completed
 *   subscription.expired      → subscription expired
 *   payment.captured          → one-time payment (yearly) or first sub payment
 *   payment.failed            → payment failed
 *
 * All handlers are idempotent via subscription_events.razorpay_event_id unique index.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || !signature) {
      return NextResponse.json({ error: 'Not configured' }, { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('Webhook signature mismatch');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(body);
    const eventType: string = event.event;
    const eventId: string = event.account_id + '_' + (event.payload?.payment?.entity?.id || event.payload?.subscription?.entity?.id || '') + '_' + eventType;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Idempotency check: skip if this event was already processed
    const { data: existingEvent } = await admin
      .from('subscription_events')
      .select('id')
      .eq('razorpay_event_id', eventId)
      .limit(1);

    if (existingEvent && existingEvent.length > 0) {
      return NextResponse.json({ received: true, note: 'already_processed' });
    }

    console.warn(`Webhook: ${eventType}`, eventId);

    // ── SUBSCRIPTION EVENTS ─────────────────────────────────

    if (eventType.startsWith('subscription.')) {
      const sub = event.payload.subscription?.entity;
      if (!sub) return NextResponse.json({ received: true });

      const userId = sub.notes?.user_id;
      const planCode = sub.notes?.plan_code;
      const rzpSubId = sub.id;

      if (!userId) {
        console.error(`Webhook: ${eventType} missing user_id in notes`);
        return NextResponse.json({ received: true });
      }

      const studentRow = await getStudent(admin, userId);
      if (!studentRow) {
        console.error(`Webhook: student not found for user ${userId}`);
        return NextResponse.json({ received: true });
      }

      const { data: currentSub } = await admin
        .from('student_subscriptions')
        .select('id, status, plan_code')
        .eq('student_id', studentRow.id)
        .single();

      switch (eventType) {
        case 'subscription.authenticated':
          // Subscription created, awaiting first payment
          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'pending',
          });
          break;

        case 'subscription.activated':
          // First charge succeeded — activate entitlement
          await admin.rpc('activate_subscription', {
            p_auth_user_id: userId,
            p_plan_code: planCode || currentSub?.plan_code || 'starter',
            p_billing_cycle: 'monthly',
            p_razorpay_subscription_id: rzpSubId,
          });

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'active',
          });
          break;

        case 'subscription.charged':
          // Recurring renewal succeeded — extend period
          const chargePaymentId = event.payload.payment?.entity?.id;
          const chargeAmount = event.payload.payment?.entity?.amount;

          await admin.rpc('renew_subscription', {
            p_student_id: studentRow.id,
            p_razorpay_payment_id: chargePaymentId || '',
            p_amount_inr: chargeAmount ? Math.round(chargeAmount / 100) : 0,
          });

          // Record payment
          if (chargePaymentId) {
            await admin.from('payment_history').insert({
              student_id: studentRow.id,
              razorpay_payment_id: chargePaymentId,
              plan_code: planCode || currentSub?.plan_code,
              billing_cycle: 'monthly',
              currency: 'INR',
              amount: chargeAmount ? Math.round(chargeAmount / 100) : 0,
              status: 'captured',
              payment_method: 'razorpay',
              notes: { source: 'webhook', event: 'subscription.charged', razorpay_subscription_id: rzpSubId },
            }).then(({ error }) => {
              if (error && !error.message.includes('duplicate')) {
                console.error('Webhook: payment insert error:', error.message);
              }
            });
          }

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            paymentId: chargePaymentId,
            amountInr: chargeAmount ? Math.round(chargeAmount / 100) : undefined,
            statusBefore: currentSub?.status,
            statusAfter: 'active',
          });
          break;

        case 'subscription.pending':
          // Renewal charge pending/retrying — mark past_due with grace
          await admin.rpc('mark_subscription_past_due', {
            p_student_id: studentRow.id,
            p_grace_days: 3,
          });

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'past_due',
          });
          break;

        case 'subscription.halted':
          // All retries exhausted — suspend access
          await admin.rpc('halt_subscription', {
            p_student_id: studentRow.id,
          });

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'halted',
          });
          break;

        case 'subscription.cancelled':
          await admin.from('student_subscriptions').update({
            status: 'cancelled',
            auto_renew: false,
            cancelled_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('student_id', studentRow.id);

          await admin.from('students').update({ subscription_plan: 'free' }).eq('id', studentRow.id);

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'cancelled',
          });
          break;

        case 'subscription.completed':
        case 'subscription.expired':
          const endStatus = eventType === 'subscription.completed' ? 'completed' : 'expired';
          await admin.from('student_subscriptions').update({
            status: endStatus,
            auto_renew: false,
            ended_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('student_id', studentRow.id);

          await admin.from('students').update({ subscription_plan: 'free' }).eq('id', studentRow.id);

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: endStatus,
          });
          break;
      }

      return NextResponse.json({ received: true });
    }

    // ── PAYMENT EVENTS (one-time / yearly) ──────────────────

    if (eventType === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const paymentId = payment.id;
      const userId = payment.notes?.user_id;
      const planCode = payment.notes?.plan_code;
      const billingCycle = payment.notes?.billing_cycle || 'monthly';

      if (!userId || !planCode) {
        return NextResponse.json({ received: true });
      }

      // Skip if this is a subscription payment (handled above)
      if (payment.subscription_id) {
        return NextResponse.json({ received: true, note: 'subscription_payment_handled_above' });
      }

      const studentRow = await getStudent(admin, userId);
      if (!studentRow) return NextResponse.json({ received: true });

      // Record payment if not already recorded
      const { data: existing } = await admin
        .from('payment_history')
        .select('id, status')
        .eq('razorpay_payment_id', paymentId)
        .limit(1);

      if (existing && existing.length > 0 && existing[0].status === 'captured') {
        return NextResponse.json({ received: true, note: 'already_processed' });
      }

      if (!existing || existing.length === 0) {
        await admin.from('payment_history').insert({
          student_id: studentRow.id,
          razorpay_payment_id: paymentId,
          razorpay_order_id: payment.order_id,
          plan_code: planCode,
          billing_cycle: billingCycle,
          currency: payment.currency || 'INR',
          amount: Math.round((payment.amount || 0) / 100),
          status: 'captured',
          payment_method: 'razorpay',
          notes: { source: 'webhook' },
        });
      }

      await admin.rpc('activate_subscription', {
        p_auth_user_id: userId,
        p_plan_code: planCode,
        p_billing_cycle: billingCycle,
        p_razorpay_payment_id: paymentId,
        p_razorpay_order_id: payment.order_id,
      });

      await logEvent(admin, {
        studentId: studentRow.id,
        eventType, eventId, planCode,
        paymentId,
        amountInr: Math.round((payment.amount || 0) / 100),
        statusBefore: null,
        statusAfter: 'active',
      });
    }

    if (eventType === 'payment.failed') {
      const payment = event.payload.payment.entity;
      const userId = payment.notes?.user_id;

      if (userId && !payment.subscription_id) {
        const studentRow = await getStudent(admin, userId);
        if (studentRow) {
          await admin.from('payment_history').insert({
            student_id: studentRow.id,
            razorpay_payment_id: payment.id,
            razorpay_order_id: payment.order_id,
            plan_code: payment.notes?.plan_code || 'unknown',
            billing_cycle: payment.notes?.billing_cycle || 'monthly',
            currency: payment.currency || 'INR',
            amount: Math.round((payment.amount || 0) / 100),
            status: 'failed',
            payment_method: 'razorpay',
            notes: { source: 'webhook', error: payment.error_description },
          }).then(({ error }) => {
            if (error && !error.message.includes('duplicate')) {
              console.error('Webhook: failed payment insert error:', error.message);
            }
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────

async function getStudent(admin: SupabaseClient, authUserId: string) {
  const { data } = await admin
    .from('students')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single();
  return data;
}

async function logEvent(admin: SupabaseClient, params: {
  studentId: string;
  subscriptionId?: string;
  eventType: string;
  eventId: string;
  rzpSubId?: string;
  planCode?: string;
  paymentId?: string;
  amountInr?: number;
  statusBefore?: string | null;
  statusAfter: string;
}) {
  await admin.from('subscription_events').insert({
    student_id: params.studentId,
    subscription_id: params.subscriptionId,
    event_type: params.eventType,
    razorpay_event_id: params.eventId,
    razorpay_subscription_id: params.rzpSubId,
    razorpay_payment_id: params.paymentId,
    plan_code: params.planCode,
    amount_inr: params.amountInr,
    status_before: params.statusBefore,
    status_after: params.statusAfter,
  }).then(({ error }) => {
    if (error && !error.message.includes('duplicate')) {
      console.error('Webhook: event log error:', error.message);
    }
  });
}
