-- scripts/recovery/09_validate_edge_function_rpcs.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- Read-only validation. Checks that RPCs called by the four AI Edge Functions
-- (foxy-tutor, ncert-solver, quiz-generator, cme-engine) exist with the correct
-- argument counts. A missing RPC causes a silent 500 error from the Edge Function
-- that the student sees as a broken AI response.
--
-- RISKS: None. Read-only queries only.
-- EXECUTION ORDER: Step 9 — run after repair migrations have been applied.
-- DEPENDENCIES: pg_proc, pg_namespace accessible.
-- IDEMPOTENCY: N/A — read-only.

-- ============================================================================
-- 1. RPCs called by foxy-tutor Edge Function
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  pg_get_function_arguments(p.oid) AS arguments,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED'
  END AS search_path_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_rag_chunks_for_node',          -- retrieval
    'get_rag_context_for_adaptive',     -- adaptive retrieval
    'get_foxy_quota',                   -- daily limit enforcement
    'get_chapter_concepts',             -- concept graph lookup
    'get_ncert_questions',              -- NCERT question retrieval
    'rag_validate_answer',              -- grounding validation
    'rag_resolve_chapter',              -- chapter resolver
    'get_rag_context_for_cme',          -- CME retrieval
    'get_rag_context_for_sr_card'       -- SRS retrieval
  )
ORDER BY p.proname;

-- Expected: all 9 RPCs present with search_path pinned.

-- ============================================================================
-- 2. RPCs called by quiz-generator Edge Function
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED'
  END AS search_path_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_verification_batch',         -- verification batch claim
    'submit_quiz_results_v2',           -- submission
    'get_quiz_questions',               -- question fetch
    'start_quiz_session'                -- session initialization
  )
ORDER BY p.proname;

-- Expected: all 4 RPCs present.

-- ============================================================================
-- 3. RPCs called by cme-engine Edge Function
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED'
  END AS search_path_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_concept_bkt_state',            -- BKT state read
    'update_bkt_mastery',               -- BKT mastery update
    'bkt_update',                       -- low-level BKT update
    'compute_post_quiz_action'          -- CME next action computation
  )
ORDER BY p.proname;

-- Expected: all 4 RPCs present.

-- ============================================================================
-- 4. RPCs required by the auth/onboarding flow (P15)
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  CASE WHEN p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%'
       THEN 'pinned'
       ELSE 'UNPINNED'
  END AS search_path_status,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'INVOKER' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'bootstrap_user_profile',
    'activate_subscription',
    'atomic_subscription_activation',
    'activate_free_subscription'
  )
ORDER BY p.proname;

-- Expected: all 4 present. Missing bootstrap_user_profile breaks signup (P15).

-- ============================================================================
-- 5. Quiz submission RPC variants (P4 atomicity)
-- ============================================================================

SELECT
  p.proname AS function_name,
  p.pronargs AS arg_count,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'atomic_quiz_profile_update',
    'submit_quiz_results',
    'submit_quiz_results_v2',
    'submit_mock_test_attempt'
  )
ORDER BY p.proname, p.pronargs;

-- Expected:
--   atomic_quiz_profile_update: 2 variants (7-arg and 8-arg)
--   submit_quiz_results: 1 variant (7-arg v1, mobile path)
--   submit_quiz_results_v2: 1 variant (9-arg with idempotency_key)
--   submit_mock_test_attempt: 1 variant (5-arg)
-- If submit_quiz_results_v2 has only 8 args, migration 20260504100200
-- (Phase 2.8 idempotency) did not apply.

-- ============================================================================
-- 6. Function search_path pin summary (all public functions)
-- ============================================================================

SELECT
  COUNT(*) FILTER (WHERE p.proconfig IS NOT NULL AND p.proconfig::text ILIKE '%search_path%') AS pinned_count,
  COUNT(*) FILTER (WHERE p.proconfig IS NULL OR p.proconfig::text NOT ILIKE '%search_path%') AS unpinned_count,
  COUNT(*) AS total_functions
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

-- Expected after 20260614200000 applies:
--   unpinned_count should be significantly lower than before the repair.
--   Target: unpinned_count < 20 (down from ~60+ before repair).
--   The Supabase security advisor will show fewer 'function_search_path_mutable' warns.
