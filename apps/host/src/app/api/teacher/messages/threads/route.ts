/**
 * GET /api/teacher/messages/threads — Phase C.3
 *
 * List the calling teacher's threads, newest first, each annotated with:
 *   - `last_message_preview` (truncated body of the most recent row);
 *   - `unread_count` from the teacher's perspective (= messages whose
 *     `sender_role = 'guardian'` and `read_at IS NULL`).
 *
 * The thread list is what the `/teacher/messages` left rail consumes and
 * what the TeacherShell badge polls (limit=1).
 *
 * Auth: `class.manage` permission (route gate) + auth.uid()-anchored teacher
 * resolution inside the SECURITY DEFINER RPC (replaces the RLS-bypassing
 * service-role client). The RPC performs the guardian/student name enrichment
 * and unread aggregation server-side.
 *
 * Query: ?limit=N (clamped 50; the RPC re-clamps 1..50). No cursor for now —
 * thread counts are low.
 *
 * Response 200:
 *   { success: true, threads: ThreadRow[], unreadTotal: number }
 *
 * Errors: 401 (unauthenticated) · 403 (auth gate) · 404 teacher-row-missing ·
 * 500 db.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

interface ThreadRow {
  id: string;
  teacher_id: string;
  guardian_id: string;
  student_id: string;
  school_id: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  guardian_name?: string | null;
  student_name?: string | null;
  last_message_preview?: string | null;
  last_message_sender_role?: 'teacher' | 'guardian' | null;
  unread_count?: number;
}

type TeacherThreadsRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  threads?: ThreadRow[];
  unreadTotal?: number;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('teacher_list_message_threads', {
    p_limit: limit,
  });

  if (error) {
    logger.error('teacher_messages_threads_rpc_failed', {
      error: new Error(error.message),
      route: 'teacher/messages/threads',
    });
    return err('Failed to list threads', 500);
  }

  const result = (data ?? {}) as TeacherThreadsRpcResult;
  if (result.success !== true) {
    if (result.error_code === 'unauthorized') {
      return err(result.error ?? 'Unauthorized', 401);
    }
    if (result.error_code === 'not_teacher') {
      return err(result.error ?? 'Teacher account not found', 404);
    }
    return err(result.error ?? 'Failed to list threads', 500);
  }

  return NextResponse.json({
    success: true,
    threads: Array.isArray(result.threads) ? result.threads : [],
    unreadTotal: result.unreadTotal ?? 0,
  });
}
