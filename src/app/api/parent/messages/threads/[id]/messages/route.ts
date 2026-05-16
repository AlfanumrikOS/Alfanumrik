/**
 * GET /api/parent/messages/threads/[id]/messages — Phase C.3
 *
 * Paginated message list for a single thread, oldest-first. Strict
 * ownership: the thread's `guardian_id` must match the caller's
 * `guardians.id`. Marks all teacher-sent unread messages read for this
 * guardian.
 *
 * Auth: `child.view_progress` permission + guardian-row resolution.
 *
 * Query: ?cursor=<iso ts>, ?before=<iso ts> (Phase D.6 alias), ?limit=N
 *        (clamped 100).
 * Response 200:
 *   { success: true, messages: MessageRow[], nextCursor, hasMore }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: threadId } = await context.params;
  if (!threadId || !UUID_RE.test(threadId)) return err('Invalid thread id', 400);

  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (guardianErr) {
    logger.error('parent_messages_get_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/messages/threads/[id]/messages',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 403);

  const { data: thread, error: threadErr } = await supabaseAdmin
    .from('teacher_parent_threads')
    .select('id, teacher_id, guardian_id, student_id')
    .eq('id', threadId)
    .maybeSingle();
  if (threadErr) {
    logger.error('parent_messages_get_thread_lookup_failed', {
      error: new Error(threadErr.message),
      route: 'parent/messages/threads/[id]/messages',
    });
    return err('Failed to resolve thread', 500);
  }
  if (!thread) return err('Thread not found', 404);
  if (thread.guardian_id !== guardian.id) return err('Thread not owned by caller', 403);

  const url = new URL(request.url);
  // Phase D.6: accept ?before= as alias of ?cursor=, matching the contract
  // in docs/runbooks/performance-targets.md. ?cursor= remains for in-flight
  // UI builds.
  const cursor = url.searchParams.get('cursor') ?? url.searchParams.get('before');
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  let q = supabaseAdmin
    .from('teacher_parent_messages')
    .select('id, thread_id, sender_role, sender_auth_user_id, body, created_at, read_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (cursor) q = q.gt('created_at', cursor);

  const { data: rows, error: listErr } = await q;
  if (listErr) {
    logger.error('parent_messages_get_list_failed', {
      error: new Error(listErr.message),
      route: 'parent/messages/threads/[id]/messages',
    });
    return err('Failed to load messages', 500);
  }

  const items = (rows ?? []) as Array<{ id: string; created_at: string; sender_role: string; read_at: string | null }>;
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;

  // Mark teacher-sent messages as read (parent just viewed them).
  const unreadTeacherIds = page
    .filter((m) => m.sender_role === 'teacher' && m.read_at === null)
    .map((m) => m.id);
  if (unreadTeacherIds.length > 0) {
    const { error: markErr } = await supabaseAdmin
      .from('teacher_parent_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadTeacherIds);
    if (markErr) {
      logger.warn('parent_messages_get_mark_read_failed', {
        route: 'parent/messages/threads/[id]/messages',
        error: markErr.message,
      });
    } else {
      for (const m of page) {
        if (unreadTeacherIds.includes(m.id)) m.read_at = m.read_at ?? new Date().toISOString();
      }
    }
  }

  return NextResponse.json({ success: true, messages: page, nextCursor, hasMore });
}
