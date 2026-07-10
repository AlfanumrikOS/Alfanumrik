/**
 * PATCH /api/parent/notifications/[id]/read — Phase C.5
 *
 * Marks a single notification as read. Ownership is enforced server-side:
 * the UPDATE filters on (id, recipient_id = caller's guardian id,
 * recipient_type = 'guardian'). A forged id from another parent's row
 * yields zero updates and a 403.
 *
 * Auth: `child.receive_alerts` permission + guardian-row resolution inside
 * the scoped `parent_mark_notification_read` RPC.
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
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { createParentNotificationsRpcClient } from '../../_scoped-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface ParentMarkNotificationReadRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    id?: string;
    read_at?: string;
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) return err('Invalid notification id', 400);

  const rpcClient = await createParentNotificationsRpcClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_mark_notification_read', {
    p_notification_id: id,
  });

  if (rpcErr) {
    logger.error('parent_notification_read_update_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/notifications/[id]/read',
    });
    return err('Failed to mark notification read', 500);
  }

  const result = rpcData as ParentMarkNotificationReadRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to mark notification read', result?.status ?? 500);
  }

  // TODO: spine event — emit `parent.notification_read` once the registry
  //       entry lands. Until then this is a direct canonical write.

  return NextResponse.json({ success: true, id: result.data?.id, read_at: result.data?.read_at });
}
