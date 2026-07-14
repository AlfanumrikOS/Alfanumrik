-- Migration: 20260715120000_learning_events_add_student_pk.sql
-- Purpose: Add a nullable students.id join key to public.learning_events so
--          the event log can join to learner-state tables (which key on
--          students.id) WITHOUT disturbing the existing student_id = auth.uid()
--          column, its FK to auth.users, or its RLS. Additive only.
--
-- Background (documented footgun): learning_events.student_id stores auth.uid()
-- (auth.users.id), NOT students.id (see 20260615122657_create_learning_events.sql).
-- Every learner-state table (concept_mastery, learner_mastery, quiz_sessions,
-- adaptive_interventions, …) keys on students.id, so the event log cannot be
-- joined to them today. This migration adds the missing bridge column.
--
-- ── Backfill decision (architect) ────────────────────────────────────────────
-- We do NOT run an in-migration UPDATE to populate student_pk for existing rows.
-- learning_events is a HIGH-VOLUME, append-only telemetry log ('quiz_attempt',
-- 'foxy_ask', 'hint_used', 'topic_opened', 'session_*', 'mastery_updated',
-- 'solver_used'). A blanket
--     UPDATE public.learning_events le
--        SET student_pk = s.id
--       FROM public.students s
--      WHERE s.auth_user_id = le.student_id
--        AND le.student_pk IS NULL;
-- would take a long row-level write lock across the whole table during `db push`
-- (deploy-time), and students.auth_user_id is nullable + not guaranteed unique,
-- which makes an unqualified join ambiguous. Both are unacceptable at deploy time.
--
-- Instead:
--   1. The column ships NULLABLE (this migration). On a FRESH database the table
--      is empty, so there is nothing to backfill and this file is a pure DDL add.
--   2. Historical backfill is a DEFERRED, BATCHED follow-up run in a low-traffic
--      window (keyset-paginated UPDATE … WHERE student_pk IS NULL LIMIT N, or a
--      one-shot maintenance step on the existing daily-cron). The batched form of
--      the join above is idempotent (re-running only touches still-NULL rows).
--   3. New writers should populate student_pk going forward (application-level
--      follow-up; out of scope for this schema-only migration).
--
-- ── RLS posture ──────────────────────────────────────────────────────────────
-- UNCHANGED. The existing SELECT/INSERT policies authorize on
-- student_id = auth.uid() and remain the only RLS anchor. student_pk needs NO
-- new policy: it is a denormalized join key consumed by server-side / service-
-- role analytics (service role bypasses RLS); a student inserting a row still
-- passes the existing WITH CHECK on student_id. Table stays append-only
-- (no UPDATE/DELETE policies added).

-- Nullable bridge column + FK to students(id). ON DELETE CASCADE mirrors the
-- existing student_id → auth.users cascade so an erased learner leaves no
-- orphaned event rows. IF NOT EXISTS keeps this idempotent + fresh-DB-safe.
ALTER TABLE public.learning_events
  ADD COLUMN IF NOT EXISTS student_pk uuid
  REFERENCES public.students(id) ON DELETE CASCADE;

-- Index for joins/filters on the new key. Partial (WHERE student_pk IS NOT NULL)
-- so it stays tiny while the column is mostly NULL (pre-backfill) and never
-- indexes the NULL majority.
CREATE INDEX IF NOT EXISTS idx_learning_events_student_pk
  ON public.learning_events (student_pk)
  WHERE student_pk IS NOT NULL;

COMMENT ON COLUMN public.learning_events.student_pk IS
  'students.id join key (nullable, additive). Bridges the auth.uid()-keyed '
  'student_id to learner-state tables that key on students.id. Backfilled by a '
  'deferred batched job, not in-migration (high-volume append-only log). RLS '
  'anchor remains student_id = auth.uid().';
