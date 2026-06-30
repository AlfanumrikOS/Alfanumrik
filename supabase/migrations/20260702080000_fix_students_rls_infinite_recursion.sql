-- Migration: 20260702080000_fix_students_rls_infinite_recursion.sql
-- Purpose: P8 PRODUCTION INCIDENT FIX — stop "infinite recursion detected in
--          policy for relation students" that breaks EVERY authenticated client
--          read of public.students (dashboard, get_mastery_overview, profile reads).
--
-- ─── Root cause (confirmed) ──────────────────────────────────────────────────
-- Migration 20260702010000_teacher_assigned_students_rls.sql (TSB-4) added the
-- PERMISSIVE policy "Teachers can view students in their classes" ON public.students
-- FOR SELECT whose USING clause INLINES a subquery over public.class_students:
--
--     id IN ( SELECT cs.student_id
--             FROM public.class_students cs
--             JOIN public.class_teachers ct ON ct.class_id = cs.class_id
--             JOIN public.teachers       t  ON t.id        = ct.teacher_id
--             WHERE t.auth_user_id = auth.uid()
--               AND cs.is_active = true
--               AND ct.is_active = true )
--
-- That inline subquery reads public.class_students as SECURITY INVOKER, so
-- class_students' OWN RLS policies evaluate — including the baseline policy
-- "Students can view own enrollment" ON public.class_students
-- (00000000000000_baseline_from_prod.sql:20107) whose USING clause reads
-- public.students back. The result is a cycle:
--
--     students  →  class_students  →  students  →  class_students  →  …
--
-- and PostgreSQL aborts the SELECT with
-- "infinite recursion detected in policy for relation students".
--
-- ─── Why the fix ends the recursion ──────────────────────────────────────────
-- The pre-existing baseline policy "students_select_merged" ON public.students
-- (baseline:22309) ALREADY provides the same teacher boundary via the helper
-- public.is_teacher_of(id) — a SECURITY DEFINER function (baseline:9212) whose
-- inner reads of class_students/class_teachers/teachers BYPASS RLS. Because those
-- inner reads do not re-enter the RLS evaluator, there is no students → class_students
-- edge to close, so the cycle cannot form. The TSB-4 inline policy was redundant
-- defense-in-depth that reintroduced exactly the cycle the is_teacher_of
-- indirection was designed to avoid.
--
-- This migration:
--   1. DROPs the recursive inline policy.
--   2. RECREATEs the SAME discoverably-named teacher backstop
--      ("Teachers can view students in their classes") but NON-RECURSIVELY, by
--      delegating to the SECURITY DEFINER helper public.is_teacher_of(id) instead
--      of inlining the class_students join. This preserves TSB-2's intent (a
--      discoverable "Teachers can …"-named policy on public.students that a future
--      reviewer/grep will find) without the cycle.
--
-- ─── Why the teacher boundary is UNCHANGED (no over/under-grant) ─────────────
-- public.is_teacher_of(uuid) (baseline:9212, SECURITY DEFINER, STABLE,
-- SET search_path = public) returns:
--     EXISTS( SELECT 1
--             FROM class_students cs
--             JOIN class_teachers ct ON ct.class_id = cs.class_id
--             JOIN teachers       t  ON t.id        = ct.teacher_id
--             WHERE cs.student_id = p_student_id
--               AND t.auth_user_id = auth.uid()
--               AND cs.is_active = true
--               AND ct.is_active = true );
-- This is the IDENTICAL roster join (same tables, same is_active guards, same
-- auth.uid() → teachers.auth_user_id resolution) as both (a) the dropped inline
-- predicate and (b) the is_teacher_of(id) branch already inside
-- students_select_merged. So `is_teacher_of(id)` yields the EXACT same set of
-- visible student rows for a teacher — no row becomes newly visible, none is
-- removed. The only behavioural delta is that the read no longer recurses.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: DROP POLICY IF EXISTS … ; CREATE POLICY … — safe to re-run.
--   * Additive: touches ONLY this one named policy. Does NOT alter
--     students_select_merged, any class_students policy, RLS enablement on any
--     table, RBAC roles/permissions, the is_teacher_of helper, or any data.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN. No SECURITY DEFINER
--     introduced here (the policy expression simply CALLS an existing helper).
--   * Migration ordering: timestamp 20260702080000 is AFTER 20260702010000
--     (which CREATEs the recursive policy) and after the current latest
--     20260702070000. On a FRESH database the chain runs 010000 (creates
--     recursive) → 080000 (DROP + CREATE non-recursive), ending on the
--     non-recursive version. On PROD (recursive policy currently live) this
--     migration DROPs and replaces it in place. Both paths converge to the same
--     correct, non-recursive end state.
--   * Rollback: re-running 20260702010000 would reintroduce the recursion; do NOT.
--     The correct rollback is to keep this version (or, at minimum, DROP the named
--     policy entirely — students_select_merged's is_teacher_of(id) branch already
--     covers the teacher boundary non-recursively).

BEGIN;

-- 1. Remove the recursive inline policy (the cause of the cycle).
DROP POLICY IF EXISTS "Teachers can view students in their classes"
  ON public.students;

-- 2. Recreate the same discoverably-named teacher backstop NON-RECURSIVELY via
--    the SECURITY DEFINER helper, whose inner reads bypass RLS (no students →
--    class_students → students cycle). Predicate is the identical effective
--    teacher boundary as the dropped inline policy and as students_select_merged's
--    is_teacher_of(id) branch — so it is additive (PERMISSIVE OR) and cannot
--    over- or under-grant.
CREATE POLICY "Teachers can view students in their classes"
  ON public.students
  FOR SELECT
  TO authenticated
  USING ( public.is_teacher_of(id) );

COMMENT ON POLICY "Teachers can view students in their classes" ON public.students IS
  'P8 incident fix (20260702080000). Discoverable teacher-assigned SELECT '
  'backstop, NON-RECURSIVE: delegates to the SECURITY DEFINER helper '
  'public.is_teacher_of(id) (baseline:9212) instead of inlining a class_students '
  'join. Inlining (TSB-4, 20260702010000) caused students → class_students → '
  'students RLS recursion via the baseline "Students can view own enrollment" '
  'policy on class_students. is_teacher_of bypasses RLS on its inner reads, so '
  'no cycle forms. The predicate is the IDENTICAL roster boundary '
  '(class_students join class_teachers join teachers, both is_active = true, '
  'auth.uid() → teachers.auth_user_id) as the dropped inline policy and as the '
  'is_teacher_of(id) branch of students_select_merged — additive PERMISSIVE OR, '
  'no over/under-grant.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. Recursion is gone — any authenticated student reading their own row:
--      SELECT id FROM public.students WHERE auth_user_id = auth.uid();
--      -- expect: 1 row, NO "infinite recursion" error.
-- 2. Teacher boundary preserved — as an assigned teacher (active class_teachers
--    row whose class has the student via an active class_students row):
--      SELECT id FROM public.students WHERE id = '<assigned-student-uuid>';
--      -- expect: 1 row.
-- 3. No over-grant — as a teacher with NO active assignment to that student:
--      SELECT id FROM public.students WHERE id = '<non-assigned-student-uuid>';
--      -- expect: 0 rows (RLS hides it).
