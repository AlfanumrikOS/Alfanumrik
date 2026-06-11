/**
 * GET /api/super-admin/subscribers — operator view of registered subscribers.
 *
 * Returns the current state of `subscriber_offsets` enriched with three
 * derived fields that operators need to triage stuck/lagging subscribers:
 *
 *   - lag_seconds          : now() - last_processed_occurred_at, in seconds.
 *                            null when last_processed_occurred_at is null.
 *   - dead_letter_count    : unresolved rows in `subscriber_dead_letters`
 *                            for this subscriber.
 *   - pending_event_count  : events on the bus matching this subscriber's
 *                            kind_filter with occurred_at > last cursor.
 *
 * Auth: authorizeAdmin (session + admin_users row).
 *
 * No mutations. No state_event emitted (this is read-side runtime metadata,
 * not learner state — see Spine ADR-005).
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     subscribers: Array<{
 *       subscriber_name: string,
 *       kind_filter: string,
 *       last_processed_event_id: string | null,
 *       last_processed_occurred_at: string | null,
 *       events_processed: number,
 *       events_dead_lettered: number,
 *       updated_at: string,
 *       lag_seconds: number | null,
 *       dead_letter_count: number,
 *       pending_event_count: number,
 *     }>,
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubscriberOffsetRow {
  subscriber_name: string;
  kind_filter: string;
  last_processed_event_id: string | null;
  last_processed_occurred_at: string | null;
  events_processed: number | null;
  events_dead_lettered: number | null;
  updated_at: string;
}

interface SubscriberView extends SubscriberOffsetRow {
  events_processed: number;
  events_dead_lettered: number;
  lag_seconds: number | null;
  dead_letter_count: number;
  pending_event_count: number;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const supabase = getSupabaseAdmin();

    const { data: offsets, error: offsetsErr } = await supabase
      .from('subscriber_offsets')
      .select(
        'subscriber_name, kind_filter, last_processed_event_id, last_processed_occurred_at, events_processed, events_dead_lettered, updated_at',
      )
      .order('subscriber_name', { ascending: true });

    if (offsetsErr) {
      logger.error('super_admin_subscribers_list_failed', {
        error: new Error(offsetsErr.message),
        stage: 'offsets_query',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load subscribers' },
        { status: 500 },
      );
    }

    const rows = (offsets ?? []) as SubscriberOffsetRow[];
    const now = Date.now();

    // Per-subscriber: dead-letter count (unresolved) + pending events on the
    // bus. We resolve both with one query each per subscriber — N is tiny
    // (handful of subscribers in production); a JOIN would be premature.
    const enriched: SubscriberView[] = [];
    for (const row of rows) {
      const lagSeconds = row.last_processed_occurred_at
        ? Math.max(
            0,
            Math.floor((now - new Date(row.last_processed_occurred_at).getTime()) / 1000),
          )
        : null;

      // Unresolved dead-letters: resolved_at IS NULL.
      const { count: deadLetterCount, error: dlErr } = await supabase
        .from('subscriber_dead_letters')
        .select('event_id', { count: 'exact', head: true })
        .eq('subscriber_name', row.subscriber_name)
        .is('resolved_at', null);

      if (dlErr) {
        logger.warn('super_admin_subscribers_dead_letter_count_failed', {
          subscriber: row.subscriber_name,
          detail: dlErr.message,
        });
      }

      // Pending event count: state_events with kind = subscriber's kind_filter
      // and occurred_at strictly newer than the last-processed cursor. Uses
      // occurred_at alone (not the (occurred_at, event_id) tuple) because the
      // count is a UX hint, not a precise tick boundary.
      let pendingQuery = supabase
        .from('state_events')
        .select('event_id', { count: 'exact', head: true })
        .eq('kind', row.kind_filter);
      if (row.last_processed_occurred_at) {
        pendingQuery = pendingQuery.gt('occurred_at', row.last_processed_occurred_at);
      }
      const { count: pendingCount, error: pendErr } = await pendingQuery;

      if (pendErr) {
        logger.warn('super_admin_subscribers_pending_count_failed', {
          subscriber: row.subscriber_name,
          detail: pendErr.message,
        });
      }

      enriched.push({
        ...row,
        events_processed: row.events_processed ?? 0,
        events_dead_lettered: row.events_dead_lettered ?? 0,
        lag_seconds: lagSeconds,
        dead_letter_count: deadLetterCount ?? 0,
        pending_event_count: pendingCount ?? 0,
      });
    }

    return NextResponse.json({
      success: true,
      data: { subscribers: enriched },
    });
  } catch (err) {
    logger.error('super_admin_subscribers_list_threw', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Unexpected error loading subscribers' },
      { status: 500 },
    );
  }
}
