/**
 * POST /api/super-admin/subscribers/[name]/replay — move a subscriber's
 * cursor BACKWARD so the next tick reprocesses events.
 *
 * !!! DANGER — reprocessing semantics !!!
 *
 *   Moving a cursor backward CAUSES THE SUBSCRIBER TO REPROCESS EVENTS on
 *   its next tick. Subscriber idempotency is REQUIRED for safety. If a
 *   subscriber writes non-idempotently (e.g. INSERT-only into a child table
 *   without an upsert key, or emits a downstream side-effect that lacks an
 *   idempotency key), replaying will DOUBLE-WRITE / DOUBLE-FIRE.
 *
 *   Operators MUST verify the subscriber's idempotency contract BEFORE
 *   replaying. Audit the subscriber's `handle()` for:
 *     - upsert on a stable key (event_id, attempt_id, …)
 *     - side-effects gated by an idempotency_key check
 *     - external API calls that are themselves idempotent or have de-dup
 *
 *   The two production subscribers as of 2026-05-17 are both idempotent
 *   (mastery-state-writer upserts on (student_id, …); concept-mastery-
 *   projector dedupes on payload.attemptId). New subscribers MUST keep
 *   this contract or this endpoint is unsafe to use on them.
 *
 * Why this endpoint exists:
 *
 *   When a subscriber gets stuck on a bad row, or when a projection needs
 *   to be rebuilt from a known point after a bug fix, operators need a
 *   surgical way to move the cursor without touching every other
 *   subscriber. This endpoint moves ONE subscriber's cursor; it does NOT
 *   delete rows from `state_events`.
 *
 * Forward jumps ("skip ahead past a bad event") are intentionally NOT
 * supported here — that is a separate, more dangerous operation reserved
 * for a follow-up endpoint. Trying to set the cursor forward returns 400.
 *
 * Contract:
 *   Body:
 *     - mode: 'reset_to_timestamp' | 'reset_to_event_id'
 *     - target: ISO timestamp string (when mode is reset_to_timestamp)
 *               or state_event UUID (when mode is reset_to_event_id)
 *     - expectedSubscriberName: must equal [name] in the URL path. Retype
 *       guardrail — prevents fat-finger replays on the wrong subscriber.
 *   Auth: authorizeAdmin (session + admin_users row).
 *
 *   200 → { success: true, old_cursor, new_cursor }
 *   400 → bad body / forward jump / expectedSubscriberName mismatch
 *   401 → not admin
 *   404 → unknown subscriber OR (reset_to_event_id) event not found
 *   500 → unexpected DB error
 *
 *  Audit: writes `subscriber.replayed` to admin_audit_log via logAdminAudit
 *  with metadata { subscriber_name, mode, target, old_cursor }.
 *
 * Spine compliance (ADR-005): this endpoint mutates STATE RUNTIME METADATA
 * (`subscriber_offsets`), NOT learner state. No state_event is emitted —
 * see runtime_metadata vs canonical-state distinction in the ADR.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  mode: z.enum(['reset_to_timestamp', 'reset_to_event_id']),
  target: z.string().min(1),
  expectedSubscriberName: z.string().min(1).max(200),
});

interface SubscriberRow {
  subscriber_name: string;
  kind_filter: string;
  last_processed_event_id: string | null;
  last_processed_occurred_at: string | null;
}

interface StateEventRow {
  event_id: string;
  occurred_at: string;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  const { name: rawName } = await context.params;
  const subscriberName = decodeURIComponent(rawName);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validation = bodySchema.safeParse(parsedBody);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid body', detail: validation.error.flatten() },
      { status: 400 },
    );
  }
  const { mode, target, expectedSubscriberName } = validation.data;

  // Retype-name guardrail: prevents fat-finger replays.
  if (expectedSubscriberName !== subscriberName) {
    return NextResponse.json(
      {
        success: false,
        error:
          'expectedSubscriberName does not match the URL path subscriber name. Retype the subscriber name exactly to confirm.',
      },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Look up the subscriber row.
  const { data: subRow, error: subErr } = await supabase
    .from('subscriber_offsets')
    .select(
      'subscriber_name, kind_filter, last_processed_event_id, last_processed_occurred_at',
    )
    .eq('subscriber_name', subscriberName)
    .maybeSingle();

  if (subErr) {
    logger.error('super_admin_subscriber_replay_lookup_failed', {
      error: new Error(subErr.message),
      subscriber: subscriberName,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to look up subscriber' },
      { status: 500 },
    );
  }
  if (!subRow) {
    return NextResponse.json(
      { success: false, error: `Unknown subscriber: ${subscriberName}` },
      { status: 404 },
    );
  }

  const existing = subRow as SubscriberRow;
  const oldCursor = {
    last_processed_event_id: existing.last_processed_event_id,
    last_processed_occurred_at: existing.last_processed_occurred_at,
  };

  // Compute the new cursor based on mode.
  let newOccurredAt: string;
  let newEventId: string | null;

  if (mode === 'reset_to_timestamp') {
    const targetDate = new Date(target);
    if (Number.isNaN(targetDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'target is not a valid ISO timestamp' },
        { status: 400 },
      );
    }
    newOccurredAt = targetDate.toISOString();
    newEventId = null;
  } else {
    // reset_to_event_id — look up the event and pull its (event_id, occurred_at).
    const { data: evRow, error: evErr } = await supabase
      .from('state_events')
      .select('event_id, occurred_at')
      .eq('event_id', target)
      .maybeSingle();

    if (evErr) {
      logger.error('super_admin_subscriber_replay_event_lookup_failed', {
        error: new Error(evErr.message),
        subscriber: subscriberName,
        event_id: target,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to look up target event' },
        { status: 500 },
      );
    }
    if (!evRow) {
      return NextResponse.json(
        { success: false, error: `Unknown event_id: ${target}` },
        { status: 404 },
      );
    }
    const ev = evRow as StateEventRow;
    newEventId = ev.event_id;
    newOccurredAt = ev.occurred_at;
  }

  // Reject forward jumps. The current cursor's occurred_at must be strictly
  // greater than the new occurred_at (i.e. we're moving backward in time).
  // When the cursor has never advanced (null), any reset counts as forward —
  // there's nothing to replay yet.
  const currentOccurredAt = existing.last_processed_occurred_at;
  if (!currentOccurredAt) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Subscriber has no cursor yet (never processed). Replay is only valid against an advanced cursor; use the regular tick path to start processing.',
      },
      { status: 400 },
    );
  }
  if (new Date(newOccurredAt).getTime() >= new Date(currentOccurredAt).getTime()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Forward jumps are not supported by this endpoint. The new cursor must be strictly before the current cursor.',
      },
      { status: 400 },
    );
  }

  // Apply the new cursor. We preserve kind_filter + counters; the substrate's
  // events_processed counter is a running total and should NOT be reset.
  const { error: updErr } = await supabase
    .from('subscriber_offsets')
    .update({
      last_processed_event_id: newEventId,
      last_processed_occurred_at: newOccurredAt,
      updated_at: new Date().toISOString(),
    })
    .eq('subscriber_name', subscriberName);

  if (updErr) {
    logger.error('super_admin_subscriber_replay_write_failed', {
      error: new Error(updErr.message),
      subscriber: subscriberName,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to update subscriber cursor' },
      { status: 500 },
    );
  }

  const newCursor = {
    last_processed_event_id: newEventId,
    last_processed_occurred_at: newOccurredAt,
  };

  // Audit (fire-and-forget; helper swallows errors internally).
  try {
    await logAdminAudit(
      auth,
      'subscriber.replayed',
      'subscriber',
      subscriberName,
      { subscriber_name: subscriberName, mode, target, old_cursor: oldCursor },
    );
  } catch (auditErr) {
    logger.warn('super_admin_subscriber_replay_audit_failed', {
      subscriber: subscriberName,
      detail: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  logger.info('super_admin_subscriber_replayed', {
    admin_user_id: auth.userId,
    subscriber: subscriberName,
    mode,
    target,
    old_cursor: oldCursor,
    new_cursor: newCursor,
  });

  return NextResponse.json({
    success: true,
    old_cursor: oldCursor,
    new_cursor: newCursor,
  });
}
