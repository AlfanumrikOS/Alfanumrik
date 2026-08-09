-- Migration: 20260808085349_backfill_concept_mastery_stuck_at_default.sql
-- Purpose: One-time DML backfill of concept_mastery rows whose mastery_probability/p_know
--          are still sitting at the raw column default 0.1 despite having real attempts.
--
-- ============================================================================
-- RECOVERY MIGRATION — reconstructed file for an out-of-band production change
-- ============================================================================
-- WHY THIS FILE EXISTS (deploy-lane unblock, 2026-08-09):
--   Version 20260808085349 is recorded in production's
--   supabase_migrations.schema_migrations but had NO corresponding .sql file in
--   supabase/migrations/. `supabase db push --linked --include-all` therefore
--   aborted with "remote migration versions not found in local migrations
--   directory" BEFORE applying anything, blocking every migration-touching
--   deploy since 2026-08-08. The SQL below was recovered READ-ONLY from the
--   `statements` column of supabase_migrations.schema_migrations on 2026-08-09.
--
-- ############################################################################
-- # THIS IS DML, NOT DDL. IT IS A ONE-TIME BACKFILL THAT IS ALREADY APPLIED  #
-- # ON PRODUCTION. Because 20260808085349 is already recorded as applied      #
-- # there, the CLI will SKIP this file on prod — it will NOT re-run and will  #
-- # NOT touch production rows again.                                          #
-- #                                                                           #
-- # It is nonetheless NATURALLY IDEMPOTENT: the WHERE clause matches only     #
-- # rows still at the untouched default (mastery_probability = 0.1 AND        #
-- # p_know = 0.1) with attempts > 0. Once a row is backfilled it no longer    #
-- # matches, so a re-run is a zero-row no-op. On a fresh DB (CI live-DB,      #
-- # staging rebuild, DR restore) it will typically affect 0 rows because the  #
-- # affected rows came from a specific 2026-08-05 seed/backfill.              #
-- ############################################################################
--
-- ORIGINAL RATIONALE (preserved verbatim from the recovered migration):
--   54 concept_mastery rows were bulk-written (seed/backfill 2026-08-05) with
--   real attempts/correct_attempts but never recomputed through the BKT RPC, so
--   mastery_probability/p_know sat at the raw column default 0.1 — the
--   dashboard/report RPCs read that as "10% mastery" regardless of actual
--   performance (same pattern as the documented prior BKT incident).
--   mastery_mean holds a real value derived from actual accuracy. One-time
--   backfill copies mastery_mean forward and recomputes mastery_level using the
--   same thresholds update_mastery_bkt uses.
--
-- FRESH-DB SAFETY: guarded on to_regclass('public.concept_mastery') and on the
-- presence of every referenced column (mastery_probability, p_know,
-- mastery_level, mastery_mean, attempts, updated_at) via information_schema, so
-- a partially-built database no-ops with a NOTICE instead of raising 42P01
-- (undefined_table) / 42703 (undefined_column). Row count is reported via
-- GET DIAGNOSTICS.
--
-- NOTE: the mastery_level thresholds below (0.95 mastered / 0.75 proficient /
-- 0.50 familiar / 0.20 developing / else not_started) intentionally mirror
-- update_mastery_bkt exactly. Do not drift them independently.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_missing_cols text[];
  v_rows         bigint;
BEGIN
  IF to_regclass('public.concept_mastery') IS NULL THEN
    RAISE NOTICE '[20260808085349] public.concept_mastery does not exist in this database; skipping backfill (no-op).';
    RETURN;
  END IF;

  SELECT array_agg(c.col ORDER BY c.col)
    INTO v_missing_cols
  FROM (
    -- Explicit ::text casts: VALUES literals are 'unknown'-typed, and array_agg()
    -- over an unknown-typed column can fail to resolve its polymorphic argument.
    VALUES
      ('mastery_probability'::text),
      ('p_know'::text),
      ('mastery_level'::text),
      ('mastery_mean'::text),
      ('attempts'::text),
      ('updated_at'::text)
  ) AS c(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns ic
    WHERE ic.table_schema = 'public'
      AND ic.table_name   = 'concept_mastery'
      AND ic.column_name  = c.col
  );

  IF v_missing_cols IS NOT NULL THEN
    RAISE NOTICE '[20260808085349] public.concept_mastery is missing column(s) %; skipping backfill (no-op).', v_missing_cols;
    RETURN;
  END IF;

  -- Recovered statement (self-guarding via its WHERE clause).
  UPDATE public.concept_mastery
  SET
    mastery_probability = mastery_mean::double precision,
    p_know              = mastery_mean::double precision,
    mastery_level = CASE
      WHEN mastery_mean >= 0.95 THEN 'mastered'
      WHEN mastery_mean >= 0.75 THEN 'proficient'
      WHEN mastery_mean >= 0.50 THEN 'familiar'
      WHEN mastery_mean >= 0.20 THEN 'developing'
      ELSE 'not_started'
    END,
    updated_at = now()
  WHERE mastery_probability = 0.1
    AND p_know = 0.1
    AND attempts > 0
    AND mastery_mean IS NOT NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE '[20260808085349] concept_mastery stuck-at-default backfill affected % row(s). (0 is expected on any DB where this already ran or where the 2026-08-05 seed never happened.)', v_rows;
END
$$;

COMMIT;
