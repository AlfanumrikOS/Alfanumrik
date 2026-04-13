import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRazorpaySignature } from '@/lib/payment-verification';
import { logOpsEvent } from '@/lib/ops-events';
import { acquireIdempotencyLock } from '@/lib/redis';

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

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code. */
function canonicalizePlan(raw: string): string {
  return raw
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || !signature) {
      return NextResponse.json({ error: 'Not configured' }, { status: 400 });
    }

    // Verify webhook signature (P11: timing-safe via extracted utility)
    if (!verifyRazorpaySignature(body, signature, webhookSecret)) {
      console.error('Webhook signature mismatch');

      await logOpsEvent({
        category: 'payment',
        source: 'webhook/route.ts',
        severity: 'critical',
        message: 'Razorpay webhook signature verification failed',
        context: { signature_present: !!signature },
      });

      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(body);
    const eventType = event.event;

    // Redis idempotency: fast dedup BEFORE hitting DB.
    // Extracts payment ID (payment events) or subscription ID (subscription events)
    // to create a unique key per webhook delivery. This is a faster check than the
    // existing DB-level idempotency (payment_history lookup) and prevents duplicate
    // DB writes across concurrent Vercel instances.
    const paymentEntity = event.payload?.payment?.entity;
    const subscriptionEntity = event.payload?.subscription?.entity;
    const idempotencyId = paymentEntity?.id || subscriptionEntity?.id;
    if (idempotencyId) {
      const isFirstProcessing = await acquireIdempotencyLock(
        `webhook:${eventType}:${idempotencyId}`,
        86400 // 24 hour TTL
      );
      if (!isFirstProcessing) {
        console.warn(`[payment-webhook] duplicate webhook blocked: ${eventType} ${idempotencyId}`);
        return NextResponse.json({ received: true, note: 'duplicate_blocked_by_redis' });
      }
    }

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
          console.log(`Webhook: payment ${paymentId} already processed, skipping`);
          return NextResponse.json({ received: true, note: 'already_processed' });
        }

        // Resolve student's internal ID (needed for both payment_history and student_subscriptions)
        const { data: studentRow } = await admin
          .from('students')
          .select('id')
          .eq('auth_user_id', userId)
          .single();

        // Record payment if not already recorded
        if ((!existing || existing.length === 0) && studentRow) {
          await admin.from('payment_history').insert({
            student_id: studentRow.id,
            razorpay_payment_id: paymentId,
            razorpay_order_id: orderId,
            plan_code: planCode,
            billing_cycle: billingCycle,
            currency: payment.currency || 'INR',
            amount: payment.amount,
            status: 'captured',
            payment_method: 'razorpay',
            notes: { source: 'webhook' },
          });
        }

        // Activate subscription via RPC (idempotent — upserts both tables)
        const { error: rpcError } = await admin.rpc('activate_subscription', {
          p_auth_user_id: userId,
          p_plan_code: planCode,
          p_billing_cycle: billingCycle,
          p_razorpay_payment_id: paymentId,
          p_razorpay_order_id: orderId,
        });

        if (rpcError) {
          console.error(`Webhook: activate_subscription RPC failed for ${userId}:`, rpcError.message);

          await logOpsEvent({
            category: 'payment',
            source: 'webhook/route.ts',
            severity: 'error',
            message: `activate_subscription RPC failed — falling back to separate UPDATEs (split-brain risk)`,
            subjectType: 'student',
            subjectId: studentRow?.id,
            context: { plan_code: planCode, payment_id: paymentId, rpc_error: rpcError.message },
          });

          // Fallback: directly update both tables so entitlement is never left stale
          await admin
            .from('students')
            .update({ subscription_plan: planCode })
            .eq('auth_user_id', userId);

          // Sync student_subscriptions.plan_code (the authoritative source for Foxy limits)
          const studentId = studentRow?.id;
          if (studentId) {
            const canonical = canonicalizePlan(planCode);
            await admin
              .from('student_subscriptions')
              .upsert(
                {
                  student_id: studentId,
                  plan_code: canonical,
                  status: 'active',
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'student_id' },
              );
          }
        } else {
          console.log(`Webhook: subscription activated for ${userId} → ${planCode}`);

          logOpsEvent({
            category: 'payment',
            source: 'webhook/route.ts',
            severity: 'info',
            message: `Subscription activated via webhook RPC`,
            subjectType: 'student',
            subjectId: studentRow?.id,
            context: { plan_code: planCode, billing_cycle: billingCycle, payment_id: paymentId },
          });
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
            amount: payment.amount || 0,
            status: 'failed',
            payment_method: 'razorpay',
            notes: { source: 'webhook', error: payment.error_description },
          });
          if (failInsertErr && !failInsertErr.message.includes('duplicate')) {
            console.error('Webhook: failed payment insert error:', failInsertErr.message);
          }
        }
      }
    }

    // ── subscription.cancelled / subscription.expired: downgrade to free ──
    if (eventType === 'subscription.cancelled' || eventType === 'subscription.expired') {
      const subscription = event.payload.subscription?.entity;
      const userId = subscription?.notes?.user_id;

      if (userId) {
        console.log(`Webhook: ${eventType} for user ${userId}`);

        // Resolve student ID first — never use nested awaits inside query args
        const { data: studentRow } = await admin
          .from('students')
          .select('id')
          .eq('auth_user_id', userId)
          .single();

        const studentId = studentRow?.id;
        if (!studentId) {
          console.error(`Webhook: ${eventType} — no student found for auth_user_id ${userId}`);
          return NextResponse.json({ received: true, note: 'student_not_found' });
        }

        // Downgrade students.subscription_plan
        await admin
          .from('students')
          .update({ subscription_plan: 'free' })
          .eq('id', studentId);

        // Downgrade student_subscriptions.plan_code (authoritative for Foxy)
        // Without this, the student retains premium Foxy access after cancellation.
        await admin
          .from('student_subscriptions')
          .update({
            plan_code: 'free',
            status: eventType === 'subscription.cancelled' ? 'cancelled' : 'expired',
            cancelled_at: new Date().toISOString(),
          })
          .eq('student_id', studentId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
