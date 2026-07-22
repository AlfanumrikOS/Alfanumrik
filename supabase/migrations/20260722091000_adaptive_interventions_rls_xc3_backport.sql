-- Migration: 20260722091000_adaptive_interventions_rls_xc3_backport.sql
-- Purpose: Phase 0 (Master Action Plan, item 0.6). Backports the XC-3 /
--          missing-is_active fix that 20260702110000_fix_twin_rls_active_
--          guard_and_xc3.sql already applied to learner_twin_snapshots /
--          learner_twin_memory onto the TWO tables that were introduced
--          around the same time but never received the equivalent fix:
--            - public.adaptive_interventions
--              (20260619000200_adaptive_interventions.sql)
--            - public.teacher_remediation_assignments
--              (20260613000004_teacher_remediation_assignments.sql)
--
-- ─── FINDING 1 (missing is_active guards -- P8 over-grant) ───────────────────
-- adaptive_interventions_teacher_select (20260619000200:193-206) inlines the
-- roster join WITHOUT is_active guards:
--   student_id IN (
--     SELECT cs.student_id
--     FROM public.class_students cs
--     JOIN public.class_teachers ct ON ct.class_id = cs.class_id
--     JOIN public.teachers t        ON t.id = ct.teacher_id
--     WHERE t.auth_user_id = auth.uid()
--     -- MISSING: AND cs.is_active = true AND ct.is_active = true
--   )
-- teacher_remediation_assignments_teacher_select/_insert/_update
-- (20260613000004:117-190) inline the IDENTICAL roster join, same omission,
-- in all three policies.
-- This makes rows visible to / writable by teachers who LEFT a class
-- (ct.is_active = false) for students de-enrolled from that class
-- (cs.is_active = false) -- a P8 boundary violation: visibility must not
-- outlive the active roster edge.
--
-- ─── FINDING 2 (XC-3 RS-RULE violation) ──────────────────────────────────────
-- Both tables' teacher policies additionally inline a FROM/JOIN over
-- class_students + class_teachers + teachers (all RLS-enabled) directly in
-- their USING/WITH CHECK clauses -- the same pattern the binding XC-3
-- RS-RULE forbids (docs/superpowers/plans/2026-07-02-xc3-systemic-rls-
-- defense-in-depth.md Section 2.3) and the exact shape that caused the
-- production TSB-4 infinite-recursion incident on public.students.
-- adaptive_interventions_parent_select ALSO inlines guardian_student_links x
-- guardians directly, the same latent-cycle pattern.
--
-- ─── Fix (identical strategy to 20260702110000) ──────────────────────────────
-- Replace every inlined roster/guardian subquery with a call to the EXISTING
-- SECURITY DEFINER helpers whose inner reads bypass RLS:
--   parent_select  -> public.is_guardian_of(student_id)   [baseline:9181]
--   teacher_select -> public.is_teacher_of(student_id)    [baseline:9212]
--                     (enforces cs.is_active = true AND ct.is_active = true
--                      -- closes FINDING 1 for adaptive_interventions)
-- teacher_remediation_assignments' teacher_select/insert/update policies also
-- separately check `teacher_id IN (SELECT t.id FROM teachers t WHERE
-- t.auth_user_id = auth.uid())` -- that ownership check is UNRELATED to the
-- roster join and is left untouched; only the roster-membership half of each
-- policy is replaced with `public.is_teacher_of(student_id)`.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
--   * Boundary change is a STRICT NARROWING for teacher_select on both tables
--     (ex-teachers / de-enrolled students lose visibility -- the FINDING-1
--     bug fix) and for teacher_remediation_assignments_teacher_insert/_update
--     (a teacher can no longer assign/update remediation for a student whose
--     roster edge has gone inactive since the roster join was last checked).
--     adaptive_interventions_parent_select is boundary-IDENTICAL (same
--     dual-status ('active','approved') guard as the helper enforces).
--   * No SECURITY DEFINER introduced here: this migration only calls EXISTING
--     SECURITY DEFINER helpers (is_guardian_of baseline:9181, is_teacher_of
--     baseline:9212). No new functions defined.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN.
--   * Additive: touches only the 5 named SELECT/INSERT/UPDATE policies below,
--     nothing else. adaptive_interventions_service_all,
--     adaptive_interventions_student_select,
--     teacher_remediation_assignments_service_all, and
--     teacher_remediation_assignments_student_select are untouched (no
--     cross-table inline in any of them; no XC-3 edge, no is_active gap).
--   * Rollback: re-run 20260619000200 / 20260613000004 to restore the inline
--     forms (NOT recommended -- restores the P8 bug and XC-3 violations).
--
-- Review chain (P14): RLS policy changes affecting parent-child visibility
-- and teacher-roster visibility -- notify frontend (parent portal, teacher
-- command center) + backend (child-progress / remediation-assignment APIs)
-- per this repo's Required Review Triggers.
--
-- Owner: architect. Added: 2026-07-22.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: public.adaptive_interventions
-- ═════════════════════════════════════════════════════════════════════════════

-- (c) Linked guardian reads the child's intervention rows.
--     Fix XC-3: delegate to SECURITY DEFINER helper is_guardian_of() instead
--     of inlining guardian_student_links x guardians. Boundary identical:
--     same dual-status ('active','approved') guard the inline used.
DROP POLICY IF EXISTS adaptive_interventions_parent_select
  ON public.adaptive_interventions;

CREATE POLICY adaptive_interventions_parent_select
  ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING ( public.is_guardian_of(student_id) );

COMMENT ON POLICY adaptive_interventions_parent_select
  ON public.adaptive_interventions IS
  'XC-3 backport (20260722091000). Parent/guardian reads linked child intervention rows. '
  'Delegates to the SECURITY DEFINER helper public.is_guardian_of(student_id) '
  '(baseline:9181) instead of inlining a guardian_student_links x guardians subquery '
  '(20260619000200). Boundary identical: same dual-status status IN '
  '(''active'',''approved'') guard. Helper inner reads bypass RLS -> no latent '
  'guardian_student_links -> adaptive_interventions recursion cycle.';

-- (d) Roster teacher reads interventions for actively assigned students.
--     Fix FINDING 1 (missing is_active guards) AND FINDING 2 (inline roster
--     JOIN / XC-3). is_teacher_of() (baseline:9212) enforces
--     cs.is_active = true AND ct.is_active = true.
DROP POLICY IF EXISTS adaptive_interventions_teacher_select
  ON public.adaptive_interventions;

CREATE POLICY adaptive_interventions_teacher_select
  ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING ( public.is_teacher_of(student_id) );

COMMENT ON POLICY adaptive_interventions_teacher_select
  ON public.adaptive_interventions IS
  'XC-3 backport + P8 fix (20260722091000). Teacher reads interventions for actively '
  'assigned students only. Delegates to the SECURITY DEFINER helper '
  'public.is_teacher_of(student_id) (baseline:9212) instead of inlining a '
  'class_students x class_teachers x teachers subquery (20260619000200). '
  'is_teacher_of enforces cs.is_active = true AND ct.is_active = true -- closes '
  'the P8 over-grant: ex-teachers (ct.is_active = false) and de-enrolled students '
  '(cs.is_active = false) are no longer visible. Helper inner reads bypass RLS -> '
  'no TSB-4-style recursion cycle can form.';

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: public.teacher_remediation_assignments
-- ═════════════════════════════════════════════════════════════════════════════

-- SELECT: ownership check (teacher_id = caller) is UNCHANGED; only the
-- roster-membership half is replaced with is_teacher_of(student_id).
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments
  FOR SELECT TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND public.is_teacher_of(student_id)
  );

COMMENT ON POLICY teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments IS
  'XC-3 backport + P8 fix (20260722091000). Teacher reads only rows they assigned AND '
  'where the student is actively on their roster. The roster-membership half now '
  'delegates to public.is_teacher_of(student_id) (baseline:9212, enforces '
  'cs.is_active = true AND ct.is_active = true) instead of inlining the '
  'class_students x class_teachers x teachers subquery (20260613000004). The '
  'teacher_id ownership check is unchanged.';

-- INSERT: same treatment. The class_id-ownership check (a DIFFERENT roster
-- fact -- "is this class one the caller teaches", not "is this student on
-- the caller's roster") is unrelated to is_teacher_of() and stays inlined.
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND public.is_teacher_of(student_id)
    AND class_id IN (
      SELECT ct.class_id
      FROM public.class_teachers ct
      JOIN public.teachers t ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

COMMENT ON POLICY teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments IS
  'XC-3 backport + P8 fix (20260722091000). A teacher may only assign remediation to a '
  'student ACTIVELY on their roster (public.is_teacher_of(student_id), baseline:9212) '
  'for a class they teach. Replaces the inlined class_students x class_teachers x '
  'teachers roster subquery from 20260613000004; the class_id-ownership check is a '
  'separate fact and is unchanged.';

-- UPDATE: same treatment on both USING and WITH CHECK, so a teacher cannot
-- re-point a row at (or keep editing a row for) a student outside their
-- active roster.
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments;

CREATE POLICY teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments
  FOR UPDATE TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND public.is_teacher_of(student_id)
  )
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND public.is_teacher_of(student_id)
  );

COMMENT ON POLICY teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments IS
  'XC-3 backport + P8 fix (20260722091000). Same is_teacher_of(student_id) delegation as '
  'the SELECT/INSERT policies, applied to both USING and WITH CHECK so a teacher cannot '
  're-point or keep editing a row for a student whose roster edge has gone inactive.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Teacher with an ACTIVE class_teachers + class_students edge sees /
--    can assign remediation for the student (adaptive_interventions and
--    teacher_remediation_assignments both).
-- 2. Teacher whose ct.is_active = false (left the class) sees 0 rows / gets a
--    WITH CHECK failure on INSERT for that student -- this is the FINDING-1
--    fix; previously these were visible/writable.
-- 3. De-enrolled student (cs.is_active = false) is NOT visible to the former
--    teacher -- previously visible (over-grant).
-- 4. Parent with an APPROVED guardian_student_links row sees the child's
--    adaptive_interventions rows; a parent with a PENDING link sees 0 rows
--    (is_guardian_of status guard).
-- 5. No infinite-recursion error on any of the above queries.
-- SELECT polname, cmd FROM pg_policies
--  WHERE tablename IN ('adaptive_interventions', 'teacher_remediation_assignments')
--  ORDER BY tablename, polname;
