-- Migration: 20260808085419_revoke_public_execute_on_update_mastery_bkt.sql
-- Purpose: Revoke the Postgres default EXECUTE grant to PUBLIC on
--          public.update_mastery_bkt(uuid, uuid, boolean).
--
-- ============================================================================
-- RECOVERY MIGRATION — reconstructed file for an out-of-band production change
-- ============================================================================
-- WHY THIS FILE EXISTS (deploy-lane unblock, 2026-08-09):
--   Version 20260808085419 is recorded in production's
--   supabase_migrations.schema_migrations but had NO corresponding .sql file in
--   supabase/migrations/. `supabase db push --linked --include-all` therefore
--   aborted with "remote migration versions not found in local migrations
--   directory" BEFORE applying anything, blocking every migration-touching
--   deploy since 2026-08-08. The SQL below was recovered READ-ONLY from the
--   `statements` column of supabase_migrations.schema_migrations on 2026-08-09.
--
-- ALREADY APPLIED ON PRODUCTION. Because 20260808085419 is already recorded as
-- applied there, the CLI will SKIP this file on prod — it will not re-run.
-- It WILL run on a fresh database (CI live-DB, staging rebuild, DR restore),
-- so the body below is wrapped in fresh-DB safety guards.
--
-- ORIGINAL RATIONALE (preserved verbatim from the recovered migration):
--   the prior revoke targeted anon/authenticated explicitly, but
--   update_mastery_bkt still had the Postgres default EXECUTE grant to PUBLIC
--   (proacl "=X/postgres"), which anon and authenticated inherit regardless of
--   any role-specific revoke. Revoking from PUBLIC closes that. service_role
--   keeps its explicit grant.
--
-- RECOVERED STATEMENT (unguarded original):
--   revoke execute on function public.update_mastery_bkt(uuid, uuid, boolean)
--     from public;
--
-- This is the completing half of 20260808085345 — that file revoked the
-- role-specific grants; this one removes the inherited PUBLIC default. Both are
-- required; neither alone closes the hole. Keep them together.
--
-- FRESH-DB SAFETY: identical guard shape to 20260808085345 — to_regprocedure()
-- existence check to avoid 42883 (undefined_function), REVOKE ... ON ROUTINE
-- instead of ON FUNCTION to avoid 42809 (wrong_object_type) if the object is a
-- PROCEDURE kind. REVOKE of a privilege that is not held is a successful no-op,
-- so this is idempotent.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.update_mastery_bkt(uuid, uuid, boolean)') IS NOT NULL THEN
    REVOKE EXECUTE ON ROUTINE public.update_mastery_bkt(uuid, uuid, boolean)
      FROM PUBLIC;
    RAISE NOTICE '[20260808085419] public.update_mastery_bkt(uuid,uuid,boolean) found; default EXECUTE grant to PUBLIC revoked. service_role retains its explicit grant.';
  ELSE
    RAISE NOTICE '[20260808085419] public.update_mastery_bkt(uuid,uuid,boolean) NOT found in this database; nothing to revoke (no-op).';
  END IF;
END
$$;

COMMIT;
