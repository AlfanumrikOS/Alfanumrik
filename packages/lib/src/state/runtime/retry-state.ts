import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns the current attempt count for (event, subscriber). Zero if none.
 */
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
    .maybeSingle();
  return (data?.attempt_count as number | undefined) ?? 0;
}

/**
 * Persist a failed attempt. INSERT on first failure (first_attempted_at = now),
 * UPDATE on subsequent failures (last_attempted_at + last_error advance;
 * first_attempted_at preserved).
 */
export async function upsertRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId).eq('subscriber_name', subscriberName)
    .maybeSingle();
  await sb.from('subscriber_retry_state').upsert({
    event_id: eventId,
    subscriber_name: subscriberName,
    attempt_count: attemptCount,
    first_attempted_at: existing?.first_attempted_at ?? now,
    last_attempted_at: now,
    last_error: lastError.slice(0, 2000),
  }, { onConflict: 'event_id,subscriber_name' });
}

/** Remove retry state for a (event, subscriber) — called on success. */
export async function clearRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
): Promise<void> {
  await sb
    .from('subscriber_retry_state')
    .delete()
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName);
}

/**
 * Record a terminal failure. Idempotent via PK conflict — repeated calls for
 * the same (event, subscriber) become no-ops. Preserves `first_attempted_at`
 * from `subscriber_retry_state` if present.
 */
export async function insertDeadLetter(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: retry } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId).eq('subscriber_name', subscriberName)
    .maybeSingle();
  await sb.from('subscriber_dead_letters').upsert({
    event_id: eventId,
    subscriber_name: subscriberName,
    attempt_count: attemptCount,
    last_error: lastError.slice(0, 2000),
    first_attempted_at: (retry?.first_attempted_at as string | undefined) ?? now,
    last_attempted_at: now,
  }, { onConflict: 'event_id,subscriber_name' });
}
