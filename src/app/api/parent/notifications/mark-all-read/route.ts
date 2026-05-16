/**
 * POST /api/parent/notifications/mark-all-read — Phase C.5
 *
 * Bulk-marks every unread notification for the calling parent as read.
 * The UPDATE is pinned to the caller's guardian id; no other parent's
 * rows can be touched even via crafted payloads (the request body is
 * ignored).
 *
 * Auth: `child.receive_alerts` permission + guardian-row resolution.
 *
 * Response 200: { success: true, updated: number }
 * Errors: 401 / 403 · 404 guardian missing · 500 db.
 *
 * Spine note (ADR-005): same as the per-row PATCH — the canonical state
 * change is the `read_at` write. A future `parent.notifications_bulk_read`
 * event could fan out to audit/analytics; not landed yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();

  if (guardianErr) {
    logger.error('parent_notifications_markall_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/notifications/mark-all-read',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 404);

  const readAt = new Date().toISOString();

  // Bulk update — recipient and recipient_type are the ONLY safety
  // pins. Body is intentionally not parsed; this endpoint has no
  // per-row selectors.
  const { data: updatedRows, error: updateErr } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: readAt })
    .eq('recipient_id', guardian.id)
    .eq('recipient_type', 'guardian')
    .eq('is_read', false)
    .select('id');

  if (updateErr) {
    logger.error('parent_notifications_markall_update_failed', {
      error: new Error(updateErr.message),
      route: 'parent/notifications/mark-all-read',
    });
    return err('Failed to mark notifications read', 500);
  }

  // TODO: spine event — emit `parent.notifications_bulk_read` once the
  //       registry entry lands. Direct canonical write for now.

  return NextResponse.json({ success: true, updated: (updatedRows ?? []).length });
}
