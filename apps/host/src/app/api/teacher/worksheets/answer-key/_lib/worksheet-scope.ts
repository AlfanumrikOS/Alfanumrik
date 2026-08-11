/**
 * Teacher WORKSHEET CONTENT SCOPE — the content-side analogue of
 * `canAccessStudent`.
 *
 * `canAccessStudent` answers "may this caller see THIS STUDENT's rows?" by
 * walking teachers → class_teachers → class_enrollments. That question has no
 * meaning for `question_bank`, which is global CBSE content keyed by
 * (subject, grade) and carries no student_id, no school_id and no class_id.
 * The corresponding boundary for CONTENT is therefore:
 *
 *     which (subject, grade) pairs does this teacher actually teach?
 *
 * Two independent sources answer that, and this module takes the UNION so a
 * teacher who is correctly configured through either one is not locked out:
 *
 *   1. `teachers.subjects_taught` / `teachers.grades_taught` — the profile
 *      arrays. `subjects_taught` is already the authority behind
 *      `/api/teacher/subjects`, which is what renders the worksheet page's
 *      subject picker, so this half simply moves an existing CLIENT-side
 *      restriction to the server where it is a boundary rather than a hint.
 *   2. The teacher's active class assignments, resolved through the CANONICAL
 *      `resolveTeacherIdentity` + `resolveTeacherRosterScope` pair in
 *      `@alfanumrik/lib/rbac` (`includeClassDetails: true` gives
 *      `classes[].subject` and `classes[].grade`). Per the "Canonical Teacher
 *      Roster Resolution" section of rbac.ts, NO new route may re-query
 *      class_teachers/class_enrollments by hand — three prior copies drifted
 *      and lost their `is_active` filters. This module does not re-query; it
 *      projects the canonical result onto the content axes.
 *
 * FAIL-CLOSED. A caller with no active `teachers` row, or with an empty union
 * on either axis, gets `null` / an empty set — never a wildcard. An empty
 * `subjects_taught` must NOT be read as "all subjects"; that inversion is the
 * exact shape of the bug this whole change exists to close.
 *
 * P5: grades are STRINGS ("6".."12") on both sides of every comparison here.
 * P13: this module returns codes and grade strings only — no teacher name,
 * email, phone or school name is read or returned.
 */

import {
  resolveTeacherIdentity,
  resolveTeacherRosterScope,
  type TeacherIdentity,
} from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export interface TeacherContentScope {
  teacher: TeacherIdentity;
  /** Subject codes the teacher may request content for. Never a wildcard. */
  subjects: Set<string>;
  /** Grade strings ("6".."12") the teacher may request content for. */
  grades: Set<string>;
}

function toCodeSet(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Resolve the (subject, grade) content boundary for an authenticated caller.
 *
 * Returns `null` when the caller has no ACTIVE teacher profile — the caller
 * must translate that into a deny, never into an unscoped read. Throws on an
 * unexpected DB error so the caller fails closed with a 500 rather than
 * silently degrading to an empty (and therefore permissive-looking) scope.
 */
export async function resolveTeacherContentScope(
  authUserId: string,
): Promise<TeacherContentScope | null> {
  const teacher = await resolveTeacherIdentity(authUserId);
  if (!teacher) return null;

  // Source 1 — profile arrays.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('teachers')
    .select('subjects_taught, grades_taught')
    .eq('id', teacher.id)
    .maybeSingle();
  if (profileErr) throw new Error(`teacher_content_scope_lookup_failed: ${profileErr.message}`);

  const subjects = new Set<string>(toCodeSet(profile?.subjects_taught));
  const grades = new Set<string>(toCodeSet(profile?.grades_taught));

  // Source 2 — active class assignments, via the canonical roster resolver.
  // `resolveTeacherRosterScope` returns null when a teacher has a school_id
  // requirement it cannot satisfy; that is a legitimate "no class-derived
  // scope", not an error, so the profile arrays still stand on their own.
  const roster = await resolveTeacherRosterScope(authUserId, {
    teacher,
    includeClassDetails: true,
  });
  for (const cls of roster?.classes ?? []) {
    if (cls.subject && cls.subject.trim().length > 0) subjects.add(cls.subject.trim());
    if (cls.grade && String(cls.grade).trim().length > 0) grades.add(String(cls.grade).trim());
  }

  return { teacher, subjects, grades };
}

/** Is this exact (subject, grade) pair inside the teacher's content scope? */
export function isInContentScope(
  scope: TeacherContentScope,
  subject: string,
  grade: string,
): boolean {
  return scope.subjects.has(subject) && scope.grades.has(grade);
}
