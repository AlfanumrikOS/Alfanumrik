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
 * Auth: `class.manage` permission + teacher-row resolution.
 *
 * Query: ?limit=N (clamped 50). No cursor for now — thread counts are low.
 *
 * Response 200:
 *   { success: true, threads: ThreadRow[], unreadTotal: number }
 *
 * Errors: 401 / 403 (auth gate) · 404 teacher-row-missing · 500 db.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
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

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_messages_threads_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/messages/threads',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 404);

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const { data: threads, error: threadsErr } = await supabaseAdmin
    .from('teacher_parent_threads')
    .select(
      'id, teacher_id, guardian_id, student_id, school_id, subject, created_at, updated_at, last_message_at',
    )
    .eq('teacher_id', teacher.id)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (threadsErr) {
    logger.error('teacher_messages_threads_list_failed', {
      error: new Error(threadsErr.message),
      route: 'teacher/messages/threads',
    });
    return err('Failed to list threads', 500);
  }

  const rows: ThreadRow[] = (threads ?? []) as ThreadRow[];
  if (rows.length === 0) {
    return NextResponse.json({ success: true, threads: [], unreadTotal: 0 });
  }

  const threadIds   = rows.map((r) => r.id);
  const guardianIds = Array.from(new Set(rows.map((r) => r.guardian_id)));
  const studentIds  = Array.from(new Set(rows.map((r) => r.student_id)));

  // Pull names in parallel (best-effort — UI degrades gracefully if missing).
  const [{ data: guardians }, { data: students }, { data: latestMsgs }, { data: unreadCounts }] =
    await Promise.all([
      supabaseAdmin.from('guardians').select('id, name').in('id', guardianIds),
      supabaseAdmin.from('students').select('id, name').in('id', studentIds),
      // Most recent message per thread — fetch with limit per thread is
      // expensive; we use a single ordered select and let the consumer
      // pick the first match per thread.
      supabaseAdmin
        .from('teacher_parent_messages')
        .select('id, thread_id, body, sender_role, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false })
        .limit(threadIds.length * 5), // 5x covers "5 most recent total" per thread on average
      // Unread (for teacher): guardian-sent messages with no read_at.
      supabaseAdmin
        .from('teacher_parent_messages')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('sender_role', 'guardian')
        .is('read_at', null),
    ]);

  const guardianName = new Map<string, string>(
    (guardians ?? []).map((g) => [g.id as string, (g.name as string) ?? '']),
  );
  const studentName = new Map<string, string>(
    (students ?? []).map((s) => [s.id as string, (s.name as string) ?? '']),
  );

  const latestByThread = new Map<string, { body: string; sender_role: 'teacher' | 'guardian'; created_at: string }>();
  for (const m of latestMsgs ?? []) {
    const tid = (m as { thread_id: string }).thread_id;
    if (!latestByThread.has(tid)) {
      latestByThread.set(tid, {
        body: (m as { body: string }).body,
        sender_role: (m as { sender_role: 'teacher' | 'guardian' }).sender_role,
        created_at: (m as { created_at: string }).created_at,
      });
    }
  }

  const unreadByThread = new Map<string, number>();
  let unreadTotal = 0;
  for (const r of unreadCounts ?? []) {
    const tid = (r as { thread_id: string }).thread_id;
    unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
    unreadTotal += 1;
  }

  const enriched = rows.map((r) => {
    const latest = latestByThread.get(r.id);
    const preview = latest?.body
      ? latest.body.length > 120
        ? `${latest.body.slice(0, 120)}…`
        : latest.body
      : null;
    return {
      ...r,
      guardian_name: guardianName.get(r.guardian_id) ?? null,
      student_name: studentName.get(r.student_id) ?? null,
      last_message_preview: preview,
      last_message_sender_role: latest?.sender_role ?? null,
      unread_count: unreadByThread.get(r.id) ?? 0,
    };
  });

  return NextResponse.json({ success: true, threads: enriched, unreadTotal });
}
