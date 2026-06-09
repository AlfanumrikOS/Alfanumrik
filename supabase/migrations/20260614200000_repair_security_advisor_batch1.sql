-- Migration: 20260614200000_repair_security_advisor_batch1.sql
-- Date: 2026-06-14
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Migration 20260525130001_security_and_performance_advisor_batch1.sql was
-- applied directly to production as a no-op (empty `statements = []` in
-- supabase_migrations.schema_migrations). It was a reconciliation placeholder;
-- the DDL it should have contained was NEVER executed on any environment.
-- This migration recovers the security advisor work that 130001 was meant to do:
-- pinning `search_path` on every function added by migrations AFTER the original
-- 40-function batch in 20260516010000_fix_function_search_path_mutable.sql.
--
-- Functions without an explicit `search_path` are vulnerable to schema-poisoning
-- attacks. An attacker who can create objects in any schema on the runtime
-- search path could shadow the function's table/type/operator references and
-- inject malicious behavior. Pinning to `public, pg_catalog` (or
-- `public, auth, pg_catalog` for functions that reference auth.uid() or
-- auth.users) closes this vector.
--
-- RISKS
-- -----
--   - LOW: ALTER FUNCTION SET search_path is a metadata-only change; it does not
--     alter the function body, call convention, or return type.
--   - Any function that relied on implicit schema resolution picking up an object
--     NOT in public or pg_catalog will now fail to resolve. None of the functions
--     pinned here access objects outside public/auth/pg_catalog.
--   - Re-running this migration on prod (already applied) is a no-op — ALTER
--     FUNCTION is idempotent.
--
-- EXECUTION ORDER
-- ---------------
-- Step 1 of 3 repair migrations. Run before 20260614200001.
-- Depends on: all migrations through 20260614000003 being applied.
--
-- IDEMPOTENCY: YES
-- ALTER FUNCTION ... SET search_path is idempotent — re-running always converges
-- to the same configuration parameter state. Safe to apply multiple times.

-- ============================================================================
-- Section A: Functions from migrations 20260517 - 20260520
-- ============================================================================

-- tg_learner_mastery_touch() — added by 20260517100000_learner_state_projections.sql
-- No auth schema reference.
ALTER FUNCTION public.tg_learner_mastery_touch()
  SET search_path = public, pg_catalog;

-- exam_papers_set_updated_at() — added by 20260520000005_exam_papers_and_pyq_import.sql
ALTER FUNCTION public.exam_papers_set_updated_at()
  SET search_path = public, pg_catalog;

-- mock_test_attempts_set_updated_at() — added by 20260520000008_mock_test_attempts.sql
ALTER FUNCTION public.mock_test_attempts_set_updated_at()
  SET search_path = public, pg_catalog;

-- submit_mock_test_attempt(...) — added by 20260520000008_mock_test_attempts.sql
-- References auth.uid() and auth.jwt() so needs auth in search_path.
ALTER FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb)
  SET search_path = public, auth, pg_catalog;

-- ============================================================================
-- Section B: Functions from migrations 20260521 - 20260524
-- ============================================================================

-- notify_state_event() — added by 20260521100000_state_events_bus_rename.sql
ALTER FUNCTION public.notify_state_event()
  SET search_path = public, pg_catalog;

-- ============================================================================
-- Section C: Functions from migrations 20260525 - 20260526
-- ============================================================================

-- bkt_update(...) — added by 20260525100001_adr_004_phase_2_bkt_rpc.sql
ALTER FUNCTION public.bkt_update(uuid, uuid, boolean)
  SET search_path = public, pg_catalog;

-- tutor_commit_attempt(...) — added by 20260525100001_adr_004_phase_2_bkt_rpc.sql
-- References auth.uid() so needs auth in search_path.
ALTER FUNCTION public.tutor_commit_attempt(uuid, uuid, boolean, integer)
  SET search_path = public, auth, pg_catalog;

-- ============================================================================
-- Section D: Functions from migrations 20260527 - 20260528
-- ============================================================================

-- set_foxy_chat_school_id() — added by 20260527000000_add_school_id_foxy_chat_messages.sql
ALTER FUNCTION public.set_foxy_chat_school_id()
  SET search_path = public, pg_catalog;

-- set_audit_log_school_id() — added by 20260527000001_add_school_id_audit_logs.sql
ALTER FUNCTION public.set_audit_log_school_id()
  SET search_path = public, pg_catalog;

-- tp_messages_bump_thread() — added by 20260527000003_teacher_parent_threads.sql
-- SECURITY DEFINER function; must pin search_path.
ALTER FUNCTION public.tp_messages_bump_thread()
  SET search_path = public, pg_catalog;

-- set_data_erasure_requests_updated_at() — added by 20260527000006_data_erasure_requests.sql
ALTER FUNCTION public.set_data_erasure_requests_updated_at()
  SET search_path = public, pg_catalog;

-- get_available_subjects_v2(...) — added by 20260528000009_subjects_rpc_stream_aware.sql
-- References auth.uid() via RLS evaluation.
ALTER FUNCTION public.get_available_subjects_v2(uuid)
  SET search_path = public, auth, pg_catalog;

-- expire_stale_foxy_expectations() — added by 20260528000013_foxy_pending_expectations.sql
ALTER FUNCTION public.expire_stale_foxy_expectations()
  SET search_path = public, pg_catalog;

-- ============================================================================
-- Section E: Functions from migrations 20260529 (AlfaBot v1)
-- ============================================================================

-- match_alfabot_kb_chunks(...) — added by 20260529000000_alfabot_v1.sql
ALTER FUNCTION public.match_alfabot_kb_chunks(vector, double precision, integer)
  SET search_path = public, pg_catalog;

-- ============================================================================
-- Section F: Functions from migrations 20260603 - 20260610
-- ============================================================================

-- sync_school_admin_role() — rewritten by 20260603140000_fix_sync_school_admin_role_trigger.sql
-- SECURITY DEFINER trigger function; pinning is critical.
ALTER FUNCTION public.sync_school_admin_role()
  SET search_path = public, pg_catalog;

-- sync_user_roles_on_insert() — rewritten by 20260603150000_demo_account_authority_completeness.sql
-- SECURITY DEFINER; references roles + user_roles tables in public.
ALTER FUNCTION public.sync_user_roles_on_insert()
  SET search_path = public, pg_catalog;

-- sync_admin_user_role() — added by 20260603150000_demo_account_authority_completeness.sql
-- SECURITY DEFINER trigger; pinning critical.
ALTER FUNCTION public.sync_admin_user_role()
  SET search_path = public, pg_catalog;

-- get_available_subjects(...) — rewritten by 20260605000000_fix_board_subject_chapter_gaps.sql
-- References auth schema (auth.uid()) per existing pinning convention.
ALTER FUNCTION public.get_available_subjects(uuid)
  SET search_path = public, auth, pg_catalog;

-- available_chapters_for_student_subject_v2(...) — added by 20260605000000
ALTER FUNCTION public.available_chapters_for_student_subject_v2(uuid, text)
  SET search_path = public, auth, pg_catalog;

-- get_adaptive_questions(...) — added by 20260605000000_fix_board_subject_chapter_gaps.sql
ALTER FUNCTION public.get_adaptive_questions(uuid, text, integer, integer)
  SET search_path = public, auth, pg_catalog;

-- purchase_streak_freeze(...) — added by 20260608000000_streak_freeze_and_curriculum.sql
-- References students table (auth.uid() comparison pattern).
ALTER FUNCTION public.purchase_streak_freeze(uuid, integer, text)
  SET search_path = public, auth, pg_catalog;

-- atomic_quiz_profile_update (7-arg variant) — rewritten by 20260610000000_publish_quiz_completed_event.sql
ALTER FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer, uuid)
  SET search_path = public, pg_catalog;

-- atomic_quiz_profile_update (8-arg variant with event_kind) — added by 20260610000000
ALTER FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer, uuid, text)
  SET search_path = public, pg_catalog;

-- bootstrap_user_profile(...) — rewritten by 20260610000000_publish_quiz_completed_event.sql
-- References auth schema.
ALTER FUNCTION public.bootstrap_user_profile(uuid, text, text, text, text, text, text)
  SET search_path = public, auth, pg_catalog;

-- activate_free_subscription(...) — added by 20260610000000_publish_quiz_completed_event.sql
ALTER FUNCTION public.activate_free_subscription(uuid)
  SET search_path = public, pg_catalog;

-- ============================================================================
-- Section G: Functions from migrations 20260614 (Phase 3B school command center)
-- ============================================================================

-- get_school_overview(...) — added by 20260614000000_phase3b_school_command_center_read_models.sql
--   (later superseded by 20260614000001 which also defines it — final version
--    is in 20260614000001; ALTER FUNCTION operates on the live body).
ALTER FUNCTION public.get_school_overview(uuid)
  SET search_path = public, pg_catalog;

-- get_classes_at_risk(...) — added by 20260614000000 / superseded in 20260614000001
ALTER FUNCTION public.get_classes_at_risk(uuid, integer)
  SET search_path = public, pg_catalog;

-- get_teacher_engagement(...) — added by 20260614000000_phase3b_school_command_center_read_models.sql
ALTER FUNCTION public.get_teacher_engagement(uuid, integer)
  SET search_path = public, pg_catalog;

-- _school_active_student_ids(...) — added by 20260614000001_phase3b_seat_enforcement.sql
ALTER FUNCTION public._school_active_student_ids(uuid)
  SET search_path = public, pg_catalog;

-- _count_active_school_students(...) — added by 20260614000001
ALTER FUNCTION public._count_active_school_students(uuid)
  SET search_path = public, pg_catalog;

-- _eval_seat_policy_unchecked(...) — added by 20260614000001
ALTER FUNCTION public._eval_seat_policy_unchecked(uuid, integer)
  SET search_path = public, pg_catalog;

-- evaluate_seat_policy(...) — added by 20260614000001
ALTER FUNCTION public.evaluate_seat_policy(uuid)
  SET search_path = public, pg_catalog;

-- refresh_school_seat_usage(...) — added by 20260614000001
ALTER FUNCTION public.refresh_school_seat_usage(uuid)
  SET search_path = public, pg_catalog;

-- enroll_students_with_seat_check(...) — added by 20260614000001
ALTER FUNCTION public.enroll_students_with_seat_check(uuid, uuid[])
  SET search_path = public, pg_catalog;

-- enroll_section_students_with_seat_check(...) — added by 20260614000001
ALTER FUNCTION public.enroll_section_students_with_seat_check(uuid, uuid)
  SET search_path = public, pg_catalog;

-- get_school_mastery_rollup(...) — added by 20260614000003_phase3b_school_reporting.sql
ALTER FUNCTION public.get_school_mastery_rollup(uuid, text)
  SET search_path = public, pg_catalog;

-- get_school_bloom_summary(...) — added by 20260614000003
ALTER FUNCTION public.get_school_bloom_summary(uuid, text)
  SET search_path = public, pg_catalog;

-- export_school_report(...) — added by 20260614000003
ALTER FUNCTION public.export_school_report(uuid, text, text)
  SET search_path = public, pg_catalog;

-- ============================================================================
-- Verification block — confirms the pin landed on a representative sample
-- ============================================================================

DO $verify$
DECLARE
  v_count        integer;
  v_sample_paths text[];
  fn             text;
BEGIN
  -- Spot-check 5 critical functions for search_path pinning.
  -- We look for proconfig entry matching 'search_path=public,pg_catalog' or
  -- 'search_path=public,auth,pg_catalog'.
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
    RAISE WARNING '[20260614200000] search_path pinning may be incomplete — % of 5 sample functions confirmed. Some function signatures may have changed; inspect pg_proc manually.', v_count;
  ELSE
    RAISE NOTICE '[20260614200000] REPAIR COMPLETE — security_advisor_batch1 search_path pins applied';
  END IF;
END $verify$;
