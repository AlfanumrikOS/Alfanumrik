-- Migration: 20260527000009_realtime_publication_subscribe.sql
-- Phase C.6.1 follow-up to the prod-readiness plan.
-- Adds the 2 tables that ff_realtime_subscriptions_v1 (seeded in
-- 20260527000002_add_ff_realtime_subscriptions_v1.sql) gates against to the
-- supabase_realtime publication, so postgres_changes events actually flow
-- once the flag is flipped ON.
--
-- Owner: backend (realtime publication) + frontend (consumes)
-- Added: 2026-05-27
--
-- WHY THIS MIGRATION EXISTS
--   The C.6 feature flag was seeded in a prior PR but had a documented
--   precondition: "supabase_realtime publication must include
--   student_learning_profiles + classroom_poll_responses". The publication
--   currently contains ZERO tables on prod. Without this migration,
--   flipping ff_realtime_subscriptions_v1 ON would silently no-op — the
--   client hook subscribes successfully but the server never publishes any
--   row events for these tables, so onChange never fires. Dashboards would
--   then look "live" while actually still showing fetch-on-focus data.
--
-- WHAT THIS MIGRATION DOES
--   1. Ensures REPLICA IDENTITY FULL on the two tables so that UPDATE
--      events carry the full row (Supabase Realtime needs this to evaluate
--      column-level filters like `student_id=in.(...)`. Default REPLICA
--      IDENTITY only carries the PK, which would make the teacher
--      heatmap filter receive zero matches).
--   2. Adds both tables to the supabase_realtime publication via a
--      DO block that checks pg_publication_tables first, so the migration
--      is idempotent. Plain ALTER PUBLICATION ... ADD TABLE errors if
--      the table is already in the publication.
--
-- PERFORMANCE NOTE
--   REPLICA IDENTITY FULL writes the entire old row to WAL on UPDATE /
--   DELETE. For student_learning_profiles (a few thousand rows per
--   classroom, BKT-cadence updates) this is fine. classroom_poll_responses
--   only sees INSERTs from the poll voting flow — REPLICA IDENTITY FULL
--   is a no-op for INSERT but kept for consistency and future event types.
--
-- ROLLBACK
--   BEGIN;
--     ALTER PUBLICATION supabase_realtime DROP TABLE public.student_learning_profiles;
--     ALTER PUBLICATION supabase_realtime DROP TABLE public.classroom_poll_responses;
--     ALTER TABLE public.student_learning_profiles REPLICA IDENTITY DEFAULT;
--     ALTER TABLE public.classroom_poll_responses   REPLICA IDENTITY DEFAULT;
--   COMMIT;
--   ff_realtime_subscriptions_v1 is OFF by default; rolling back the
--   publication first then flipping the flag back to OFF (already its
--   default) is the safe revert order.
--
-- VERIFY POST-DEPLOY
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   -- Should include both: student_learning_profiles, classroom_poll_responses.

-- 1. REPLICA IDENTITY for UPDATE filter support ----------------------------

ALTER TABLE public.student_learning_profiles REPLICA IDENTITY FULL;
ALTER TABLE public.classroom_poll_responses  REPLICA IDENTITY FULL;

-- 2. Add tables to supabase_realtime publication (idempotent) -------------

DO $publish$
DECLARE
  v_pub_exists boolean;
  v_in_pub     boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO v_pub_exists;

  IF NOT v_pub_exists THEN
    RAISE WARNING 'Phase C.6.1: supabase_realtime publication missing — Supabase project may have it disabled. Skipping ADD TABLE.';
    RETURN;
  END IF;

  -- student_learning_profiles
  SELECT EXISTS(
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'student_learning_profiles'
  ) INTO v_in_pub;

  IF NOT v_in_pub THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.student_learning_profiles';
    RAISE NOTICE 'Phase C.6.1: added public.student_learning_profiles to supabase_realtime.';
  ELSE
    RAISE NOTICE 'Phase C.6.1: public.student_learning_profiles already in supabase_realtime — skipped.';
  END IF;

  -- classroom_poll_responses
  SELECT EXISTS(
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'classroom_poll_responses'
  ) INTO v_in_pub;

  IF NOT v_in_pub THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_poll_responses';
    RAISE NOTICE 'Phase C.6.1: added public.classroom_poll_responses to supabase_realtime.';
  ELSE
    RAISE NOTICE 'Phase C.6.1: public.classroom_poll_responses already in supabase_realtime — skipped.';
  END IF;
END $publish$;

-- 3. Verification block ----------------------------------------------------

DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename IN ('student_learning_profiles', 'classroom_poll_responses');

  IF v_count < 2 THEN
    RAISE WARNING 'Phase C.6.1: expected 2 tables in supabase_realtime, found %. Realtime subscriptions for ff_realtime_subscriptions_v1 may not fire.', v_count;
  ELSE
    RAISE NOTICE 'Phase C.6.1: supabase_realtime now publishes % of 2 required tables (OK).', v_count;
  END IF;
END $verify$;
