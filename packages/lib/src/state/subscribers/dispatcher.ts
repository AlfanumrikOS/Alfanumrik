/**
 * src/lib/state/subscribers/dispatcher.ts — fan-out of bus events to subscribers.
 *
 * The dispatcher is a flat table keyed by event kind. When the event
 * listener daemon (or any direct caller) pushes an event in, the
 * dispatcher runs every subscriber registered for that kind in
 * registration order.
 *
 * Failure semantics:
 *
 *   - One subscriber throwing does NOT abort the others. The event
 *     log is the source of truth; a failed subscriber's projection
 *     will catch up on the next replay.
 *   - The dispatcher returns a per-subscriber outcome array so the
 *     caller (listener daemon) can decide whether to advance its
 *     watermark or hold for retry.
 *
 * Why not just register subscribers as Services on the Orchestrator?
 *
 *   - A Service mutates state by emitting NEW events. A Subscriber
 *     writes a projection (read-side). The two are different roles;
 *     mixing them muddies the contract.
 *   - Services run under the per-learner mutex; subscribers may run
 *     concurrently across learners. Keeping them separate lets each
 *     scale independently.
 */

import { DomainEventSchema, type DomainEvent, type DomainEventKind } from '../events/registry';
import {
  defaultLog,
  toAnySubscriber,
  type AnySubscriber,
  type Subscriber,
  type SubscriberContext,
  type SubscriberLogLine,
} from './subscriber';
import { masteryStateWriter } from './mastery-state-writer';
import { conceptMasteryProjector } from './concept-mastery-projector';
import { freeTierProvisioner } from './free-tier-provisioner';
import { entitlementProjector } from './entitlement-projector';
import { scheduledActionsWriter } from './scheduled-actions-writer';

export interface DispatchOutcome {
  subscriber: string;
  status: 'ok' | 'error' | 'skipped';
  message?: string;
}

export interface ReplayResult {
  replayed?: number;
  errors?: Array<{ eventId: string; message: string }>;
  refused?: 'not_student_scoped';
}

export interface Dispatcher {
  handleEvent(event: DomainEvent, ctx: SubscriberContext): Promise<DispatchOutcome[]>;
  /** Subscribers currently registered for a given kind. */
  subscribersFor<K extends DomainEventKind>(
    kind: K,
  ): ReadonlyArray<Subscriber<K>>;
  /** All registered subscribers — for tests and debugging. */
  list(): ReadonlyArray<AnySubscriber>;
  /**
   * Re-invoke ONE subscriber for events matching its kind AND a specific
   * student. Does NOT mutate subscriber_offsets — replay is a read-only
   * operation on the bus from the cursor's perspective. The subscriber's
   * own idempotency is required.
   *
   * Refuses with `not_student_scoped` if the subscriber lacks
   * studentIdFromEvent. Throws for unknown subscriber names.
   */
  replayForStudent(
    subscriberName: string,
    studentId: string,
    ctx: SubscriberContext,
  ): Promise<ReplayResult>;
}

export function createDispatcher(
  subscribers: ReadonlyArray<AnySubscriber>,
): Dispatcher {
  const byKind = new Map<DomainEventKind, AnySubscriber[]>();
  for (const s of subscribers) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, []);
    byKind.get(s.kind)!.push(s);
  }
  return {
    async handleEvent(event, ctx): Promise<DispatchOutcome[]> {
      const subs = byKind.get(event.kind) ?? [];
      if (subs.length === 0) {
        return [
          {
            subscriber: '_none_',
            status: 'skipped',
            message: `no subscriber registered for ${event.kind}`,
          },
        ];
      }
      const outcomes: DispatchOutcome[] = [];
      for (const s of subs) {
        try {
          // Safe: we partitioned by `s.kind === event.kind`, so the
          // erased `event: DomainEvent` is the narrow shape s.handle
          // expects.
          await s.handle(event, ctx);
          outcomes.push({ subscriber: s.name, status: 'ok' });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes.push({ subscriber: s.name, status: 'error', message });
        }
      }
      return outcomes;
    },
    subscribersFor<K extends DomainEventKind>(kind: K) {
      const list = byKind.get(kind) ?? [];
      return list as unknown as Subscriber<K>[];
    },
    list() {
      return subscribers;
    },
    async replayForStudent(subscriberName, studentId, ctx): Promise<ReplayResult> {
      const sub = subscribers.find(s => s.name === subscriberName);
      if (!sub) throw new Error(`unknown subscriber: ${subscriberName}`);
      if (!sub.studentIdFromEvent) return { refused: 'not_student_scoped' };

      const { data: rows } = await ctx.sb
        .from('state_events')
        .select('*')
        .eq('kind', sub.kind)
        .order('occurred_at', { ascending: true })
        .order('event_id', { ascending: true });

      let replayed = 0;
      const errors: Array<{ eventId: string; message: string }> = [];
      for (const row of rows ?? []) {
        const event = parseEventRow(row);
        if (!event) continue;
        if (sub.studentIdFromEvent(event) !== studentId) continue;
        try {
          await sub.handle(event, ctx);
          replayed += 1;
        } catch (err) {
          errors.push({
            eventId: event.eventId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { replayed, errors };
    },
  };
}

// NOTE: duplicated from src/lib/state/runtime/tick-one.ts. Consider extracting
// to a shared `_event-row.ts` util if a third caller appears.
function parseEventRow(row: unknown): DomainEvent | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const candidate = {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  };
  const parsed = DomainEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * The production subscriber roster. Add new subscribers here and the
 * listener daemon picks them up on next process start.
 */
export const STANDARD_SUBSCRIBERS: ReadonlyArray<AnySubscriber> = [
  toAnySubscriber(masteryStateWriter),
  // ADR-004 Phase 2 / ADR-005 Path C v2 — canonical writer of concept_mastery
  // for the BKT path. Idempotent on payload.attemptId.
  toAnySubscriber(conceptMasteryProjector),
  // W2.3 — free tier provisioner replacing students DB trigger
  toAnySubscriber(freeTierProvisioner),
  // W2.4 — entitlement projector subscribing to billing.invoice_paid
  toAnySubscriber(entitlementProjector),
  // ADR-001 Phase 3c / ADR-005 E10 sunset — canonical writer of
  // scheduled_actions, consuming learner.next_action_resolved. Idempotent
  // overwrite keyed by (student_id, horizon, day_bucket, rank).
  toAnySubscriber(scheduledActionsWriter),
];

/** The production dispatcher. Singleton per process. */
export const standardDispatcher: Dispatcher = createDispatcher(STANDARD_SUBSCRIBERS);

export { defaultLog, toAnySubscriber };
export type { AnySubscriber, Subscriber, SubscriberContext, SubscriberLogLine };
