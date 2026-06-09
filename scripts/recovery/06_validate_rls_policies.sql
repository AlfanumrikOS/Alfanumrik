-- scripts/recovery/06_validate_rls_policies.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks RLS coverage on all public tables.
-- Identifies tables with RLS disabled (P8 violation) and tables with RLS
-- enabled but zero policies (accidental lockout — all rows hidden from
-- authenticated users).
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 6 — run after repair migrations have been applied.
-- DEPENDENCIES: pg_class, pg_policy, pg_namespace accessible.
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. Tables with RLS DISABLED (P8 violation candidates)
-- ============================================================================

SELECT
  c.relname AS table_name,
  'RLS DISABLED' AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
  -- Exclude known internal/utility tables that intentionally have no RLS
  AND c.relname NOT IN (
    'spatial_ref_sys',       -- PostGIS system table (if present)
    'schema_migrations'      -- Supabase internal
  )
ORDER BY c.relname;

-- Expected: 0 rows. Any table listed here is a P8 violation.
-- Exception: service-role-only tables (invoice_number_sequences, etc.)
-- should still have RLS enabled with zero client policies.

-- ============================================================================
-- 2. Tables with RLS ENABLED but ZERO policies (accidental lockout)
-- ============================================================================

SELECT
  c.relname AS table_name,
  'RLS ON, zero policies — all rows hidden from authenticated users' AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid
  )
ORDER BY c.relname;

-- Expected: may include service-role-only tables:
--   invoice_number_sequences, contract_number_sequences,
--   payment_reconciliation_queue, grounding_circuit_state
-- These are intentional: service_role bypasses RLS; no authenticated client
-- should access these tables directly.

-- ============================================================================
-- 3. RLS coverage on recently-created critical tables
-- ============================================================================

WITH critical_tables AS (
  SELECT unnest(ARRAY[
    'parent_cheers',
    'teacher_parent_threads',
    'teacher_parent_messages',
    'parental_consent',
    'data_erasure_requests',
    'mock_test_attempts',
    'mock_test_responses',
    'exam_papers',
    'school_contracts',
    'teacher_remediation_assignments'
  ]) AS table_name
)
SELECT
  ct.table_name,
  CASE WHEN c.relrowsecurity THEN 'RLS ON' ELSE 'RLS OFF' END AS rls_status,
  COUNT(pol.polname) AS policy_count,
  STRING_AGG(pol.polname, ', ' ORDER BY pol.polname) AS policies
FROM critical_tables ct
LEFT JOIN pg_class c ON c.relname = ct.table_name
  AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
GROUP BY ct.table_name, c.relrowsecurity
ORDER BY ct.table_name;

-- Expected per table:
--   parent_cheers:               RLS ON, 3 policies (student_select, guardian_select, service_insert)
--   teacher_parent_threads:      RLS ON, 2 policies (teacher_select, guardian_select)
--   teacher_parent_messages:     RLS ON, 4 policies (teacher/guardian select + insert)
--   parental_consent:            RLS ON, 4 policies (guardian select/insert/update + service all)
--   data_erasure_requests:       RLS ON, 2-3 policies
--   mock_test_attempts:          RLS ON, 4 policies (student own + admin all)
--   mock_test_responses:         RLS ON, 4 policies (student own + admin all)
--   exam_papers:                 RLS ON, 2 policies (authenticated select + admin write)
--   school_contracts:            RLS ON, 1 policy (school_admin read)
--   teacher_remediation_assignments: varies

-- ============================================================================
-- 4. Policy detail for parent_cheers (spot-check of Wave D migration)
-- ============================================================================

SELECT
  pol.polname AS policy_name,
  CASE pol.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    ELSE 'ALL'
  END AS command,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_clause,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_clause
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'parent_cheers'
ORDER BY pol.polname;

-- ============================================================================
-- 5. Comprehensive RLS summary for all public tables
-- ============================================================================

SELECT
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF' END AS rls,
  COUNT(pol.polname) AS policies,
  CASE
    WHEN NOT c.relrowsecurity THEN 'P8 VIOLATION'
    WHEN COUNT(pol.polname) = 0 THEN 'service-role-only (intentional or check needed)'
    ELSE 'ok'
  END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY
  CASE WHEN NOT c.relrowsecurity THEN 0 ELSE 1 END,
  c.relname;

-- Expected: All tables show rls = 'ON'. Tables with 0 policies should be
-- limited to known service-role-only tables.
