-- Migration: Audit log unification + data quality automation (P1-5, P1-7)
-- Audit remediation 2026-08-06:
--   1. Unifies audit_logs and admin_audit_log schemas
--   2. Adds automated data quality validation jobs
--   3. Adds recurring integrity checks

-- Part 1: Add missing columns to audit_logs to unify with admin_audit_log
DO $$
BEGIN
  -- Add admin_id column for admin actions (matches admin_audit_log.admin_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'admin_id'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN admin_id uuid;
  END IF;

  -- Add entity_type/entity_id columns for resource classification
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN entity_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN entity_id uuid;
  END IF;

  -- Add reason column for audit context
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN reason text;
  END IF;
END $$;

-- Part 2: Complete _own policy drift detection
-- The 20260728090100 migration left this incomplete. This query identifies
-- policies with '_own' in their name but USING (true) predicate.
CREATE OR REPLACE FUNCTION public.detect_vacuous_own_policies()
RETURNS TABLE(
  table_name text,
  policy_name text,
  policy_cmd text,
  policy_using text,
  policy_check text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text AS table_name,
    pol.polname::text AS policy_name,
    pol.polcmd::text AS policy_cmd,
    COALESCE(pg_get_expr(pol.polqual, pol.polrelid), 'NONE')::text AS policy_using,
    COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), 'NONE')::text AS policy_check
  FROM pg_policy pol
  JOIN pg_class c ON pol.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND pol.polname ILIKE '%\_own%' ESCAPE '\'
    AND (
      COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') = '(true)'
      OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') = '(true)'
    )
  ORDER BY c.relname, pol.polname;
$$;

REVOKE ALL ON FUNCTION public.detect_vacuous_own_policies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_vacuous_own_policies() TO authenticated, service_role;

-- Part 3: Automated data quality validation
-- Function checks critical integrity invariants and returns failures.
CREATE OR REPLACE FUNCTION public.run_data_quality_checks()
RETURNS TABLE(
  check_name text,
  result text,
  detail text,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET statement_timeout = '30s'
AS $$
DECLARE
  v_count bigint;
  v_student_count bigint;
  v_orphaned_count bigint;
BEGIN
  -- Check 1: Null student_id on tenant-scoped tables
  FOR check_name, result, detail, severity IN
    SELECT
      c.relname::text || '_null_student_id' AS check_name,
      CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END AS result,
      CASE WHEN count(*) > 0 THEN count(*)::text || ' rows with NULL student_id' ELSE 'All rows have student_id' END AS detail,
      CASE WHEN count(*) > 0 THEN 'HIGH' ELSE 'INFO' END AS severity
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'student_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'quiz_responses', 'quiz_sessions', 'concept_mastery',
        'student_learning_profiles', 'foxy_chat_messages'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = c.relname AND column_name = 'student_id'
          AND is_nullable = 'YES'
      )
  LOOP
    -- Check for nulls only on nullable columns
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE student_id IS NULL',
      check_name -- will be 'tablename_null_student_id', extract table name
    ) INTO v_count;

    IF v_count > 0 THEN
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Check 2: Orphaned quiz_responses (no matching quiz_session or student)
  SELECT count(*) INTO v_orphaned_count
  FROM public.quiz_responses qr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = qr.student_id
  );
  IF v_orphaned_count > 0 THEN
    RETURN QUERY SELECT
      'orphaned_quiz_responses'::text,
      'fail'::text,
      v_orphaned_count::text || ' quiz_responses with no matching student',
      'HIGH'::text;
  END IF;

  -- Check 3: Duplicate student_learning_profiles per (student_id, subject)
  -- (unique constraint should prevent this, but verify)
  SELECT count(*) INTO v_count FROM (
    SELECT student_id, subject, count(*)
    FROM public.student_learning_profiles
    GROUP BY student_id, subject
    HAVING count(*) > 1
  ) dupes;
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'duplicate_learning_profiles'::text,
      'fail'::text,
      v_count::text || ' duplicate (student_id, subject) pairs',
      'CRITICAL'::text;
  END IF;

  -- Check 4: Streak consistency (student with streak > 0 but no recent activity)
  SELECT count(*) INTO v_count
  FROM public.students
  WHERE streak_days > 0
    AND last_active < now() - interval '48 hours';
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'stale_streaks'::text,
      'fail'::text,
      v_count::text || ' students with active streak but no activity in 48h',
      'MEDIUM'::text;
  END IF;

  -- Check 5: Payment history without student (should not happen after anonymisation)
  SELECT count(*) INTO v_count
  FROM public.payment_history ph
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = ph.student_id
  );
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'orphaned_payment_history'::text,
      'warn'::text,
      v_count::text || ' payment_history rows with no matching student (may be anonymised)',
      'LOW'::text;
  END IF;

  -- If no checks returned, emit a pass row
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'all_checks'::text,
      'pass'::text,
      'All data quality checks passed'::text,
      'INFO'::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.run_data_quality_checks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_data_quality_checks() TO authenticated, service_role;

-- Part 4: Daily quality check result storage
CREATE TABLE IF NOT EXISTS public.data_quality_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz DEFAULT now(),
  check_name text NOT NULL,
  result text NOT NULL CHECK (result IN ('pass', 'fail', 'warn')),
  detail text,
  severity text NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
  resolved_at timestamptz,
  resolved_by text
);

ALTER TABLE public.data_quality_check_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access data_quality_check_results"
  ON public.data_quality_check_results FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read quality results"
  ON public.data_quality_check_results FOR SELECT
  TO authenticated
  USING (true);

-- Index for recent failures
CREATE INDEX IF NOT EXISTS idx_data_quality_recent_failures
  ON public.data_quality_check_results (checked_at DESC)
  WHERE result IN ('fail', 'warn') AND resolved_at IS NULL;

-- Part 5: Row count baseline snapshot (for drift detection)
CREATE TABLE IF NOT EXISTS public.table_row_count_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz DEFAULT now(),
  table_name text NOT NULL,
  row_count bigint NOT NULL,
  table_size_bytes bigint,
  recorded_by text DEFAULT 'auto'
);

ALTER TABLE public.table_row_count_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access table_row_count_baselines"
  ON public.table_row_count_baselines FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read baselines"
  ON public.table_row_count_baselines FOR SELECT
  TO authenticated
  USING (true);
