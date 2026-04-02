import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

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

    // Use timing-safe comparison to prevent timing attacks on signature verification
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.error('Webhook signature mismatch');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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

    logger.info(`Webhook: ${eventType}`, { eventId });

    // ── SUBSCRIPTION EVENTS ─────────────────────────────────

    if (eventType.startsWith('subscription.')) {
      const sub = event.payload.subscription?.entity;
      if (!sub) return NextResponse.json({ received: true });

      const userId = sub.notes?.user_id;
      const planCode = sub.notes?.plan_code;
      const rzpSubId = sub.id;

      if (!userId) {
        logger.error('Webhook: missing user_id in notes', { eventType });
        return NextResponse.json({ received: true });
      }

      const studentRow = await getStudent(admin, userId);
      if (!studentRow) {
        logger.error('Webhook: student not found for user', { authUserId: userId });
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

        case 'subscription.activated': {
          // First charge succeeded — activate entitlement
          const activatePlan = planCode || currentSub?.plan_code || 'starter';
          const { error: activateRpcErr } = await admin.rpc('activate_subscription', {
            p_auth_user_id: userId,
            p_plan_code: activatePlan,
            p_billing_cycle: 'monthly',
            p_razorpay_subscription_id: rzpSubId,
          });

          if (activateRpcErr) {
            // RPC failed — fall back to direct PATCH so the student is not left without access.
            // Payment was already captured by Razorpay, so we MUST grant entitlement (P11).
            logger.error('Webhook: activate_subscription RPC failed, using fallback', {
              error: activateRpcErr.message, studentId: studentRow.id, planCode: activatePlan,
            });
            await admin.from('students').update({
              subscription_plan: activatePlan,
            }).eq('id', studentRow.id);

            await admin.from('student_subscriptions').upsert({
              student_id: studentRow.id,
              plan_code: activatePlan,
              status: 'active',
              billing_cycle: 'monthly',
              razorpay_subscription_id: rzpSubId,
              current_period_start: new Date().toISOString(),
              current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              auto_renew: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'student_id' });
          }

          await logEvent(admin, {
            studentId: studentRow.id,
            subscriptionId: currentSub?.id,
            eventType, eventId, rzpSubId, planCode,
            statusBefore: currentSub?.status,
            statusAfter: 'active',
          });
          break;
        }

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
                logger.error('Webhook: payment insert error', { error: error.message });
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
          // Do NOT downgrade to free here — student retains access until
          // current_period_end. The daily-cron job handles expiry.
          await admin.from('student_subscriptions').update({
            status: 'cancelled',
            auto_renew: false,
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('student_id', studentRow.id);

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

      const { error: captureRpcErr } = await admin.rpc('activate_subscription', {
        p_auth_user_id: userId,
        p_plan_code: planCode,
        p_billing_cycle: billingCycle,
        p_razorpay_payment_id: paymentId,
        p_razorpay_order_id: payment.order_id,
      });

      if (captureRpcErr) {
        // RPC failed — fall back to direct PATCH so the student is not left without access.
        // Payment was already captured by Razorpay, so we MUST grant entitlement (P11).
        logger.error('Webhook: activate_subscription RPC failed for payment.captured, using fallback', {
          error: captureRpcErr.message, studentId: studentRow.id, planCode,
        });
        await admin.from('students').update({
          subscription_plan: planCode,
        }).eq('id', studentRow.id);

        const periodMs = billingCycle === 'yearly' ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
        await admin.from('student_subscriptions').upsert({
          student_id: studentRow.id,
          plan_code: planCode,
          status: 'active',
          billing_cycle: billingCycle,
          razorpay_order_id: payment.order_id,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + periodMs).toISOString(),
          auto_renew: billingCycle === 'monthly',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'student_id' });
      }

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
              logger.error('Webhook: failed payment insert error', { error: error.message });
            }
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error('Webhook error', { error: err instanceof Error ? err : new Error(String(err)) });
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
      logger.error('Webhook: event log error', { error: error.message });
    }
  });
}
