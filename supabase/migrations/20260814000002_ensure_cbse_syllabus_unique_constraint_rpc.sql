-- Migration: 20260814000002_ensure_cbse_syllabus_unique_constraint_rpc.sql
-- Purpose: SECURITY DEFINER helper that idempotently restores the
--          cbse_syllabus UNIQUE constraint on whatever database it runs on.
--
-- WHY THIS EXISTS
-- ===============
-- The integration-test lane hits the shared staging Supabase project
-- (STAGING_SUPABASE_URL → project `sb-gzpxqklxwzishrkiaatd`), which is a
-- DIFFERENT database from the one `Sync Migrations to Staging` pushes to
-- (SUPABASE_STAGING_PROJECT_REF). As a result, the cbse_syllabus UNIQUE
-- constraint — present in the baseline and restored by 20260814000001 on the
-- sync target — is absent on the integration-test DB, and the integration
-- test's duplicate-insert assertion fails (setup insert succeeds, duplicate
-- insert ALSO succeeds → no constraint).
--
-- This RPC lets the test restore the invariant on whatever DB it runs against,
-- removing the dependence on shared external sync state. Idempotent: no-op when
-- the constraint (or an equivalent unique index over the same 4 columns)
-- already exists. SECURITY DEFINER with pinned search_path so it can run
-- ALTER TABLE; granted to service_role only (the integration harness uses the
-- service-role client). Not callable by anon/authenticated.
--
-- Safe to apply to any environment; no destructive DDL.

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_cbse_syllabus_unique_constraint()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_count integer;
BEGIN
  SELECT COUNT(*) INTO v_existing_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'cbse_syllabus'
    AND c.contype = 'u'
    AND c.conkey IS NOT NULL
    AND array_length(c.conkey, 1) = 4
    AND EXISTS (
      SELECT 1
      FROM unnest(c.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE a.attname IN ('board', 'grade', 'subject_code', 'chapter_number')
    );

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
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE a.attname IN ('board', 'grade', 'subject_code', 'chapter_number')
      );
  END IF;

  IF v_existing_count = 0 THEN
    ALTER TABLE ONLY "public"."cbse_syllabus"
      ADD CONSTRAINT "cbse_syllabus_board_grade_subject_code_chapter_number_key"
      UNIQUE ("board", "grade", "subject_code", "chapter_number");
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.ensure_cbse_syllabus_unique_constraint() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_cbse_syllabus_unique_constraint() TO service_role;

COMMIT;
