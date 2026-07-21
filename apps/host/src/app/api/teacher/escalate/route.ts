/**
 * POST /api/teacher/escalate — Teacher Dashboard RCA follow-up (T13).
 *
 * "Escalate to school admin." The RCA found teachers can message a parent
 * (`/api/teacher/parent-notify`) but had NO way to raise a case with their OWN
 * school admin(s) from within the product. This route closes that gap by
 * REUSING the existing generic `notifications` table (recipient_id/
 * recipient_type/sender_id/sender_type) — no new table, no new column, no new
 * permission, no migration.
 *
 * Flow:
 *   1. `authorizeRequest('class.manage')` — the SAME gate the rest of the
 *      teacher roster-mutation/notification surface uses (P9). No new
 *      permission is introduced.
 *   2. Resolve caller -> internal `teachers.id` via the canonical
 *      `resolveTeacherIdentity` (NEVER auth.uid()).
 *   3. Roster check (P8) via the canonical `resolveTeacherRosterScope` — the
 *      student MUST be on the caller's roster. 403 if not (mirrors
 *      /api/teacher/parent-notify and /api/teacher/remediation).
 *   4. Resolve the teacher's school's ACTIVE school_admins rows
 *      (`school_admins.school_id = teacher.schoolId AND is_active = true`).
 *      Zero active admins is NOT an error — 409 `{ no_admin: true }` so the UI
 *      can show a clean "no school admin configured" message; nothing is sent.
 *   5. Insert ONE `notifications` row per active admin
 *      (`recipient_type='school_admin'`, `sender_type='teacher'`,
 *      `type='teacher_escalation'`), carrying `student_id`, the teacher's
 *      note, and the roster `class_id` in `data` for context. No PII beyond
 *      what a teacher already has visibility into is logged (P13) — the note
 *      text is stored in the row (same contract as parent-notify's message
 *      body), never written to the logger.
 *
 * Response 200: { success: true, notified_admin_count, notification_ids }.
 *
 * Errors: 400 invalid body · 401/403 auth · 403 non-roster / no teacher row ·
 *   409 no active school admin · 500 db.
 *
 * Read side (school-admin visibility): `GET /api/school-admin/escalations`
 * (institution.view_analytics) + `/school-admin/escalations` page — reads the
 * SAME `notifications` rows via the service-role client (the established
 * school-admin-panel convention: every `/api/school-admin/*` route reads
 * through `getSupabaseAdmin()` behind `authorizeSchoolAdmin`, not client-side
 * RLS — see e.g. `analytics/route.ts`, `announcements/route.ts`). This is
 * consistent with P8: the existing `notif_own` RLS policy on `notifications`
 * has no `school_admin` branch, so a school admin could NOT read these rows
 * via a direct client-side query; the service-role route is the sanctioned
 * server-side path, identical to every other school-admin surface.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authorizeRequest,
  resolveTeacherIdentity,
  resolveTeacherRosterScope,
  type TeacherIdentity,
} from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BodySchema = z.object({
  student_id: z.string().regex(UUID_RE, 'student_id must be a valid UUID'),
  note: z.string().trim().min(1).max(1000),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function resolveTeacher(authUserId: string): Promise<TeacherIdentity | null> {
  try {
    return await resolveTeacherIdentity(authUserId);
  } catch (e) {
    logger.error('teacher_escalate_teacher_lookup_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/escalate',
    });
    throw new Error('teacher_lookup_failed');
  }
}

/** Roster check (P8) — mirrors /api/teacher/parent-notify. */
async function rosterClassId(teacher: TeacherIdentity, studentId: string): Promise<string | null> {
  let roster;
  try {
    roster = await resolveTeacherRosterScope(teacher.id, { teacher, studentId });
  } catch (e) {
    logger.error('teacher_escalate_roster_lookup_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/escalate',
    });
    throw new Error('roster_lookup_failed');
  }
  if (!roster || roster.enrollments.length === 0) return null;
  return roster.enrollments[0].classId;
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const { student_id, note } = body;

  let teacher: TeacherIdentity | null;
  try {
    teacher = await resolveTeacher(auth.userId!);
  } catch {
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  let classId: string | null;
  try {
    classId = await rosterClassId(teacher, student_id);
  } catch {
    return err('Failed to verify roster', 500);
  }
  if (!classId) return err('Student is not on your roster', 403);

  if (!teacher.schoolId) {
    return err('Teacher has no associated school', 409);
  }

  // Resolve the teacher's school's active admin(s).
  const { data: admins, error: adminsErr } = await supabaseAdmin
    .from('school_admins')
    .select('id')
    .eq('school_id', teacher.schoolId)
    .eq('is_active', true);
  if (adminsErr) {
    logger.error('teacher_escalate_admin_lookup_failed', {
      error: new Error(adminsErr.message),
      route: 'teacher/escalate',
    });
    return err('Failed to resolve school admin', 500);
  }
  const adminRows = (admins ?? []) as { id: string }[];
  if (adminRows.length === 0) {
    return NextResponse.json(
      { success: false, no_admin: true, error: 'No active school admin found for your school' },
      { status: 409 },
    );
  }

  // Best-effort student name for the notification title (never logged).
  const { data: studentRow } = await supabaseAdmin
    .from('students')
    .select('name, grade')
    .eq('id', student_id)
    .maybeSingle();
  const studentName = (studentRow as { name?: string } | null)?.name?.trim() || 'A student';
  const notifTitle = 'Teacher escalation';
  const notifBody = note.length > 500 ? `${note.slice(0, 500)}…` : note;

  const rowsToInsert = adminRows.map((admin) => ({
    recipient_id: admin.id,
    recipient_type: 'school_admin',
    sender_id: teacher.id,
    sender_type: 'teacher',
    type: 'teacher_escalation',
    notification_type: 'teacher_escalation',
    title: notifTitle,
    message: `${studentName}: ${notifBody}`,
    body: `${studentName}: ${notifBody}`,
    data: {
      student_id,
      class_id: classId,
      teacher_id: teacher.id,
      note: notifBody,
    },
    is_read: false,
    delivery_channel: 'in_app',
  }));

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('notifications')
    .insert(rowsToInsert)
    .select('id');
  if (insertErr || !inserted) {
    logger.error('teacher_escalate_notification_insert_failed', {
      error: new Error(insertErr?.message ?? 'no rows returned'),
      route: 'teacher/escalate',
    });
    return err('Failed to escalate', 500);
  }

  return NextResponse.json({
    success: true,
    notified_admin_count: inserted.length,
    notification_ids: (inserted as { id: string }[]).map((r) => r.id),
  });
}
