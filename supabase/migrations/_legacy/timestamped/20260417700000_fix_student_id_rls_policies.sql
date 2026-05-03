-- Migration: 20260417700000_fix_student_id_rls_policies.sql
-- Purpose:   Correct 6 RLS policies across 6 tables whose USING/WITH CHECK clauses
--            compared student_id to auth.uid() directly. These comparisons are
--            ALWAYS false in production because student_id holds students.id
--            (the students-table UUID), not the auth.users UUID. Result: the
--            affected tables return zero rows to authenticated students through
--            the anon/authenticated role, silently breaking multiple features
--            (BKT mastery view, Foxy tutor logs, subject enrollment lookups,
--            legacy-subject archive audit trail).
--
-- Fix:       Replace each broken predicate with the canonical join:
--              student_id IN (
--                SELECT id FROM public.students
--                WHERE auth_user_id = (SELECT auth.uid())
--              )
--            auth.uid() is wrapped in (SELECT ...) so Postgres evaluates it
--            once per query (initplan) instead of once per row — per Supabase
--            auth_rls_initplan advisor guidance.
--
-- Affected tables & origin of the broken policies:
--   1. adaptive_mastery              — from 20260408000008 (SELECT + UPDATE)
--   2. foxy_chat_messages            — from 20260408000008 (SELECT + INSERT) — duplicate/hazard
--   3. foxy_sessions                 — from 20260408000008 (SELECT)         — duplicate/hazard
--   4. ai_tutor_logs                 — from 20260325080000 (SELECT)
--   5. student_subject_enrollment    — from 20260415000001 (SELECT + ALL)
--   6. legacy_subjects_archive       — from 20260415000008 (SELECT)
--
-- NOT TOUCHED (already correct):
--   * leaderboard_snapshots — fixed by 20260408000021 (uses students.auth_user_id join).
--   * Service-role, parent, and teacher policies on all above tables remain intact.
--
-- Safety:
--   * Idempotent — DROP POLICY IF EXISTS + DO $$ ... EXCEPTION WHEN duplicate_object $$.
--   * RLS is re-asserted ENABLE (no-op if already enabled) on every affected table.
--   * No tables or columns are dropped.
--   * Only the broken student self-access policies are replaced. The separately
--     named correct policies on foxy_sessions / foxy_chat_messages (created by
--     20260408000002, e.g. foxy_sessions_student_select) are left untouched.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Safety: ensure RLS is enabled on every affected table (no-op if already).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.adaptive_mastery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foxy_chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foxy_sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tutor_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_subject_enrollment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_subjects_archive     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 1. adaptive_mastery
--    Replace broken SELECT and UPDATE policies with corrected versions.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can view own mastery"   ON public.adaptive_mastery;
DROP POLICY IF EXISTS "Students can update own mastery" ON public.adaptive_mastery;

DO $$ BEGIN
  CREATE POLICY "adaptive_mastery_student_select"
    ON public.adaptive_mastery
    FOR SELECT TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "adaptive_mastery_student_update"
    ON public.adaptive_mastery
    FOR UPDATE TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    )
    WITH CHECK (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. foxy_chat_messages
--    The canonical student SELECT policy (foxy_chat_messages_student_select,
--    created by 20260408000002) already uses the correct join and is
--    preserved. The broken duplicates from 20260408000008 are DROPPED only,
--    not recreated, to avoid multiple_permissive_policies.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can view own foxy messages"   ON public.foxy_chat_messages;
DROP POLICY IF EXISTS "Students can insert own foxy messages" ON public.foxy_chat_messages;

-- ─────────────────────────────────────────────────────────────
-- 3. foxy_sessions
--    Same pattern as foxy_chat_messages — canonical policy
--    foxy_sessions_student_select is already correct.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can view own foxy sessions" ON public.foxy_sessions;

-- ─────────────────────────────────────────────────────────────
-- 4. ai_tutor_logs
--    Only student policy on this table is broken — must be replaced,
--    not simply dropped, or students lose all read access.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can view own tutor logs" ON public.ai_tutor_logs;

DO $$ BEGIN
  CREATE POLICY "ai_tutor_logs_student_select"
    ON public.ai_tutor_logs
    FOR SELECT TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. student_subject_enrollment
--    sse_read_own (SELECT) and sse_write_own (ALL) both broken.
--    Replace with corrected SELECT + ALL policies covering student self.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sse_read_own  ON public.student_subject_enrollment;
DROP POLICY IF EXISTS sse_write_own ON public.student_subject_enrollment;

DO $$ BEGIN
  CREATE POLICY sse_read_own
    ON public.student_subject_enrollment
    FOR SELECT TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY sse_write_own
    ON public.student_subject_enrollment
    FOR ALL TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    )
    WITH CHECK (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 6. legacy_subjects_archive
--    lsa_read_own (SELECT) broken. Writes remain service-role only
--    (no INSERT/UPDATE/DELETE policy => blocked for authenticated).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS lsa_read_own ON public.legacy_subjects_archive;

DO $$ BEGIN
  CREATE POLICY lsa_read_own
    ON public.legacy_subjects_archive
    FOR SELECT TO authenticated
    USING (
      student_id IN (
        SELECT id FROM public.students
        WHERE auth_user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- Post-migration verification (run manually; expected count = 0):
--   SELECT tablename, policyname, qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'adaptive_mastery','foxy_chat_messages','foxy_sessions',
--       'ai_tutor_logs','student_subject_enrollment','legacy_subjects_archive'
--     )
--     AND qual LIKE '%student_id = auth.uid()%';
-- ─────────────────────────────────────────────────────────────
