import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sentinel watermark returned when a subscriber has no row in
 * `public.subscriber_offsets` yet. Matches the COALESCE default the
 * `subscriber_lag` view uses (migration 20260524110001), so a freshly
 * registered subscriber is treated as "infinitely behind" and the runtime
 * will read events from the beginning of the bus on its first tick.
 */
const EPOCH = '1970-01-01T00:00:00Z';

/**
 * Sentinel event-id used by the per-subscriber lag view to lexicographically
 * order events when no row exists yet. Re-exported so callers comparing
 * (occurred_at, event_id) tuples have a single source of truth.
 */
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface SubscriberOffset {
  lastEventId: string | null;
  lastOccurredAt: string;
  /**
   * Server-set ingestion time (`state_events.created_at`) of the last
   * processed/dead-lettered event. This — NOT `lastOccurredAt` — is the bus
   * ORDERING cursor (see tick-one.ts). occurred_at is caller-supplied and can
   * be arbitrary (a far-future value poisoned a live watermark on 2026-07-13);
   * created_at is monotonic and server-controlled, so ordering by it makes the
   * bus immune to occurred_at values. Optional so pre-existing callers/tests
   * that only set lastOccurredAt still type-check; the writer falls back to
   * lastOccurredAt when this is absent.
   */
  lastCreatedAt?: string;
}

/**
 * Read the watermark for a registered subscriber. Returns the sentinel
 * { null, EPOCH } pair when no row exists so callers can treat "never run"
 * uniformly with "row missing".
 *
 * Reads are intentionally tolerant of error responses (transient REST
 * failures, missing row): the projector runtime always wants a valid
 * watermark to compare against. A real corruption surfaces on the
 * subsequent write attempt.
 */
export async function readSubscriberOffset(
  sb: SupabaseClient,
  subscriberName: string,
): Promise<SubscriberOffset> {
  const { data, error } = await sb
    .from('subscriber_offsets')
    .select('last_processed_event_id, last_processed_occurred_at, last_processed_created_at')
    .eq('subscriber_name', subscriberName)
    .maybeSingle();
  if (error || !data) {
    return { lastEventId: null, lastOccurredAt: EPOCH, lastCreatedAt: EPOCH };
  }
  const lastOccurredAt = (data.last_processed_occurred_at as string | null) ?? EPOCH;
  return {
    lastEventId: data.last_processed_event_id as string | null,
    lastOccurredAt,
    // Fall back to occurred_at (then EPOCH) when the created_at column has not
    // been backfilled yet, so an un-migrated row still resumes safely.
    lastCreatedAt: (data.last_processed_created_at as string | null) ?? lastOccurredAt,
  };
}

/**
 * Advance a subscriber's watermark and accumulate per-tick counters.
 *
 * Reads the existing row first to preserve `kind_filter` (set at registration)
 * and to increment counters rather than overwrite them. An UPSERT on
 * `subscriber_name` then writes the new state atomically.
 *
 * Counter accumulation is intentional: each tick reports a delta, and the
 * row tracks running totals since the subscriber was registered.
 */
// Precondition: subscriber_offsets row is seeded at subscriber registration
// (via migration). First write to an unseeded row would set kind_filter='',
// which would break subscriber_lag.events_behind (kind='' never matches).
// Single writer per subscriber per tick; read-modify-write is safe under
// that invariant.
export async function writeSubscriberOffset(
  sb: SupabaseClient,
  subscriberName: string,
  newOffset: SubscriberOffset,
  delta: { processed: number; deadLettered: number },
): Promise<void> {
  const { data: existing } = await sb
    .from('subscriber_offsets')
    .select('events_processed, events_dead_lettered, kind_filter')
    .eq('subscriber_name', subscriberName)
    .maybeSingle();
  await sb.from('subscriber_offsets').upsert(
    {
      subscriber_name: subscriberName,
      kind_filter: (existing?.kind_filter as string | undefined) ?? '',
      last_processed_event_id: newOffset.lastEventId,
      last_processed_occurred_at: newOffset.lastOccurredAt,
      // created_at is the ordering cursor; fall back to occurred_at if a caller
      // didn't supply it (keeps old callers/tests valid without a null cursor).
      last_processed_created_at: newOffset.lastCreatedAt ?? newOffset.lastOccurredAt,
      events_processed:
        ((existing?.events_processed as number | undefined) ?? 0) + delta.processed,
      events_dead_lettered:
        ((existing?.events_dead_lettered as number | undefined) ?? 0) + delta.deadLettered,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subscriber_name' },
  );
}

export { EPOCH, ZERO_UUID };
