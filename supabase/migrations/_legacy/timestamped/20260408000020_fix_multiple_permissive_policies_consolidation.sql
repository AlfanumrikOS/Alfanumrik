-- Migration: fix_multiple_permissive_policies_consolidation
-- Applied: 2026-04-08
-- Purpose: Eliminate 461 multiple_permissive_policies flagged by Supabase advisor.
--   Multiple permissive policies on same (table, role, cmd) are OR'd on every row read,
--   causing unnecessary plan overhead. This migration:
--   1. Drops pure service_role duplicate policies (identical qual=true, different name)
--   2. Drops public/authenticated duplicate SELECT policies
--   3. Drops wrong student_id = auth.uid() policies (student_id is student UUID, not auth UUID)
--   4. Merges admin_users two SELECT policies into one OR-combined policy
--   5. Fixes leaderboard_snapshots SELECT policies to use correct auth check via students table
-- NOTE: All migrations are forward-only. This migration was applied to production DB
--   before being committed to the repo. The net effect is already live.

-- ─────────────────────────────────────────────────────────────
-- 1. Pure service_role duplicate drops (qual = true, different names)
-- ─────────────────────────────────────────────────────────────

-- quiz_sessions: keep service_role_all, drop duplicate
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_sessions' AND policyname='service_role_bypass'
  ) THEN
    DROP POLICY "service_role_bypass" ON public.quiz_sessions;
  END IF;
END $$;

-- quiz_responses: drop duplicate service_role policy
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_responses' AND policyname='service_role_bypass'
  ) THEN
    DROP POLICY "service_role_bypass" ON public.quiz_responses;
  END IF;
END $$;

-- foxy_sessions: drop duplicate service_role policy
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='foxy_sessions' AND policyname='service_role_bypass'
  ) THEN
    DROP POLICY "service_role_bypass" ON public.foxy_sessions;
  END IF;
END $$;

-- foxy_chat_messages: drop duplicate service_role policy
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='foxy_chat_messages' AND policyname='service_role_bypass'
  ) THEN
    DROP POLICY "service_role_bypass" ON public.foxy_chat_messages;
  END IF;
END $$;

-- student_learning_profiles: drop duplicate service_role policy
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_learning_profiles' AND policyname='service_role_bypass'
  ) THEN
    DROP POLICY "service_role_bypass" ON public.student_learning_profiles;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Drop public/authenticated duplicate SELECT policies
-- ─────────────────────────────────────────────────────────────

-- curriculum_topics: keep primary SELECT, drop redundant everyone_read
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='curriculum_topics' AND policyname='everyone_read'
  ) THEN
    DROP POLICY "everyone_read" ON public.curriculum_topics;
  END IF;
END $$;

-- question_bank: drop redundant public SELECT
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='question_bank' AND policyname='public_read'
  ) THEN
    DROP POLICY "public_read" ON public.question_bank;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Drop student SELECT policies that used subquery variant (keep get_my_student_id version)
-- ─────────────────────────────────────────────────────────────

-- quiz_sessions: drop old student-subquery variant, keep get_my_student_id version
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_sessions' AND policyname='student_owns_sessions'
  ) THEN
    DROP POLICY "student_owns_sessions" ON public.quiz_sessions;
  END IF;
END $$;

-- quiz_responses: drop old subquery variant
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_responses' AND policyname='student_owns_responses'
  ) THEN
    DROP POLICY "student_owns_responses" ON public.quiz_responses;
  END IF;
END $$;

-- foxy_sessions: drop old subquery variant
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='foxy_sessions' AND policyname='student_owns_foxy_sessions'
  ) THEN
    DROP POLICY "student_owns_foxy_sessions" ON public.foxy_sessions;
  END IF;
END $$;

-- foxy_chat_messages: drop old subquery variant
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='foxy_chat_messages' AND policyname='student_owns_messages'
  ) THEN
    DROP POLICY "student_owns_messages" ON public.foxy_chat_messages;
  END IF;
END $$;

-- student_learning_profiles: drop old subquery variant
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_learning_profiles' AND policyname='student_owns_profile'
  ) THEN
    DROP POLICY "student_owns_profile" ON public.student_learning_profiles;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Drop WRONG policies: student_id = auth.uid()
--    (student_id is student UUID from students table, NOT auth UUID)
-- ─────────────────────────────────────────────────────────────

-- offline_pending_responses
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='offline_pending_responses' AND policyname='student_owns_offline'
  ) THEN
    DROP POLICY "student_owns_offline" ON public.offline_pending_responses;
  END IF;
END $$;

-- practice_session_log
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='practice_session_log' AND policyname='student_owns_practice'
  ) THEN
    DROP POLICY "student_owns_practice" ON public.practice_session_log;
  END IF;
END $$;

-- student_competency_scores
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_competency_scores' AND policyname='student_owns_competency'
  ) THEN
    DROP POLICY "student_owns_competency" ON public.student_competency_scores;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Drop quiz_sessions guardian subset policy
--    (guardian_view_quiz already covers student+guardian+teacher with broader USING)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_sessions' AND policyname='qs_guardian_read'
  ) THEN
    DROP POLICY "qs_guardian_read" ON public.quiz_sessions;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 6. Merge admin_users two SELECT policies into one OR-combined policy
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_users' AND policyname='admin_users_select_self'
  ) THEN
    DROP POLICY "admin_users_select_self" ON public.admin_users;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_users' AND policyname='admin_users_select_admins'
  ) THEN
    DROP POLICY "admin_users_select_admins" ON public.admin_users;
  END IF;
END $$;

-- Create merged single SELECT policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_users' AND policyname='admin_users_select_merged'
  ) THEN
    CREATE POLICY "admin_users_select_merged" ON public.admin_users
      FOR SELECT TO authenticated
      USING (
        auth.uid() = auth_user_id
        OR auth.uid() IN (
          SELECT auth_user_id FROM public.admin_users WHERE is_active = true
        )
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. Fix leaderboard_snapshots SELECT policies
--    Both old policies used student_id = auth.uid() — WRONG.
--    student_id is student UUID; must join via students.auth_user_id.
-- ─────────────────────────────────────────────────────────────

-- Drop broken policies
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leaderboard_snapshots' AND policyname='student_can_read_own_snapshot'
  ) THEN
    DROP POLICY "student_can_read_own_snapshot" ON public.leaderboard_snapshots;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leaderboard_snapshots' AND policyname='student_read_leaderboard'
  ) THEN
    DROP POLICY "student_read_leaderboard" ON public.leaderboard_snapshots;
  END IF;
END $$;

-- Create single correct SELECT policy
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leaderboard_snapshots' AND policyname='leaderboard_snapshots_student_select'
  ) THEN
    CREATE POLICY "leaderboard_snapshots_student_select" ON public.leaderboard_snapshots
      FOR SELECT TO authenticated
      USING (
        student_id IN (
          SELECT id FROM public.students WHERE auth_user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Verification: count remaining policy duplicates
-- (Run manually to confirm reduction)
-- SELECT tablename, cmd, roles, count(*) as policy_count
-- FROM pg_policies
-- WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
-- GROUP BY tablename, cmd, roles
-- HAVING count(*) > 1
-- ORDER BY policy_count DESC, tablename;
-- ─────────────────────────────────────────────────────────────
