-- Migration: 20260814000001_restore_cbse_syllabus_unique_constraint.sql
-- Purpose: Restore the UNIQUE constraint on cbse_syllabus
--          (board, grade, subject_code, chapter_number) if it is missing.
--
-- WHY THIS EXISTS
-- ===============
-- The shared staging Supabase project drifted: the constraint
--   cbse_syllabus_board_grade_subject_code_chapter_number_key
-- was absent on staging even though it is declared in the baseline
-- (00000000000000_baseline_from_prod.sql). The integration lane's
-- cbse-syllabus test (apps/host/src/__tests__/migrations/cbse-syllabus.test.ts)
-- asserts that a duplicate (board, grade, subject_code, chapter_number) row is
-- rejected; with the constraint missing the duplicate insert succeeds and the
-- assertion fails, which cascades to the CI Gate (required integration-tests
-- job) and the fail-closed production deploy Quality Gate.
--
-- Verified (2026-08-08): the constraint is defined in the baseline at
--   line ~15028 (`cbse_syllabus_board_grade_subject_code_chapter_number_key`),
--   and no later migration DROPs it or recreates the table. The staging drift
--   therefore cannot be explained by this repo's migration chain; this is a
--   forward, idempotent repair that guarantees the invariant on ANY target.
--
-- IDEMPOTENCY
-- ===========
-- The DO block checks pg_constraint AND pg_index for an existing constraint or
-- index that already covers exactly {board, grade, subject_code, chapter_number}
-- on cbse_syllabus. If one exists (under any name), this migration is a no-op.
-- If none exists, it adds the canonical constraint. Safe to apply to any
-- environment (fresh, staging, prod) without destructive DDL.

BEGIN;

DO $$
DECLARE
  v_existing_count integer;
BEGIN
  -- Any existing unique constraint or unique index that covers the 4 columns
  -- (in any order) satisfies the invariant; do not double-add.
  SELECT COUNT(*) INTO v_existing_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'cbse_syllabus'
    AND c.contype = 'u'
    AND (
      c.conkey IS NOT NULL
      AND array_length(c.conkey, 1) = 4
      AND EXISTS (
        SELECT 1
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE a.attname IN ('board', 'grade', 'subject_code', 'chapter_number')
      )
    );

  -- Also check for a plain UNIQUE INDEX (not a constraint) on the same columns.
  IF v_existing_count = 0 THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'cbse_syllabus'
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND array_length(i.indkey, 1) = 4
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey::smallint[]) AS k(attnum)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE a.attname IN ('board', 'grade', 'subject_code', 'chapter_number')
      );
  END IF;

  IF v_existing_count = 0 THEN
    ALTER TABLE ONLY "public"."cbse_syllabus"
      ADD CONSTRAINT "cbse_syllabus_board_grade_subject_code_chapter_number_key"
      UNIQUE ("board", "grade", "subject_code", "chapter_number");
  END IF;
END $$;

COMMIT;
