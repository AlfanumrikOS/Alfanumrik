-- Migration: 20260808085345_revoke_anon_execute_on_update_mastery_bkt.sql
-- Purpose: Revoke EXECUTE on public.update_mastery_bkt(uuid, uuid, boolean) from anon and authenticated.
--
-- ============================================================================
-- RECOVERY MIGRATION — reconstructed file for an out-of-band production change
-- ============================================================================
-- WHY THIS FILE EXISTS (deploy-lane unblock, 2026-08-09):
--   Version 20260808085345 is recorded in production's
--   supabase_migrations.schema_migrations but had NO corresponding .sql file in
--   supabase/migrations/. `supabase db push --linked --include-all` therefore
--   aborted with "remote migration versions not found in local migrations
--   directory" BEFORE applying anything, so every migration-touching deploy has
--   failed since 2026-08-08 (this also stranded the unapplied security
--   migrations 20260814000000 / 20260814000003 / 20260814000004).
--
--   The SQL below was recovered READ-ONLY from the `statements` column of
--   supabase_migrations.schema_migrations on 2026-08-09. Reproducing the file
--   restores local/remote history parity so the CLI stops erroring.
--
-- ALREADY APPLIED ON PRODUCTION. Because 20260808085345 is already recorded as
-- applied there, the CLI will SKIP this file on prod — it will not re-run.
-- It WILL run on a fresh database (CI live-DB, staging rebuild, DR restore),
-- so the body below is wrapped in fresh-DB safety guards.
--
-- ORIGINAL RATIONALE (preserved verbatim from the recovered migration):
--   update_mastery_bkt(uuid,uuid,boolean) had no auth/ownership check and was
--   executable by anon, letting anyone with the public anon key rewrite any
--   student's mastery data by ID via PostgREST RPC. The locked-down sibling
--   update_concept_mastery_bkt (SECURITY DEFINER, anon revoked) is the pattern
--   the rest of the mastery-write surface follows. Also revoked from
--   authenticated since the function takes an arbitrary p_student_id with no
--   ownership check.
--
-- RECOVERED STATEMENT (unguarded original):
--   revoke execute on function public.update_mastery_bkt(uuid, uuid, boolean)
--     from anon, authenticated;
--
-- FRESH-DB SAFETY: a bare REVOKE raises 42883 (undefined_function) if the
-- routine does not exist in the target database (e.g. a partially-built DB, or
-- one where the function was later dropped/renamed). The DO block below checks
-- to_regprocedure() first and no-ops with a NOTICE if absent. REVOKE ... ON
-- ROUTINE is used instead of ON FUNCTION so a PROCEDURE kind cannot raise
-- 42809 (wrong_object_type). REVOKE is naturally idempotent — revoking a
-- privilege that is not held is a successful no-op.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.update_mastery_bkt(uuid, uuid, boolean)') IS NOT NULL THEN
    REVOKE EXECUTE ON ROUTINE public.update_mastery_bkt(uuid, uuid, boolean)
      FROM anon, authenticated;
    RAISE NOTICE '[20260808085345] public.update_mastery_bkt(uuid,uuid,boolean) found; EXECUTE revoked from anon, authenticated.';
  ELSE
    RAISE NOTICE '[20260808085345] public.update_mastery_bkt(uuid,uuid,boolean) NOT found in this database; nothing to revoke (no-op).';
  END IF;
END
$$;

COMMIT;
