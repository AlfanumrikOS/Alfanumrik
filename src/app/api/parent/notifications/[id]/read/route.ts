/**
 * PATCH /api/parent/notifications/[id]/read — Phase C.5
 *
 * Marks a single notification as read. Ownership is enforced server-side:
 * the UPDATE filters on (id, recipient_id = caller's guardian id,
 * recipient_type = 'guardian'). A forged id from another parent's row
 * yields zero updates and a 403.
 *
 * Auth: `child.receive_alerts` permission + guardian-row resolution.
 *
 * Response 200: { success: true, id, read_at }
 * Errors: 401 / 403 (auth or cross-parent) · 404 guardian missing · 500 db.
 *
 * Spine note (ADR-005): the canonical state mutation here is the
 * `read_at` write on `notifications`. Ideally a `parent.notification_read`
 * domain event would be emitted on the event bus so subscribers (audit,
 * analytics) could react. No such event kind exists yet — TODO add and
 * publish once the registry entry lands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) return err('Invalid notification id', 400);

  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();

  if (guardianErr) {
    logger.error('parent_notification_read_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/notifications/[id]/read',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 404);

  const readAt = new Date().toISOString();

  // Ownership-pinned UPDATE — both id AND recipient must match. Returns
  // the row only on a successful, owned write; .single() throws on zero
  // rows which we surface as 403.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: readAt })
    .eq('id', id)
    .eq('recipient_id', guardian.id)
    .eq('recipient_type', 'guardian')
    .select('id, read_at')
    .maybeSingle();

  if (updateErr) {
    logger.error('parent_notification_read_update_failed', {
      error: new Error(updateErr.message),
      route: 'parent/notifications/[id]/read',
    });
    return err('Failed to mark notification read', 500);
  }
  if (!updated) {
    // Either the row doesn't exist or it belongs to another parent. We
    // return 403 for both: 404 would leak existence on a cross-parent id.
    return err('Notification not found or not owned', 403);
  }

  // TODO: spine event — emit `parent.notification_read` once the registry
  //       entry lands. Until then this is a direct canonical write.

  return NextResponse.json({ success: true, id: updated.id, read_at: updated.read_at });
}
