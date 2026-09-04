-- 20260904120000_p2_5_phase2k_students_authenticated_select_merge_batch10.sql
--
-- P2-5 phase 2, batch 10 of Category B (2026-09-03 launch audit, CEO-approved
-- "full consolidation, small batches with tests") -- the explicit standalone
-- decision that batch 6 (20260904080000_p2_5_phase2g_students_dedup_batch6.sql)
-- deliberately deferred: OR-merging the LAST 3 {authenticated}-role SELECT
-- policies on the apex public.students table. Scoped as its own reviewed
-- change (CEO-approved, not folded into a routine batch) given the incident
-- history below.
--
-- ---------------------------------------------------------------------------
-- SCOPE (verified live via pg_policies immediately before writing this file)
-- ---------------------------------------------------------------------------
-- students carries exactly 3 remaining {authenticated} SELECT policies (after
-- batch 6 dropped a 4th, byte-identical "Authenticated users can view scoped
-- students"):
--   1. "Teachers can view students in their classes"
--      USING ( public.is_teacher_of(id) )
--   2. "School admins can view school students"
--      USING ( public.is_school_admin_of_student(id) )
--   3. "School staff can view own school students"
--      USING ( auth_user_id = (SELECT auth.uid())
--              OR (school_id IS NOT NULL AND school_id = public.get_jwt_school_id()) )
-- A 4th, role-heterogeneous {public} policy, students_select_merged
-- (USING (auth_user_id = auth.uid() OR is_teacher_of(id) OR is_guardian_of(id))),
-- is DELIBERATELY LEFT UNTOUCHED -- same role-heterogeneity rule applied
-- throughout batches 1-9 (a {public} policy is evaluated for every role, so
-- folding it into an authenticated-only merge risks silently narrowing or
-- widening access). INSERT (students_insert_own, {public}) and the 2 UPDATE
-- policies ("Students can update own profile" {authenticated} +
-- students_update_own {public}) are also out of scope, already correctly
-- left alone by batch 6.
--
-- ---------------------------------------------------------------------------
-- WHY THIS WAS DEFERRED, AND WHY IT IS SAFE TO DO NOW
-- ---------------------------------------------------------------------------
-- Batch 6 left these 3 policies alone specifically because each is
-- independently pinned BY EXACT NAME (parsing the LIVE effective migration
-- chain, not just frozen migration-file history) by THREE regression test
-- files guarding the 2026-07-02 TSB-4 production incident: an inline
-- class_students/class_teachers/teachers subquery in "Teachers can view
-- students in their classes" caused Postgres to raise "infinite recursion
-- detected in policy for relation students", breaking every authenticated
-- read of students. The fix (20260702080000_fix_students_rls_infinite_
-- recursion.sql) recreated the policy as USING (public.is_teacher_of(id)) --
-- a SECURITY DEFINER helper whose inner reads bypass RLS. A related XC-3
-- Phase 1 fix (20260702090000) similarly refactored "School admins can view
-- school students" from an inline `FROM school_admins` join to
-- is_school_admin_of_student(id). The teacher policy was regressed and
-- re-fixed once more (20260721000000 briefly reintroduced an inline join via
-- class_enrollments; 20260721000100 fixed it again one migration later) --
-- confirmed by independently walking the full migration chain before writing
-- this file, not assumed from the first fix migration alone.
--
-- The three guarding test files are updated in this SAME change to key on
-- the new merged policy name instead of the retired individual names:
--   - apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts
--   - apps/host/src/__tests__/students-rls-no-recursion.test.ts (REG-210)
--   - apps/host/src/__tests__/rls-teacher-assigned-students.test.ts (REG-209/212)
-- This migration does not change the effective SELECT boundary in any way
-- (see below), so the SEMANTIC guarantees those files exist to protect
-- (teacher boundary via is_teacher_of(id), school-admin boundary via
-- is_school_admin_of_student(id), no inline cross-table subquery) still
-- hold -- only the SURFACE the assertions key on changes.
--
-- ---------------------------------------------------------------------------
-- SEMANTICS-PRESERVING (same method as batches 1-6; no over/under-grant)
-- ---------------------------------------------------------------------------
-- The merged USING clause is a pure OR of the 3 original USING clauses,
-- copied verbatim from their exact live pg_policies text. A student row is
-- visible under the merged policy iff visible under AT LEAST ONE of the 3
-- originals -- identical access before and after; only the per-row overhead
-- of evaluating 3 separate PERMISSIVE policies is removed.
--
-- Recursion-guard ledger: NO CHANGE. Two branches already delegate to
-- SECURITY DEFINER helpers (inner reads bypass RLS) and the third is pure
-- auth.uid()/column comparisons -- none of the 3 predicates, nor the merged
-- result, inlines a FROM/JOIN over another RLS-enabled table. None of the 3
-- names was ever a member of GRANDFATHERED_INLINE_POLICIES, and the merged
-- name is not added either -- mirrors batch 6's precedent exactly.
--
-- New name students_authenticated_select_merged is distinct from the
-- existing role-heterogeneous {public} policy students_select_merged
-- (reusing that name would collide across a DIFFERENT role scope). Checked
-- against every policy name tied to a documented security incident in this
-- repo (TSB-4/REG-209/210/212/216, the 20260816000009 user_roles_admin
-- CRITICAL fix, the P0 lockdown series) -- no collision.

BEGIN;

DROP POLICY IF EXISTS "Teachers can view students in their classes" ON public.students;
DROP POLICY IF EXISTS "School admins can view school students" ON public.students;
DROP POLICY IF EXISTS "School staff can view own school students" ON public.students;

CREATE POLICY "students_authenticated_select_merged"
  ON public.students
  FOR SELECT
  TO authenticated
  USING (
    public.is_teacher_of(id)
    OR public.is_school_admin_of_student(id)
    OR (
      auth_user_id = (SELECT auth.uid())
      OR (school_id IS NOT NULL AND school_id = public.get_jwt_school_id())
    )
  );

COMMENT ON POLICY "students_authenticated_select_merged" ON public.students IS
  'P2-5 phase 2 batch 10 (20260904120000). OR-merge of the 3 {authenticated} '
  'SELECT policies that all applied to this (table, command, role): '
  '"Teachers can view students in their classes" (is_teacher_of(id), P8 '
  'incident fix 20260702080000, re-fixed 20260721000100), "School admins can '
  'view school students" (is_school_admin_of_student(id), XC-3 Phase 1 fix '
  '20260702090000), and "School staff can view own school students" '
  '(auth_user_id = auth.uid() OR school-scoped via get_jwt_school_id(), '
  '20260506000002). Semantics-preserving: a row is visible iff it was visible '
  'under at least one of the 3 originals. Does NOT touch the separate '
  '{public}-role students_select_merged policy (role-heterogeneous, '
  'deliberately left unmerged -- see batch 6, migration 20260904080000). See '
  'rls-no-cross-table-recursion.test.ts, students-rls-no-recursion.test.ts, '
  'and rls-teacher-assigned-students.test.ts for the companion name-keyed '
  'regression-test updates landed in this same change.';

COMMIT;
