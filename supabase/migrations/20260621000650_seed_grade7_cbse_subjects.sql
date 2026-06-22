-- Migration: 20260621000600_seed_grade7_cbse_subjects.sql
-- Purpose: Seed Grade 7 CBSE core subjects into grade_subject_map so that
--          get_available_subjects() returns all subjects for Grade 7 students.
--
-- Root cause: The subject_governance_seed.sql (20260415000004) that inserted
--   grade_subject_map rows for grades 6-10 is archived under
--   supabase/migrations/_legacy/timestamped/ and is NOT re-executed on fresh
--   databases or new staging environments.  The baseline migration
--   (00000000000000_baseline_from_prod.sql) is schema-only — it defines the
--   grade_subject_map table and unique index but inserts no rows.
--
--   Migration 20260605000000_fix_board_subject_chapter_gaps.sql added a
--   `board` column (DEFAULT 'CBSE') and changed the unique index to
--   (grade, subject_code, stream, board) NULLS NOT DISTINCT.  Rows seeded
--   by the legacy chain carry board='CBSE' via that default, but on any
--   environment that did not run the legacy chain the table is empty.
--
--   As a result Hridaan (Grade 7 CBSE) sees only the subjects that happen to
--   exist — effectively none, or only whichever row was inserted ad hoc.
--
-- Fix: Idempotently insert the five CBSE core subjects for Grade 7.  All
--   five subject codes exist in public.subjects (seeded via the legacy chain
--   or present in prod) and in public.plan_subject_access for the 'free' plan,
--   so they will appear as unlocked for free-tier students.
--
-- Idempotency: ON CONFLICT DO NOTHING on the unique index
--   (grade, subject_code, stream, board) NULLS NOT DISTINCT.
--
-- Also recomputes subjects.is_content_ready so subjects with chapters +
--   questions are marked ready immediately, without waiting for the nightly
--   cron at 03:30 UTC.  Wrapped in a non-fatal exception handler so the
--   migration succeeds even on environments where the helper function does
--   not yet exist.

BEGIN;

-- ─── 1. Ensure subject rows exist ─────────────────────────────────────────────
-- Guard: the subjects table must have these codes or the FK will reject the
-- grade_subject_map insert.  Insert with ON CONFLICT DO NOTHING so prod is
-- untouched (rows already exist there from the legacy seed).
INSERT INTO public.subjects (code, name, name_hi, icon, color, subject_kind, is_active, display_order)
VALUES
  ('math',          'Mathematics',   'गणित',           '🧮', '#F97316', 'cbse_core', true, 10),
  ('science',       'Science',       'विज्ञान',          '🔬', '#10B981', 'cbse_core', true, 20),
  ('english',       'English',       'अंग्रेज़ी',         '📘', '#3B82F6', 'cbse_core', true, 30),
  ('hindi',         'Hindi',         'हिंदी',            '📕', '#EF4444', 'cbse_core', true, 40),
  ('social_studies','Social Studies','सामाजिक विज्ञान',   '🌏', '#8B5CF6', 'cbse_core', true, 50)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Seed Grade 7 CBSE core subjects into grade_subject_map ───────────────
-- Unique index: (grade, subject_code, stream, board) NULLS NOT DISTINCT
-- stream IS NULL for grades 6-10 (no stream selection below grade 11).
-- board = 'CBSE' — the canonical value used by get_available_subjects() for
-- the board-match / fallback logic.
INSERT INTO public.grade_subject_map (grade, subject_code, stream, board, is_core)
VALUES
  ('7', 'math',          NULL, 'CBSE', true),
  ('7', 'science',       NULL, 'CBSE', true),
  ('7', 'english',       NULL, 'CBSE', true),
  ('7', 'hindi',         NULL, 'CBSE', true),
  ('7', 'social_studies',NULL, 'CBSE', true)
ON CONFLICT DO NOTHING;

-- ─── 3. Recompute is_content_ready immediately ────────────────────────────────
-- The nightly pg_cron job (03:30 UTC) normally refreshes subjects.is_content_ready.
-- Running it here means subjects with chapters + questions in question_bank are
-- visible to students without waiting for the next cron window.
-- Non-fatal: if the function is absent in the target environment the migration
-- still commits successfully; the nightly cron will catch up.
DO $$
BEGIN
  PERFORM public.recompute_subject_content_readiness_daily();
EXCEPTION
  WHEN others THEN
    NULL; -- function absent or errored; non-fatal, nightly cron will catch up
END;
$$;

COMMIT;
