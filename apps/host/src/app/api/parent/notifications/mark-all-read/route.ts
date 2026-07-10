/**
 * POST /api/parent/notifications/mark-all-read — Phase C.5
 *
 * Bulk-marks every unread notification for the calling parent as read.
 * The UPDATE is pinned to the caller's guardian id; no other parent's
 * rows can be touched even via crafted payloads (the request body is
 * ignored).
 *
 * Auth: `child.receive_alerts` permission + guardian-row resolution inside
 * the scoped `parent_mark_all_notifications_read` RPC.
 *
 * Response 200: { success: true, updated: number }
 * Errors: 401 / 403 · 404 guardian missing · 500 db.
 *
 * Spine note (ADR-005): same as the per-row PATCH — the canonical state
 * change is the `read_at` write. A future `parent.notifications_bulk_read`
 * event could fan out to audit/analytics; not landed yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { createParentNotificationsRpcClient } from '../_scoped-client';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface ParentMarkAllNotificationsReadRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    updated?: number;
  };
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const rpcClient = await createParentNotificationsRpcClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_mark_all_notifications_read');

  if (rpcErr) {
    logger.error('parent_notifications_markall_update_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/notifications/mark-all-read',
    });
    return err('Failed to mark notifications read', 500);
  }

  const result = rpcData as ParentMarkAllNotificationsReadRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to mark notifications read', result?.status ?? 500);
  }

  // TODO: spine event — emit `parent.notifications_bulk_read` once the
  //       registry entry lands. Direct canonical write for now.

  return NextResponse.json({ success: true, updated: result.data?.updated ?? 0 });
}
