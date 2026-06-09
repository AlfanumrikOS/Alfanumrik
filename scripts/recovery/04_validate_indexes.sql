-- scripts/recovery/04_validate_indexes.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that indexes added by the repair migrations
-- (20260614200000, 20260614200001) are present after deployment.
-- Also provides a general unindexed-FK audit for recently-created tables.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 4 — run after repair migrations have been applied.
-- DEPENDENCIES: pg_indexes, pg_constraint, pg_class must be accessible.
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. Repair indexes from 20260614200001 — presence check
-- ============================================================================

SELECT
  indexname,
  tablename,
  CASE WHEN indexname IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_tp_threads_student_id',
    'idx_tp_messages_sender',
    'idx_parental_consent_version',
    'idx_data_erasure_requests_student',
    'idx_data_erasure_requests_status_created',
    'idx_synthetic_monitor_results_name_checked',
    'idx_synthetic_monitor_results_status',
    'idx_school_slo_log_school_evaluated',
    'idx_grounding_circuit_state_name',
    'idx_admin_login_attempts_user_attempted',
    'idx_parent_cheers_notification_id',
    'idx_teacher_remediation_teacher_id',
    'idx_teacher_remediation_student_id',
    'idx_teacher_remediation_status_assigned',
    'idx_at_risk_alerts_school_status'
  )
ORDER BY indexname;

-- Expected: all 15 rows present. If any are missing, the table may not exist
-- yet (phase3b tables require 20260614000000-000003 to have applied first).

-- ============================================================================
-- 2. Pre-existing indexes from other migrations (spot-check)
-- ============================================================================

SELECT
  indexname,
  tablename,
  'pre-existing' AS source
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    -- From 20260504100200
    'quiz_sessions_idempotency_key_uniq',
    -- From 20260520000004
    'idx_qb_pyq_lookup',
    'idx_qb_paper_pattern',
    -- From 20260520000005
    'idx_exam_papers_family_year',
    'idx_exam_papers_active',
    'idx_question_bank_exam_paper_id',
    -- From 20260520000008
    'idx_mta_student_id',
    'idx_mtr_attempt_id',
    -- From 20260527000003
    'idx_tp_threads_unique_tuple',
    'idx_tp_threads_teacher_recent',
    'idx_tp_messages_thread_created',
    -- From 20260527000004
    'idx_parental_consent_guardian',
    'idx_parental_consent_active',
    -- From 20260613000001
    'idx_parent_cheers_student_created',
    'idx_parent_cheers_guardian_created'
  )
ORDER BY indexname;

-- Expected: all 15 rows. If any are missing, the underlying migration
-- did not apply successfully.

-- ============================================================================
-- 3. Unindexed FK scan — tables added since 2026-05-03
-- ============================================================================
-- This query finds FK columns on recently-created tables that have no
-- index. An unindexed FK causes slow ON DELETE CASCADE/SET NULL operations
-- and slow reverse-lookup queries.

WITH fk_cols AS (
  SELECT
    tc.table_name,
    kcu.column_name AS fk_column,
    ccu.table_name  AS referenced_table
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
    AND kcu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
  JOIN information_schema.key_column_usage ccu
    ON ccu.constraint_name = rc.unique_constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name IN (
      'teacher_parent_threads', 'teacher_parent_messages',
      'parental_consent', 'data_erasure_requests', 'parent_cheers',
      'mock_test_attempts', 'mock_test_responses', 'exam_papers',
      'payment_reconciliation_queue', 'school_contracts'
    )
),
indexed_cols AS (
  SELECT
    t.relname AS table_name,
    a.attname AS column_name
  FROM pg_index ix
  JOIN pg_class t  ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
  WHERE n.nspname = 'public'
    AND ix.indpred IS NULL  -- only non-partial indexes for simplicity
)
SELECT
  fk.table_name,
  fk.fk_column,
  fk.referenced_table,
  CASE WHEN ic.column_name IS NOT NULL THEN 'indexed' ELSE 'UNINDEXED' END AS index_status
FROM fk_cols fk
LEFT JOIN indexed_cols ic
  ON ic.table_name = fk.table_name
  AND ic.column_name = fk.fk_column
ORDER BY fk.table_name, fk.fk_column;

-- Expected after repair migration: all FK columns have index_status = 'indexed'.
-- Any UNINDEXED rows represent gaps to address.

-- ============================================================================
-- 4. Index size summary for repair indexes
-- ============================================================================

SELECT
  indexname,
  tablename,
  pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_tp_threads_student_id',
    'idx_tp_messages_sender',
    'idx_parental_consent_version',
    'idx_data_erasure_requests_student',
    'idx_parent_cheers_notification_id',
    'idx_teacher_remediation_teacher_id'
  )
ORDER BY indexname;

-- Expected: all small (< 100 kB) — these are new tables with few rows.
