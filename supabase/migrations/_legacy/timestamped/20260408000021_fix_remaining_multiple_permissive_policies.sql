-- Migration: fix_remaining_multiple_permissive_policies
-- Applied: 2026-04-08
-- Purpose: Eliminate all remaining multiple_permissive_policies after migration 000020.
--
-- Patterns fixed:
--   A) Merge student+teacher+guardian SELECT into one policy (chapter_progress, students)
--   B) Merge guardian+teacher SELECT into one (7 tables with existing ALL student policy)
--   C) Merge 2 SELECT into 1 (leaderboard_snapshots, teachers)
--
-- Net result: 0 tables with multiple permissive policies on same (table, role, cmd).
-- All changes idempotent via DROP IF EXISTS + CREATE.

-- ─────────────────────────────────────────────────────────────
-- 1. leaderboard_snapshots: merge 2 SELECT (authenticated) → 1
--    Old: "Students read own leaderboard row" + "Students read grade leaderboard"
--    New: single policy covers own row OR same grade (leaderboard display)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students read own leaderboard row" ON public.leaderboard_snapshots;
DROP POLICY IF EXISTS "Students read grade leaderboard" ON public.leaderboard_snapshots;
DROP POLICY IF EXISTS "leaderboard_snapshots_student_select" ON public.leaderboard_snapshots;

CREATE POLICY "leaderboard_snapshots_student_select" ON public.leaderboard_snapshots
  FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid()))
    OR grade = (SELECT s.grade FROM public.students s WHERE s.auth_user_id = (SELECT auth.uid()) LIMIT 1)
  );

-- ─────────────────────────────────────────────────────────────
-- 2. students: merge 3 SELECT (public) → 1
--    student sees own row + teacher sees their students + guardian sees their wards
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "students_select_own" ON public.students;
DROP POLICY IF EXISTS "students_select_teacher" ON public.students;
DROP POLICY IF EXISTS "students_select_guardian" ON public.students;

CREATE POLICY "students_select_merged" ON public.students
  FOR SELECT
  USING (
    auth_user_id = (SELECT auth.uid())
    OR is_teacher_of(id)
    OR is_guardian_of(id)
  );

-- ─────────────────────────────────────────────────────────────
-- 3. chapter_progress: merge 3 SELECT (public) → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cp_student_select" ON public.chapter_progress;
DROP POLICY IF EXISTS "cp_teacher_select" ON public.chapter_progress;
DROP POLICY IF EXISTS "cp_parent_select" ON public.chapter_progress;

CREATE POLICY "cp_select_merged" ON public.chapter_progress
  FOR SELECT
  USING (
    student_id IN (SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid()))
    OR student_id IN (
      SELECT cs.student_id FROM class_students cs
      JOIN class_teachers ct ON ct.class_id = cs.class_id
      JOIN teachers t ON t.id = ct.teacher_id
      WHERE t.auth_user_id = (SELECT auth.uid())
    )
    OR student_id IN (
      SELECT gsl.student_id FROM guardian_student_links gsl
      JOIN guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = (SELECT auth.uid()) AND gsl.status = 'approved'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 4. teachers: merge 2 SELECT (public) → 1
--    own row OR any authenticated user (public teacher directory)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "teachers_select_own" ON public.teachers;
DROP POLICY IF EXISTS "teachers_select_public_info" ON public.teachers;

CREATE POLICY "teachers_select_merged" ON public.teachers
  FOR SELECT
  USING (
    auth_user_id = (SELECT auth.uid())
    OR auth.role() = 'authenticated'
  );

-- ─────────────────────────────────────────────────────────────
-- 5. concept_mastery: merge guardian+teacher SELECT → 1
--    (ALL policy for student remains — handles student write access)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cm_guardian_read" ON public.concept_mastery;
DROP POLICY IF EXISTS "cm_teacher_read" ON public.concept_mastery;

CREATE POLICY "cm_readonly_others" ON public.concept_mastery
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- 6. spaced_repetition_cards: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "src_guardian_read" ON public.spaced_repetition_cards;
DROP POLICY IF EXISTS "src_teacher_read" ON public.spaced_repetition_cards;

CREATE POLICY "src_readonly_others" ON public.spaced_repetition_cards
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- 7. student_learning_profiles: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "slp_guardian_read" ON public.student_learning_profiles;
DROP POLICY IF EXISTS "slp_teacher_read" ON public.student_learning_profiles;

CREATE POLICY "slp_readonly_others" ON public.student_learning_profiles
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- 8. student_simulation_progress: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ssp_guardian_read" ON public.student_simulation_progress;
DROP POLICY IF EXISTS "ssp_teacher_read" ON public.student_simulation_progress;

CREATE POLICY "ssp_readonly_others" ON public.student_simulation_progress
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- 9. study_plan_tasks: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "spt_guardian_read" ON public.study_plan_tasks;
DROP POLICY IF EXISTS "spt_teacher_read" ON public.study_plan_tasks;

CREATE POLICY "spt_readonly_others" ON public.study_plan_tasks
  FOR SELECT
  USING (
    plan_id IN (SELECT id FROM public.study_plans WHERE is_guardian_of(student_id))
    OR plan_id IN (SELECT id FROM public.study_plans WHERE is_teacher_of(student_id))
  );

-- ─────────────────────────────────────────────────────────────
-- 10. study_plans: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sp_guardian_read" ON public.study_plans;
DROP POLICY IF EXISTS "sp_teacher_read" ON public.study_plans;

CREATE POLICY "sp_readonly_others" ON public.study_plans
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- 11. topic_mastery: merge guardian+teacher SELECT → 1
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tm_guardian_read" ON public.topic_mastery;
DROP POLICY IF EXISTS "tm_teacher_read" ON public.topic_mastery;

CREATE POLICY "tm_readonly_others" ON public.topic_mastery
  FOR SELECT
  USING (is_guardian_of(student_id) OR is_teacher_of(student_id));

-- ─────────────────────────────────────────────────────────────
-- Verification (run manually):
-- SELECT count(*) FROM (
--   SELECT tablename, cmd, roles FROM pg_policies
--   WHERE schemaname='public' AND permissive='PERMISSIVE'
--   GROUP BY tablename, cmd, roles HAVING count(*) > 1
-- ) x;
-- Expected: 0
-- ─────────────────────────────────────────────────────────────
