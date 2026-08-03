/**
 * GET /api/teacher/messages/threads/[id]/messages — Phase C.3
 *
 * Paginated message list for a single thread, oldest-first (chat order).
 * Strict ownership: the thread's `teacher_id` must match the caller's
 * `teachers.id`. Side effect: mark all guardian-sent unread messages read
 * for this teacher.
 *
 * Auth: `class.manage` permission (route gate) + auth.uid()-anchored teacher
 * resolution, ownership enforcement, and the read_at UPDATE inside the
 * SECURITY DEFINER RPC (replaces the RLS-bypassing service-role client).
 *
 * Query:
 *   ?cursor=<iso ts>  — created_at > cursor (older-first "load more")
 *   ?before=<iso ts>  — Phase D.6 alias for ?cursor= (kept for forward-
 *                       compat with the pagination contract documented in
 *                       docs/runbooks/performance-targets.md)
 *   ?limit=N          — clamped 100 (the RPC re-clamps 1..100)
 *
 * Response 200:
 *   { success: true, messages: MessageRow[], nextCursor: string | null,
 *     hasMore: boolean }
 *
 * Errors: 400 invalid thread id · 401 unauthenticated · 403 not teacher /
 * cross-tenant · 404 thread missing · 500 db.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

interface MessageRow {
  id: string;
  thread_id: string;
  sender_role: 'teacher' | 'guardian';
  sender_auth_user_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

type TeacherThreadMessagesRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  messages?: MessageRow[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: threadId } = await context.params;
  if (!threadId || !UUID_RE.test(threadId)) return err('Invalid thread id', 400);

  const url = new URL(request.url);
  // Phase D.6: accept ?before= as alias of ?cursor= so callers can speak the
  // standard pagination contract. ?cursor= remains for in-flight UI builds.
  const cursor = url.searchParams.get('cursor') ?? url.searchParams.get('before');
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('teacher_list_thread_messages', {
    p_thread_id: threadId,
    p_cursor: cursor,
    p_limit: limit,
  });

  if (error) {
    logger.error('teacher_thread_messages_rpc_failed', {
      error: new Error(error.message),
      route: 'teacher/messages/threads/[id]/messages',
    });
    return err('Failed to load messages', 500);
  }

  const result = (data ?? {}) as TeacherThreadMessagesRpcResult;
  if (result.success !== true) {
    if (result.error_code === 'unauthorized') return err(result.error ?? 'Unauthorized', 401);
    if (result.error_code === 'thread_not_found') return err(result.error ?? 'Thread not found', 404);
    if (result.error_code === 'thread_not_owned' || result.error_code === 'not_teacher') {
      return err(result.error ?? 'Thread not owned by caller', 403);
    }
    return err(result.error ?? 'Failed to load messages', 500);
  }

  return NextResponse.json({
    success: true,
    messages: Array.isArray(result.messages) ? result.messages : [],
    nextCursor: result.nextCursor ?? null,
    hasMore: result.hasMore === true,
  });
}
