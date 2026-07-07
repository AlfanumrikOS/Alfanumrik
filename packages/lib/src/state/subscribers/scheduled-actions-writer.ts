/**
 * scheduled-actions-writer — ADR-001 Phase 3c / ADR-005 E10 sunset.
 *
 * Canonical writer of public.scheduled_actions for the Learner Loop.
 * Consumes `learner.next_action_resolved` events published by
 * GET /api/learner/next and projects them into the per-(student, horizon,
 * day_bucket, rank) slot via the UNIQUE constraint
 * `scheduled_actions_slot_unique`.
 *
 * **Why this exists:** ADR-005 §"The enforceable rule" #1 — no API route is
 * a canonical writer of learner state. Before this projector, /api/learner/next
 * wrote scheduled_actions inline (registered as exception E10 in
 * docs/architecture/EXCEPTIONS.md). This subscriber is the projector that
 * closes E10: the route publishes the durable event, this writes the row.
 *
 * **Idempotency:** the write is a pure OVERWRITE keyed by
 * (student_id, horizon, day_bucket, rank) — no accumulation. Re-delivery of
 * the same event upserts the byte-identical row, so the substrate's
 * at-least-once delivery is safe WITHOUT a read-before-write check (unlike
 * concept-mastery-projector, which accumulates total_correct/streak and must
 * dedupe on attemptId). This matches the route's "overwrite-within-day"
 * semantics exactly.
 *
 * **Determinism:** the payload carries the resolver's full action body plus
 * generatedAt/expiresAt, so the row this projector writes is identical to the
 * row the route writes optimistically during the dual-write parity phase
 * (the deterministic-equivalence property ADR-005 requires of dual writers).
 *
 * **source:** hard-coded 'scheduler' — the resolver is the only producer of
 * this event. Teacher/parent override rows (source='teacher_override' /
 * 'manual_pin') are a different write path and never flow through here.
 *
 * Spec: docs/architecture/ADR-001-learner-loop-unification.md (Phase 3c),
 *       docs/architecture/EXCEPTIONS.md E10.
 */

import type { Subscriber, SubscriberContext } from './subscriber';

export const scheduledActionsWriter: Subscriber<'learner.next_action_resolved'> = {
  name: 'scheduled-actions-writer',
  kind: 'learner.next_action_resolved',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.payload.studentId;
  },

  async handle(event, ctx: SubscriberContext) {
    const p = event.payload;

    // Defense-in-depth: the dispatcher already validates events through
    // DomainEventSchema before delivery, but a projector must never crash the
    // tick on a malformed payload. A missing anchor field is a safe no-op
    // (skipped) rather than a throw — a throw would dead-letter a poison row
    // and stall the cursor for a non-retryable problem.
    if (!p.studentId || !p.horizon || !p.dayBucket || !p.actionKind) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: 'malformed payload: missing slot anchor field',
      });
      return;
    }

    if (ctx.dryRun) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'dryrun',
        message: `would upsert ${p.horizon}/${p.dayBucket}/rank${p.rank} kind=${p.actionKind}`,
      });
      return;
    }

    const { error } = await ctx.sb
      .from('scheduled_actions')
      .upsert(
        {
          student_id:     p.studentId,
          horizon:        p.horizon,
          day_bucket:     p.dayBucket,
          rank:           p.rank,
          action_kind:    p.actionKind,
          action_payload: p.actionPayload,
          // Hard-coded: the resolver is the only producer of this event.
          source:         'scheduler',
          generated_at:   p.generatedAt,
          expires_at:     p.expiresAt,
        },
        { onConflict: 'student_id,horizon,day_bucket,rank' },
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
        `scheduled-actions-writer: upsert failed for ${event.eventId}: ${error.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `${p.horizon}/${p.dayBucket}/rank${p.rank} kind=${p.actionKind}`,
    });
  },
};
