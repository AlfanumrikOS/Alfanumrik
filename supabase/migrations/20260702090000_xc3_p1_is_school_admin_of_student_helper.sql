-- Migration: 20260702090000_xc3_p1_is_school_admin_of_student_helper.sql
-- Purpose: XC-3 Phase 1 — close the LAST latent inline cross-table edge on the
--          apex public.students table. Refactor the policy
--          "School admins can view school students" from an inline
--          FROM public.school_admins subquery to a SECURITY DEFINER helper
--          (public.is_school_admin_of_student(uuid)), per the binding RS-RULE
--          (plan docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md
--          §4 Phase 1 + §2.3): no policy may inline a FROM/JOIN over a DIFFERENT
--          RLS-enabled table; cross-table checks delegate to a SECURITY DEFINER
--          helper whose inner reads bypass RLS.
--
-- ─── What this closes (plan §2.3 line 76) ────────────────────────────────────
-- The baseline policy (00000000000000_baseline_from_prod.sql:19906):
--
--   CREATE POLICY "School admins can view school students" ON public.students
--     FOR SELECT TO authenticated
--     USING ( school_id IN ( SELECT sa.school_id
--                            FROM public.school_admins sa
--                            WHERE sa.auth_user_id = auth.uid()
--                              AND sa.is_active = true ) );
--
-- INLINES a SECURITY-INVOKER subquery over public.school_admins (a different
-- RLS-enabled table) directly inside a policy ON public.students. It is the LAST
-- latent inline edge on the apex table. It is safe ONLY while school_admins has no
-- policy that reads students back (today school_admins self-scopes via auth.uid()).
-- The moment a school_admins policy were to read students, this edge would close a
-- TSB-4-style students → school_admins → students recursion cycle. Refactoring it to
-- a SECURITY DEFINER helper removes the latent edge permanently.
--
-- ─── Why the boundary is EXACTLY preserved (no over/under-grant) ─────────────
-- The inline predicate makes a student row visible iff the student's school_id is
-- one of the schools where the caller (auth.uid()) is an ACTIVE school_admin.
-- public.is_school_admin_of_student(p_student_id) returns EXISTS over the SAME join:
--   resolve the student's school_id from students, then check the caller is an
--   active row in school_admins for that school — same tables, same
--   sa.auth_user_id = auth.uid() resolution, same sa.is_active = true guard, same
--   school-scoping (students.school_id = school_admins.school_id). NULL students
--   school_id matches no school_admins row in both forms (NULL IN (…) and the
--   equi-join are both non-matching), so a student with no school stays invisible
--   in both. The set of visible student rows is therefore IDENTICAL — no row
--   becomes newly visible, none is removed. The only behavioural delta is that the
--   cross-table read now runs inside a SECURITY DEFINER function.
--
-- ─── Why NO recursion (SECURITY DEFINER) ─────────────────────────────────────
-- is_school_admin_of_student is SECURITY DEFINER, so its inner reads of BOTH
-- public.students and public.school_admins BYPASS RLS — they do not re-enter the
-- RLS policy evaluator. There is therefore no students → (helper-internal) →
-- students edge and no students → school_admins edge in the RLS graph: the cycle
-- the inline form could close cannot form. This mirrors the established pattern of
-- is_teacher_of / is_guardian_of / is_school_admin_of (baseline:9197-9228) and the
-- 20260702080000 teacher-policy fix.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Idempotent: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS + CREATE
--     POLICY — safe to re-run. On a fresh DB the chain runs the baseline (inline
--     form) then this migration (DROP + CREATE helper form), ending on the helper
--     form. On prod (inline form live) this DROPs and replaces it in place. Both
--     paths converge to the same non-inline end state.
--   * Additive boundary equivalence: same visible-row set; this is NOT an RBAC
--     change (no role/permission added or removed) and NOT a data change.
--   * No destructive DDL: no DROP TABLE / DROP COLUMN. Touches only this one named
--     policy and adds one helper function.
--   * SECURITY DEFINER justification (required by architect rules): the helper MUST
--     bypass RLS on its inner reads of students + school_admins to (a) preserve the
--     exact cross-table boundary and (b) avoid re-entering the students/school_admins
--     RLS evaluator (the recursion the refactor exists to prevent). STABLE +
--     SET search_path = public scope it safely; it only ever returns a boolean for
--     the supplied student id and never widens access beyond the inline form.
--   * Rollback: re-create the inline policy form (or simply DROP the named policy —
--     students_select_merged's student-own/teacher/guardian net still covers the
--     non-admin paths). The helper can remain; it is inert unless a policy calls it.

BEGIN;

-- 1. SECURITY DEFINER helper — EXISTS over the SAME join the inline policy used:
--    student's school_id (from students) matched against an ACTIVE school_admins row
--    for the caller (auth.uid()). Inner reads bypass RLS → no recursion.
-- rls-helper
CREATE OR REPLACE FUNCTION public.is_school_admin_of_student(p_student_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM students s
    JOIN school_admins sa ON sa.school_id = s.school_id
    WHERE s.id = p_student_id
      AND sa.auth_user_id = auth.uid()
      AND sa.is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_school_admin_of_student(uuid) IS
  'XC-3 Phase 1 (20260702090000). SECURITY DEFINER RLS helper [rls-helper]. '
  'Returns true iff the caller (auth.uid()) is an ACTIVE school_admin of the '
  'school the given student belongs to. EXACT boundary equivalent of the former '
  'inline "School admins can view school students" predicate (students.school_id IN '
  '(SELECT sa.school_id FROM school_admins sa WHERE sa.auth_user_id = auth.uid() AND '
  'sa.is_active = true)) — same tables, same school-scoping, same is_active guard, '
  'same NULL-school_id non-match — so no over/under-grant. SECURITY DEFINER so the '
  'inner reads of students + school_admins BYPASS RLS: closes the last latent inline '
  'cross-table edge on the apex students table without forming a recursion cycle.';

-- 2. Replace the inline policy with the helper-delegating form (NO inline subquery).
DROP POLICY IF EXISTS "School admins can view school students" ON public.students;

CREATE POLICY "School admins can view school students"
  ON public.students
  FOR SELECT
  TO authenticated
  USING ( public.is_school_admin_of_student(id) );

COMMENT ON POLICY "School admins can view school students" ON public.students IS
  'XC-3 Phase 1 (20260702090000). School-admin SELECT boundary on students, '
  'NON-INLINE: delegates to the SECURITY DEFINER helper '
  'public.is_school_admin_of_student(id) instead of inlining a FROM school_admins '
  'subquery (baseline:19906). Identical visible-row set (same school-scoping + '
  'is_active guard); the helper bypasses RLS on its inner reads so no '
  'students → school_admins → students recursion can form. Closes the last latent '
  'inline cross-table edge on the apex students table (plan §2.3).';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. As an ACTIVE school_admin of school X, a student of school X is visible:
--      SELECT id FROM public.students WHERE id = '<student-in-school-X>';  -- 1 row
-- 2. As that admin, a student of a DIFFERENT school is NOT visible:
--      SELECT id FROM public.students WHERE id = '<student-in-school-Y>';  -- 0 rows
-- 3. As an INACTIVE school_admin (is_active = false), no school students visible:
--      SELECT count(*) FROM public.students;  -- excludes school-admin-only rows
-- 4. No recursion: any authenticated read of students returns without the
--    "infinite recursion detected in policy for relation students" error.
