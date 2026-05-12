/**
 * supabase/functions/_shared/state-runtime/concept-mastery-projector.ts
 *
 * Deno-side copy of `src/lib/state/subscribers/concept-mastery-projector.ts`.
 * Canonical writer of public.concept_mastery for the ADR-004 Phase 2 / ADR-005
 * Path C v2 BKT path. Idempotent on payload.attemptId. Stays in sync with the
 * Node-side copy by hand.
 */
import { updateMasteryBKT } from './bkt.ts'
import type { Subscriber, SubscriberContext } from './subscriber.ts'

export const conceptMasteryProjector: Subscriber<'learner.concept_check_answered'> = {
  name: 'concept-mastery-projector',
  kind: 'learner.concept_check_answered',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.payload.studentId
  },

  async handle(event, ctx: SubscriberContext) {
    const p = event.payload

    const { data: existing } = await ctx.sb
      .from('concept_mastery')
      .select('last_attempt_id, total_correct, streak_current')
      .eq('student_id', p.studentId)
      .eq('concept_id', p.conceptId)
      .maybeSingle()

    if ((existing as { last_attempt_id?: string } | null)?.last_attempt_id === p.attemptId) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `attempt ${p.attemptId} already projected`,
      })
      return
    }

    const newMean = updateMasteryBKT(p.priorMasteryMean, p.correct)
    const prevCorrect = ((existing as { total_correct?: number } | null)?.total_correct ?? 0) as number
    const prevStreak = ((existing as { streak_current?: number } | null)?.streak_current ?? 0) as number

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would set mastery_mean=${newMean.toFixed(3)} attempts=${p.attemptSequence}`,
      })
      return
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
      )

    if (error) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: error.message,
      })
      throw new Error(
        `concept-mastery-projector: upsert failed for ${event.eventId}: ${error.message}`,
      )
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `mastery_mean=${newMean.toFixed(3)} seq=${p.attemptSequence}`,
    })
  },
}
