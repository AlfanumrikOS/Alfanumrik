-- scripts/recovery/01_diagnose_migration_state.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only diagnostic. Run FIRST before any other recovery action.
-- Checks the state of supabase_migrations.schema_migrations to identify
-- hollow tombstones, version gaps, and non-CI-applied versions.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 1 — run before all other scripts.
-- DEPENDENCIES: Access to supabase_migrations schema (service_role required).
-- IDEMPOTENCY: N/A — read-only.
--
-- HOW TO RUN:
-- In Supabase SQL editor on project shktyoxqhundlvkiwguu, paste and run.
-- Or: psql $DATABASE_URL -f scripts/recovery/01_diagnose_migration_state.sql

-- ============================================================================
-- 1. Total migration count
-- ============================================================================

SELECT
  count(*) AS total_applied_migrations,
  min(version) AS earliest_version,
  max(version) AS latest_version
FROM supabase_migrations.schema_migrations;

-- Expected: 210 rows (as of 2026-06-14 audit).
-- If count differs significantly, investigate before proceeding.

-- ============================================================================
-- 2. Find hollow tombstone migrations (no SQL statements recorded)
-- ============================================================================

SELECT
  version,
  name,
  array_length(statements, 1) AS statement_count,
  created_at
FROM supabase_migrations.schema_migrations
WHERE statements IS NULL
   OR array_length(statements, 1) IS NULL
   OR array_length(statements, 1) = 0
ORDER BY version;

-- Expected after repair migrations are applied: 0 rows (or the 2 known
-- tombstones 20260525130001 and 20260525130002 which are intentional placeholders).
-- If unexpected rows appear, investigate before proceeding.

-- ============================================================================
-- 3. Known hollow tombstones — show their current statement state
-- ============================================================================

SELECT
  version,
  name,
  array_length(statements, 1) AS statement_count,
  created_at,
  CASE
    WHEN array_length(statements, 1) IS NULL OR array_length(statements, 1) = 0
    THEN 'HOLLOW — was never applied'
    ELSE 'has_statements'
  END AS status
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260525130001', '20260525130002')
ORDER BY version;

-- ============================================================================
-- 4. Show last 15 applied migrations with their statement counts
-- ============================================================================

SELECT
  version,
  name,
  array_length(statements, 1) AS statement_count,
  created_at
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 15;

-- ============================================================================
-- 5. Repair migration presence check
-- ============================================================================

SELECT
  version,
  name,
  array_length(statements, 1) AS statement_count,
  created_at
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260614200000', '20260614200001', '20260614200002')
ORDER BY version;

-- Expected after deploy: 3 rows with statement_count > 0.
-- If 0 rows: repair migrations have not been applied yet.

-- ============================================================================
-- 6. Baseline marker — confirm version 00000000000000 is present
-- ============================================================================

SELECT
  version,
  name,
  array_length(statements, 1) AS statement_count,
  created_at
FROM supabase_migrations.schema_migrations
WHERE version = '00000000000000';

-- Expected: 1 row. If missing, this is not a baseline-initialized project.

-- ============================================================================
-- 7. Any versions that don't match the YYYYMMDDHHMMSS format (anomalies)
-- ============================================================================

SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version !~ '^\d{14}$'
  AND version != '00000000000000'
ORDER BY version;

-- Expected: 0 rows. Any non-timestamp version is an anomaly to investigate.

-- ============================================================================
-- 8. Version gap analysis — find any unexpected gaps in the timeline
-- ============================================================================

WITH ordered AS (
  SELECT
    version,
    LAG(version) OVER (ORDER BY version) AS prev_version
  FROM supabase_migrations.schema_migrations
  WHERE version != '00000000000000'
)
SELECT
  prev_version AS version_before_gap,
  version AS version_after_gap
FROM ordered
WHERE prev_version IS NOT NULL
  -- Flag gaps of more than 30 days (2,592,000 seconds ≈ 30 days in YYYYMMDDHHMMSS)
  AND (version::bigint - prev_version::bigint) > 25920000
ORDER BY version;

-- Expected: 0 rows or expected known gaps (e.g. between legacy batch and current chain).
