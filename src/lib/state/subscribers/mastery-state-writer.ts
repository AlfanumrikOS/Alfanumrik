/**
 * src/lib/state/subscribers/mastery-state-writer.ts
 *
 * The first concrete subscriber. Reacts to learner.mastery_changed and
 * upserts a row into the learner_mastery projection table.
 *
 * Idempotency: the subscriber sets last_updated_at from the event's
 * occurredAt and uses an UPSERT on (auth_user_id, subject_code,
 * chapter_number). Replaying the same event is a no-op write of the
 * same toMastery value. The bus's UNIQUE(idempotencyKey) on
 * state_events makes the upstream replay rare; this writer's own
 * idempotency makes it safe.
 *
 * Mastery monotonicity: we deliberately do NOT enforce mastery only
 * goes up. A correct-trail-then-wrong sequence legitimately reduces
 * mastery in the BKT model. The writer trusts the event's toMastery.
 *
 * Attempts counter: incremented per event by 1. This counts mastery
 * UPDATES (one per chapter per quiz), not per-question attempts. The
 * field is for "did this chapter get touched today?"-style dashboards,
 * not for precise BKT attempt accounting (which lives in quiz_sessions
 * + the event log).
 */

import type {
  LearnerMasteryChangedEvent,
  Subscriber,
  SubscriberContext,
} from './types';

export const masteryStateWriter: Subscriber<'learner.mastery_changed'> = {
  name: 'mastery-state-writer',
  kind: 'learner.mastery_changed',
  studentIdFromEvent(event) {
    return event.actorAuthUserId;
  },

  async handle(event, ctx: SubscriberContext) {
    const payload = event.payload;
    const subjectCode = payload.subjectCode.toLowerCase();
    const upsertPayload = {
      auth_user_id: event.actorAuthUserId,
      subject_code: subjectCode,
      chapter_number: payload.chapterNumber,
      mastery: clamp01(payload.toMastery),
      last_updated_at: event.occurredAt,
    };

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would upsert mastery=${upsertPayload.mastery.toFixed(3)}`,
        context: upsertPayload,
      });
      return;
    }

    // Two-step: read current row to get attempts counter, then upsert.
    // The single ON CONFLICT path can't increment attempts without an
    // RPC; this is simpler and the cost is negligible at our scale.
    const existing = await ctx.sb
      .from('learner_mastery')
      .select('attempts')
      .eq('auth_user_id', upsertPayload.auth_user_id)
      .eq('subject_code', upsertPayload.subject_code)
      .eq('chapter_number', upsertPayload.chapter_number)
      .maybeSingle();

    const nextAttempts = (existing.data?.attempts ?? 0) + 1;

    const { error } = await ctx.sb
      .from('learner_mastery')
      .upsert(
        { ...upsertPayload, attempts: nextAttempts },
        { onConflict: 'auth_user_id,subject_code,chapter_number' },
      );

    if (error) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: error.message,
        context: { upsertPayload },
      });
      throw new Error(
        `mastery-state-writer: upsert failed for ${event.eventId}: ${error.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `mastery=${upsertPayload.mastery.toFixed(3)} attempts=${nextAttempts}`,
    });
  },
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// Re-export type alias used in tests/imports.
export type { LearnerMasteryChangedEvent };
