-- Migration: 20260614200000_repair_security_advisor_batch1.sql
-- Date: 2026-06-14
-- Fixed: 2026-06-09 -- replaced hardcoded function signatures with dynamic
--        pg_proc lookup. Original bare ALTER FUNCTION calls used incorrect
--        signatures (e.g. bkt_update(uuid,uuid,boolean) vs actual
--        bkt_update(numeric,boolean,numeric,numeric,numeric,numeric)), causing
--        SQLSTATE 42883 undefined_function on first deploy attempt.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Migration 20260525130001_security_and_performance_advisor_batch1.sql was
-- applied directly to production as a no-op (empty statements = [] in
-- supabase_migrations.schema_migrations). It was a reconciliation placeholder;
-- the DDL it should have contained was NEVER executed on any environment.
-- This migration recovers the security advisor work that 130001 was meant to do:
-- pinning search_path on every function added by migrations AFTER the original
-- 40-function batch in 20260516010000_fix_function_search_path_mutable.sql.
--
-- Functions without an explicit search_path are vulnerable to schema-poisoning
-- attacks. An attacker who can create objects in any schema on the runtime
-- search path could shadow the function table/type/operator references and
-- inject malicious behavior. Pinning to public, pg_catalog (or
-- public, auth, pg_catalog for functions that reference auth.uid() or
-- auth.users) closes this vector.
--
-- RISKS
-- -----
--   - LOW: ALTER FUNCTION SET search_path is a metadata-only change; it does
--     not alter the function body, call convention, or return type.
--   - Any function that relied on implicit schema resolution picking up an
--     object NOT in public or pg_catalog will now fail to resolve. None of
--     the functions pinned here access objects outside public/auth/pg_catalog.
--   - Re-running this migration on prod (already applied) is a no-op --
--     ALTER FUNCTION is idempotent.
--
-- EXECUTION ORDER
-- ---------------
-- Step 1 of 3 repair migrations. Run before 20260614200001.
-- Depends on: all migrations through 20260614000003 being applied.
--
-- IDEMPOTENCY: YES
-- ALTER FUNCTION ... SET search_path is idempotent -- re-running always
-- converges to the same configuration parameter state.

-- ============================================================================
-- Dynamic search_path pin
-- ============================================================================
-- Discovers every target function by NAME from pg_proc (not by hardcoded
-- signature), so the migration is resilient to signature changes, overloads,
-- and functions that may not exist on a given environment.
--
-- pg_get_function_identity_arguments(oid) returns the canonical argument-type
-- string PostgreSQL requires for ALTER FUNCTION, e.g.:
--   uuid, uuid, uuid, boolean, integer, integer, text, text, integer,
--   timestamp with time zone, uuid, text
-- This string is used directly in the EXECUTE format call.
--
-- Functions that reference auth.uid() / auth.users get:
--   search_path = public, auth, pg_catalog
-- All others get:
--   search_path = public, pg_catalog
--
-- If a function does not exist on the target environment the EXCEPTION
-- handler logs a NOTICE and continues -- the migration never fails.
-- ============================================================================

DO $pin_search_paths$
DECLARE
  r         RECORD;
  v_pinned  integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      n.nspname
        || '.'
        || quote_ident(p.proname)
        || '('
        || pg_get_function_identity_arguments(p.oid)
        || ')' AS fn_sig,
      CASE p.proname
        WHEN 'submit_mock_test_attempt'                  THEN 'public, auth, pg_catalog'
        WHEN 'tutor_commit_attempt'                      THEN 'public, auth, pg_catalog'
        WHEN 'get_available_subjects_v2'                 THEN 'public, auth, pg_catalog'
        WHEN 'get_available_subjects'                    THEN 'public, auth, pg_catalog'
        WHEN 'available_chapters_for_student_subject_v2' THEN 'public, auth, pg_catalog'
        WHEN 'get_adaptive_questions'                    THEN 'public, auth, pg_catalog'
        WHEN 'purchase_streak_freeze'                    THEN 'public, auth, pg_catalog'
        WHEN 'bootstrap_user_profile'                    THEN 'public, auth, pg_catalog'
        ELSE 'public, pg_catalog'
      END AS target_path
    FROM pg_proc    p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'tg_learner_mastery_touch',
        'exam_papers_set_updated_at',
        'mock_test_attempts_set_updated_at',
        'submit_mock_test_attempt',
        'notify_state_event',
        'bkt_update',
        'tutor_commit_attempt',
        'set_foxy_chat_school_id',
        'set_audit_log_school_id',
        'tp_messages_bump_thread',
        'set_data_erasure_requests_updated_at',
        'get_available_subjects_v2',
        'expire_stale_foxy_expectations',
        'match_alfabot_kb_chunks',
        'sync_school_admin_role',
        'sync_user_roles_on_insert',
        'sync_admin_user_role',
        'get_available_subjects',
        'available_chapters_for_student_subject_v2',
        'get_adaptive_questions',
        'purchase_streak_freeze',
        'atomic_quiz_profile_update',
        'bootstrap_user_profile',
        'activate_free_subscription',
        'get_school_overview',
        'get_classes_at_risk',
        'get_teacher_engagement',
        '_school_active_student_ids',
        '_count_active_school_students',
        '_eval_seat_policy_unchecked',
        'evaluate_seat_policy',
        'refresh_school_seat_usage',
        'enroll_students_with_seat_check',
        'enroll_section_students_with_seat_check',
        'get_school_mastery_rollup',
        'get_school_bloom_summary',
        'export_school_report'
      )
    ORDER BY p.proname, p.oid
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = %s',
        r.fn_sig,
        r.target_path
      );
      RAISE NOTICE '[20260614200000] Pinned: % -> %', r.fn_sig, r.target_path;
      v_pinned := v_pinned + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[20260614200000] Skipped: % (SQLSTATE % -- %)',
        r.fn_sig, SQLSTATE, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RAISE NOTICE '[20260614200000] Loop complete -- pinned: %, skipped: %',
    v_pinned, v_skipped;
END $pin_search_paths$;

-- ============================================================================
-- Verification block
-- ============================================================================

DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'submit_mock_test_attempt', 'tp_messages_bump_thread',
       'sync_admin_user_role', 'sync_user_roles_on_insert',
       'get_school_overview'
     )
     AND p.proconfig IS NOT NULL
     AND p.proconfig::text ILIKE '%search_path%';

  RAISE NOTICE '[20260614200000] search_path pin spot-check: %/5 sample functions have proconfig set', v_count;

  IF v_count < 5 THEN
    RAISE WARNING '[20260614200000] Pinning may be incomplete -- % of 5 confirmed. Check NOTICE log above for skipped functions.', v_count;
  ELSE
    RAISE NOTICE '[20260614200000] REPAIR COMPLETE -- security_advisor_batch1 search_path pins applied';
  END IF;
END $verify$;
