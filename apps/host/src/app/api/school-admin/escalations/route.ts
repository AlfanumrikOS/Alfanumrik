/**
 * GET /api/school-admin/escalations — Teacher Dashboard RCA follow-up (T13).
 *
 * Read-only list of teacher -> school-admin escalations for the caller's
 * school. Reads the SAME generic `notifications` rows the teacher-side
 * `/api/teacher/escalate` route writes (`recipient_type='school_admin'`,
 * `type='teacher_escalation'`) — no new table.
 *
 * Permission: institution.view_analytics (read-only surface, mirrors
 * `analytics/route.ts`'s gate — the smallest existing permission that fits a
 * read-only reporting view).
 *
 * Scope: only rows where `recipient_id` is one of the CALLER'S SCHOOL's
 * active `school_admins.id` values — this is the school boundary (any admin
 * at the school can see escalations addressed to any admin at that school,
 * matching the "co-admins" visibility already granted by
 * `school_admins`' own "School admins can view co-admins" RLS policy).
 * Never returns rows from another school (P8).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.view_analytics');
  if (!auth.authorized) return auth.errorResponse!;

  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();

  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25', 10)));

  // Step 1: this school's active admin ids (the recipient scope).
  const { data: adminRows, error: adminErr } = await supabase
    .from('school_admins')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (adminErr) {
    logger.error('school_admin_escalations_admin_lookup_failed', {
      error: new Error(adminErr.message),
      route: 'school-admin/escalations',
    });
    return NextResponse.json({ success: false, error: adminErr.message }, { status: 500 });
  }

  const adminIds = (adminRows ?? []).map((r) => (r as { id: string }).id);
  if (adminIds.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  // Step 2: escalation notifications addressed to any admin at this school.
  const { data: notifs, error: notifErr } = await supabase
    .from('notifications')
    .select('id, recipient_id, title, message, data, is_read, created_at')
    .eq('recipient_type', 'school_admin')
    .eq('type', 'teacher_escalation')
    .in('recipient_id', adminIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (notifErr) {
    logger.error('school_admin_escalations_list_failed', {
      error: new Error(notifErr.message),
      route: 'school-admin/escalations',
    });
    return NextResponse.json({ success: false, error: notifErr.message }, { status: 500 });
  }

  const data = (notifs ?? []).map((row) => {
    const r = row as {
      id: string;
      title: string;
      message: string;
      data: Record<string, unknown> | null;
      is_read: boolean;
      created_at: string;
    };
    return {
      id: r.id,
      title: r.title,
      message: r.message,
      is_read: r.is_read,
      created_at: r.created_at,
      student_id: (r.data?.student_id as string | undefined) ?? null,
      class_id: (r.data?.class_id as string | undefined) ?? null,
    };
  });

  return NextResponse.json({ success: true, data });
}
