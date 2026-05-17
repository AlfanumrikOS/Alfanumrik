/**
 * POST /api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry
 *
 * Remove a dead-letter row so the runtime re-attempts the event on its next
 * tick. The deletion is the retry signal: the tick path checks for a
 * matching dead-letter row before processing, and a missing row puts the
 * event back into the normal retry envelope.
 *
 * !!! NOTE — same idempotency caveat as cursor replay:
 *   Re-processing an event that previously dead-lettered means the
 *   subscriber will execute its `handle()` again. The subscriber MUST be
 *   idempotent for this to be safe. Operators should investigate WHY the
 *   event dead-lettered (last_error) before retrying — if the root cause
 *   isn't fixed, the retry will just dead-letter again.
 *
 * Contract:
 *   Path params: [name] = subscriber_name, [event_id] = state_event UUID.
 *   Body: none (or any JSON; ignored). POST is idempotent at the API
 *         level — deleting an already-absent row returns 200 with
 *         { success: true, removed: 0 }.
 *   Auth: authorizeAdmin (session + admin_users row).
 *
 *   200 → { success: true, removed: number }
 *   401 → not admin
 *   500 → unexpected DB error
 *
 * Audit: writes `subscriber.dead_letter_retried` to admin_audit_log via
 *        logAdminAudit with metadata { subscriber_name, event_id }.
 *
 * Spine compliance (ADR-005): this endpoint mutates STATE RUNTIME METADATA
 * (`subscriber_dead_letters`), NOT learner state. No state_event emit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ name: string; event_id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { name: rawName, event_id: rawEventId } = await context.params;
  const subscriberName = decodeURIComponent(rawName);
  const eventId = decodeURIComponent(rawEventId);

  if (!subscriberName || !eventId) {
    return NextResponse.json(
      { success: false, error: 'subscriber name and event_id are required' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: deleted, error: delErr } = await supabase
    .from('subscriber_dead_letters')
    .delete()
    .eq('subscriber_name', subscriberName)
    .eq('event_id', eventId)
    .select('event_id, subscriber_name');

  if (delErr) {
    logger.error('super_admin_dead_letter_retry_failed', {
      error: new Error(delErr.message),
      subscriber: subscriberName,
      event_id: eventId,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to remove dead-letter row' },
      { status: 500 },
    );
  }

  const removed = Array.isArray(deleted) ? deleted.length : 0;

  // Audit fire-and-forget.
  try {
    await logAdminAudit(
      auth,
      'subscriber.dead_letter_retried',
      'subscriber_dead_letter',
      `${subscriberName}/${eventId}`,
      { subscriber_name: subscriberName, event_id: eventId, removed },
    );
  } catch (auditErr) {
    logger.warn('super_admin_dead_letter_retry_audit_failed', {
      subscriber: subscriberName,
      event_id: eventId,
      detail: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  logger.info('super_admin_dead_letter_retried', {
    admin_user_id: auth.userId,
    subscriber: subscriberName,
    event_id: eventId,
    removed,
  });

  return NextResponse.json({ success: true, removed });
}
