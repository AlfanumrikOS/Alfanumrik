/**
 * GET /api/parent/notifications  — Phase C.5
 *
 * Paginated list of the calling parent's in-app notifications, most
 * recent first. The canonical table is `notifications` (recipient_id +
 * recipient_type='guardian'); see baseline_from_prod.sql for the column
 * inventory.
 *
 * Auth:
 *   1. `authorizeRequest(request, 'child.receive_alerts')` — the parent
 *      role's "receive alerts" permission is the closest fit for a parent
 *      reading their own notification surface.
 *   2. Call the RLS-scoped `parent_list_notifications` RPC with the request
 *      JWT/cookie session. The RPC resolves guardians.id from auth.uid().
 *
 * Query params:
 *   ?cursor=<iso ts>    — created_at < cursor (for "load more")
 *   ?before=<iso ts>    — Phase D.6 alias for ?cursor= (standard pagination
 *                          contract; docs/runbooks/performance-targets.md)
 *   ?filter=all|unread  — default 'all'
 *   ?limit=N            — clamped to 50 (we ship 50/page; UI cannot push)
 *
 * Response 200:
 *   { success: true, items: NotificationRow[], nextCursor: string | null,
 *     hasMore: boolean, unreadCount: number }
 *
 * Errors: 401 / 403 (auth gate) · 404 guardian-row-missing · 500 db error.
 *
 * Cross-parent reads are impossible by construction: the WHERE clause
 * always pins recipient_id = the resolved guardian id and recipient_type
 * = 'guardian'. Even a forged ?guardian_id query param is ignored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { createParentNotificationsRpcClient } from './_scoped-client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

export interface ParentNotificationRow {
  id: string;
  title: string;
  message: string;
  body: string | null;
  type: string;
  data: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  delivery_channel: string;
}

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface ParentNotificationsRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    items?: ParentNotificationRow[];
    nextCursor?: string | null;
    hasMore?: boolean;
    unreadCount?: number;
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') === 'unread' ? 'unread' : 'all';
  // Phase D.6: accept ?before= as cursor alias (forward-compat with the
  // standard pagination contract). ?cursor= remains primary.
  const cursor = url.searchParams.get('cursor') ?? url.searchParams.get('before');
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  const rpcClient = await createParentNotificationsRpcClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_list_notifications', {
    p_filter: filter,
    p_cursor: cursor,
    p_limit: limit,
  });

  if (rpcErr) {
    logger.error('parent_notifications_list_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/notifications',
    });
    return err('Failed to load notifications', 500);
  }

  const result = rpcData as ParentNotificationsRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to load notifications', result?.status ?? 500);
  }

  const data = result.data ?? {};
  return NextResponse.json({
    success: true,
    items: data.items ?? [],
    nextCursor: data.nextCursor ?? null,
    hasMore: data.hasMore ?? false,
    unreadCount: data.unreadCount ?? 0,
  });
}
