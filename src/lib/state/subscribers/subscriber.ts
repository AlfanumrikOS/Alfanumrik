/**
 * src/lib/state/subscribers/subscriber.ts — the Subscriber contract.
 *
 * A Subscriber is the projection side of an event. While a Service
 * COMPUTES events from a state + input, a Subscriber READS an event
 * and writes a projection (mastery_state row, parent notification,
 * dashboard tile, …) without mutating the event log itself.
 *
 * Subscribers MUST be idempotent. The bus delivers at-least-once
 * (pg_notify can replay; the polling daemon retries on subscriber
 * failure). Every subscriber uses the event's idempotencyKey to
 * deduplicate writes — either via a UNIQUE constraint on the
 * projection table, or by checking-before-write.
 *
 * Subscribers are scoped to a single event kind. A subscriber that
 * needs to fan out across kinds is split into one subscriber per kind.
 * This keeps the dispatcher a flat lookup table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainEvent, DomainEventKind } from '../events/registry';

export interface SubscriberContext {
  sb: SupabaseClient;
  /** When in dry-run, subscribers MUST log what they would write but
   *  not actually write. Used by the parity-check rollout phase. */
  dryRun: boolean;
  /** Injected clock for tests. */
  now: () => Date;
  /** Structured logger callback. Defaults to console.info. */
  log: (line: SubscriberLogLine) => void;
}

export interface SubscriberLogLine {
  subscriber: string;
  eventKind: DomainEventKind;
  eventId: string;
  outcome: 'ok' | 'skipped' | 'dryrun' | 'error';
  message?: string;
  context?: Record<string, unknown>;
}

export interface Subscriber<K extends DomainEventKind = DomainEventKind> {
  /** Stable name, used in logs and metrics. */
  readonly name: string;
  /** The single event kind this subscriber listens to. */
  readonly kind: K;
  /**
   * Total attempts across ticks before dead-letter (default 3).
   * The runner increments a persistent counter in subscriber_retry_state
   * on each failure and dead-letters when count >= maxRetries.
   */
  readonly maxRetries?: number;
  /**
   * Optional. Maps the event payload to the studentId this event concerns.
   * Required for replayForStudent — absence makes the subscriber not
   * student-scoped (the admin replay endpoint refuses with
   * `not_student_scoped`).
   */
  studentIdFromEvent?(event: Extract<DomainEvent, { kind: K }>): string | null;
  /** Handle one event. MUST be idempotent (see header). */
  handle(
    event: Extract<DomainEvent, { kind: K }>,
    ctx: SubscriberContext,
  ): Promise<void>;
}

/**
 * The erased form used for storage in the dispatcher's list. `Subscriber<K>`
 * is invariant in K (the `handle` method is contravariant; `kind` is
 * covariant), so a narrower `Subscriber<'foo'>` is not a subtype of
 * `Subscriber<DomainEventKind>`. AnySubscriber is the explicit
 * type-erased contract: stored subscribers accept the full union but
 * the dispatcher verifies `s.kind === event.kind` at runtime before
 * calling `handle`. Use `toAnySubscriber(narrow)` to register a narrow
 * subscriber.
 */
export interface AnySubscriber {
  readonly name: string;
  readonly kind: DomainEventKind;
  readonly maxRetries?: number;
  studentIdFromEvent?(event: DomainEvent): string | null;
  handle(event: DomainEvent, ctx: SubscriberContext): Promise<void>;
}

/** Type-erase a narrow Subscriber<K> for storage in the dispatcher. */
export function toAnySubscriber<K extends DomainEventKind>(
  s: Subscriber<K>,
): AnySubscriber {
  return s as unknown as AnySubscriber;
}

export function defaultLog(line: SubscriberLogLine): void {
  // eslint-disable-next-line no-console
  console.info(
    `[subscriber:${line.subscriber}] ${line.eventKind} ${line.eventId} → ${line.outcome}` +
      (line.message ? ` ${line.message}` : ''),
  );
}
