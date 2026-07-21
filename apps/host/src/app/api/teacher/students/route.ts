/**
 * GET /api/teacher/students
 *
 * Task T6 (Teacher Dashboard Redesign & Remediation Plan). The teacher
 * roster/student-list READ previously existed ONLY inside the Deno
 * `teacher-dashboard` Edge Function (`get_students_list` / `get_dashboard`
 * actions), while the corresponding WRITE
 * (`/api/teacher/students/[id]/notes`) already lived in Next.js. This route
 * closes that split for the Next.js surface WITHOUT re-implementing roster
 * resolution: it delegates entirely to the canonical
 * `resolveTeacherIdentity` + `resolveTeacherRosterScope` helpers added in
 * `@alfanumrik/lib/rbac` (2026-07-20 roster-resolver unification, see the
 * "Canonical Teacher Roster Resolution" section of rbac.ts). The Edge
 * Function is left untouched — this is additive, not a replacement.
 *
 * Auth: `class.manage` permission (matches `/api/teacher/classes` and
 * `/api/teacher/students/[id]/notes`) — canonical teacher-write/roster
 * permission. Access to any individual student is only ever granted through
 * `resolveTeacherRosterScope`'s active `class_teachers` ⋈ `class_enrollments`
 * join — the exact same join `canAccessStudent`'s teacher branch uses.
 *
 * Query params:
 *   classId? — UUID. When present, scopes the roster to one class; the
 *              class must be one the caller-teacher is actively assigned to
 *              (re-verified server-side, never trusted from the client).
 *
 * Response 200:
 *   { success: true, data: RosterStudent[] }
 *   RosterStudent = {
 *     id: string;
 *     name: string;
 *     grade: string;
 *     classIds: string[];       // teacher's active classes this student is enrolled in
 *     xpTotal: number | null;
 *     streakDays: number | null;
 *     note: string | null;
 *     customGoal: string | null;
 *   }
 *
 * Errors: 400 invalid classId · 401 unauthenticated · 403 missing permission
 * / teacher account not found / classId not on the caller's roster ·
 * 500 lookup failure. Error bodies never include student names, emails, or
 * any other PII (P13) — generic strings only.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeRequest,
  resolveTeacherIdentity,
  resolveTeacherRosterScope,
  type TeacherIdentity,
} from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface RosterStudent {
  id: string;
  name: string;
  grade: string;
  classIds: string[];
  xpTotal: number | null;
  streakDays: number | null;
  note: string | null;
  customGoal: string | null;
}

async function resolveTeacher(authUserId: string): Promise<TeacherIdentity | null> {
  try {
    return await resolveTeacherIdentity(authUserId);
  } catch (e) {
    logger.error('teacher_students_teacher_lookup_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/students',
    });
    throw new Error('teacher_lookup_failed');
  }
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  const classIdParam = url.searchParams.get('classId');
  if (classIdParam && !UUID_RE.test(classIdParam)) {
    return err('Invalid classId filter', 400);
  }

  let teacher: TeacherIdentity | null;
  try {
    teacher = await resolveTeacher(auth.userId!);
  } catch {
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  let roster;
  try {
    roster = await resolveTeacherRosterScope(teacher.id, {
      teacher,
      classId: classIdParam ?? undefined,
    });
  } catch (e) {
    logger.error('teacher_students_roster_lookup_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/students',
    });
    return err('Failed to resolve roster', 500);
  }
  // Only null when a specifically-requested classId does not resolve to one
  // of this teacher's active classes — the caller has no visibility into it.
  if (!roster) return err('Class is not available on this roster', 403);

  if (roster.enrollments.length === 0) {
    return NextResponse.json({ success: true, data: [] as RosterStudent[] }, { status: 200 });
  }

  // classIds-per-student, restricted to the teacher's own active classes.
  const classIdsByStudent = new Map<string, Set<string>>();
  for (const enrollment of roster.enrollments) {
    const set = classIdsByStudent.get(enrollment.studentId) ?? new Set<string>();
    set.add(enrollment.classId);
    classIdsByStudent.set(enrollment.studentId, set);
  }
  const studentIds = Array.from(classIdsByStudent.keys());

  const { data: studentRows, error: studentsErr } = await supabaseAdmin
    .from('students')
    .select('id, name, grade, xp_total, streak_days')
    .in('id', studentIds)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (studentsErr) {
    logger.error('teacher_students_students_lookup_failed', {
      error: new Error(studentsErr.message),
      route: 'teacher/students',
    });
    return err('Failed to load roster', 500);
  }

  const { data: noteRows, error: notesErr } = await supabaseAdmin
    .from('teacher_student_notes')
    .select('student_id, note, custom_goal')
    .eq('teacher_id', teacher.id)
    .in('student_id', studentIds);
  if (notesErr) {
    // Notes are supplementary — do not fail the whole roster read over them,
    // but do log so a persistent failure is visible in monitoring.
    logger.warn('teacher_students_notes_lookup_failed', {
      route: 'teacher/students',
      error: notesErr.message,
    });
  }

  const notesByStudent = new Map<string, { note: string | null; customGoal: string | null }>();
  for (const row of (noteRows ?? []) as Array<{ student_id: string; note: string | null; custom_goal: string | null }>) {
    notesByStudent.set(row.student_id, { note: row.note ?? null, customGoal: row.custom_goal ?? null });
  }

  const data: RosterStudent[] = ((studentRows ?? []) as Array<{
    id: string; name: string; grade: string; xp_total: number | null; streak_days: number | null;
  }>).map((s) => {
    const noteEntry = notesByStudent.get(s.id);
    return {
      id: s.id,
      name: s.name,
      grade: s.grade,
      classIds: Array.from(classIdsByStudent.get(s.id) ?? []),
      xpTotal: s.xp_total ?? null,
      streakDays: s.streak_days ?? null,
      note: noteEntry?.note ?? null,
      customGoal: noteEntry?.customGoal ?? null,
    };
  });

  return NextResponse.json({ success: true, data }, { status: 200 });
}
