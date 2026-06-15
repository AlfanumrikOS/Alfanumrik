-- =============================================================================
-- Migration: 20260615162908_restore_missing_rpc_surface.sql
-- Purpose:   Restore three monitoring RPCs that are called from src/ but are
--            ABSENT from both the pg_dump-derived baseline
--            (00000000000000_baseline_from_prod.sql) and every timestamped
--            root migration. REG-144-class compensating migration.
--
-- Provenance / verification (performed 2026-06-15 against the linked project
-- ref shktyoxqhundlvkiwguu, Postgres 17.6, read-only):
--   * Confirmed each function ABSENT in schema public via a pg_proc existence
--     scan (sanity-checked against the known-present atomic_quiz_profile_update,
--     which returned PRESENT with 4 overloads — proving the query path).
--   * Each function's sole CREATE definition lives only under
--     supabase/migrations/_legacy/timestamped/20260409000004_monitoring_helper_rpcs.sql
--     (not on the applied path).
--   * Each body was DRIFT-CHECKED column-by-column against the live schema by
--     executing the function's exact inner SELECT against the linked DB.
--
-- Restored here (CLEAN or MECHANICAL-DRIFT only):
--   1. get_connection_stats   — CLEAN (verbatim). Inner SELECT ran unchanged.
--   2. get_table_sizes        — CLEAN (verbatim). Inner SELECT ran unchanged.
--   3. get_slow_functions_stats — MECHANICAL DRIFT. The legacy body selected
--        pg_stat_user_functions.mean_time, but that column does NOT exist on
--        this view in PostgreSQL 17 (the live "column mean_time does not exist /
--        HINT: self_time" error confirmed it; mean_time is a pg_stat_statements
--        column, never a pg_stat_user_functions column). Minimal 1:1 repoint:
--        compute mean_time = total_time / NULLIF(calls, 0). The RETURNS TABLE
--        shape is UNCHANGED (still exposes mean_time), so the caller contract in
--        src/app/api/super-admin/db-performance/route.ts (SlowFunctionRow) is
--        preserved.
--
-- DELIBERATELY EXCLUDED (NEEDS REDESIGN — not restorable as a verbatim RPC):
--   * check_and_increment_permission_usage — its backing tables permission_usage
--     AND plan_permission_overrides are BOTH ABSENT from the live DB (no aliases
--     exist; only permissions + role_permissions are present). Restoring the
--     function alone would error at runtime ("relation does not exist"). Also has
--     caller-contract drift: src/lib/plan-gate.ts passes a p_increment arg the
--     legacy signature lacks and reads current_count/daily_limit while the legacy
--     body returns count/limit; and getOverride() queries column `plan` while the
--     legacy table defines `plan_id`. Requires the full table + seed + contract
--     redesign from migration 20260417100000, tracked separately.
--   * predict_exam_score — references concept_mastery.current_retention,
--     concept_mastery.bloom_mastery, and concept_mastery.cme_action_type, all of
--     which are ABSENT from the live concept_mastery (no clean 1:1 twin exists;
--     the table now carries BKT/SM-2 fields instead). Same class as the
--     compute_post_quiz_action trap. Requires redesign, tracked separately.
--
-- Idempotent: DROP FUNCTION IF EXISTS + CREATE OR REPLACE.
-- All three are SECURITY DEFINER with SET search_path = public, justified
-- because they read pg_stat_* views that require pg_monitor/superuser-scoped
-- visibility and are granted to service_role only (admin Database Performance
-- panel), never to authenticated.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. get_connection_stats  (CLEAN — verbatim from _legacy)
--    Connection state breakdown for the admin DB Performance panel.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_connection_stats();

CREATE OR REPLACE FUNCTION public.get_connection_stats()
RETURNS TABLE(state text, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(state, 'idle/null')::text as state, COUNT(*) as count
  FROM pg_stat_activity
  WHERE datname = current_database()
  GROUP BY state
  ORDER BY count DESC;
$$;

REVOKE ALL ON FUNCTION public.get_connection_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_connection_stats() TO service_role;


-- -----------------------------------------------------------------------------
-- 2. get_table_sizes  (CLEAN — verbatim from _legacy)
--    Live/dead row + size stats for vacuum/bloat monitoring.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_table_sizes();

CREATE OR REPLACE FUNCTION public.get_table_sizes()
RETURNS TABLE(tablename text, live_rows bigint, dead_rows bigint, size_bytes bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    relname::text as tablename,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    pg_total_relation_size(quote_ident(relname))::bigint as size_bytes
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_table_sizes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_sizes() TO service_role;


-- -----------------------------------------------------------------------------
-- 3. get_slow_functions_stats  (MECHANICAL DRIFT — see header)
--    Top slowest functions by mean execution time.
--    REPOINT: legacy selected pg_stat_user_functions.mean_time (nonexistent on
--    PG17). Derived as total_time / NULLIF(calls, 0). RETURNS TABLE shape and
--    the mean_time column name are unchanged to preserve the caller contract.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_slow_functions_stats();

CREATE OR REPLACE FUNCTION public.get_slow_functions_stats()
RETURNS TABLE(funcname text, calls bigint, total_time float, mean_time float)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    funcname::text,
    calls,
    total_time,
    (total_time / NULLIF(calls, 0))::float AS mean_time  -- DRIFT REPOINT: pg_stat_user_functions has no mean_time column on PG17
  FROM pg_stat_user_functions
  WHERE calls > 0
  ORDER BY mean_time DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_slow_functions_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_slow_functions_stats() TO service_role;
