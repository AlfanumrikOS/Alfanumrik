-- Migration: 20260721000000_tsb4_close_residual_class_students_rls_refs.sql
-- Purpose: TSB-4 cutover follow-up — close the LAST residual RLS references to
--          the legacy `class_students` table that survived the boundary-reader
--          repoint. Per scripts/tsb4-canonical-membership-cutover.json, the
--          `boundary-reader-repoint` and `route-helper-repoint` stages moved
--          canAccessStudent / listStudentsInClass / teacher route helpers onto
--          the canonical `class_enrollments` table, but two RLS policy sets
--          were NOT touched by that work and still literally join through
--          `class_students`:
--            1. public.students teacher backstop policy
--               "Teachers can view students in their classes"
--               (added by 20260702010000_teacher_assigned_students_rls.sql)
--            2. public.teacher_remediation_assignments teacher SELECT/INSERT/
--               UPDATE policies
--               (added by 20260613000004_teacher_remediation_assignments.sql,
--               re-issued verbatim by 20260619000150 for repair-skip recovery)
--
-- ─── Why this is safe to do now (not blocked by the CEO-gated retirement) ────
-- `scripts/tsb4-canonical-membership-cutover.json`'s `legacy-table-retirement`
-- stage is CEO-gated because it means DROPPING/freezing `class_students`
-- outright. This migration does NOT touch the `class_students` table at all —
-- it only repoints RLS policy USING/WITH CHECK clauses to read the canonical
-- `class_enrollments` table instead. `class_students` keeps existing, keeps
-- receiving writes from the school-admin "add student" path, and keeps being
-- mirrored bidirectionally by the sync triggers in
-- 20260620000700_sync_class_students_class_enrollments.sql (INSERT) and
-- 20260702030000_class_membership_softdelete_sync.sql (is_active soft-delete).
-- Because both tables are guaranteed row-identical by those triggers, swapping
-- the RLS join target is a no-op on the effective visible row set and carries
-- no authorization-widening risk.
--
-- ─── Four-pattern RLS model preserved (P8) ───────────────────────────────────
-- Only the teacher-assigned pattern's join target changes (class_students ->
-- class_enrollments). Student-own, parent-linked, and admin/service-role
-- patterns on both tables are untouched by this migration.
--
-- ─── Safety properties ────────────────────────────────────────────────────────
--   * Additive/idempotent: DROP POLICY IF EXISTS (own policy names only) +
--     CREATE POLICY. No table/column dropped, no RLS toggle (already enabled
--     at baseline on both tables), no SECURITY DEFINER introduced.
--   * Predicate shape is IDENTICAL to the class_students version being
--     replaced (same roster join, same is_active guard), just against
--     class_enrollments — no row set is added or removed, given the sync
--     triggers keep the two tables' (class_id, student_id, is_active) tuples
--     in lockstep.
--   * Rollback: re-run 20260702010000 / 20260619000150 (they DROP POLICY IF
--     EXISTS before their own CREATE POLICY, so re-applying restores the
--     class_students-based predicate exactly).
--
-- Owner: architect. RCA: TSB-4 follow-up (residual RLS class_students refs).

BEGIN;

-- ─── 1. public.students teacher backstop (was: 20260702010000) ──────────────
DROP POLICY IF EXISTS "Teachers can view students in their classes"
  ON public.students;

CREATE POLICY "Teachers can view students in their classes"
  ON public.students
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT ce.student_id
      FROM public.class_enrollments ce
      JOIN public.class_teachers ct ON ct.class_id = ce.class_id
      JOIN public.teachers       t  ON t.id        = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND ce.is_active = true
        AND ct.is_active = true
    )
  );

COMMENT ON POLICY "Teachers can view students in their classes" ON public.students IS
  'TSB-4 residual-RLS closure (2026-07-20). Teacher-assigned SELECT backstop, '
  'now joined through the canonical class_enrollments table instead of the '
  'previous legacy roster table. Predicate shape (roster join + is_active '
  'guards) is unchanged from the version it replaces; the two roster tables '
  'are kept row-identical by the bidirectional sync triggers in 20260620000700 '
  'and 20260702030000, so this is a no-op on the effective visible row set.';

-- ─── 2. public.teacher_remediation_assignments (was: 20260613000004 /
--        20260619000150) ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments
  FOR SELECT TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT ce.student_id
      FROM public.class_enrollments ce
      JOIN public.class_teachers ct ON ct.class_id = ce.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND ce.is_active = true
    )
  );

DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT ce.student_id
      FROM public.class_enrollments ce
      JOIN public.class_teachers ct ON ct.class_id = ce.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND ce.is_active = true
    )
    AND class_id IN (
      SELECT ct.class_id
      FROM public.class_teachers ct
      JOIN public.teachers t ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments
  FOR UPDATE TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT ce.student_id
      FROM public.class_enrollments ce
      JOIN public.class_teachers ct ON ct.class_id = ce.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND ce.is_active = true
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT ce.student_id
      FROM public.class_enrollments ce
      JOIN public.class_teachers ct ON ct.class_id = ce.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND ce.is_active = true
    )
  );

COMMENT ON POLICY teacher_remediation_assignments_teacher_select ON public.teacher_remediation_assignments IS
  'TSB-4 residual-RLS closure (2026-07-20). Roster join repointed from the '
  'previous legacy roster table onto canonical class_enrollments; predicate shape unchanged.';

COMMENT ON POLICY teacher_remediation_assignments_teacher_insert ON public.teacher_remediation_assignments IS
  'TSB-4 residual-RLS closure (2026-07-20). Roster join repointed from the '
  'previous legacy roster table onto canonical class_enrollments; predicate shape unchanged.';

COMMENT ON POLICY teacher_remediation_assignments_teacher_update ON public.teacher_remediation_assignments IS
  'TSB-4 residual-RLS closure (2026-07-20). Roster join repointed from the '
  'previous legacy roster table onto canonical class_enrollments; predicate shape unchanged.';

-- teacher_remediation_assignments_service_all and _student_select are
-- untouched (they never referenced class_students).

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Policies now reference class_enrollments, not class_students:
--    SELECT polname, pg_get_expr(polqual, polrelid) AS using_clause
--      FROM pg_policy
--     WHERE polrelid = 'public.students'::regclass
--       AND polname = 'Teachers can view students in their classes';
--    SELECT polname, pg_get_expr(polqual, polrelid) AS using_clause
--      FROM pg_policy
--     WHERE polrelid = 'public.teacher_remediation_assignments'::regclass
--       AND polname LIKE 'teacher_remediation_assignments_teacher_%';
--    -- expect: class_enrollments in every using_clause / with_check, no
--    -- class_students anywhere.
-- 2. As an assigned teacher: same visible rows as before this migration
--    (given class_students/class_enrollments are kept in sync).
-- 3. As a de-enrolled (is_active=false on either side) teacher-student pair:
--    0 rows on all three policies (fail-closed).;
