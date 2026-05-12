/**
 * supabase/functions/_shared/state-runtime/retry-state.ts
 *
 * Deno-side copy of `src/lib/state/runtime/retry-state.ts`.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function readRetryCount(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
): Promise<number> {
  const { data } = await sb
    .from('subscriber_retry_state')
    .select('attempt_count')
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName)
    .maybeSingle()
  return (data?.attempt_count as number | undefined) ?? 0
}

export async function upsertRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { data: existing } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName)
    .maybeSingle()
  await sb.from('subscriber_retry_state').upsert(
    {
      event_id: eventId,
      subscriber_name: subscriberName,
      attempt_count: attemptCount,
      first_attempted_at: existing?.first_attempted_at ?? now,
      last_attempted_at: now,
      last_error: lastError.slice(0, 2000),
    },
    { onConflict: 'event_id,subscriber_name' },
  )
}

export async function clearRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
): Promise<void> {
  await sb
    .from('subscriber_retry_state')
    .delete()
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName)
}

export async function insertDeadLetter(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { data: retry } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName)
    .maybeSingle()
  await sb.from('subscriber_dead_letters').upsert(
    {
      event_id: eventId,
      subscriber_name: subscriberName,
      attempt_count: attemptCount,
      last_error: lastError.slice(0, 2000),
      first_attempted_at:
        (retry?.first_attempted_at as string | undefined) ?? now,
      last_attempted_at: now,
    },
    { onConflict: 'event_id,subscriber_name' },
  )
}
