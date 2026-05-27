-- Migration: restore_rls_with_check_clauses
-- Date: 2026-05-06
-- Purpose: Migration 4 (20260408000004_fix_service_role_rls_policies) correctly
--          re-scoped service role policies from {public} to service_role, but the
--          generic recreation used `WITH CHECK (true)` for ALL operations. This is
--          correct for service_role (trusted server-side), but we also need to
--          verify that per-user INSERT/UPDATE policies have proper WITH CHECK clauses
--          so users can only write to their own rows.
--
-- This migration ensures WITH CHECK is set correctly on all user-facing
-- INSERT and UPDATE policies for high-sensitivity tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. quiz_responses — students can only INSERT their own responses
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own quiz_responses" ON public.quiz_responses;
CREATE POLICY "Students can insert own quiz_responses"
  ON public.quiz_responses FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. students — students can only UPDATE their own profile
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can update own profile" ON public.students;
CREATE POLICY "Students can update own profile"
  ON public.students FOR UPDATE TO authenticated
  USING (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. foxy_chat_messages — students can only INSERT their own messages
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own foxy messages" ON public.foxy_chat_messages;
CREATE POLICY "Students can insert own foxy messages"
  ON public.foxy_chat_messages FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. foxy_sessions — students can only INSERT their own sessions
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own foxy sessions" ON public.foxy_sessions;
CREATE POLICY "Students can insert own foxy sessions"
  ON public.foxy_sessions FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. student_learning_profiles — students can only UPDATE their own profiles
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can update own learning profiles" ON public.student_learning_profiles;
CREATE POLICY "Students can update own learning profiles"
  ON public.student_learning_profiles FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. quiz_sessions — students can only INSERT / UPDATE their own sessions
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own quiz_sessions" ON public.quiz_sessions;
CREATE POLICY "Students can insert own quiz_sessions"
  ON public.quiz_sessions FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can update own quiz_sessions" ON public.quiz_sessions;
CREATE POLICY "Students can update own quiz_sessions"
  ON public.quiz_sessions FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. topic_mastery — students can only INSERT / UPDATE their own mastery data
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own topic_mastery" ON public.topic_mastery;
CREATE POLICY "Students can insert own topic_mastery"
  ON public.topic_mastery FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can update own topic_mastery" ON public.topic_mastery;
CREATE POLICY "Students can update own topic_mastery"
  ON public.topic_mastery FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. bloom_progression — students can only INSERT / UPDATE their own data
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own bloom_progression" ON public.bloom_progression;
CREATE POLICY "Students can insert own bloom_progression"
  ON public.bloom_progression FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can update own bloom_progression" ON public.bloom_progression;
CREATE POLICY "Students can update own bloom_progression"
  ON public.bloom_progression FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. student_achievements — students can only INSERT their own achievements
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own achievements" ON public.student_achievements;
CREATE POLICY "Students can insert own achievements"
  ON public.student_achievements FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. payment_history — students can only INSERT their own payment records
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own payment_history" ON public.payment_history;
CREATE POLICY "Students can insert own payment_history"
  ON public.payment_history FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));
