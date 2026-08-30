-- Reconstructed from production ledger (supabase_migrations.schema_migrations).
-- Originally applied out-of-band 2026-08-29; committed to restore parity.
-- Content verified byte-identical to stored statements. Do not re-run
-- against production — already applied at version 20260829164420.

CREATE OR REPLACE FUNCTION public.verify_activity_reporting()
RETURNS TABLE(check_name text, status text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- 1. Analytics schema exists
  check_name := 'analytics_schema';
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'analytics') THEN
    status := 'PASS'; detail := 'analytics schema exists';
  ELSE
    status := 'FAIL'; detail := 'analytics schema missing';
  END IF;
  RETURN NEXT;

  -- 2. Unified view exists and returns rows
  check_name := 'unified_view';
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM analytics.student_activity_timeline LIMIT 1' INTO v_count;
    IF v_count > 0 THEN
      status := 'PASS'; detail := v_count || ' rows in timeline view';
    ELSE
      status := 'WARN'; detail := 'view exists but has 0 rows (may be empty database)';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status := 'FAIL'; detail := 'view query failed: ' || SQLERRM;
  END;
  RETURN NEXT;

  -- 3. Student daily summary mat view populated
  check_name := 'matview_student_daily';
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM analytics.student_daily_summary' INTO v_count;
    IF v_count > 0 THEN
      status := 'PASS'; detail := v_count || ' rows';
    ELSE
      status := 'WARN'; detail := 'materialized view empty — run REFRESH or wait for cron';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status := 'FAIL'; detail := SQLERRM;
  END;
  RETURN NEXT;

  -- 4. Class activity summary mat view
  check_name := 'matview_class_daily';
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM analytics.class_activity_summary' INTO v_count;
    IF v_count > 0 THEN
      status := 'PASS'; detail := v_count || ' rows';
    ELSE
      status := 'WARN'; detail := 'empty — may need class_enrollments data';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status := 'FAIL'; detail := SQLERRM;
  END;
  RETURN NEXT;

  -- 5. School activity summary mat view
  check_name := 'matview_school_daily';
  BEGIN
    EXECUTE 'SELECT COUNT(*) FROM analytics.school_activity_summary' INTO v_count;
    IF v_count > 0 THEN
      status := 'PASS'; detail := v_count || ' rows';
    ELSE
      status := 'WARN'; detail := 'empty — may need school_id data on students';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status := 'FAIL'; detail := SQLERRM;
  END;
  RETURN NEXT;

  -- 6. RPCs exist
  FOR check_name IN
    SELECT unnest(ARRAY[
      'get_activity_timeline',
      'get_progress_report',
      'get_class_activity_report',
      'get_school_usage_analytics'
    ])
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = check_name
    ) THEN
      status := 'PASS'; detail := 'function exists';
    ELSE
      status := 'FAIL'; detail := 'function missing';
    END IF;
    RETURN NEXT;
  END LOOP;

  -- 7. pg_cron jobs scheduled
  check_name := 'cron_jobs';
  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM cron.job
    WHERE jobname LIKE 'analytics-%';
    IF v_count >= 4 THEN
      status := 'PASS'; detail := v_count || ' analytics cron jobs scheduled';
    ELSIF v_count > 0 THEN
      status := 'WARN'; detail := 'only ' || v_count || '/4 cron jobs found';
    ELSE
      status := 'WARN'; detail := 'no cron jobs — pg_cron may not be installed';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status := 'WARN'; detail := 'pg_cron not available: ' || SQLERRM;
  END;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_activity_reporting() TO authenticated;
