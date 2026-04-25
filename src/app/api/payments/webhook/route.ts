import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyRazorpaySignature } from '@/lib/payment-verification';
import { logOpsEvent } from '@/lib/ops-events';
import { logger } from '@/lib/logger';

/**
 * Razorpay Webhook Handler — CANONICAL (per architect C3)
 *
 * This route is the single authoritative webhook receiver for Razorpay.
 * The legacy Supabase Edge Function `payments` handleWebhook path is
 * disabled (see supabase/functions/payments/index.ts cleanup in the same PR).
 *
 * Handles:
 *   - payment.captured               → record payment, activate (yearly/one-time)
 *   - payment.failed                 → record failure
 *   - subscription.authenticated     → log only (pending row already present)
 *   - subscription.activated         → activate (first-charge success)
 *   - subscription.charged           → renewal (reuse activate_subscription)
 *   - subscription.halted            → set status=halted, downgrade
 *   - subscription.cancelled         → set status=cancelled (access until period end)
 *   - subscription.expired           → set status=expired, downgrade
 *   - subscription.completed         → mark completed, downgrade
 *
 * Student resolution order (architect C3):
 *   1. event.notes.student_id
 *   2. student_subscriptions.razorpay_subscription_id = rzSubId
 *   3. students.auth_user_id = event.notes.user_id
 *   4. All failed → logOpsEvent critical + return 500 (so Razorpay retries).
 *
 * All writes are idempotent.
 */

/**
 * Task 3 — payment-webhook-hardening: outcome marker for payment_webhook_events.
 *
 * Records the terminal outcome on the row inserted by `record_webhook_event`
 * via `mark_webhook_event_processed`. Failure is non-blocking: we never want
 * to fail a webhook because we couldn't update telemetry.
 */
async function markEvent(
  admin: SupabaseClient,
  rowId: string | null,
  outcome: 'ack' | 'dedupe' | 'activated' | 'downgraded' | 'failed' | 'unresolved',
): Promise<void> {
  if (!rowId) return;
  try {
    await admin.rpc('mark_webhook_event_processed', { p_id: rowId, p_outcome: outcome });
  } catch (err) {
    logger.warn('webhook: mark_webhook_event_processed failed (non-blocking)', {
      error: err instanceof Error ? err.message : String(err), rowId, outcome,
    });
  }
}

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code. */
function canonicalizePlan(raw: string): string {
  return raw
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

/**
 * Phase 0g.2 kill-switch read.
 *
 * Returns whether the atomic_subscription_activation fallback should run
 * when activate_subscription RPC fails. Default: true (atomic enabled) —
 * missing flag row is treated as enabled so behavior is safe before the
 * `20260425140500_ff_atomic_subscription_activation` migration applies.
 *
 * Set the flag to is_enabled=false ONLY if atomic_subscription_activation
 * itself is misbehaving and we want webhooks to 503 immediately so
 * Razorpay retries (instead of writing the wrong thing).
 */
async function isAtomicFallbackEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await admin
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_atomic_subscription_activation')
      .maybeSingle();
    return data?.is_enabled ?? true;
  } catch {
    // Any error reading the flag → assume safe behavior (atomic enabled).
    return true;
  }
}

type ResolvedStudent = {
  student_id: string;
  /** Which branch succeeded — useful for ops metrics. */
  via: 'notes_student_id' | 'rz_sub_id' | 'notes_user_id';
};

/**
 * Three-step student resolution per architect C3.
 * Returns null if all three branches fail.
 */
async function resolveStudent(
  admin: SupabaseClient,
  opts: {
    notesStudentId?: string;
    rzSubId?: string;
    notesUserId?: string;
  }
): Promise<ResolvedStudent | null> {
  // (1) notes.student_id — fast path, canonical.
  if (opts.notesStudentId) {
    const { data } = await admin
      .from('students')
      .select('id')
      .eq('id', opts.notesStudentId)
      .maybeSingle();
    if (data?.id) return { student_id: data.id, via: 'notes_student_id' };
  }

  // (2) student_subscriptions.razorpay_subscription_id
  if (opts.rzSubId) {
    const { data } = await admin
      .from('student_subscriptions')
      .select('student_id')
      .eq('razorpay_subscription_id', opts.rzSubId)
      .maybeSingle();
    if (data?.student_id) return { student_id: data.student_id, via: 'rz_sub_id' };
  }

  // (3) students.auth_user_id = notes.user_id (legacy).
  if (opts.notesUserId) {
    const { data } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', opts.notesUserId)
      .maybeSingle();
    if (data?.id) return { student_id: data.id, via: 'notes_user_id' };
  }

  return null;
}

/**
 * Downgrade helper with plan-downgrade-race guard (architect risk #1).
 *
 * Task 5b — payment-webhook-hardening: this delegates to the
 * `atomic_downgrade_subscription` RPC (migration
 * 20260425150000_atomic_downgrade_subscription_rpc.sql) which takes a
 * row-level lock on student_subscriptions, validates the stale-cancel
 * guard, and runs both downgrade UPDATEs in a single transaction. This
 * eliminates the SELECT-then-UPDATE race the previous JS implementation
 * exposed (a charge could land between the read and the write).
 *
 * RPC contract: returns a single-row TABLE(outcome text) where outcome is
 * either 'downgraded' or 'stale_cancel_ignored'. On RPC error we re-throw
 * so the outer POST try/catch returns 500 and Razorpay retries — silently
 * swallowing the error would re-create the split-brain risk.
 */
async function downgradeIfMatchingSub(
  admin: SupabaseClient,
  studentId: string,
  cancelledSubId: string,
  newStatus: 'cancelled' | 'expired' | 'halted' | 'completed',
  eventType: string,
): Promise<'downgraded' | 'stale_cancel_ignored'> {
  const { data, error } = await admin.rpc('atomic_downgrade_subscription', {
    p_student_id: studentId,
    p_cancelled_sub_id: cancelledSubId,
    p_new_status: newStatus,
  });

  if (error) {
    await logOpsEvent({
      category: 'payment',
      severity: 'critical',
      source: 'webhook/route.ts',
      message: 'atomic_downgrade_subscription RPC failed',
      context: {
        event_type: eventType,
        student_id: studentId,
        cancelled_sub_id: cancelledSubId,
        error: error.message,
      },
    });
    // Re-throw so the outer try/catch returns 500 → Razorpay retries.
    throw new Error(`atomic_downgrade_subscription failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const outcome = row?.outcome as 'downgraded' | 'stale_cancel_ignored' | undefined;

  if (outcome === 'stale_cancel_ignored') {
    await logOpsEvent({
      category: 'payment',
      severity: 'warning',
      source: 'webhook/route.ts',
      message: 'stale_cancel_ignored',
      context: { event_type: eventType, student_id: studentId, cancelled_sub_id: cancelledSubId },
    });
    return 'stale_cancel_ignored';
  }
  return 'downgraded';
}

/**
 * Central handler for unresolved-student webhook events.
 *
 * Task 3 — accepts optional admin + webhookEventRowId so we can stamp
 * `outcome=unresolved` on the payment_webhook_events row before returning.
 */
async function handleUnresolved(
  eventType: string,
  rzSubId: string | undefined,
  rzPaymentId: string | undefined,
  notes: Record<string, unknown>,
  admin?: SupabaseClient,
  webhookEventRowId?: string | null,
): Promise<NextResponse> {
  await logOpsEvent({
    category: 'payment',
    severity: 'critical',
    source: 'webhook/route.ts',
    message: 'webhook student_unresolved',
    context: {
      event_type: eventType,
      rz_sub_id: rzSubId ?? null,
      razorpay_payment_id: rzPaymentId ?? null,
      notes_keys: Object.keys(notes ?? {}),
    },
  });
  if (admin && webhookEventRowId) {
    await markEvent(admin, webhookEventRowId, 'unresolved');
  }
  // Return 500 so Razorpay retries (5xx = retry, 4xx = no retry).
  return NextResponse.json({ error: 'student_unresolved' }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || !signature) {
      return NextResponse.json({ error: 'Not configured' }, { status: 400 });
    }

    // Verify webhook signature (P11: timing-safe via extracted utility).
    // This MUST run before any other processing.
    if (!verifyRazorpaySignature(body, signature, webhookSecret)) {
      logger.error('Webhook signature mismatch');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(body);
    const eventType: string = event.event;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      logger.error('webhook: MISSING ENV VARS', { hasServiceKey: !!serviceKey, hasUrl: !!supabaseUrl });
      return NextResponse.json({ error: 'Server not configured' }, { status: 503 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Event-level dedupe (Task 3 of payment-webhook-hardening plan) ──
    // Razorpay can re-fire any event. We record (account_id, event_id) in
    // payment_webhook_events with a unique constraint. ON CONFLICT means
    // duplicate delivery → ACK and skip. This dedupes events that have no
    // payment entity (e.g. re-fired subscription.cancelled).
    const accountId: string | undefined = event.account_id;
    const razorpayEventId: string | undefined = event.id;
    let webhookEventRowId: string | null = null;

    if (accountId && razorpayEventId) {
      const { data: dedupeRows, error: dedupeErr } = await admin.rpc('record_webhook_event', {
        p_account_id: accountId,
        p_event_id: razorpayEventId,
        p_event_type: eventType,
        p_raw_payload: event,
      });
      if (dedupeErr) {
        // RPC missing or DB error — log and proceed without dedupe so we
        // don't lose a real event. payment_history-level dedupe still applies.
        logger.warn('webhook: record_webhook_event RPC failed; proceeding without event-level dedupe', {
          error: dedupeErr.message, eventType, razorpayEventId,
        });
      } else {
        const row = Array.isArray(dedupeRows) ? dedupeRows[0] : dedupeRows;
        if (row && row.is_new === false) {
          return NextResponse.json({ received: true, note: 'dedupe' });
        }
        webhookEventRowId = row?.id ?? null;
      }
    } else {
      logger.warn('webhook: missing account_id or event.id; skipping event-level dedupe', {
        hasAccountId: !!accountId, hasEventId: !!razorpayEventId, eventType,
      });
    }

    // ══════════════════════════════════════════════════════════
    // PAYMENT EVENTS
    // ══════════════════════════════════════════════════════════

    if (eventType === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const notes = payment.notes ?? {};
      const rawPlan = notes.plan_code;
      const billingCycle = notes.billing_cycle || 'monthly';
      const planCode = rawPlan ? canonicalizePlan(rawPlan) : null;

      logger.info('Webhook: payment.captured', { paymentId, orderId, planCode });

      if (!planCode) {
        await markEvent(admin, webhookEventRowId, 'ack');
        return NextResponse.json({ received: true, note: 'no_plan' });
      }

      // Idempotency: skip if already captured.
      const { data: existing } = await admin
        .from('payment_history')
        .select('id, status')
        .eq('razorpay_payment_id', paymentId)
        .limit(1);
      if (existing && existing.length > 0 && existing[0].status === 'captured') {
        await markEvent(admin, webhookEventRowId, 'ack');
        return NextResponse.json({ received: true, note: 'already_processed' });
      }

      const resolved = await resolveStudent(admin, {
        notesStudentId: notes.student_id,
        notesUserId: notes.user_id,
      });
      if (!resolved) {
        // markEvent('unresolved') is called inside handleUnresolved.
        return handleUnresolved(eventType, undefined, paymentId, notes, admin, webhookEventRowId);
      }

      // Record payment (idempotent via payment_id).
      if (!existing || existing.length === 0) {
        await admin.from('payment_history').insert({
          student_id: resolved.student_id,
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

      // Activate subscription (idempotent — upserts both tables atomically via RPC).
      const authUserId = notes.user_id;
      if (authUserId) {
        const { error: rpcError } = await admin.rpc('activate_subscription_locked', {
          p_auth_user_id: authUserId,
          p_plan_code: planCode,
          p_billing_cycle: billingCycle,
          p_razorpay_payment_id: paymentId,
          p_razorpay_order_id: orderId,
        });
        if (rpcError) {
          logger.error('Webhook: activate_subscription RPC failed; falling back to atomic_subscription_activation', {
            error: rpcError.message,
            authUserId,
            studentId: resolved.student_id,
          });
          // Kill switch (ff_atomic_subscription_activation): if disabled,
          // skip the atomic fallback and 503 so Razorpay retries.
          if (!(await isAtomicFallbackEnabled(admin))) {
            logger.warn('Webhook: ff_atomic_subscription_activation disabled — skipping atomic fallback, returning 503', {
              eventType,
              studentId: resolved.student_id,
            });
            await logOpsEvent({
              category: 'payment',
              severity: 'critical',
              source: 'webhook/route.ts',
              message: 'atomic_fallback_kill_switch_active',
              context: {
                event_type: eventType,
                student_id: resolved.student_id,
                primary_error: rpcError.message,
              },
            });
            await markEvent(admin, webhookEventRowId, 'failed');
            return NextResponse.json(
              { error: 'subscription_activation_failed' },
              { status: 503 },
            );
          }
          // P11: atomic_subscription_activation upserts BOTH tables in a
          // single transaction (CREATE FUNCTION at supabase/migrations/
          // 20260424120000_atomic_subscription_activation_rpc.sql). This
          // closes the split-brain risk that the previous two-statement
          // fallback exposed.
          const { error: atomicErr } = await admin.rpc('atomic_subscription_activation_locked', {
            p_student_id: resolved.student_id,
            p_plan_code: planCode,
            p_billing_cycle: billingCycle,
            p_razorpay_payment_id: paymentId,
            p_razorpay_subscription_id: null,
          });
          if (atomicErr) {
            // Both RPCs failed — return 503 so Razorpay retries the webhook.
            // We do NOT do per-table writes from here: that re-introduces the
            // exact split-brain risk this RPC was added to eliminate.
            logger.error('Webhook: atomic_subscription_activation also failed', {
              error: atomicErr.message,
              studentId: resolved.student_id,
            });
            await logOpsEvent({
              category: 'payment',
              severity: 'critical',
              source: 'webhook/route.ts',
              message: 'subscription_activation_both_rpcs_failed',
              context: {
                event_type: eventType,
                student_id: resolved.student_id,
                primary_error: rpcError.message,
                fallback_error: atomicErr.message,
              },
            });
            await markEvent(admin, webhookEventRowId, 'failed');
            return NextResponse.json(
              { error: 'subscription_activation_failed' },
              { status: 503 },
            );
          }
        }
      }
      await markEvent(admin, webhookEventRowId, 'activated');
      return NextResponse.json({ received: true });
    }

    if (eventType === 'payment.failed') {
      const payment = event.payload.payment.entity;
      const notes = payment.notes ?? {};
      logger.info('Webhook: payment.failed', { paymentId: payment.id, reason: payment.error_description });

      const resolved = await resolveStudent(admin, {
        notesStudentId: notes.student_id,
        notesUserId: notes.user_id,
      });
      if (!resolved) {
        // Failed payments with unresolved students are less critical — log at error, don't 500.
        await logOpsEvent({
          category: 'payment',
          severity: 'error',
          source: 'webhook/route.ts',
          message: 'payment.failed student_unresolved',
          context: { razorpay_payment_id: payment.id, notes_keys: Object.keys(notes) },
        });
        await markEvent(admin, webhookEventRowId, 'ack');
        return NextResponse.json({ received: true, note: 'student_unresolved' });
      }

      const rawPlan = notes.plan_code;
      // Use canonical 'free' rather than 'unknown' so the row passes any future
      // CHECK constraint on plan_code IN ('free','starter','pro','unlimited').
      // Architect re-review condition (2026-04-15).
      const planCode = rawPlan ? canonicalizePlan(rawPlan) : 'free';
      const { error: failInsertErr } = await admin.from('payment_history').insert({
        student_id: resolved.student_id,
        razorpay_payment_id: payment.id,
        razorpay_order_id: payment.order_id,
        plan_code: planCode,
        billing_cycle: notes.billing_cycle || 'monthly',
        currency: payment.currency || 'INR',
        amount: payment.amount || 0,
        status: 'failed',
        payment_method: 'razorpay',
        notes: { source: 'webhook', error: payment.error_description },
      });
      if (failInsertErr && !failInsertErr.message.includes('duplicate')) {
        logger.error('Webhook: failed payment insert error', { error: failInsertErr.message });
      }
      await markEvent(admin, webhookEventRowId, 'ack');
      return NextResponse.json({ received: true });
    }

    // ══════════════════════════════════════════════════════════
    // SUBSCRIPTION EVENTS (monthly recurring)
    // ══════════════════════════════════════════════════════════
    const subEvents = new Set([
      'subscription.authenticated',
      'subscription.activated',
      'subscription.charged',
      'subscription.pending',
      'subscription.halted',
      'subscription.cancelled',
      'subscription.expired',
      'subscription.completed',
    ]);

    if (subEvents.has(eventType)) {
      const subscription = event.payload?.subscription?.entity;
      const paymentEntity = event.payload?.payment?.entity;
      const rzSubId: string | undefined = subscription?.id;
      const notes = subscription?.notes ?? paymentEntity?.notes ?? {};

      const resolved = await resolveStudent(admin, {
        notesStudentId: notes.student_id,
        rzSubId,
        notesUserId: notes.user_id,
      });
      if (!resolved) {
        // markEvent('unresolved') is called inside handleUnresolved.
        return handleUnresolved(eventType, rzSubId, paymentEntity?.id, notes, admin, webhookEventRowId);
      }

      const rawPlan = notes.plan_code;
      const planCode = rawPlan ? canonicalizePlan(rawPlan) : null;
      const authUserId: string | undefined = notes.user_id;

      logger.info(`Webhook: ${eventType}`, {
        rzSubId, resolvedVia: resolved.via, studentId: resolved.student_id, planCode,
      });

      // ── subscription.authenticated: payment method approved, awaiting first charge.
      if (eventType === 'subscription.authenticated') {
        // Pending row already exists from subscribe-route. Nothing to do — just ACK.
        await markEvent(admin, webhookEventRowId, 'ack');
        return NextResponse.json({ received: true });
      }

      // ── subscription.activated / subscription.charged: activate or renew.
      if (eventType === 'subscription.activated' || eventType === 'subscription.charged') {
        if (!planCode) {
          await markEvent(admin, webhookEventRowId, 'ack');
          return NextResponse.json({ received: true, note: 'no_plan_in_notes' });
        }

        // Record payment if present (subscription.charged carries a payment entity).
        if (paymentEntity?.id) {
          const { data: existing } = await admin
            .from('payment_history')
            .select('id, status')
            .eq('razorpay_payment_id', paymentEntity.id)
            .limit(1);
          if (!existing || existing.length === 0) {
            await admin.from('payment_history').insert({
              student_id: resolved.student_id,
              razorpay_payment_id: paymentEntity.id,
              razorpay_order_id: paymentEntity.order_id,
              plan_code: planCode,
              billing_cycle: 'monthly',
              currency: paymentEntity.currency || 'INR',
              amount: paymentEntity.amount,
              status: 'captured',
              payment_method: 'razorpay',
              notes: { source: 'webhook', event: eventType, rz_sub_id: rzSubId },
            });
          }
        }

        // Activate via RPC. We require authUserId here — if absent, do a direct
        // upsert to ensure entitlement is still granted.
        if (authUserId) {
          const { error: rpcError } = await admin.rpc('activate_subscription_locked', {
            p_auth_user_id: authUserId,
            p_plan_code: planCode,
            p_billing_cycle: 'monthly',
            p_razorpay_payment_id: paymentEntity?.id ?? null,
            p_razorpay_subscription_id: rzSubId ?? null,
          });
          if (rpcError) {
            logger.error('Webhook: activate_subscription RPC failed; falling back to atomic_subscription_activation', {
              error: rpcError.message,
              eventType,
              rzSubId,
              studentId: resolved.student_id,
            });
            // Kill switch — see payment.captured branch.
            if (!(await isAtomicFallbackEnabled(admin))) {
              logger.warn('Webhook: ff_atomic_subscription_activation disabled — skipping atomic fallback, returning 503', {
                eventType,
                rzSubId,
                studentId: resolved.student_id,
              });
              await logOpsEvent({
                category: 'payment',
                severity: 'critical',
                source: 'webhook/route.ts',
                message: 'atomic_fallback_kill_switch_active',
                context: {
                  event_type: eventType,
                  student_id: resolved.student_id,
                  rz_sub_id: rzSubId ?? null,
                  primary_error: rpcError.message,
                },
              });
              await markEvent(admin, webhookEventRowId, 'failed');
              return NextResponse.json(
                { error: 'subscription_activation_failed' },
                { status: 503 },
              );
            }
            // P11: atomic fallback (see payment.captured branch comment).
            const { error: atomicErr } = await admin.rpc('atomic_subscription_activation_locked', {
              p_student_id: resolved.student_id,
              p_plan_code: planCode,
              p_billing_cycle: 'monthly',
              p_razorpay_payment_id: paymentEntity?.id ?? null,
              p_razorpay_subscription_id: rzSubId ?? null,
            });
            if (atomicErr) {
              logger.error('Webhook: atomic_subscription_activation also failed', {
                error: atomicErr.message,
                eventType,
                rzSubId,
                studentId: resolved.student_id,
              });
              await logOpsEvent({
                category: 'payment',
                severity: 'critical',
                source: 'webhook/route.ts',
                message: 'subscription_activation_both_rpcs_failed',
                context: {
                  event_type: eventType,
                  student_id: resolved.student_id,
                  rz_sub_id: rzSubId ?? null,
                  primary_error: rpcError.message,
                  fallback_error: atomicErr.message,
                },
              });
              await markEvent(admin, webhookEventRowId, 'failed');
              return NextResponse.json(
                { error: 'subscription_activation_failed' },
                { status: 503 },
              );
            }
          }
        } else {
          // No auth_user_id in notes — call atomic RPC directly with the
          // resolved student_id. This previously did a single-table upsert
          // that would have left students.subscription_plan stale; the RPC
          // fixes that by writing both tables atomically.
          const { error: atomicErr } = await admin.rpc('atomic_subscription_activation_locked', {
            p_student_id: resolved.student_id,
            p_plan_code: planCode,
            p_billing_cycle: 'monthly',
            p_razorpay_payment_id: paymentEntity?.id ?? null,
            p_razorpay_subscription_id: rzSubId ?? null,
          });
          if (atomicErr) {
            logger.error('Webhook: atomic_subscription_activation failed (no authUserId path)', {
              error: atomicErr.message,
              eventType,
              rzSubId,
              studentId: resolved.student_id,
            });
            await logOpsEvent({
              category: 'payment',
              severity: 'critical',
              source: 'webhook/route.ts',
              message: 'subscription_activation_no_auth_user_id_failed',
              context: {
                event_type: eventType,
                student_id: resolved.student_id,
                rz_sub_id: rzSubId ?? null,
                error: atomicErr.message,
              },
            });
            await markEvent(admin, webhookEventRowId, 'failed');
            return NextResponse.json(
              { error: 'subscription_activation_failed' },
              { status: 503 },
            );
          }
        }
        await markEvent(admin, webhookEventRowId, 'activated');
        return NextResponse.json({ received: true });
      }

      // ── subscription.pending: payment retry in progress; mark past_due with grace.
      if (eventType === 'subscription.pending') {
        const { error: pdErr } = await admin.rpc('mark_subscription_past_due', {
          p_student_id: resolved.student_id,
          p_grace_days: 3,
        });
        if (pdErr) {
          logger.error('Webhook: mark_subscription_past_due failed', {
            error: pdErr.message, rzSubId, studentId: resolved.student_id,
          });
          await markEvent(admin, webhookEventRowId, 'failed');
          return NextResponse.json({ error: 'past_due_mark_failed' }, { status: 503 });
        }
        await markEvent(admin, webhookEventRowId, 'downgraded');
        return NextResponse.json({ received: true, note: 'marked_past_due' });
      }

      // ── subscription.halted: payment retries exhausted.
      if (eventType === 'subscription.halted') {
        if (rzSubId) {
          const result = await downgradeIfMatchingSub(admin, resolved.student_id, rzSubId, 'halted', eventType);
          await markEvent(admin, webhookEventRowId, result === 'stale_cancel_ignored' ? 'ack' : 'downgraded');
          return NextResponse.json({ received: true, note: result });
        }
      }

      // ── subscription.cancelled / expired / completed: downgrade with race guard.
      if (eventType === 'subscription.cancelled' ||
          eventType === 'subscription.expired' ||
          eventType === 'subscription.completed') {
        if (rzSubId) {
          const newStatus =
            eventType === 'subscription.cancelled' ? 'cancelled'
            : eventType === 'subscription.expired'  ? 'expired'
            : 'completed';
          const result = await downgradeIfMatchingSub(admin, resolved.student_id, rzSubId, newStatus, eventType);
          await markEvent(admin, webhookEventRowId, result === 'stale_cancel_ignored' ? 'ack' : 'downgraded');
          return NextResponse.json({ received: true, note: result });
        }
      }

      // Fallthrough subscription event with no rzSubId — just ACK.
      await markEvent(admin, webhookEventRowId, 'ack');
      return NextResponse.json({ received: true });
    }

    // Unknown event type — ACK and ignore.
    await markEvent(admin, webhookEventRowId, 'ack');
    return NextResponse.json({ received: true, note: 'unhandled_event_type', event_type: eventType });
  } catch (err) {
    logger.error('Webhook error', { error: err instanceof Error ? err : new Error(String(err)) });
    // 500 so Razorpay retries.
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
