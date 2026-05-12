/**
 * supabase/functions/_shared/state-runtime/tick-one.ts
 *
 * Deno-side copy of `src/lib/state/runtime/tick-one.ts`.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { AnySubscriber, SubscriberContext } from './subscriber.ts'
import { DomainEventSchema, type DomainEvent } from './events-registry.ts'
import {
  readSubscriberOffset,
  writeSubscriberOffset,
  ZERO_UUID,
  type SubscriberOffset,
} from './offsets.ts'
import {
  readRetryCount,
  upsertRetryState,
  clearRetryState,
  insertDeadLetter,
} from './retry-state.ts'

export interface TickOneOptions {
  sb: SupabaseClient
  ctx: SubscriberContext
  batchSize?: number
}

export interface TickOneResult {
  subscriberName: string
  processed: number
  deadLettered: number
}

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_MAX_RETRIES = 3

export async function tickOne(
  sub: AnySubscriber,
  opts: TickOneOptions,
): Promise<TickOneResult> {
  const { sb, ctx } = opts
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const maxRetries = sub.maxRetries ?? DEFAULT_MAX_RETRIES

  const cursor = await readSubscriberOffset(sb, sub.name)

  const { data: rows, error } = await sb
    .from('state_events')
    .select('*')
    .eq('kind', sub.kind)
    .gte('occurred_at', cursor.lastOccurredAt)
    .order('occurred_at', { ascending: true })
    .order('event_id', { ascending: true })
    .limit(batchSize + 1)

  if (error)
    throw new Error(`tick-one: fetch failed for ${sub.name}: ${error.message}`)

  const events = (rows ?? [])
    .filter((r) => {
      const occ = r.occurred_at as string
      const id = r.event_id as string
      if (occ > cursor.lastOccurredAt) return true
      if (occ === cursor.lastOccurredAt) return id > (cursor.lastEventId ?? ZERO_UUID)
      return false
    })
    .slice(0, batchSize)

  let processed = 0
  let deadLettered = 0
  let advanceTo: SubscriberOffset = cursor

  for (const row of events) {
    const event = parseEventRow(row)
    const rowEventId = ((row as Record<string, unknown>).event_id ?? null) as
      | string
      | null
    const rowOccurredAt = ((row as Record<string, unknown>).occurred_at ?? null) as
      | string
      | null

    if (!event) {
      if (!rowEventId || !rowOccurredAt) {
        ctx.log({
          subscriber: sub.name,
          eventKind: 'mesh.cycle_completed',
          eventId: 'unknown',
          outcome: 'error',
          message: 'state_events row missing event_id or occurred_at; skipping',
        })
        continue
      }
      const errMsg = 'event row failed schema parse'
      const prior = await readRetryCount(sb, rowEventId, sub.name)
      const newCount = prior + 1
      if (newCount >= maxRetries) {
        await insertDeadLetter(sb, rowEventId, sub.name, newCount, errMsg)
        await clearRetryState(sb, rowEventId, sub.name)
        deadLettered += 1
        advanceTo = { lastEventId: rowEventId, lastOccurredAt: rowOccurredAt }
      } else {
        await upsertRetryState(sb, rowEventId, sub.name, newCount, errMsg)
        break
      }
      continue
    }

    try {
      await sub.handle(event, ctx)
      await clearRetryState(sb, event.eventId, sub.name)
      processed += 1
      advanceTo = { lastEventId: event.eventId, lastOccurredAt: event.occurredAt }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const prior = await readRetryCount(sb, event.eventId, sub.name)
      const newCount = prior + 1
      if (newCount >= maxRetries) {
        await insertDeadLetter(sb, event.eventId, sub.name, newCount, errMsg)
        await clearRetryState(sb, event.eventId, sub.name)
        deadLettered += 1
        advanceTo = {
          lastEventId: event.eventId,
          lastOccurredAt: event.occurredAt,
        }
      } else {
        await upsertRetryState(sb, event.eventId, sub.name, newCount, errMsg)
        break
      }
    }
  }

  if (advanceTo !== cursor) {
    await writeSubscriberOffset(sb, sub.name, advanceTo, {
      processed,
      deadLettered,
    })
  }
  return { subscriberName: sub.name, processed, deadLettered }
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
