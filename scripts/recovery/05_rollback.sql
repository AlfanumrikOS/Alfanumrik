-- =============================================================================
-- scripts/recovery/05_rollback.sql
-- Alfanumrik Learning OS — Emergency rollback script
-- =============================================================================
--
-- DANGER — EMERGENCY USE ONLY
-- ----------------------------
-- This script undoes the 13 pending migrations IN REVERSE ORDER.
-- It removes schema objects (functions, indexes, a column, permission rows,
-- and feature_flag rows) that were added by those migrations.
--
-- BEFORE RUNNING:
--   1. Confirm with the CEO. This script affects production schema.
--   2. Identify the exact symptom driving the rollback (Sentry error, health
--      check failure, broken API route) — document it.
--   3. This script is NON-DESTRUCTIVE in that it never drops data tables or
--      truncates rows of production data. It only removes the OBJECTS added
--      by these migrations.
--   4. Active API routes depend on some of these objects:
--      - /api/schools/command-center/* → get_school_overview, get_classes_at_risk,
--        get_teacher_engagement, get_school_mastery_rollup, get_school_bloom_summary,
--        export_school_report
--      - /api/schools/enroll/* → enroll_students_with_seat_check,
--        enroll_section_students_with_seat_check, evaluate_seat_policy
--      - authorizeRequest() checks → institution.export_reports etc. (Wave C perms)
--      Rolling back while these routes are live WILL cause 500 errors on those
--      routes. Coordinate a Vercel rollback to the previous deployment FIRST,
--      or gate all school-admin routes behind ff_school_provisioning = OFF.
--   5. Take a backup snapshot before running.
--
-- PROPERTIES
-- ----------
--   - Each step is wrapped in BEGIN/EXCEPTION so a failure in one step does
--     not prevent subsequent steps from running.
--   - Every DROP checks existence first (IF EXISTS / NOT EXISTS) — safe to
--     run twice.
--   - Python AI flags are only deleted if is_enabled = false. An enabled flag
--     is NEVER deleted (safety invariant — never roll back an active feature).
--   - After rollback completes, the migration versions are removed from
--     supabase_migrations.schema_migrations so supabase db push can re-apply
--     them cleanly if needed.
--
-- SERVICE ROLE REQUIRED.
-- =============================================================================

-- Progress tracker
CREATE TEMP TABLE IF NOT EXISTS _rollback_log (
  step      text,
  status    text,
  details   text
);

DO $rb_danger_warning$
BEGIN
  RAISE WARNING '=================================================================';
  RAISE WARNING 'ROLLBACK: scripts/recovery/05_rollback.sql';
  RAISE WARNING 'EMERGENCY USE ONLY — confirm with CEO before proceeding.';
  RAISE WARNING 'This script removes schema objects that active API routes depend on.';
  RAISE WARNING '=================================================================';
END $rb_danger_warning$;


-- =============================================================================
-- STEP 1 (of 8): Drop repair indexes from 20260614200001
-- =============================================================================
DO $rb_step1$
DECLARE
  v_dropped integer := 0;
BEGIN
  -- Each index is dropped IF EXISTS — idempotent on double-rollback.
  DROP INDEX IF EXISTS public.idx_tp_threads_student_id;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_tp_messages_sender;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_parental_consent_version;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_data_erasure_requests_student;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_data_erasure_requests_status_created;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_synthetic_monitor_results_name_checked;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_synthetic_monitor_results_status;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_school_slo_log_school_evaluated;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_grounding_circuit_state_name;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_admin_login_attempts_user_attempted;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_parent_cheers_notification_id;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_teacher_remediation_teacher_id;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_teacher_remediation_student_id;
  v_dropped := v_dropped + 1;
  DROP INDEX IF EXISTS public.idx_teacher_remediation_status_assigned;
  v_dropped := v_dropped + 1;

  INSERT INTO _rollback_log VALUES (
    'step1_repair_indexes_20260614200001', 'OK',
    format('%s repair indexes dropped (all IF EXISTS — may have been 0 if not present)', v_dropped)
  );
  RAISE NOTICE '[rollback] STEP 1 complete: 14 repair indexes dropped (IF EXISTS).';

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step1_repair_indexes_20260614200001', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 1 FAILED: % — continuing.', SQLERRM;
END $rb_step1$;


-- =============================================================================
-- STEP 2 (of 8): Reset search_path on functions pinned by 20260614200000
-- Uses the SAME dynamic pg_proc lookup as the original migration so it is
-- resilient to signature drift. RESET search_path removes the SET parameter,
-- returning each function to the database default search_path.
-- =============================================================================
DO $rb_step2$
DECLARE
  r         RECORD;
  v_reset   integer := 0;
  v_skip    integer := 0;
BEGIN
  FOR r IN
    SELECT
      n.nspname || '.' || quote_ident(p.proname) || '(' ||
        pg_get_function_identity_arguments(p.oid) || ')' AS fn_sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'tg_learner_mastery_touch','exam_papers_set_updated_at',
        'mock_test_attempts_set_updated_at','submit_mock_test_attempt',
        'notify_state_event','bkt_update','tutor_commit_attempt',
        'set_foxy_chat_school_id','set_audit_log_school_id',
        'tp_messages_bump_thread','set_data_erasure_requests_updated_at',
        'get_available_subjects_v2','expire_stale_foxy_expectations',
        'match_alfabot_kb_chunks','sync_school_admin_role',
        'sync_user_roles_on_insert','sync_admin_user_role',
        'get_available_subjects','available_chapters_for_student_subject_v2',
        'get_adaptive_questions','purchase_streak_freeze',
        'atomic_quiz_profile_update','bootstrap_user_profile',
        'activate_free_subscription','get_school_overview',
        'get_classes_at_risk','get_teacher_engagement',
        '_school_active_student_ids','_count_active_school_students',
        '_eval_seat_policy_unchecked','evaluate_seat_policy',
        'refresh_school_seat_usage','enroll_students_with_seat_check',
        'enroll_section_students_with_seat_check','get_school_mastery_rollup',
        'get_school_bloom_summary','export_school_report'
      )
    ORDER BY p.proname, p.oid
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s RESET search_path', r.fn_sig);
      v_reset := v_reset + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Function may not exist on this env — skip silently.
      v_skip := v_skip + 1;
    END;
  END LOOP;

  INSERT INTO _rollback_log VALUES (
    'step2_reset_search_path_20260614200000', 'OK',
    format('search_path RESET on %s functions; %s skipped (not found)', v_reset, v_skip)
  );
  RAISE NOTICE '[rollback] STEP 2 complete: search_path RESET on % functions (% skipped).', v_reset, v_skip;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step2_reset_search_path_20260614200000', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 2 FAILED: % — continuing.', SQLERRM;
END $rb_step2$;


-- =============================================================================
-- STEP 3 (of 8): Drop Wave D functions and index from 20260614000003
-- =============================================================================
DO $rb_step3$
BEGIN
  -- Wave D Bloom covering index
  DROP INDEX IF EXISTS public.idx_quiz_responses_student_bloom;

  -- Wave D reporting functions (SECURITY DEFINER, read-only)
  DROP FUNCTION IF EXISTS public.get_school_mastery_rollup(uuid, text);
  DROP FUNCTION IF EXISTS public.get_school_bloom_summary(uuid);
  DROP FUNCTION IF EXISTS public.export_school_report(uuid);

  INSERT INTO _rollback_log VALUES (
    'step3_wave_d_20260614000003', 'OK',
    '3 Wave D functions dropped; idx_quiz_responses_student_bloom dropped'
  );
  RAISE NOTICE '[rollback] STEP 3 complete: Wave D functions and Bloom index dropped (IF EXISTS).';

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step3_wave_d_20260614000003', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 3 FAILED: % — continuing.', SQLERRM;
END $rb_step3$;


-- =============================================================================
-- STEP 4 (of 8): Remove Wave C permission rows from 20260614000002
--
-- IMPORTANT: institution.manage_students predates Wave C (originally seeded
-- by the legacy migration 20260327210000_extended_rbac_roles.sql). Wave C
-- only re-asserted it on fresh DBs. We DO NOT delete institution.manage_students
-- here — it is a pre-existing permission that may be depended on by other
-- code paths outside these 13 migrations.
--
-- We delete ONLY the 4 newly-added Wave C permission codes:
--   institution.export_reports
--   institution.manage_billing
--   institution.view_billing
--   institution.manage_staff
-- =============================================================================
DO $rb_step4$
DECLARE
  v_rp_deleted integer;
  v_p_deleted  integer;
BEGIN
  -- Remove role_permissions grants for the 4 new codes first (FK child rows)
  DELETE FROM public.role_permissions
  WHERE permission_id IN (
    SELECT id FROM public.permissions
    WHERE code IN (
      'institution.export_reports',
      'institution.manage_billing',
      'institution.view_billing',
      'institution.manage_staff'
    )
  );
  GET DIAGNOSTICS v_rp_deleted = ROW_COUNT;

  -- Remove the 4 new permission rows
  DELETE FROM public.permissions
  WHERE code IN (
    'institution.export_reports',
    'institution.manage_billing',
    'institution.view_billing',
    'institution.manage_staff'
  );
  GET DIAGNOSTICS v_p_deleted = ROW_COUNT;

  -- NOTE: institution.manage_students is NOT touched — see comment above.

  INSERT INTO _rollback_log VALUES (
    'step4_wave_c_rbac_20260614000002', 'OK',
    format('%s role_permission rows removed; %s permission rows removed; institution.manage_students preserved',
           v_rp_deleted, v_p_deleted)
  );
  RAISE NOTICE '[rollback] STEP 4 complete: % role_permission rows removed, % permission rows removed.',
    v_rp_deleted, v_p_deleted;
  RAISE NOTICE '[rollback]   institution.manage_students preserved (predates Wave C).';

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step4_wave_c_rbac_20260614000002', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 4 FAILED: % — continuing.', SQLERRM;
END $rb_step4$;


-- =============================================================================
-- STEP 5 (of 8): Drop Wave B seat enforcement objects from 20260614000001
-- =============================================================================
DO $rb_step5$
BEGIN
  -- Drop Wave B enforcement RPCs (SECURITY DEFINER)
  -- Order matters: public-facing first, then internal helpers.
  DROP FUNCTION IF EXISTS public.enroll_students_with_seat_check(uuid, jsonb);
  DROP FUNCTION IF EXISTS public.enroll_section_students_with_seat_check(uuid, jsonb);
  DROP FUNCTION IF EXISTS public.refresh_school_seat_usage(uuid);
  DROP FUNCTION IF EXISTS public.evaluate_seat_policy(uuid, integer);
  DROP FUNCTION IF EXISTS public._eval_seat_policy_unchecked(integer, integer, integer, timestamptz);
  DROP FUNCTION IF EXISTS public._count_active_school_students(uuid);
  DROP FUNCTION IF EXISTS public._school_active_student_ids(uuid);

  -- Drop Wave B covering indexes
  DROP INDEX IF EXISTS public.idx_class_students_class_active;
  DROP INDEX IF EXISTS public.idx_class_students_student_active;
  DROP INDEX IF EXISTS public.idx_students_school_active;

  -- Remove the seat_grace_started_at column from school_subscriptions.
  -- This is safe: the column is nullable and was added by this migration batch.
  -- No existing data relies on it being non-null (Wave B logic is the only writer).
  ALTER TABLE public.school_subscriptions
    DROP COLUMN IF EXISTS seat_grace_started_at;

  INSERT INTO _rollback_log VALUES (
    'step5_wave_b_20260614000001', 'OK',
    '7 Wave B functions dropped; 3 Wave B indexes dropped; seat_grace_started_at column dropped'
  );
  RAISE NOTICE '[rollback] STEP 5 complete: Wave B functions, indexes, and seat_grace_started_at column dropped (IF EXISTS).';

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step5_wave_b_20260614000001', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 5 FAILED: % — continuing.', SQLERRM;
END $rb_step5$;


-- =============================================================================
-- STEP 6 (of 8): Drop Wave A functions and indexes from 20260614000000
-- =============================================================================
DO $rb_step6$
BEGIN
  -- Drop Wave A read-model functions (SECURITY DEFINER, read-only)
  DROP FUNCTION IF EXISTS public.get_school_overview(uuid);
  DROP FUNCTION IF EXISTS public.get_classes_at_risk(uuid, integer, integer);
  DROP FUNCTION IF EXISTS public.get_teacher_engagement(uuid, integer, integer);

  -- Drop Wave A covering indexes
  DROP INDEX IF EXISTS public.idx_classes_school_active;
  DROP INDEX IF EXISTS public.idx_class_teachers_teacher_active;
  DROP INDEX IF EXISTS public.idx_teachers_school_active;
  DROP INDEX IF EXISTS public.idx_concept_mastery_student_pknow;

  INSERT INTO _rollback_log VALUES (
    'step6_wave_a_20260614000000', 'OK',
    '3 Wave A functions dropped; 4 Wave A indexes dropped'
  );
  RAISE NOTICE '[rollback] STEP 6 complete: Wave A functions and indexes dropped (IF EXISTS).';

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step6_wave_a_20260614000000', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 6 FAILED: % — continuing.', SQLERRM;
END $rb_step6$;


-- =============================================================================
-- STEP 7 (of 8): Remove Python AI feature flags from 20260609100000-160000
--
-- SAFETY INVARIANT: a flag is only deleted if is_enabled = false.
-- If any flag has been manually enabled (is_enabled = true), it is NOT deleted
-- and a WARNING is emitted. Never roll back an active feature flag.
-- =============================================================================
DO $rb_step7$
DECLARE
  v_enabled_count integer;
  v_deleted       integer;
BEGIN
  -- Check for any enabled flags BEFORE deleting
  SELECT count(*) INTO v_enabled_count
  FROM public.feature_flags
  WHERE flag_name IN (
    'ff_python_monthly_synthesis_builder_v1',
    'ff_python_nep_compliance_v1',
    'ff_python_parent_report_generator_v1',
    'ff_python_grade_experiment_conclusion_v1',
    'ff_python_verify_question_bank_v1',
    'ff_python_extract_ncert_questions_v1',
    'ff_python_bulk_non_mcq_gen_v1'
  ) AND is_enabled = true;

  IF v_enabled_count > 0 THEN
    RAISE WARNING '[rollback] STEP 7 SAFETY BLOCK: % Python AI flag(s) have is_enabled=true. '
                  'These flags will NOT be deleted. Disable them manually before re-running '
                  'this step. Only is_enabled=false flags will be removed.',
      v_enabled_count;
  END IF;

  -- Delete only the disabled flags (is_enabled = false)
  DELETE FROM public.feature_flags
  WHERE flag_name IN (
    'ff_python_monthly_synthesis_builder_v1',
    'ff_python_nep_compliance_v1',
    'ff_python_parent_report_generator_v1',
    'ff_python_grade_experiment_conclusion_v1',
    'ff_python_verify_question_bank_v1',
    'ff_python_extract_ncert_questions_v1',
    'ff_python_bulk_non_mcq_gen_v1'
  ) AND is_enabled = false;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO _rollback_log VALUES (
    'step7_python_ai_flags', 'OK',
    format('%s Python AI flag rows deleted (is_enabled=false only); %s enabled flags preserved (not deleted)',
           v_deleted, v_enabled_count)
  );
  RAISE NOTICE '[rollback] STEP 7 complete: % Python AI flag rows deleted; % enabled flag(s) preserved.',
    v_deleted, v_enabled_count;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step7_python_ai_flags', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 7 FAILED: % — continuing.', SQLERRM;
END $rb_step7$;


-- =============================================================================
-- STEP 8 (of 8): Remove migration version records from schema_migrations
-- This allows supabase db push to re-apply the migrations cleanly if needed.
-- Only remove versions that were part of this batch.
-- =============================================================================
DO $rb_step8$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN (
    '20260609100000', '20260609110000', '20260609120000',
    '20260609130000', '20260609140000', '20260609150000',
    '20260609160000', '20260614000000', '20260614000001',
    '20260614000002', '20260614000003', '20260614200000',
    '20260614200001'
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO _rollback_log VALUES (
    'step8_remove_schema_migration_records', 'OK',
    format('%s migration version records removed from supabase_migrations.schema_migrations', v_deleted)
  );
  RAISE NOTICE '[rollback] STEP 8 complete: % migration version records removed from schema_migrations.', v_deleted;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _rollback_log VALUES ('step8_remove_schema_migration_records', 'FAIL', SQLERRM);
  RAISE WARNING '[rollback] STEP 8 FAILED: % — continuing.', SQLERRM;
END $rb_step8$;


-- =============================================================================
-- ROLLBACK SUMMARY
-- =============================================================================
DO $rb_summary$
DECLARE
  r        RECORD;
  v_failed integer := 0;
  v_ok     integer := 0;
BEGIN
  FOR r IN SELECT * FROM _rollback_log ORDER BY ctid LOOP
    IF r.status = 'OK' THEN
      v_ok := v_ok + 1;
      RAISE NOTICE '[rollback] OK    %: %', r.step, r.details;
    ELSE
      v_failed := v_failed + 1;
      RAISE WARNING '[rollback] FAIL  %: %', r.step, r.details;
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '[rollback] ====================================================';
  RAISE NOTICE '[rollback] ROLLBACK SUMMARY';
  RAISE NOTICE '[rollback]   Steps OK    : %', v_ok;
  RAISE NOTICE '[rollback]   Steps FAILED: %', v_failed;
  RAISE NOTICE '[rollback] ====================================================';

  IF v_failed > 0 THEN
    RAISE WARNING '[rollback] % step(s) failed. Review warnings above. '
                  'Partial rollback may leave schema in an inconsistent state. '
                  'Contact Architect agent before re-deploying.', v_failed;
  ELSE
    RAISE NOTICE '[rollback] All rollback steps completed successfully.';
    RAISE NOTICE '[rollback] NEXT STEPS:';
    RAISE NOTICE '[rollback]   1. Coordinate Vercel rollback to the previous deployment.';
    RAISE NOTICE '[rollback]   2. Confirm all school-admin API routes return expected responses.';
    RAISE NOTICE '[rollback]   3. Once the root cause is fixed, re-apply via: supabase db push';
    RAISE NOTICE '[rollback]   4. Run scripts/recovery/04_validation.sql to re-verify.';
  END IF;
  RAISE NOTICE '[rollback] ====================================================';
END $rb_summary$;

-- Clean up
DROP TABLE IF EXISTS _rollback_log;
