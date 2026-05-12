/**
 * supabase/functions/_shared/state-runtime/dispatcher.ts
 *
 * Deno-side copy of `src/lib/state/subscribers/dispatcher.ts`. The Edge
 * Function only needs `list()` for `tickAll`, but the full surface stays
 * here so the standardDispatcher is a drop-in equivalent of the Node-side
 * singleton.
 */
import {
  DomainEventSchema,
  type DomainEvent,
  type DomainEventKind,
} from './events-registry.ts'
import {
  defaultLog,
  toAnySubscriber,
  type AnySubscriber,
  type Subscriber,
  type SubscriberContext,
  type SubscriberLogLine,
} from './subscriber.ts'
import { masteryStateWriter } from './mastery-state-writer.ts'
import { conceptMasteryProjector } from './concept-mastery-projector.ts'

export interface DispatchOutcome {
  subscriber: string
  status: 'ok' | 'error' | 'skipped'
  message?: string
}

export interface ReplayResult {
  replayed?: number
  errors?: Array<{ eventId: string; message: string }>
  refused?: 'not_student_scoped'
}

export interface Dispatcher {
  handleEvent(
    event: DomainEvent,
    ctx: SubscriberContext,
  ): Promise<DispatchOutcome[]>
  subscribersFor<K extends DomainEventKind>(
    kind: K,
  ): ReadonlyArray<Subscriber<K>>
  list(): ReadonlyArray<AnySubscriber>
  replayForStudent(
    subscriberName: string,
    studentId: string,
    ctx: SubscriberContext,
  ): Promise<ReplayResult>
}

export function createDispatcher(
  subscribers: ReadonlyArray<AnySubscriber>,
): Dispatcher {
  const byKind = new Map<DomainEventKind, AnySubscriber[]>()
  for (const s of subscribers) {
    if (!byKind.has(s.kind)) byKind.set(s.kind, [])
    byKind.get(s.kind)!.push(s)
  }
  return {
    async handleEvent(event, ctx): Promise<DispatchOutcome[]> {
      const subs = byKind.get(event.kind) ?? []
      if (subs.length === 0) {
        return [
          {
            subscriber: '_none_',
            status: 'skipped',
            message: `no subscriber registered for ${event.kind}`,
          },
        ]
      }
      const outcomes: DispatchOutcome[] = []
      for (const s of subs) {
        try {
          await s.handle(event, ctx)
          outcomes.push({ subscriber: s.name, status: 'ok' })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          outcomes.push({ subscriber: s.name, status: 'error', message })
        }
      }
      return outcomes
    },
    subscribersFor<K extends DomainEventKind>(kind: K) {
      const list = byKind.get(kind) ?? []
      return list as unknown as Subscriber<K>[]
    },
    list() {
      return subscribers
    },
    async replayForStudent(subscriberName, studentId, ctx): Promise<ReplayResult> {
      const sub = subscribers.find((s) => s.name === subscriberName)
      if (!sub) throw new Error(`unknown subscriber: ${subscriberName}`)
      if (!sub.studentIdFromEvent) return { refused: 'not_student_scoped' }

      const { data: rows } = await ctx.sb
        .from('state_events')
        .select('*')
        .eq('kind', sub.kind)
        .order('occurred_at', { ascending: true })
        .order('event_id', { ascending: true })

      let replayed = 0
      const errors: Array<{ eventId: string; message: string }> = []
      for (const row of rows ?? []) {
        const event = parseEventRow(row)
        if (!event) continue
        if (sub.studentIdFromEvent(event) !== studentId) continue
        try {
          await sub.handle(event, ctx)
          replayed += 1
        } catch (err) {
          errors.push({
            eventId: event.eventId,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
      return { replayed, errors }
    },
  }
}

function parseEventRow(row: unknown): DomainEvent | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const candidate = {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  }
  const parsed = DomainEventSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export const STANDARD_SUBSCRIBERS: ReadonlyArray<AnySubscriber> = [
  toAnySubscriber(masteryStateWriter),
  // ADR-004 Phase 2 / ADR-005 Path C v2 — keep in sync with the Node copy
  // in src/lib/state/subscribers/dispatcher.ts. Idempotent on attemptId.
  toAnySubscriber(conceptMasteryProjector),
]

export const standardDispatcher: Dispatcher = createDispatcher(
  STANDARD_SUBSCRIBERS,
)

export { defaultLog, toAnySubscriber }
export type { AnySubscriber, Subscriber, SubscriberContext, SubscriberLogLine }
