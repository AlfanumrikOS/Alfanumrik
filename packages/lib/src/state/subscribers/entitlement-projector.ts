/**
 * entitlement-projector — W2.4.
 *
 * Consumes `billing.invoice_paid` events for B2C/student subscription payments
 * and projects them into active subscriptions by invoking the database RPC
 * `atomic_subscription_activation`.
 *
 * **Idempotency:** The database RPC `atomic_subscription_activation` uses
 * `ON CONFLICT (student_id) DO UPDATE` which updates the subscription details
 * safely and idempotently on repeated deliveries.
 */

import type { Subscriber, SubscriberContext } from './subscriber';

export const entitlementProjector: Subscriber<'billing.invoice_paid'> = {
  name: 'entitlement-projector',
  kind: 'billing.invoice_paid',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.actorAuthUserId;
  },

  async handle(event, ctx: SubscriberContext) {
    // Entitlement projector only handles B2C/student subscriptions.
    // B2B/School subscription invoice payments are skipped.
    if (event.tenantId !== null) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `B2B/School subscription (tenantId: ${event.tenantId}) ignored by entitlement-projector`,
      });
      return;
    }

    const authUserId = event.actorAuthUserId;

    // 1. Resolve student_id from auth_user_id
    const { data: student, error: studentError } = await ctx.sb
      .from('students')
      .select('id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (studentError) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: `failed to resolve student for authUserId=${authUserId}: ${studentError.message}`,
      });
      throw new Error(
        `entitlement-projector: failed to resolve student for authUserId=${authUserId}: ${studentError.message}`,
      );
    }

    if (!student) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `student profile not found for authUserId=${authUserId}`,
      });
      return;
    }

    const studentId = student.id;

    // 2. Fetch payment details from payment_history using payload.invoiceId
    const { data: payment, error: paymentError } = await ctx.sb
      .from('payment_history')
      .select('plan_code, billing_cycle, razorpay_payment_id, razorpay_subscription_id')
      .eq('id', event.payload.invoiceId)
      .maybeSingle();

    if (paymentError) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: `failed to fetch payment_history for invoiceId=${event.payload.invoiceId}: ${paymentError.message}`,
      });
      throw new Error(
        `entitlement-projector: failed to fetch payment_history for invoiceId=${event.payload.invoiceId}: ${paymentError.message}`,
      );
    }

    if (!payment) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: `payment_history row not found for invoiceId=${event.payload.invoiceId}`,
      });
      throw new Error(
        `entitlement-projector: payment_history row not found for invoiceId=${event.payload.invoiceId}`,
      );
    }

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would activate subscription: plan=${payment.plan_code} cycle=${payment.billing_cycle}`,
      });
      return;
    }

    // 3. Call database RPC to activate/update the subscription
    const { error: rpcError } = await ctx.sb.rpc('atomic_subscription_activation', {
      p_student_id: studentId,
      p_plan_code: payment.plan_code,
      p_billing_cycle: payment.billing_cycle,
      p_razorpay_payment_id: payment.razorpay_payment_id,
      p_razorpay_subscription_id: payment.razorpay_subscription_id,
    });

    if (rpcError) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: rpcError.message,
      });
      throw new Error(
        `entitlement-projector: RPC atomic_subscription_activation failed: ${rpcError.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `subscription activated: plan=${payment.plan_code} cycle=${payment.billing_cycle}`,
    });
  },
};
