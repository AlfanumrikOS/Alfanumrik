/**
 * GET /api/parent/messages/threads — Phase C.3
 *
 * List the calling guardian's threads, newest first, annotated with:
 *   - `teacher_name`, `student_name`
 *   - `last_message_preview`
 *   - `unread_count` (= teacher-sent messages with `read_at IS NULL`)
 *
 * Auth: `child.view_progress` permission + guardian-row resolution.
 *
 * Query: ?limit=N (clamped 50).
 *
 * Response 200: { success: true, threads: ThreadRow[], unreadTotal }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

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
  teacher_name?: string | null;
  student_name?: string | null;
  last_message_preview?: string | null;
  last_message_sender_role?: 'teacher' | 'guardian' | null;
  unread_count?: number;
}

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (guardianErr) {
    logger.error('parent_messages_threads_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/messages/threads',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 404);

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
    .eq('guardian_id', guardian.id)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (threadsErr) {
    logger.error('parent_messages_threads_list_failed', {
      error: new Error(threadsErr.message),
      route: 'parent/messages/threads',
    });
    return err('Failed to list threads', 500);
  }

  const rows: ThreadRow[] = (threads ?? []) as ThreadRow[];
  if (rows.length === 0) {
    return NextResponse.json({ success: true, threads: [], unreadTotal: 0 });
  }

  const threadIds  = rows.map((r) => r.id);
  const teacherIds = Array.from(new Set(rows.map((r) => r.teacher_id)));
  const studentIds = Array.from(new Set(rows.map((r) => r.student_id)));

  const [{ data: teachers }, { data: students }, { data: latestMsgs }, { data: unreadCounts }] =
    await Promise.all([
      supabaseAdmin.from('teachers').select('id, name').in('id', teacherIds),
      supabaseAdmin.from('students').select('id, name').in('id', studentIds),
      supabaseAdmin
        .from('teacher_parent_messages')
        .select('id, thread_id, body, sender_role, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false })
        .limit(threadIds.length * 5),
      supabaseAdmin
        .from('teacher_parent_messages')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('sender_role', 'teacher')
        .is('read_at', null),
    ]);

  const teacherName = new Map<string, string>(
    (teachers ?? []).map((t) => [t.id as string, (t.name as string) ?? '']),
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
      teacher_name: teacherName.get(r.teacher_id) ?? null,
      student_name: studentName.get(r.student_id) ?? null,
      last_message_preview: preview,
      last_message_sender_role: latest?.sender_role ?? null,
      unread_count: unreadByThread.get(r.id) ?? 0,
    };
  });

  return NextResponse.json({ success: true, threads: enriched, unreadTotal });
}
