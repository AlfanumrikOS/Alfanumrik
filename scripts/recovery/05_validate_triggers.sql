-- scripts/recovery/05_validate_triggers.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that all expected triggers exist and fire
-- against the correct tables after repair migrations are applied.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 5 — run after repair migrations have been applied.
-- DEPENDENCIES: pg_trigger, pg_class, pg_proc accessible via service_role.
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. All non-internal triggers in the public schema
-- ============================================================================

SELECT
  t.tgname          AS trigger_name,
  c.relname         AS table_name,
  p.proname         AS function_name,
  CASE t.tgtype & 66
    WHEN  2 THEN 'BEFORE'
    WHEN 64 THEN 'INSTEAD OF'
    ELSE         'AFTER'
  END AS timing,
  CASE
    WHEN t.tgtype & 4 > 0 THEN 'INSERT'
    WHEN t.tgtype & 8 > 0 THEN 'DELETE'
    WHEN t.tgtype & 16 > 0 THEN 'UPDATE'
    ELSE 'OTHER'
  END AS event,
  CASE t.tgtype & 1 WHEN 1 THEN 'PER ROW' ELSE 'PER STATEMENT' END AS level
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- Expected: 30-70 trigger rows covering the application's tables.

-- ============================================================================
-- 2. Critical trigger presence check
-- ============================================================================

WITH expected_triggers AS (
  SELECT * FROM (VALUES
    -- table, trigger_name
    ('rag_content_chunks',       'rag_chunks_recompute_trigger'),    -- from baseline
    ('question_bank',            'question_bank_recompute_trigger'),  -- from baseline
    ('payment_reconciliation_queue', 'prq_updated_at_trg'),          -- 20260507140000
    ('school_contracts',         'school_contracts_updated_at_trg'),  -- 20260507150000
    ('exam_papers',              'trg_exam_papers_set_updated_at'),   -- 20260520000005
    ('mock_test_attempts',       'trg_mta_set_updated_at'),           -- 20260520000008
    ('teacher_parent_messages',  'trg_tp_messages_bump_thread'),      -- 20260527000003
    ('data_erasure_requests',    'trg_data_erasure_requests_updated_at'), -- 20260527000006
    ('admin_users',              'trg_sync_admin_user_role'),         -- 20260603150000
    ('students',                 'on_student_created')                -- from baseline
  ) AS t(table_name, trigger_name)
)
SELECT
  e.table_name,
  e.trigger_name,
  CASE WHEN t.tgname IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END AS status
FROM expected_triggers e
LEFT JOIN pg_trigger t ON t.tgname = e.trigger_name
  AND t.tgrelid = (('public.' || e.table_name)::regclass)
ORDER BY e.table_name;

-- Expected: all rows show 'PRESENT'.
-- MISSING rows indicate a migration did not apply or was rolled back.

-- ============================================================================
-- 3. SECURITY DEFINER trigger functions — search_path check
-- ============================================================================

SELECT
  p.proname AS function_name,
  c.relname AS fires_on_table,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED — vulnerable'
  END AS search_path_status
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND p.prosecdef = true  -- SECURITY DEFINER only
ORDER BY p.proname;

-- Expected after 20260614200000: all SECURITY DEFINER trigger functions show 'pinned'.
-- Any 'UNPINNED' row is a security advisory finding.

-- ============================================================================
-- 4. Trigger function bodies — check for known broken patterns
-- ============================================================================

-- Check that sync_user_roles_on_insert uses 'parent' (not 'guardian') for guardians.
SELECT
  CASE
    WHEN pg_get_functiondef(oid) LIKE '%''parent''%'
     AND pg_get_functiondef(oid) NOT LIKE '%''guardian''%'
    THEN 'CORRECT — uses parent role name'
    ELSE 'CHECK NEEDED — may still reference guardian role name'
  END AS sync_user_roles_status
FROM pg_proc
WHERE proname = 'sync_user_roles_on_insert'
  AND pronamespace = 'public'::regnamespace;

-- Expected: 'CORRECT — uses parent role name'
-- If 'CHECK NEEDED': migration 20260603150000 may not have applied.
