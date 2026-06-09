-- scripts/recovery/07_validate_auth_dependencies.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that functions and FK columns referencing
-- auth.users are intact and correctly configured. Any breakage here would
-- cause login failures or RLS bypass.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 7 — run after repair migrations have been applied.
-- DEPENDENCIES: auth schema must be accessible (service_role required).
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. FK columns referencing auth.users
-- ============================================================================

SELECT
  tc.table_name       AS child_table,
  kcu.column_name     AS fk_column,
  rc.delete_rule
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
  AND ccu.table_schema = 'auth'
  AND ccu.table_name = 'users'
ORDER BY tc.table_name, kcu.column_name;

-- Expected: students.auth_user_id, teachers.auth_user_id, guardians.auth_user_id,
-- admin_users.auth_user_id, mock_test_attempts.student_id, exam_papers.imported_by.

-- ============================================================================
-- 2. Functions that reference auth.uid() — confirm search_path includes auth
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  CASE
    WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%auth%' THEN 'has auth in search_path'
    WHEN p.proconfig IS NOT NULL THEN 'search_path set (no auth)'
    ELSE 'NO search_path set'
  END AS auth_search_path,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_mode,
  -- Body contains auth.uid() reference?
  CASE WHEN pg_get_functiondef(p.oid) ILIKE '%auth.uid()%' THEN 'YES' ELSE 'no' END AS body_refs_auth_uid
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%auth.uid()%'
ORDER BY p.proname;

-- Expected: all rows show 'has auth in search_path'.
-- Any function that references auth.uid() but has no auth in its search_path
-- is relying on the runtime search_path, which is a security advisory finding.

-- ============================================================================
-- 3. bootstrap_user_profile RPC — signature check
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  pg_get_function_arguments(p.oid) AS argument_types,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%auth%'
       THEN 'auth in search_path'
       ELSE 'NO auth in search_path'
  END AS auth_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'bootstrap_user_profile'
ORDER BY p.pronargs;

-- Expected: function exists with SECURITY DEFINER and auth in search_path.

-- ============================================================================
-- 4. on_auth_user_created trigger — critical for signup flow (P15)
-- ============================================================================

SELECT
  t.tgname   AS trigger_name,
  c.relname  AS table_name,
  p.proname  AS function_name,
  n2.nspname AS function_schema
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n2 ON n2.oid = p.pronamespace
WHERE t.tgname LIKE '%user_created%'
  OR t.tgname LIKE '%auth%'
ORDER BY t.tgname;

-- Expected: trigger on auth.users that fires on INSERT to create profile rows.
-- If missing, the signup→profile flow (P15) is broken.

-- ============================================================================
-- 5. RLS policies that use auth.uid() — confirm they compile
-- ============================================================================

SELECT
  c.relname AS table_name,
  pol.polname AS policy_name,
  CASE
    WHEN pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%auth.uid()%' THEN 'uses auth.uid() in USING'
    WHEN pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%auth.uid()%' THEN 'uses auth.uid() in WITH CHECK'
    ELSE 'other'
  END AS auth_usage
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (
    pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%auth.uid()%'
    OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%auth.uid()%'
  )
ORDER BY c.relname, pol.polname
LIMIT 50;

-- Expected: a substantial list of policies using auth.uid(). If zero rows:
-- something is deeply wrong with the policy definitions or auth schema access.
