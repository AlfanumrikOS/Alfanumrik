-- Migration: 20260721000100_fix_students_teacher_backstop_recursion_regression.sql
-- Purpose: P8 REGRESSION FIX — 20260721000000_tsb4_close_residual_class_students_rls_refs.sql
--          reintroduced the EXACT recursive inline-subquery shape that the
--          2026-07-02 production-incident fix
--          (20260702080000_fix_students_rls_infinite_recursion.sql) deliberately
--          removed from the "Teachers can view students in their classes" policy
--          on public.students — just against `class_enrollments` instead of the
--          legacy `class_students` table. Caught by
--          rls-teacher-assigned-students.test.ts (2 failures) and
--          rls-no-cross-table-recursion.test.ts (4 failures): a NEW inline
--          cross-table policy ("students::Teachers can view students in their
--          classes" -> inlines class_enrollments, class_teachers, teachers) that
--          is absent from GRANDFATHERED_INLINE_POLICIES and is asserted there to
--          NEVER reappear.
--
-- ─── Root cause (confirmed) ──────────────────────────────────────────────────
-- 20260720170000 recreated the students teacher backstop as:
--     id IN ( SELECT ce.student_id
--             FROM public.class_enrollments ce
--             JOIN public.class_teachers ct ON ct.class_id = ce.class_id
--             JOIN public.teachers       t  ON t.id        = ct.teacher_id
--             WHERE t.auth_user_id = auth.uid()
--               AND ce.is_active = true AND ct.is_active = true )
-- This inline subquery reads public.class_enrollments as SECURITY INVOKER, so
-- class_enrollments' OWN RLS policy "class_enrollments_student_select"
-- (00000000000000_baseline_from_prod.sql:20650 — "student_id IN (SELECT
-- students.id FROM public.students WHERE students.auth_user_id = auth.uid())")
-- reads public.students BACK. The cycle is identical in shape to the original
-- TSB-4 incident, just via the canonical roster table:
--     students -> class_enrollments -> students -> class_enrollments -> …
-- confirmed by direct inspection of the baseline policy text (verified in this
-- investigation, not assumed) — this is a REAL recursion risk, not merely a
-- stylistic inconsistency with the 2026-07-02 precedent.
--
-- ─── Why the fix ends the recursion (same proof shape as 20260702080000) ─────
-- public.is_teacher_of(uuid) (baseline:9212, SECURITY DEFINER, STABLE,
-- SET search_path = public) evaluates its inner class_students/class_teachers/
-- teachers reads with RLS BYPASSED (SECURITY DEFINER), so no students ->
-- roster-table -> students edge can form no matter which roster table it
-- queries. This migration:
--   1. Repoints is_teacher_of's inner query from the legacy `class_students`
--      table to the canonical `class_enrollments` table (safe: SECURITY DEFINER
--      bypasses RLS on its own inner reads regardless of table; this also
--      completes the canonical-table migration TSB-4/T2 was working toward for
--      this helper).
--   2. Repoints the "Teachers can view students in their classes" policy on
--      public.students back to `USING ( public.is_teacher_of(id) )`, removing
--      the inline subquery reintroduced by 20260720170000.
--
-- ─── Why the teacher boundary is UNCHANGED (no over/under-grant) ─────────────
-- class_students and class_enrollments are kept row-identical for
-- (class_id, student_id, is_active) by the bidirectional sync triggers in
-- 20260620000700_sync_class_students_class_enrollments.sql (INSERT mirroring)
-- and 20260702030000_class_membership_softdelete_sync.sql (is_active
-- soft-delete mirroring). Because both tables are guaranteed in lockstep,
-- repointing is_teacher_of's inner FROM/JOIN target changes zero rows in its
-- result for any (student, teacher) pair. The predicate shape (roster join +
-- both is_active guards + auth.uid() -> teachers.auth_user_id resolution) is
-- otherwise byte-for-byte identical to the function it replaces. This is a
-- join-target/indirection change only, not an authorization change.
--
-- ─── teacher_remediation_assignments — investigated, confirmed SAFE, left as-is ─
-- 20260720170000 ALSO repointed the three teacher_remediation_assignments
-- policies (teacher_select/insert/update) from class_students to
-- class_enrollments, inlining the SAME roster join shape directly on a
-- DIFFERENT table (teacher_remediation_assignments, not students). This does
-- NOT reintroduce a cycle, verified by inspecting every policy on the tables it
-- inlines:
--   * class_enrollments policies (class_enrollments_school_admin_select,
--     class_enrollments_service_role, class_enrollments_student_select) read
--     FROM classes / students only — none reads FROM
--     teacher_remediation_assignments.
--   * class_teachers policies ("School admins can manage school
--     class_teachers", "Teachers can view own class assignments") read FROM
--     classes / class_students / teachers only — none reads FROM
--     teacher_remediation_assignments.
--   * teachers policies (teachers_select_merged, teachers_insert_own,
--     teachers_update_own, teachers_service_role, "School admins can view
--     school teachers") read FROM school_admins / teachers only — none reads
--     FROM teacher_remediation_assignments.
-- So there is no teacher_remediation_assignments -> {class_enrollments,
-- class_teachers, teachers} -> teacher_remediation_assignments back-edge: the
-- cycle topology that broke `students` does NOT exist for this table. This is
-- also independently confirmed by the existing static guard
-- (rls-no-cross-table-recursion.test.ts): the four
-- teacher_remediation_assignments_teacher_* / _student_select policies are
-- already present in GRANDFATHERED_INLINE_POLICIES (frozen debt, not a live
-- cycle — the ledger key is "<table>::<name>" and is insensitive to which
-- roster table the join now targets), and that guard's "no STALE entries" and
-- "no NEW offenders" checks both continue to pass after 20260720170000 with no
-- migration needed. This migration therefore intentionally leaves those three
-- policies exactly as 20260720170000 left them.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: CREATE OR REPLACE FUNCTION; DROP POLICY IF EXISTS + CREATE
--     POLICY — safe to re-run.
--   * Additive/corrective: touches ONLY public.is_teacher_of and the one named
--     students policy. Does NOT alter students_select_merged, any
--     class_enrollments/class_students/teacher_remediation_assignments policy,
--     RLS enablement on any table, RBAC roles/permissions, or any data.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN. No new SECURITY DEFINER
--     introduced (is_teacher_of already was SECURITY DEFINER; this changes its
--     body only).
--   * Forward-only: 20260720170000 is left unedited per repo convention; this
--     migration runs strictly after it and supersedes its students-policy
--     effect via DROP + CREATE of the same name.
--   * Rollback: re-running 20260720170000's students-policy block would
--     reintroduce the recursion; do NOT. Correct rollback is to keep this
--     version, or at minimum re-run 20260702080000's CREATE POLICY block.
--
-- Owner: architect. RCA: TSB-4 residual-closure regression (reintroduced
-- 2026-07-02 incident shape via class_enrollments).

BEGIN;

-- ─── 1. Repoint is_teacher_of's inner reads onto the canonical roster table ──
-- SECURITY DEFINER: this function's inner reads BYPASS RLS regardless of which
-- table they query, so this is safe against the recursion class that motivated
-- the 2026-07-02 fix — the point of the fix was routing the STUDENTS POLICY
-- through this indirection, not which roster table the helper itself reads.
CREATE OR REPLACE FUNCTION "public"."is_teacher_of"("p_student_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT EXISTS(
    SELECT 1
    FROM class_enrollments ce
    JOIN class_teachers ct ON ct.class_id = ce.class_id
    JOIN teachers t ON t.id = ct.teacher_id
    WHERE ce.student_id = p_student_id
      AND t.auth_user_id = auth.uid()
      AND ce.is_active = true
      AND ct.is_active = true
  ));
END;
$$;

COMMENT ON FUNCTION "public"."is_teacher_of"("uuid") IS
  'P8 regression fix (20260720180000). SECURITY DEFINER helper (baseline:9212) '
  'whose inner reads BYPASS RLS, so no students <-> roster-table recursion can '
  'form regardless of which roster table it queries. Repointed from the legacy '
  'class_students table to the canonical class_enrollments table (kept '
  'row-identical by the bidirectional sync triggers in 20260620000700 and '
  '20260702030000, so this is a no-op on the effective boundary). Predicate '
  'shape (roster join + both is_active guards + auth.uid() -> '
  'teachers.auth_user_id) is otherwise unchanged.';

-- ─── 2. Repoint the students teacher backstop back to the helper (non-recursive) ─
-- Removes the inline class_enrollments/class_teachers/teachers subquery that
-- 20260720170000 reintroduced, restoring the 20260702080000 non-recursive form.
DROP POLICY IF EXISTS "Teachers can view students in their classes"
  ON public.students;

CREATE POLICY "Teachers can view students in their classes"
  ON public.students
  FOR SELECT
  TO authenticated
  USING ( public.is_teacher_of(id) );

COMMENT ON POLICY "Teachers can view students in their classes" ON public.students IS
  'P8 regression fix (20260720180000). Restores the 2026-07-02 incident-fix '
  'shape (NON-RECURSIVE, delegates to the SECURITY DEFINER helper '
  'public.is_teacher_of(id)) after 20260720170000 reintroduced an inline '
  'class_enrollments/class_teachers/teachers subquery that re-opened the same '
  'students -> roster-table -> students RLS recursion cycle documented in '
  '20260702080000_fix_students_rls_infinite_recursion.sql (there via '
  'class_students; here via class_enrollments and its own '
  '"class_enrollments_student_select" policy reading students back). '
  'is_teacher_of bypasses RLS on its inner reads (now against the canonical '
  'class_enrollments table, see the function-level comment), so no cycle forms. '
  'The predicate is the IDENTICAL roster boundary as the policy it replaces — '
  'additive PERMISSIVE OR within students_select_merged, no over/under-grant.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Recursion is gone — any authenticated student reading their own row:
--      SELECT id FROM public.students WHERE auth_user_id = auth.uid();
--      -- expect: 1 row, NO "infinite recursion" error.
-- 2. Teacher boundary preserved — as an assigned teacher (active class_teachers
--    row whose class has the student via an active class_enrollments row):
--      SELECT id FROM public.students WHERE id = '<assigned-student-uuid>';
--      -- expect: 1 row.
-- 3. No over-grant — as a teacher with NO active assignment to that student:
--      SELECT id FROM public.students WHERE id = '<non-assigned-student-uuid>';
--      -- expect: 0 rows (RLS hides it).
-- 4. teacher_remediation_assignments teacher policies remain functionally
--    unchanged (untouched by this migration) — same visible rows as after
--    20260720170000.
