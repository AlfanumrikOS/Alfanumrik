-- Migration: 20260702110000_fix_twin_rls_active_guard_and_xc3.sql
-- Purpose: XC-3 remediation — fix TWO security findings (P8 over-grant + XC-3
--          RS-RULE violation) in public.learner_twin_snapshots and
--          public.learner_twin_memory introduced by migrations 20260702000200 and
--          20260702000300 (Digital Twin Slice 1).
--
-- ─── FINDING 1 (HIGH — P8 active over-grant) ─────────────────────────────────
-- learner_twin_snapshots_teacher_select (20260702000200:103-113) and
-- learner_twin_memory_teacher_select (20260702000300:103-114) inline the
-- class_students × class_teachers × teachers roster join WITHOUT is_active guards:
--
--   student_id IN (
--     SELECT cs.student_id
--     FROM public.class_students cs
--     JOIN public.class_teachers ct ON ct.class_id = cs.class_id
--     JOIN public.teachers t        ON t.id = ct.teacher_id
--     WHERE t.auth_user_id = auth.uid()
--     -- MISSING: AND cs.is_active = true AND ct.is_active = true
--   )
--
-- This makes twin rows visible to:
--   • Teachers who LEFT a class (ct.is_active = false).
--   • Students de-enrolled from a class (cs.is_active = false).
-- Both are P8 boundary violations: data must not outlive the active roster edge.
--
-- ─── FINDING 2 (HIGH — latent P8, XC-3 RS-RULE violated) ────────────────────
-- All 6 non-service-role SELECT policies on both tables inline FROM/JOIN subqueries
-- over DIFFERENT RLS-enabled tables in their USING clauses:
--
--   learner_twin_snapshots_student_select / learner_twin_memory_student_select:
--     student_id IN (SELECT s.id FROM public.students s WHERE …)
--     → cross-table inline into public.students (RLS-enabled)
--
--   learner_twin_snapshots_parent_select / learner_twin_memory_parent_select:
--     student_id IN (SELECT gsl.student_id FROM public.guardian_student_links gsl
--                    JOIN public.guardians g …)
--     → cross-table inline into public.guardian_student_links + public.guardians
--       (both RLS-enabled)
--
--   learner_twin_snapshots_teacher_select / learner_twin_memory_teacher_select:
--     student_id IN (SELECT cs.student_id FROM public.class_students cs
--                    JOIN public.class_teachers ct … JOIN public.teachers t …)
--     → cross-table inline into public.class_students + public.class_teachers
--       + public.teachers (all RLS-enabled)
--
-- This violates the binding XC-3 RS-RULE (see
-- docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md §2.3):
-- "no policy may inline a FROM/JOIN over a DIFFERENT RLS-enabled table in its
-- USING / WITH CHECK." The teacher-roster inline is the EXACT pattern that caused
-- the production TSB-4 infinite-recursion incident (a class_students inline in a
-- policy ON public.students, fixed by 20260702080000). A future RLS policy on
-- class_students, guardian_student_links, or guardians that back-references
-- learner_twin_snapshots or learner_twin_memory would close the recursion cycle.
--
-- ─── Fix ─────────────────────────────────────────────────────────────────────
-- Replace all 6 inline-subquery policies (3 per table) with safe, non-inline forms
-- that delegate to EXISTING SECURITY DEFINER helpers whose inner reads BYPASS RLS:
--
--   student_select  → scalar subquery (no multi-table JOIN):
--                     student_id = (SELECT id FROM public.students
--                                   WHERE auth_user_id = auth.uid() LIMIT 1)
--                     No cross-table JOIN; the students policy does NOT reference
--                     learner_twin_* back, so no cycle can form.
--
--   parent_select   → public.is_guardian_of(student_id)  [baseline:9181]
--                     SECURITY DEFINER: inner reads of guardian_student_links +
--                     guardians bypass RLS. Same dual-status guard
--                     (status IN ('active','approved')) as the dropped inline.
--
--   teacher_select  → public.is_teacher_of(student_id)   [baseline:9212]
--                     SECURITY DEFINER: inner reads of class_students +
--                     class_teachers + teachers bypass RLS. Includes
--                     cs.is_active = true AND ct.is_active = true — simultaneously
--                     closes FINDING 1 (active-guard over-grant). Same roster join
--                     as the dropped inline; no row becomes newly visible, none
--                     is removed beyond the is_active tightening that closes the bug.
--
-- The service_all policies (auth.role() = 'service_role') are NOT touched: they
-- contain no cross-table join and present no XC-3 edge.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
--     On a fresh DB the chain runs 000200/000300 (inline forms) → this migration
--     (DROP + CREATE safe forms), ending on the safe forms. On prod (inline forms
--     live) this DROPs and replaces them in place. Both paths converge identically.
--   * Boundary equivalence: for parent_select and student_select the visible row set
--     is IDENTICAL to the original inline forms (same auth.uid() resolution, same
--     status guard). For teacher_select the set is strictly NARROWER (tighter) by
--     exactly the P8 bug: rows for ex-teachers / de-enrolled students are now hidden.
--   * No SECURITY DEFINER introduced here: this migration only calls existing
--     SECURITY DEFINER helpers (is_guardian_of baseline:9181, is_teacher_of
--     baseline:9212). No new functions defined.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN.
--   * Additive: touches only the 6 named SELECT policies, nothing else.
--   * Rollback: re-run 20260702000200 and 20260702000300 to restore the inline
--     forms (NOT recommended — restores the P8 bug and XC-3 violations).

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: public.learner_twin_snapshots
-- ═════════════════════════════════════════════════════════════════════════════

-- (b) Student reads own snapshots.
--     Fix XC-3: scalar subquery replaces IN(SELECT … FROM students …).
--     Boundary identical: students.auth_user_id = auth.uid() resolves to the same
--     student id; LIMIT 1 is safe (auth_user_id is unique on students, baseline:16272
--     equivalent). No multi-table JOIN; no latent cycle.
DROP POLICY IF EXISTS learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots;

CREATE POLICY learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id = (
      SELECT id FROM public.students
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

COMMENT ON POLICY learner_twin_snapshots_student_select
  ON public.learner_twin_snapshots IS
  'XC-3 drain (20260702110000). Student reads own snapshots. '
  'Scalar subquery (= LIMIT 1) replaces the original IN(SELECT s.id FROM students …) '
  'form (20260702000200). Identical effective boundary: students.auth_user_id = '
  'auth.uid(). No multi-table JOIN over a second RLS-enabled table; no latent '
  'recursion cycle.';

-- (c) Linked guardian reads child snapshots.
--     Fix XC-3: delegate to SECURITY DEFINER helper is_guardian_of().
--     Boundary identical: same guardian_student_links × guardians join and same
--     dual-status guard (status IN (''active'',''approved'')) as the dropped inline.
--     Helper bypasses RLS on inner reads → no latent cycle.
DROP POLICY IF EXISTS learner_twin_snapshots_parent_select
  ON public.learner_twin_snapshots;

CREATE POLICY learner_twin_snapshots_parent_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING ( public.is_guardian_of(student_id) );

COMMENT ON POLICY learner_twin_snapshots_parent_select
  ON public.learner_twin_snapshots IS
  'XC-3 drain (20260702110000). Parent/guardian reads linked child snapshots. '
  'Delegates to the SECURITY DEFINER helper public.is_guardian_of(student_id) '
  '(baseline:9181) instead of inlining a guardian_student_links × guardians subquery '
  '(20260702000200). Boundary identical: same dual-status status IN '
  '(''active'',''approved'') guard. Helper inner reads bypass RLS → no latent '
  'guardian_student_links → learner_twin_snapshots recursion cycle.';

-- (d) Roster teacher reads snapshots for assigned students.
--     Fix FINDING 1 (missing is_active guards) AND Fix XC-3 (inline roster JOIN).
--     is_teacher_of() (baseline:9212) is SECURITY DEFINER and includes
--     cs.is_active = true AND ct.is_active = true — closing the over-grant that
--     made ex-teacher / de-enrolled-student rows visible. Helper bypasses RLS on
--     its inner reads → no class_students → learner_twin_snapshots cycle.
DROP POLICY IF EXISTS learner_twin_snapshots_teacher_select
  ON public.learner_twin_snapshots;

CREATE POLICY learner_twin_snapshots_teacher_select
  ON public.learner_twin_snapshots
  FOR SELECT TO authenticated
  USING ( public.is_teacher_of(student_id) );

COMMENT ON POLICY learner_twin_snapshots_teacher_select
  ON public.learner_twin_snapshots IS
  'XC-3 drain + P8 fix (20260702110000). Teacher reads snapshots for actively '
  'assigned students only. Delegates to the SECURITY DEFINER helper '
  'public.is_teacher_of(student_id) (baseline:9212) instead of inlining a '
  'class_students × class_teachers × teachers subquery (20260702000200). '
  'is_teacher_of enforces cs.is_active = true AND ct.is_active = true — closes '
  'FINDING-1: ex-teachers (ct.is_active = false) and de-enrolled students '
  '(cs.is_active = false) are no longer visible. Helper inner reads bypass RLS → '
  'no TSB-4-style class_students → learner_twin_snapshots → class_students '
  'recursion cycle can form.';

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: public.learner_twin_memory
-- ═════════════════════════════════════════════════════════════════════════════

-- (b) Student reads own memory rows.
--     Fix XC-3: scalar subquery replaces IN(SELECT … FROM students …).
DROP POLICY IF EXISTS learner_twin_memory_student_select
  ON public.learner_twin_memory;

CREATE POLICY learner_twin_memory_student_select
  ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING (
    student_id = (
      SELECT id FROM public.students
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

COMMENT ON POLICY learner_twin_memory_student_select
  ON public.learner_twin_memory IS
  'XC-3 drain (20260702110000). Student reads own memory rows. '
  'Scalar subquery (= LIMIT 1) replaces the original IN(SELECT s.id FROM students …) '
  'form (20260702000300). Identical effective boundary: students.auth_user_id = '
  'auth.uid(). No multi-table JOIN over a second RLS-enabled table; no latent '
  'recursion cycle.';

-- (c) Linked guardian reads child memory rows.
--     Fix XC-3: delegate to SECURITY DEFINER helper is_guardian_of().
DROP POLICY IF EXISTS learner_twin_memory_parent_select
  ON public.learner_twin_memory;

CREATE POLICY learner_twin_memory_parent_select
  ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING ( public.is_guardian_of(student_id) );

COMMENT ON POLICY learner_twin_memory_parent_select
  ON public.learner_twin_memory IS
  'XC-3 drain (20260702110000). Parent/guardian reads linked child memory rows. '
  'Delegates to the SECURITY DEFINER helper public.is_guardian_of(student_id) '
  '(baseline:9181) instead of inlining a guardian_student_links × guardians subquery '
  '(20260702000300). Boundary identical: same dual-status status IN '
  '(''active'',''approved'') guard. Helper inner reads bypass RLS → no latent '
  'guardian_student_links → learner_twin_memory recursion cycle.';

-- (d) Roster teacher reads memory rows for assigned students.
--     Fix FINDING 1 (missing is_active guards) AND Fix XC-3 (inline roster JOIN).
DROP POLICY IF EXISTS learner_twin_memory_teacher_select
  ON public.learner_twin_memory;

CREATE POLICY learner_twin_memory_teacher_select
  ON public.learner_twin_memory
  FOR SELECT TO authenticated
  USING ( public.is_teacher_of(student_id) );

COMMENT ON POLICY learner_twin_memory_teacher_select
  ON public.learner_twin_memory IS
  'XC-3 drain + P8 fix (20260702110000). Teacher reads memory rows for actively '
  'assigned students only. Delegates to the SECURITY DEFINER helper '
  'public.is_teacher_of(student_id) (baseline:9212) instead of inlining a '
  'class_students × class_teachers × teachers subquery (20260702000300). '
  'is_teacher_of enforces cs.is_active = true AND ct.is_active = true — closes '
  'FINDING-1: ex-teachers (ct.is_active = false) and de-enrolled students '
  '(cs.is_active = false) are no longer visible. Helper inner reads bypass RLS → '
  'no TSB-4-style class_students → learner_twin_memory → class_students '
  'recursion cycle can form.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Student sees own twin rows:
--      SET role authenticated; SET request.jwt.claims TO '{"sub":"<student-auth-uid>"}';
--      SELECT count(*) FROM public.learner_twin_snapshots;  -- own rows only
--      SELECT count(*) FROM public.learner_twin_memory;     -- own rows only
--
-- 2. Teacher with ACTIVE class_teachers + class_students edge sees the student's rows.
--      (Run as teacher's auth session; expect > 0 for an assigned student's data.)
--
-- 3. Teacher whose ct.is_active = false (left the class) sees 0 rows for that
--    student. This is the FINDING-1 fix — previously these were visible.
--
-- 4. De-enrolled student (cs.is_active = false) data is NOT visible to the former
--    teacher. Previously visible (over-grant).
--
-- 5. Parent with an APPROVED guardian_student_links row sees the child's rows.
--    A parent with a PENDING link sees 0 rows (is_guardian_of status guard).
--
-- 6. No infinite-recursion error on any of the above queries.
