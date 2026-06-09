-- scripts/recovery/03_validate_foreign_keys.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks for orphaned FK rows in tables added by
-- recent migrations. Only checks tables added AFTER the baseline (2026-05-03)
-- to keep the query scope manageable and avoid scanning large legacy tables.
--
-- RISKS: None. Read-only queries with EXISTS checks (no full scans on large tables).
-- EXECUTION ORDER: Step 3 — run after 02_validate_schema_completeness.sql.
-- DEPENDENCIES: Tables from migrations 20260507 onward must exist.
-- IDEMPOTENCY: N/A — read-only.
--
-- NOTE: These queries use NOT EXISTS subqueries, which are performance-safe
-- on new/small tables. Do NOT run against large legacy tables (students, etc.)
-- without a full COUNT(*) estimate first.

-- ============================================================================
-- 1. FK map for recently-created tables
-- ============================================================================

SELECT
  tc.table_name       AS child_table,
  kcu.column_name     AS fk_column,
  ccu.table_name      AS parent_table,
  ccu.column_name     AS parent_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
  AND kcu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
  AND rc.constraint_schema = tc.constraint_schema
JOIN information_schema.key_column_usage ccu
  ON ccu.constraint_name = rc.unique_constraint_name
  AND ccu.table_schema = rc.unique_constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'payment_reconciliation_queue',
    'invoice_number_sequences',
    'school_contracts',
    'contract_number_sequences',
    'exam_papers',
    'mock_test_attempts',
    'mock_test_responses',
    'teacher_parent_threads',
    'teacher_parent_messages',
    'parental_consent',
    'data_erasure_requests',
    'parent_cheers'
  )
ORDER BY tc.table_name, kcu.column_name;

-- ============================================================================
-- 2. Orphan check — payment_reconciliation_queue
-- ============================================================================

SELECT
  'payment_reconciliation_queue → school_invoices' AS check_name,
  count(*) AS orphaned_rows
FROM public.payment_reconciliation_queue prq
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_invoices si WHERE si.id = prq.invoice_id
);

SELECT
  'payment_reconciliation_queue → schools' AS check_name,
  count(*) AS orphaned_rows
FROM public.payment_reconciliation_queue prq
WHERE NOT EXISTS (
  SELECT 1 FROM public.schools s WHERE s.id = prq.school_id
);

-- Expected: both 0. Non-zero means a school_invoice or school was deleted
-- without first cancelling/reconciling the queue row (violated RESTRICT).

-- ============================================================================
-- 3. Orphan check — mock_test_attempts
-- ============================================================================

SELECT
  'mock_test_attempts → exam_papers' AS check_name,
  count(*) AS orphaned_rows
FROM public.mock_test_attempts mta
WHERE NOT EXISTS (
  SELECT 1 FROM public.exam_papers ep WHERE ep.id = mta.exam_paper_id
);

-- Note: student_id is auth.users.id (not students.id) in this table.
-- We check auth.users existence via supabase auth schema.
SELECT
  'mock_test_attempts → auth.users' AS check_name,
  count(*) AS orphaned_rows
FROM public.mock_test_attempts mta
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = mta.student_id
);

-- ============================================================================
-- 4. Orphan check — mock_test_responses
-- ============================================================================

SELECT
  'mock_test_responses → mock_test_attempts' AS check_name,
  count(*) AS orphaned_rows
FROM public.mock_test_responses mtr
WHERE NOT EXISTS (
  SELECT 1 FROM public.mock_test_attempts mta WHERE mta.id = mtr.attempt_id
);

SELECT
  'mock_test_responses → question_bank' AS check_name,
  count(*) AS orphaned_rows
FROM public.mock_test_responses mtr
WHERE NOT EXISTS (
  SELECT 1 FROM public.question_bank qb WHERE qb.id = mtr.question_id
);

-- ============================================================================
-- 5. Orphan check — teacher_parent_threads
-- ============================================================================

SELECT
  'teacher_parent_threads → teachers' AS check_name,
  count(*) AS orphaned_rows
FROM public.teacher_parent_threads tpt
WHERE NOT EXISTS (
  SELECT 1 FROM public.teachers t WHERE t.id = tpt.teacher_id
);

SELECT
  'teacher_parent_threads → guardians' AS check_name,
  count(*) AS orphaned_rows
FROM public.teacher_parent_threads tpt
WHERE NOT EXISTS (
  SELECT 1 FROM public.guardians g WHERE g.id = tpt.guardian_id
);

SELECT
  'teacher_parent_threads → students' AS check_name,
  count(*) AS orphaned_rows
FROM public.teacher_parent_threads tpt
WHERE NOT EXISTS (
  SELECT 1 FROM public.students s WHERE s.id = tpt.student_id
);

-- ============================================================================
-- 6. Orphan check — teacher_parent_messages
-- ============================================================================

SELECT
  'teacher_parent_messages → teacher_parent_threads' AS check_name,
  count(*) AS orphaned_rows
FROM public.teacher_parent_messages tpm
WHERE NOT EXISTS (
  SELECT 1 FROM public.teacher_parent_threads tpt WHERE tpt.id = tpm.thread_id
);

-- ============================================================================
-- 7. Orphan check — parental_consent
-- ============================================================================

SELECT
  'parental_consent → guardians' AS check_name,
  count(*) AS orphaned_rows
FROM public.parental_consent pc
WHERE NOT EXISTS (
  SELECT 1 FROM public.guardians g WHERE g.id = pc.guardian_id
);

SELECT
  'parental_consent → students' AS check_name,
  count(*) AS orphaned_rows
FROM public.parental_consent pc
WHERE NOT EXISTS (
  SELECT 1 FROM public.students s WHERE s.id = pc.student_id
);

-- ============================================================================
-- 8. Orphan check — parent_cheers
-- ============================================================================

SELECT
  'parent_cheers → guardians' AS check_name,
  count(*) AS orphaned_rows
FROM public.parent_cheers pc
WHERE NOT EXISTS (
  SELECT 1 FROM public.guardians g WHERE g.id = pc.guardian_id
);

SELECT
  'parent_cheers → students' AS check_name,
  count(*) AS orphaned_rows
FROM public.parent_cheers pc
WHERE NOT EXISTS (
  SELECT 1 FROM public.students s WHERE s.id = pc.student_id
);

-- ============================================================================
-- 9. Summary: count tables with non-zero orphan potential
-- ============================================================================

SELECT
  table_name,
  pg_total_relation_size(('public.' || table_name)::regclass) AS total_bytes,
  (SELECT reltuples::bigint FROM pg_class WHERE relname = table_name) AS estimated_rows
FROM (VALUES
  ('payment_reconciliation_queue'),
  ('mock_test_attempts'),
  ('mock_test_responses'),
  ('teacher_parent_threads'),
  ('teacher_parent_messages'),
  ('parental_consent'),
  ('parent_cheers'),
  ('data_erasure_requests')
) AS t(table_name)
ORDER BY table_name;

-- Expected: all recently-created tables have small row counts (< 10k).
-- If any shows millions of rows, the orphan checks above may be slow.
