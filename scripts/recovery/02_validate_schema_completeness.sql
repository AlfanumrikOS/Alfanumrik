-- scripts/recovery/02_validate_schema_completeness.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that critical database objects required by
-- the application exist with expected signatures.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 2 — run after 01_diagnose_migration_state.sql.
-- DEPENDENCIES: service_role access to pg_proc, pg_class, information_schema.
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. Critical RPCs — existence and argument count check
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED'
  END AS search_path_status,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'atomic_quiz_profile_update',
    'submit_quiz_results_v2',
    'start_quiz_session',
    'bootstrap_user_profile',
    'activate_subscription',
    'atomic_subscription_activation',
    'get_student_snapshot',
    'get_quiz_questions',
    'reconcile_payment',
    'next_invoice_number',
    'next_contract_number',
    'submit_mock_test_attempt',
    'bkt_update',
    'tutor_commit_attempt',
    'get_available_subjects',
    'get_available_subjects_v2',
    'evaluate_seat_policy',
    'get_school_overview',
    'export_school_report'
  )
ORDER BY p.proname, p.pronargs;

-- ============================================================================
-- 2. Critical tables — existence and RLS check
-- ============================================================================

SELECT
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'RLS ON' ELSE 'RLS OFF' END AS rls_status,
  (
    SELECT count(*)
    FROM pg_policy pol
    WHERE pol.polrelid = c.oid
  ) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'  -- regular tables only
  AND c.relname IN (
    -- Core tables
    'students', 'teachers', 'guardians', 'schools', 'admin_users',
    -- Quiz tables
    'quiz_sessions', 'quiz_responses', 'quiz_session_shuffles',
    'question_bank', 'exam_papers',
    -- Payment tables
    'school_invoices', 'school_subscriptions', 'student_subscriptions',
    'payment_reconciliation_queue', 'invoice_number_sequences',
    -- Pedagogy v2
    'dive_artifacts', 'monthly_synthesis_runs', 'phenomena',
    -- JEE/NEET
    'mock_test_attempts', 'mock_test_responses',
    -- Phase 3B school
    'school_contracts', 'contract_number_sequences',
    -- Phase 5 / prod-readiness
    'parental_consent', 'data_erasure_requests',
    'teacher_parent_threads', 'teacher_parent_messages',
    'parent_cheers',
    -- Spine / learner loop
    'state_events'
  )
ORDER BY c.relname;

-- Expected: All tables present with RLS ON and policy_count > 0.
-- Any table with RLS OFF is a P8 violation.

-- ============================================================================
-- 3. Public table/view/function counts (within expected ranges)
-- ============================================================================

SELECT
  'tables' AS object_type,
  count(*) AS count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'

UNION ALL

SELECT
  'views',
  count(*)
FROM information_schema.views
WHERE table_schema = 'public'

UNION ALL

SELECT
  'functions',
  count(*)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'

UNION ALL

SELECT
  'triggers',
  count(*)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY object_type;

-- Expected ranges (approximate, as of 2026-06-14):
--   tables:    90-130
--   views:     5-20
--   functions: 120-200
--   triggers:  30-70

-- ============================================================================
-- 4. Baseline marker confirmation
-- ============================================================================

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '00000000000000'
    ) THEN 'baseline PRESENT — project uses new baseline model'
    ELSE 'WARNING: baseline NOT found — legacy migration chain may be in use'
  END AS baseline_status;

-- ============================================================================
-- 5. Critical columns for recent feature migrations
-- ============================================================================

SELECT
  t.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE t.table_schema = 'public'
  AND (
    (t.table_name = 'quiz_sessions'         AND c.column_name = 'idempotency_key')
    OR (t.table_name = 'question_bank'      AND c.column_name = 'exam_paper_id')
    OR (t.table_name = 'question_bank'      AND c.column_name = 'exam_session')
    OR (t.table_name = 'rag_content_chunks' AND c.column_name = 'pack_id')
    OR (t.table_name = 'students'           AND c.column_name = 'weekly_streak_count')
    OR (t.table_name = 'guardians'          AND c.column_name = 'monthly_synthesis_optin')
    OR (t.table_name = 'guardians'          AND c.column_name = 'is_demo')
    OR (t.table_name = 'teachers'           AND c.column_name = 'is_demo')
    OR (t.table_name = 'foxy_chat_messages' AND c.column_name = 'pending')
    OR (t.table_name = 'schools'            AND c.column_name = 'gstin')
  )
ORDER BY t.table_name, c.column_name;

-- Expected: 10 rows. Any missing row indicates a migration did not apply.
