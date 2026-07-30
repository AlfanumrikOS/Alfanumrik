-- Migration: 20260801110000_fix_board_score_social_studies_code.sql
-- Purpose: Data-quality fix — correct cbse_chapter_weights subject_code for
--   Grade 10 Social Studies rows from 'social_science' to the platform's
--   single canonical code 'social_studies'.
--
-- BACKGROUND
-- ──────────
-- 20260628000000_board_score_v1.sql seeded the 20 Grade-10 Social Studies
-- chapter rows with subject_code = 'social_science'. Every other place in the
-- platform that represents this subject uses 'social_studies':
--   - subjects.code
--   - grade_subject_map.subject_code
--   - student_subject_enrollment.subject_code (FK -> subjects.code)
--   - students.selected_subjects (text[] of subjects.code values)
--   - get_available_subjects() RPC output
-- Verified this session via grep across supabase/migrations/**: 'social_studies'
-- appears in ~10 other functions/mappings; 'social_science' appears nowhere
-- else in the migration chain except the 20 rows this migration corrects.
--
-- WHAT BREAKS WITHOUT THIS FIX
-- ────────────────────────────
-- The BoardScore subject-scoping fix (docs/superpowers/specs/
-- 2026-07-30-boardscore-subject-scoping.md §4) intersects a student's
-- selected_subjects with cbse_chapter_weights.subject_code to decide which
-- subjects to compute a prediction for. A Grade-10 student who correctly
-- selected 'social_studies' will NEVER match a 'social_science'-coded weights
-- row — the join silently returns zero rows for that subject. Grade-10 Social
-- Studies BoardScore can therefore never compute for ANY student, with no
-- error surfaced (it just looks like "no weights configured for this
-- subject"). This is a prerequisite for BoardScore's grade-10 SST coverage to
-- work at all (spec §5, §8 item 6).
--
-- SAFETY VERIFICATION (performed this session, not assumed)
-- ───────────────────────────────────────────────────────────
-- 1. No foreign key references cbse_chapter_weights.subject_code (or any
--    column of this table). Grepped every migration file for
--    "cbse_chapter_weights": it appears only in (a) its own creation
--    migration 20260628000000_board_score_v1.sql, (b) an RLS-only migration
--    (20260728090000_lockdown_anon_readable_public_tables.sql) that touches
--    policies, not rows or FKs, and (c) a read-only mention in a feature-flag
--    seed's comment block (20260724150000_seed_ff_outcome_prediction_v1.sql).
--    No table anywhere declares "REFERENCES public.cbse_chapter_weights". The
--    only constraint touching subject_code is this table's own natural key
--    (below) — safe to UPDATE without orphaning any dependent row.
-- 2. No collision on the natural-key UNIQUE constraint
--    (board, grade, subject_code, chapter_number). This table has exactly
--    one seeding migration (20260628000000_board_score_v1.sql); it seeds
--    'social_science' (not 'social_studies') for board='CBSE', grade='10',
--    chapter_number 1-20, and no other migration in the chain inserts
--    'social_studies'-coded rows for grade 10. Post-update there will be
--    zero existing rows at (CBSE, 10, social_studies, 1..20) to collide with.
--
-- IDEMPOTENCY
-- ───────────
-- The WHERE clause targets only rows still coded 'social_science'. A second
-- run matches zero rows (they will already read 'social_studies') — safe to
-- replay.
--
-- MANUAL DOWN (if ever needed)
-- ─────────────────────────────
--   UPDATE public.cbse_chapter_weights
--   SET subject_code = 'social_science'
--   WHERE subject_code = 'social_studies' AND grade = '10' AND board = 'CBSE'
--     AND chapter_number BETWEEN 1 AND 20;

BEGIN;

UPDATE public.cbse_chapter_weights
SET subject_code = 'social_studies',
    updated_at = now()
WHERE subject_code = 'social_science'
  AND grade = '10'
  AND board = 'CBSE';

COMMIT;
