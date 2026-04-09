-- ============================================================
-- MONITORING HELPER RPCs
-- Purpose: Expose pg_stat_* views safely to service_role only
-- for the super-admin Database Performance panel.
-- SECURITY DEFINER is justified: these RPCs access pg_stat views
-- that require superuser/pg_monitor privileges. Called only via
-- service_role from the admin API route, not by authenticated users.
-- ============================================================

-- RPC 1: Top slowest functions by mean execution time
CREATE OR REPLACE FUNCTION public.get_slow_functions_stats()
RETURNS TABLE(funcname text, calls bigint, total_time float, mean_time float)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT funcname::text, calls, total_time, mean_time
  FROM pg_stat_user_functions
  WHERE calls > 0
  ORDER BY mean_time DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_slow_functions_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_slow_functions_stats() TO service_role;

-- RPC 2: Connection state breakdown
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

-- RPC 3: Table sizes (for vacuum/bloat monitoring)
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
