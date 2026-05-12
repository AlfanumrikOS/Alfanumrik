/**
 * supabase/functions/_shared/state-runtime/subscriber.ts
 *
 * Deno-side copy of `src/lib/state/subscribers/subscriber.ts`. Keep in sync
 * by hand — see events-registry.ts for the rationale.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { DomainEvent, DomainEventKind } from './events-registry.ts'

export interface SubscriberContext {
  sb: SupabaseClient
  /** When in dry-run, subscribers MUST log what they would write but
   *  not actually write. Used by the parity-check rollout phase. */
  dryRun: boolean
  /** Injected clock for tests. */
  now: () => Date
  /** Structured logger callback. Defaults to console.info. */
  log: (line: SubscriberLogLine) => void
}

export interface SubscriberLogLine {
  subscriber: string
  eventKind: DomainEventKind
  eventId: string
  outcome: 'ok' | 'skipped' | 'dryrun' | 'error'
  message?: string
  context?: Record<string, unknown>
}

export interface Subscriber<K extends DomainEventKind = DomainEventKind> {
  readonly name: string
  readonly kind: K
  readonly maxRetries?: number
  studentIdFromEvent?(event: Extract<DomainEvent, { kind: K }>): string | null
  handle(
    event: Extract<DomainEvent, { kind: K }>,
    ctx: SubscriberContext,
  ): Promise<void>
}

export interface AnySubscriber {
  readonly name: string
  readonly kind: DomainEventKind
  readonly maxRetries?: number
  studentIdFromEvent?(event: DomainEvent): string | null
  handle(event: DomainEvent, ctx: SubscriberContext): Promise<void>
}

export function toAnySubscriber<K extends DomainEventKind>(
  s: Subscriber<K>,
): AnySubscriber {
  return s as unknown as AnySubscriber
}

export function defaultLog(line: SubscriberLogLine): void {
  // eslint-disable-next-line no-console
  console.info(
    `[subscriber:${line.subscriber}] ${line.eventKind} ${line.eventId} → ${line.outcome}` +
      (line.message ? ` ${line.message}` : ''),
  )
}
