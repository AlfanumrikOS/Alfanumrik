-- Migration: fix_search_path_on_secdef_functions
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Set search_path = public on all postgres-owned SECURITY DEFINER functions
--          to prevent search_path injection attacks (Supabase security advisor finding).
--          Uses ALTER FUNCTION ... SET search_path to avoid full rewrites.

DO $$
DECLARE
  v_fn RECORD;
  v_sql text;
BEGIN
  FOR v_fn IN
    SELECT
      p.oid,
      n.nspname                        AS schema_name,
      p.proname                        AS fn_name,
      pg_get_function_identity_arguments(p.oid) AS fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true                          -- SECURITY DEFINER
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
      AND NOT EXISTS (                                -- missing search_path
        SELECT 1 FROM pg_options_to_table(p.proconfig)
        WHERE option_name = 'search_path'
      )
  LOOP
    v_sql := format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public',
      v_fn.schema_name, v_fn.fn_name, v_fn.fn_args
    );
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not set search_path on %.%: %',
        v_fn.schema_name, v_fn.fn_name, SQLERRM;
    END;
  END LOOP;
END;
$$;
