import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnySubscriber, SubscriberContext } from '@alfanumrik/lib/state/subscribers/subscriber';
import { DomainEventSchema, type DomainEvent } from '@alfanumrik/lib/state/events/registry';
import {
  readSubscriberOffset, writeSubscriberOffset,
  ZERO_UUID, type SubscriberOffset,
} from './offsets';
import {
  readRetryCount, upsertRetryState, clearRetryState, insertDeadLetter,
} from './retry-state';

export interface TickOneOptions {
  sb: SupabaseClient;
  ctx: SubscriberContext;
  batchSize?: number;
}

export interface TickOneResult {
  subscriberName: string;
  processed: number;
  deadLettered: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Process one subscriber's queue: fetch events past its cursor (filtered by
 * kind), call its handler in (occurred_at, event_id) order. On success,
 * advance the cursor and clear any persisted retry state. On failure:
 *   - increment subscriber_retry_state.attempt_count;
 *   - if count >= maxRetries: insert subscriber_dead_letters, clear retry
 *     state, advance the cursor past the bad event;
 *   - else: stop processing this batch (cursor unchanged) — next tick retries.
 *
 * Parse failures (event row that fails DomainEventSchema) flow through the
 * same retry/dead-letter path as handler exceptions, keyed on the row's
 * raw event_id. This prevents a stuck cursor when a malformed row lands.
 *
 * Pure on inputs; all I/O is via the provided SupabaseClient.
 */
export async function tickOne(
  sub: AnySubscriber,
  opts: TickOneOptions,
): Promise<TickOneResult> {
  const { sb, ctx } = opts;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = sub.maxRetries ?? DEFAULT_MAX_RETRIES;

  const cursor = await readSubscriberOffset(sb, sub.name);

  // Fetch events with occurred_at >= cursor.lastOccurredAt; we filter the
  // boundary tie (occurred_at = cursor + event_id <= last) in JS to keep the
  // predicate simple. Over-fetch by 1 to absorb the boundary row.
  const { data: rows, error } = await sb
    .from('state_events')
    .select('*')
    .eq('kind', sub.kind)
    .gte('occurred_at', cursor.lastOccurredAt)
    .order('occurred_at', { ascending: true })
    .order('event_id', { ascending: true })
    .limit(batchSize + 1);

  if (error) throw new Error(`tick-one: fetch failed for ${sub.name}: ${error.message}`);

  const events = (rows ?? []).filter(r => {
    const occ = r.occurred_at as string;
    const id = r.event_id as string;
    if (occ > cursor.lastOccurredAt) return true;
    if (occ === cursor.lastOccurredAt) return id > (cursor.lastEventId ?? ZERO_UUID);
    return false;
  }).slice(0, batchSize);

  let processed = 0;
  let deadLettered = 0;
  let advanceTo: SubscriberOffset = cursor;

  for (const row of events) {
    const event = parseEventRow(row);
    const rowEventId = ((row as Record<string, unknown>).event_id ?? null) as string | null;
    const rowOccurredAt = ((row as Record<string, unknown>).occurred_at ?? null) as string | null;

    if (!event) {
      // Schema-parse failure. Treat as a handler failure so the row flows
      // through retry → dead-letter and the cursor eventually advances.
      // Without this, a malformed row at the cursor head would stick the
      // subscriber forever.
      if (!rowEventId || !rowOccurredAt) {
        // Row is so malformed we can't even key retry state. Skip + advance
        // so the cursor doesn't stick. This should never happen because the
        // table has NOT NULL constraints on event_id and occurred_at, but
        // defensive.
        ctx.log({
          subscriber: sub.name,
          eventKind: 'mesh.cycle_completed', // placeholder; the kind itself is unparseable
          eventId: 'unknown',
          outcome: 'error',
          message: 'state_events row missing event_id or occurred_at; skipping',
        });
        continue;
      }
      const errMsg = 'event row failed schema parse';
      const prior = await readRetryCount(sb, rowEventId, sub.name);
      const newCount = prior + 1;
      if (newCount >= maxRetries) {
        await insertDeadLetter(sb, rowEventId, sub.name, newCount, errMsg);
        await clearRetryState(sb, rowEventId, sub.name);
        deadLettered += 1;
        advanceTo = { lastEventId: rowEventId, lastOccurredAt: rowOccurredAt };
      } else {
        await upsertRetryState(sb, rowEventId, sub.name, newCount, errMsg);
        // Stop processing the rest of this batch — cursor unchanged so the
        // same bad row is the first one fetched on the next tick.
        break;
      }
      continue;
    }

    try {
      await sub.handle(event, ctx);
      await clearRetryState(sb, event.eventId, sub.name);
      processed += 1;
      advanceTo = { lastEventId: event.eventId, lastOccurredAt: event.occurredAt };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const prior = await readRetryCount(sb, event.eventId, sub.name);
      const newCount = prior + 1;
      if (newCount >= maxRetries) {
        await insertDeadLetter(sb, event.eventId, sub.name, newCount, errMsg);
        await clearRetryState(sb, event.eventId, sub.name);
        deadLettered += 1;
        advanceTo = { lastEventId: event.eventId, lastOccurredAt: event.occurredAt };
      } else {
        await upsertRetryState(sb, event.eventId, sub.name, newCount, errMsg);
        // Stop processing the rest of this batch — cursor unchanged so the
        // same bad event is the first one fetched on the next tick.
        break;
      }
    }
  }

  if (advanceTo !== cursor) {
    await writeSubscriberOffset(sb, sub.name, advanceTo, { processed, deadLettered });
  }
  return { subscriberName: sub.name, processed, deadLettered };
}

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
