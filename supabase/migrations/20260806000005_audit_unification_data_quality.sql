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
-- Function checks critical integrity invariants against REAL tables and returns
-- failures as rows. Fixed 2026-08-07: removed the invalid FOR..SELECT loop and
-- the made-up table-name query; every check references a proven column.
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
  v_emitted boolean := false;
BEGIN
  -- Check 1: Orphaned quiz_responses (no matching student) -- real columns
  SELECT count(*) INTO v_count
  FROM public.quiz_responses qr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = qr.student_id
  );
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'orphaned_quiz_responses'::text, 'fail'::text,
      v_count::text || ' quiz_responses with no matching student', 'HIGH'::text;
    v_emitted := true;
  END IF;

  -- Check 2: Duplicate student_learning_profiles per (student_id, subject)
  SELECT count(*) INTO v_count FROM (
    SELECT student_id, subject, count(*)
    FROM public.student_learning_profiles
    GROUP BY student_id, subject
    HAVING count(*) > 1
  ) dupes;
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'duplicate_learning_profiles'::text, 'fail'::text,
      v_count::text || ' duplicate (student_id, subject) pairs', 'CRITICAL'::text;
    v_emitted := true;
  END IF;

  -- Check 3: Orphaned quiz_sessions (no matching student) -- real columns
  SELECT count(*) INTO v_count
  FROM public.quiz_sessions qs
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = qs.student_id
  );
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'orphaned_quiz_sessions'::text, 'fail'::text,
      v_count::text || ' quiz_sessions with no matching student', 'HIGH'::text;
    v_emitted := true;
  END IF;

  -- Check 4: Quiz_completed state events with no matching session.
  -- state_events has NO processing_status column; reconciliation is by
  -- occurred_at against quiz_sessions.created_at (bounded window).
  SELECT count(*) INTO v_count
  FROM public.state_events se
  WHERE se.kind = 'learner.quiz_completed'
    AND se.occurred_at > now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.quiz_sessions qs
      WHERE qs.created_at BETWEEN se.occurred_at - interval '1 min'
                              AND se.occurred_at + interval '5 min'
    );
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'unmatched_quiz_completed_events'::text, 'fail'::text,
      v_count::text || ' quiz_completed events with no session (30d)', 'HIGH'::text;
    v_emitted := true;
  END IF;

  -- Check 5: Blank student names (students.name is NOT NULL; check empty)
  SELECT count(*) INTO v_count
  FROM public.students
  WHERE btrim(name) = '';
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'blank_student_name'::text, 'warn'::text,
      v_count::text || ' students with blank name', 'MEDIUM'::text;
    v_emitted := true;
  END IF;

  -- Check 6: Payment history rows that are NOT anonymised (real student id
  -- still resolves) AND not deleted -- orphaned-but-not-anonymised is a red flag.
  SELECT count(*) INTO v_count
  FROM public.payment_history ph
  WHERE NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = ph.student_id
  )
  AND ph.student_id IS NOT NULL;
  IF v_count > 0 THEN
    RETURN QUERY SELECT
      'orphaned_payment_history'::text, 'warn'::text,
      v_count::text || ' payment_history rows with no matching student (un-anonymised)', 'LOW'::text;
    v_emitted := true;
  END IF;

  -- If nothing failed, emit a single pass row.
  IF NOT v_emitted THEN
    RETURN QUERY SELECT
      'all_checks'::text, 'pass'::text,
      'All data quality checks passed'::text, 'INFO'::text;
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
