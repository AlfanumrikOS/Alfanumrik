-- lint:allow-placeholder
-- Intentional no-op (Phase E.2 lint allow-list): the promotion logic was
-- consolidated back into 20260513000000_promote_ncert_exercises_to_question_bank.sql
-- after a third edge case surfaced. This file stays to preserve schema_migrations
-- continuity for environments that already recorded this version.
--
-- ─── No-op stub (intentional) ───────────────────────────────────────────────
--
-- This migration was originally introduced in PR #658 as a follow-up to
-- 20260513000000 to handle a duplicate-text constraint violation. After
-- a third bug surfaced (NCERT MCQ rows with NULL options violating
-- chk_four_options), the entire promotion logic was consolidated back into
-- the corrected 20260513000000 file. This file remains as a no-op so that
-- environments which already recorded version 20260513120000 in
-- schema_migrations don't lose track of it, and so the file's presence
-- does not block fresh-environment deploys.
--
-- See:
--   - supabase/migrations/20260513000000_promote_ncert_exercises_to_question_bank.sql
--   - docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md

BEGIN;
-- intentional no-op
SELECT 1 WHERE FALSE;
COMMIT;
