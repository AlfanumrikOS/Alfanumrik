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
 *   2. Resolve the guardian row from `auth_user_id`. Notifications are
 *      addressed to `guardians.id`, not `auth.users.id`, so this hop is
 *      mandatory — without it a parent could not see any of their own rows.
 *
 * Query params:
 *   ?cursor=<iso ts>    — created_at < cursor (for "load more")
 *   ?filter=all|unread  — default 'all'
 *   ?limit=N            — clamped to 50 (we ship 50/page; UI cannot push)
 *
 * Response 200:
 *   { success: true, items: NotificationRow[], nextCursor: string | null,
 *     unreadCount: number }
 *
 * Errors: 401 / 403 (auth gate) · 404 guardian-row-missing · 500 db error.
 *
 * Cross-parent reads are impossible by construction: the WHERE clause
 * always pins recipient_id = the resolved guardian id and recipient_type
 * = 'guardian'. Even a forged ?guardian_id query param is ignored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

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

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.receive_alerts');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Resolve guardian row — notifications are keyed on guardians.id, not
  // auth_user_id. Parents who haven't been onboarded as a guardian (e.g.
  // an admin who happens to have the role granted) get an empty page.
  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();

  if (guardianErr) {
    logger.error('parent_notifications_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/notifications',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 404);

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') === 'unread' ? 'unread' : 'all';
  const cursor = url.searchParams.get('cursor');
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  // Build the list query. We intentionally do NOT trust any guardian_id
  // query param — the recipient is pinned to the resolved row.
  let listQuery = supabaseAdmin
    .from('notifications')
    .select(
      'id, title, message, body, type, data, is_read, read_at, created_at, delivery_channel',
    )
    .eq('recipient_id', guardian.id)
    .eq('recipient_type', 'guardian');

  if (filter === 'unread') {
    listQuery = listQuery.eq('is_read', false);
  }
  if (cursor) {
    listQuery = listQuery.lt('created_at', cursor);
  }

  const { data: rows, error: listErr } = await listQuery
    .order('created_at', { ascending: false })
    .limit(limit + 1); // +1 so we can detect "more pages exist"
  if (listErr) {
    logger.error('parent_notifications_list_failed', {
      error: new Error(listErr.message),
      route: 'parent/notifications',
    });
    return err('Failed to load notifications', 500);
  }

  const items = (rows ?? []) as ParentNotificationRow[];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;

  // Unread count (small denormalized query — keeps the badge fresh
  // without forcing the UI to re-fetch the full page).
  const { count: unreadCount, error: countErr } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', guardian.id)
    .eq('recipient_type', 'guardian')
    .eq('is_read', false);

  if (countErr) {
    logger.warn('parent_notifications_unread_count_failed', {
      route: 'parent/notifications',
      error: countErr.message,
    });
  }

  return NextResponse.json({
    success: true,
    items: page,
    nextCursor,
    unreadCount: unreadCount ?? 0,
  });
}
