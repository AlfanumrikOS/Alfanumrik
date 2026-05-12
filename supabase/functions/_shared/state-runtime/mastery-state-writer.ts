/**
 * supabase/functions/_shared/state-runtime/mastery-state-writer.ts
 *
 * Deno-side copy of `src/lib/state/subscribers/mastery-state-writer.ts`.
 * The first concrete projector — reacts to learner.mastery_changed and
 * upserts learner_mastery rows. Stays in sync with the Node-side copy by hand.
 */
import type { DomainEvent } from './events-registry.ts'
import type { Subscriber, SubscriberContext } from './subscriber.ts'

type LearnerMasteryChangedEvent = Extract<
  DomainEvent,
  { kind: 'learner.mastery_changed' }
>

export const masteryStateWriter: Subscriber<'learner.mastery_changed'> = {
  name: 'mastery-state-writer',
  kind: 'learner.mastery_changed',
  studentIdFromEvent(event) {
    return event.actorAuthUserId
  },

  async handle(event, ctx: SubscriberContext) {
    const payload = event.payload
    const subjectCode = payload.subjectCode.toLowerCase()
    const upsertPayload = {
      auth_user_id: event.actorAuthUserId,
      subject_code: subjectCode,
      chapter_number: payload.chapterNumber,
      mastery: clamp01(payload.toMastery),
      last_updated_at: event.occurredAt,
    }

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would upsert mastery=${upsertPayload.mastery.toFixed(3)}`,
        context: upsertPayload,
      })
      return
    }

    const existing = await ctx.sb
      .from('learner_mastery')
      .select('attempts')
      .eq('auth_user_id', upsertPayload.auth_user_id)
      .eq('subject_code', upsertPayload.subject_code)
      .eq('chapter_number', upsertPayload.chapter_number)
      .maybeSingle()

    const nextAttempts = ((existing.data?.attempts as number | undefined) ?? 0) + 1

    const { error } = await ctx.sb
      .from('learner_mastery')
      .upsert(
        { ...upsertPayload, attempts: nextAttempts },
        { onConflict: 'auth_user_id,subject_code,chapter_number' },
      )

    if (error) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: error.message,
        context: { upsertPayload },
      })
      throw new Error(
        `mastery-state-writer: upsert failed for ${event.eventId}: ${error.message}`,
      )
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `mastery=${upsertPayload.mastery.toFixed(3)} attempts=${nextAttempts}`,
    })
  },
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export type { LearnerMasteryChangedEvent }
