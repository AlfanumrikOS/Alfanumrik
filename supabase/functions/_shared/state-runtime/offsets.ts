/**
 * supabase/functions/_shared/state-runtime/offsets.ts
 *
 * Deno-side copy of `src/lib/state/runtime/offsets.ts`.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EPOCH = '1970-01-01T00:00:00Z'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export interface SubscriberOffset {
  lastEventId: string | null
  lastOccurredAt: string
}

export async function readSubscriberOffset(
  sb: SupabaseClient,
  subscriberName: string,
): Promise<SubscriberOffset> {
  const { data, error } = await sb
    .from('subscriber_offsets')
    .select('last_processed_event_id, last_processed_occurred_at')
    .eq('subscriber_name', subscriberName)
    .maybeSingle()
  if (error || !data) {
    return { lastEventId: null, lastOccurredAt: EPOCH }
  }
  return {
    lastEventId: data.last_processed_event_id as string | null,
    lastOccurredAt:
      (data.last_processed_occurred_at as string | null) ?? EPOCH,
  }
}

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
    .maybeSingle()
  await sb.from('subscriber_offsets').upsert(
    {
      subscriber_name: subscriberName,
      kind_filter: (existing?.kind_filter as string | undefined) ?? '',
      last_processed_event_id: newOffset.lastEventId,
      last_processed_occurred_at: newOffset.lastOccurredAt,
      events_processed:
        ((existing?.events_processed as number | undefined) ?? 0) +
        delta.processed,
      events_dead_lettered:
        ((existing?.events_dead_lettered as number | undefined) ?? 0) +
        delta.deadLettered,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subscriber_name' },
  )
}

export { EPOCH, ZERO_UUID }
