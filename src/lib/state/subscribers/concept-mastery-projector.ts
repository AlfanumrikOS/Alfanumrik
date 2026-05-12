/**
 * concept-mastery-projector — ADR-004 Phase 2 / ADR-005 Path C v2.
 *
 * Canonical writer of public.concept_mastery for the BKT path. Consumes
 * `learner.concept_check_answered` events published by the atomic
 * tutor_commit_attempt RPC and projects them into a roll-up row keyed
 * by (student_id, concept_id) via the partial UNIQUE INDEX
 * `concept_mastery_student_concept_unique`.
 *
 * **Idempotency:** if existing.last_attempt_id == event.payload.attemptId,
 * the projector skips the upsert (no-op). This makes the runtime's
 * at-least-once delivery safe.
 *
 * **Determinism:** posterior = updateMasteryBKT(event.priorMasteryMean,
 * event.correct). The event carries the prior from the RPC's lock-held
 * read, so this catch-up compute is byte-identical to what the RPC
 * computed at /answer time → the optimistic mastery_mean returned by
 * the route and the canonical value the projector writes always agree.
 *
 * **Why we don't read concept_mastery.mastery_mean as the prior:** that
 * would re-base the BKT chain on whatever the projector last wrote,
 * which is racy with the route's in-flight compute. The event's
 * priorMasteryMean is the chain-head value at the moment the RPC
 * committed — the only correct prior.
 *
 * Spec: docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md
 */

import { updateMasteryBKT } from '@/lib/tutor/bkt';
import type { Subscriber, SubscriberContext } from './subscriber';

export const conceptMasteryProjector: Subscriber<'learner.concept_check_answered'> = {
  name: 'concept-mastery-projector',
  kind: 'learner.concept_check_answered',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.payload.studentId;
  },

  async handle(event, ctx: SubscriberContext) {
    const p = event.payload;

    const { data: existing } = await ctx.sb
      .from('concept_mastery')
      .select('last_attempt_id, total_correct, streak_current')
      .eq('student_id', p.studentId)
      .eq('concept_id', p.conceptId)
      .maybeSingle();

    if (existing?.last_attempt_id === p.attemptId) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `attempt ${p.attemptId} already projected`,
      });
      return;
    }

    const newMean = updateMasteryBKT(p.priorMasteryMean, p.correct);
    const prevCorrect = (existing?.total_correct ?? 0) as number;
    const prevStreak = (existing?.streak_current ?? 0) as number;

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would set mastery_mean=${newMean.toFixed(3)} attempts=${p.attemptSequence}`,
      });
      return;
    }

    const { error } = await ctx.sb
      .from('concept_mastery')
      .upsert(
        {
          student_id:        p.studentId,
          concept_id:        p.conceptId,
          mastery_mean:      newMean,
          last_attempt_id:   p.attemptId,
          total_attempts:    p.attemptSequence,
          total_correct:     prevCorrect + (p.correct ? 1 : 0),
          streak_current:    p.correct ? prevStreak + 1 : 0,
          last_practiced_at: p.occurredAt,
          bkt_version:       1,
          updated_at:        ctx.now().toISOString(),
        },
        { onConflict: 'student_id,concept_id' },
      );

    if (error) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: error.message,
      });
      throw new Error(
        `concept-mastery-projector: upsert failed for ${event.eventId}: ${error.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `mastery_mean=${newMean.toFixed(3)} seq=${p.attemptSequence}`,
    });
  },
};
