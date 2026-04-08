-- Migration: fix_security_definer_view_and_rls_initplan
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: (1) Drop SECURITY DEFINER from admin view (unnecessary privilege escalation)
--          (2) Fix RLS policies calling bare auth.uid() to use (SELECT auth.uid())
--              to prevent per-row re-evaluation (auth_rls_initplan advisor finding)

-- ── 1. Recreate admin view as SECURITY INVOKER (default) ─────────────────────
-- Callers must have SELECT privilege on underlying tables — correct behaviour.
DROP VIEW IF EXISTS public.admin_question_verification_status;

CREATE VIEW public.admin_question_verification_status AS
SELECT
  qb.id,
  qb.subject,
  qb.grade,
  qb.difficulty,
  qb.bloom_level,
  qb.is_verified,
  qb.is_active,
  qb.source,
  qb.created_at
FROM public.question_bank qb;

-- ── 2. Fix per-row auth.uid() evaluation on high-traffic tables ───────────────
-- Before: USING (student_id = auth.uid())         — evaluated per row
-- After:  USING (student_id = (SELECT auth.uid())) — evaluated once per query

-- adaptive_mastery (student owns their BKT state)
DROP POLICY IF EXISTS "Students can view own mastery" ON public.adaptive_mastery;
CREATE POLICY "Students can view own mastery"
  ON public.adaptive_mastery FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can update own mastery" ON public.adaptive_mastery;
CREATE POLICY "Students can update own mastery"
  ON public.adaptive_mastery FOR UPDATE TO authenticated
  USING (student_id = (SELECT auth.uid()));

-- foxy_chat_messages
DROP POLICY IF EXISTS "Students can view own foxy messages" ON public.foxy_chat_messages;
CREATE POLICY "Students can view own foxy messages"
  ON public.foxy_chat_messages FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can insert own foxy messages" ON public.foxy_chat_messages;
CREATE POLICY "Students can insert own foxy messages"
  ON public.foxy_chat_messages FOR INSERT TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- foxy_sessions
DROP POLICY IF EXISTS "Students can view own foxy sessions" ON public.foxy_sessions;
CREATE POLICY "Students can view own foxy sessions"
  ON public.foxy_sessions FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));
