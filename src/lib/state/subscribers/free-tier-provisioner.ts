/**
 * free-tier-provisioner — W2.3.
 *
 * Consumes `learner.signed_up` events and provisions a free plan subscription
 * for the new student via the `activate_free_subscription` database RPC.
 * Replaces the implicit database trigger `trg_auto_free_subscription`.
 *
 * **Idempotency:** The database RPC `activate_free_subscription` uses
 * `ON CONFLICT (student_id) DO NOTHING` which makes it safe to run multiple
 * times for the same student.
 */

import type { Subscriber, SubscriberContext } from './subscriber';

export const freeTierProvisioner: Subscriber<'learner.signed_up'> = {
  name: 'free-tier-provisioner',
  kind: 'learner.signed_up',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.actorAuthUserId;
  },

  async handle(event, ctx: SubscriberContext) {
    const authUserId = event.actorAuthUserId;

    // Resolve student_id from auth_user_id
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
        `free-tier-provisioner: failed to resolve student for authUserId=${authUserId}: ${studentError.message}`,
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

    // Check if subscription already exists for this student
    const { data: existingSub, error: subError } = await ctx.sb
      .from('student_subscriptions')
      .select('id')
      .eq('student_id', studentId)
      .maybeSingle();

    if (subError) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: `failed to check existing subscription for studentId=${studentId}: ${subError.message}`,
      });
      throw new Error(
        `free-tier-provisioner: failed to check existing subscription for studentId=${studentId}: ${subError.message}`,
      );
    }

    if (existingSub) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `subscription already exists for studentId=${studentId}`,
      });
      return;
    }

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would activate free subscription for studentId=${studentId}`,
      });
      return;
    }

    const { error: rpcError } = await ctx.sb.rpc('activate_free_subscription', {
      p_student_id: studentId,
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
        `free-tier-provisioner: RPC activate_free_subscription failed for studentId=${studentId}: ${rpcError.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `activated free subscription for studentId=${studentId}`,
    });
  },
};
