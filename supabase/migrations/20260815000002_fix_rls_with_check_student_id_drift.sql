-- Migration: 20260815000002_fix_rls_with_check_student_id_drift.sql
-- Purpose: 20260506000003_restore_rls_with_check_clauses.sql intended to
-- harden INSERT/UPDATE WITH CHECK clauses on 10 high-sensitivity tables, but
-- used `student_id = (SELECT auth.uid())` on 9 of them. `student_id` on
-- every one of these tables is a FK into students.id (a surrogate UUID),
-- never the auth.users.id (`auth.uid()`) -- so that predicate can never be
-- satisfied and the policy it created is permanently unsatisfiable dead
-- weight (`students` itself, item 2 in that migration, correctly used
-- auth_user_id = auth.uid() and is not touched here).
--
-- This has not been an outage because every affected table also carries a
-- separate, correctly-scoped ALL-operations "<table>_own" policy (or, for
-- bloom_progression/foxy_sessions, correctly-scoped dedicated INSERT/UPDATE
-- policies) created by earlier migrations -- Postgres OR's multiple
-- permissive policies together, so the good policy alone has kept writes
-- working. But the broken policy is a live landmine: if the good policy is
-- ever dropped/renamed by a future migration (e.g. a well-meaning "dedupe
-- redundant policies" cleanup that doesn't realize the surviving one is the
-- unsatisfiable one), writes silently break with no code change on the
-- app side. It is also a confusing false signal for anyone auditing RLS
-- coverage on these tables. This migration replaces each broken policy
-- (same name, so it is a direct fix of the specific migration that
-- introduced it, not a new parallel policy) with the same satisfiable
-- predicate already proven correct elsewhere in the schema for that table.
--
-- Deferred: payment_history (item 10 in 20260506000003) has the same
-- `student_id = (SELECT auth.uid())` bug on "Students can insert own
-- payment_history", but that table has no separate correctly-scoped
-- policy backing it up today (unlike the 8 tables fixed below) and all
-- production payment-record inserts go through supabase-admin
-- (service_role, which bypasses RLS via the service-role policy on that
-- table) per P11 -- backend/architect need to confirm no authenticated-role
-- write path depends on this policy before it is touched, so it is left
-- out of this migration and tracked separately rather than changed here
-- without that confirmation.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. quiz_responses (INSERT) -- get_my_student_id() form, matching the
--    coexisting correct "quiz_responses_own" ALL-ops policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own quiz_responses" ON public.quiz_responses;
CREATE POLICY "Students can insert own quiz_responses"
  ON public.quiz_responses FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. foxy_chat_messages (INSERT) -- get_my_student_id() form, matching the
--    coexisting correct "Students write own foxy messages" policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own foxy messages" ON public.foxy_chat_messages;
CREATE POLICY "Students can insert own foxy messages"
  ON public.foxy_chat_messages FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. foxy_sessions (INSERT + UPDATE) -- get_my_student_id() form. The original
--    draft of this migration matched the inline `students` subquery form these
--    two policies already carried (from an earlier, independently-reviewed
--    migration) rather than the helper form used by the other 6 tables below.
--    P8 review (RLS no-cross-table-recursion guard, apps/host/src/__tests__/
--    rls-no-cross-table-recursion.test.ts) flagged that as a fresh violation on
--    re-creation: every NEW/RENAMED policy is checked against the current
--    frozen ledger regardless of what it replaces, and only "Students can
--    update own foxy sessions" happened to already be grandfathered there --
--    "Students can insert own foxy sessions" was not, so recreating it inline
--    pushed the detector from 225 to +1 new offender. Both are switched to
--    public.get_my_student_id() (SECURITY DEFINER; baseline_from_prod.sql)
--    here for consistency with the other 6 tables and to close the INSERT
--    offender; see the matching ledger prune in
--    rls-no-cross-table-recursion.test.ts for the UPDATE side (225 -> 224).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own foxy sessions" ON public.foxy_sessions;
CREATE POLICY "Students can insert own foxy sessions"
  ON public.foxy_sessions FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "Students can update own foxy sessions" ON public.foxy_sessions;
CREATE POLICY "Students can update own foxy sessions"
  ON public.foxy_sessions FOR UPDATE TO authenticated
  USING (student_id = public.get_my_student_id())
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. student_learning_profiles (UPDATE) -- get_my_student_id() form,
--    matching the coexisting correct "learning_profiles_own" ALL-ops policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can update own learning profiles" ON public.student_learning_profiles;
CREATE POLICY "Students can update own learning profiles"
  ON public.student_learning_profiles FOR UPDATE TO authenticated
  USING (student_id = public.get_my_student_id())
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. quiz_sessions (INSERT + UPDATE) -- get_my_student_id() form, matching
--    the coexisting correct "quiz_sessions_own" ALL-ops policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own quiz_sessions" ON public.quiz_sessions;
CREATE POLICY "Students can insert own quiz_sessions"
  ON public.quiz_sessions FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "Students can update own quiz_sessions" ON public.quiz_sessions;
CREATE POLICY "Students can update own quiz_sessions"
  ON public.quiz_sessions FOR UPDATE TO authenticated
  USING (student_id = public.get_my_student_id())
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. topic_mastery (INSERT + UPDATE) -- get_my_student_id() form, matching
--    the coexisting correct "topic_mastery_own" ALL-ops policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own topic_mastery" ON public.topic_mastery;
CREATE POLICY "Students can insert own topic_mastery"
  ON public.topic_mastery FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "Students can update own topic_mastery" ON public.topic_mastery;
CREATE POLICY "Students can update own topic_mastery"
  ON public.topic_mastery FOR UPDATE TO authenticated
  USING (student_id = public.get_my_student_id())
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. bloom_progression (INSERT + UPDATE) -- get_my_student_id() form. Same P8
--    review finding as foxy_sessions above: the original draft matched the
--    inline `auth.uid() IN (SELECT ... FROM students ...)` form of the
--    coexisting "bloom_own_insert"/"bloom_own_update" policies, but neither of
--    THESE two policy names was already grandfathered in the recursion-guard
--    ledger, so both were fresh offenders on re-creation. `student_id =
--    public.get_my_student_id()` is the equivalent boundary (get_my_student_id()
--    returns the caller's own students.id via SECURITY DEFINER, so its inner
--    read bypasses RLS -- same intent as `auth.uid() IN (SELECT auth_user_id
--    FROM students WHERE id = student_id)`, just delegated instead of inlined).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own bloom_progression" ON public.bloom_progression;
CREATE POLICY "Students can insert own bloom_progression"
  ON public.bloom_progression FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

DROP POLICY IF EXISTS "Students can update own bloom_progression" ON public.bloom_progression;
CREATE POLICY "Students can update own bloom_progression"
  ON public.bloom_progression FOR UPDATE TO authenticated
  USING (student_id = public.get_my_student_id())
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. student_achievements (INSERT) -- get_my_student_id() form, matching
--    the coexisting correct "student_achievements_own" ALL-ops policy.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students can insert own achievements" ON public.student_achievements;
CREATE POLICY "Students can insert own achievements"
  ON public.student_achievements FOR INSERT TO authenticated
  WITH CHECK (student_id = public.get_my_student_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. payment_history -- DEFERRED, see header comment. Not touched by this
--    migration pending backend/architect confirmation of write paths.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;
