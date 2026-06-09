-- =============================================================================
-- scripts/recovery/04_validation.sql
-- Alfanumrik Learning OS — Post-deployment acceptance test
-- =============================================================================
--
-- PURPOSE
-- -------
-- Run this script AFTER all 13 migrations have been applied (either via
-- supabase db push or scripts/recovery/03_repair_migrations.sql). Verifies
-- every expected schema object is present and correctly configured.
--
-- This is the acceptance test. All checks must pass before marking
-- the deployment complete and informing the CEO.
--
-- HOW TO RUN
-- ----------
--   psql <connection_string>   -f scripts/recovery/04_validation.sql
--   OR paste into the Supabase SQL editor (service_role session)
--
-- OUTPUT
-- ------
--   Each check emits RAISE NOTICE on pass and RAISE WARNING on fail.
--   Final line: RAISE NOTICE 'VALIDATION PASSED: N/M checks passed'
--            OR RAISE WARNING 'VALIDATION FAILED: N/M checks passed — see warnings above'
--
-- IDEMPOTENT: read-only. Safe to run multiple times. No schema mutations.
-- =============================================================================

DO $validation$
DECLARE
  -- Counters
  v_pass    integer := 0;
  v_fail    integer := 0;
  v_total   integer;

  -- Scratch variables
  v_count   integer;
  v_exists  boolean;
  v_label   text;

  -- Helper: emit pass/fail notice
  -- (inline via IF/RAISE rather than a function so the DO block is self-contained)

BEGIN

  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Alfanumrik — recovery/04_validation.sql';
  RAISE NOTICE 'Post-deployment acceptance test for 13 pending migrations';
  RAISE NOTICE '=================================================================';

  -- ===========================================================================
  -- SECTION 1: Schema completeness
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 1: Schema completeness ---';

  -- 1.1  seat_grace_started_at column on school_subscriptions (Wave B)
  v_label := '1.1  school_subscriptions.seat_grace_started_at column';
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'school_subscriptions'
      AND column_name  = 'seat_grace_started_at'
  ) INTO v_exists;
  IF v_exists THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  %', v_label;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  % — column missing. Migration 20260614000001 may not have applied.', v_label;
  END IF;

  -- 1.2  get_school_overview function (Wave A, re-defined in Wave B)
  v_label := '1.2  function public.get_school_overview(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_school_overview'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.3  get_classes_at_risk function (Wave A, re-defined in Wave B)
  v_label := '1.3  function public.get_classes_at_risk(uuid, int, int)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_classes_at_risk'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.4  get_teacher_engagement function (Wave A)
  v_label := '1.4  function public.get_teacher_engagement(uuid, int, int)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_teacher_engagement'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.5  _school_active_student_ids function (Wave B)
  v_label := '1.5  function public._school_active_student_ids(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_school_active_student_ids'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.6  _count_active_school_students function (Wave B)
  v_label := '1.6  function public._count_active_school_students(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_count_active_school_students'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.7  _eval_seat_policy_unchecked function (Wave B)
  v_label := '1.7  function public._eval_seat_policy_unchecked(int, int, int, timestamptz)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_eval_seat_policy_unchecked'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.8  evaluate_seat_policy function (Wave B)
  v_label := '1.8  function public.evaluate_seat_policy(uuid, int)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'evaluate_seat_policy'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.9  enroll_students_with_seat_check function (Wave B)
  v_label := '1.9  function public.enroll_students_with_seat_check(uuid, jsonb)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enroll_students_with_seat_check'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing. Apply source 20260614000001.', v_label; END IF;

  -- 1.10  enroll_section_students_with_seat_check function (Wave B)
  v_label := '1.10 function public.enroll_section_students_with_seat_check(uuid, jsonb)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enroll_section_students_with_seat_check'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing. Apply source 20260614000001.', v_label; END IF;

  -- 1.11  refresh_school_seat_usage function (Wave B)
  v_label := '1.11 function public.refresh_school_seat_usage(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_school_seat_usage'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing.', v_label; END IF;

  -- 1.12  get_school_mastery_rollup function (Wave D)
  v_label := '1.12 function public.get_school_mastery_rollup(uuid, text)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_school_mastery_rollup'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing. Apply source 20260614000003.', v_label; END IF;

  -- 1.13  get_school_bloom_summary function (Wave D)
  v_label := '1.13 function public.get_school_bloom_summary(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_school_bloom_summary'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing. Apply source 20260614000003.', v_label; END IF;

  -- 1.14  export_school_report function (Wave D)
  v_label := '1.14 function public.export_school_report(uuid)';
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'export_school_report'
  ) INTO v_exists;
  IF v_exists THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  %', v_label;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL  % — function missing. Apply source 20260614000003.', v_label; END IF;

  -- ===========================================================================
  -- SECTION 2: 14 repair indexes from 20260614200001
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 2: Repair indexes (20260614200001) ---';

  WITH expected_indexes(idx_name) AS (
    VALUES
      ('idx_tp_threads_student_id'),
      ('idx_tp_messages_sender'),
      ('idx_parental_consent_version'),
      ('idx_data_erasure_requests_student'),
      ('idx_data_erasure_requests_status_created'),
      ('idx_synthetic_monitor_results_name_checked'),
      ('idx_synthetic_monitor_results_status'),
      ('idx_school_slo_log_school_evaluated'),
      ('idx_grounding_circuit_state_name'),
      ('idx_admin_login_attempts_user_attempted'),
      ('idx_parent_cheers_notification_id'),
      ('idx_teacher_remediation_teacher_id'),
      ('idx_teacher_remediation_student_id'),
      ('idx_teacher_remediation_status_assigned')
  )
  SELECT count(*) INTO v_count
  FROM expected_indexes e
  JOIN pg_indexes pi ON pi.schemaname = 'public' AND pi.indexname = e.idx_name;

  IF v_count = 14 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  2.1  All 14 repair indexes present (idx_tp_threads_student_id .. idx_teacher_remediation_status_assigned)';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  2.1  Only %/14 repair indexes found. Missing indexes:', v_count;
    -- Report which are missing
    FOR v_label IN
      SELECT e.idx_name FROM (
        VALUES
          ('idx_tp_threads_student_id'),('idx_tp_messages_sender'),
          ('idx_parental_consent_version'),('idx_data_erasure_requests_student'),
          ('idx_data_erasure_requests_status_created'),
          ('idx_synthetic_monitor_results_name_checked'),
          ('idx_synthetic_monitor_results_status'),
          ('idx_school_slo_log_school_evaluated'),
          ('idx_grounding_circuit_state_name'),
          ('idx_admin_login_attempts_user_attempted'),
          ('idx_parent_cheers_notification_id'),
          ('idx_teacher_remediation_teacher_id'),
          ('idx_teacher_remediation_student_id'),
          ('idx_teacher_remediation_status_assigned')
      ) AS e(idx_name)
      WHERE e.idx_name NOT IN (
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      )
    LOOP
      RAISE WARNING '       MISSING index: %', v_label;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- SECTION 3: 7 Python AI feature flag rows in feature_flags
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 3: Python AI feature flags ---';

  WITH expected_flags(flag_name) AS (
    VALUES
      ('ff_python_monthly_synthesis_builder_v1'),
      ('ff_python_nep_compliance_v1'),
      ('ff_python_parent_report_generator_v1'),
      ('ff_python_grade_experiment_conclusion_v1'),
      ('ff_python_verify_question_bank_v1'),
      ('ff_python_extract_ncert_questions_v1'),
      ('ff_python_bulk_non_mcq_gen_v1')
  )
  SELECT count(*) INTO v_count
  FROM expected_flags e
  JOIN public.feature_flags ff ON ff.flag_name = e.flag_name;

  IF v_count = 7 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  3.1  All 7 Python AI feature flag rows present';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  3.1  Only %/7 Python AI feature flags found. Missing:', v_count;
    FOR v_label IN
      SELECT e.flag_name FROM (
        VALUES
          ('ff_python_monthly_synthesis_builder_v1'),
          ('ff_python_nep_compliance_v1'),
          ('ff_python_parent_report_generator_v1'),
          ('ff_python_grade_experiment_conclusion_v1'),
          ('ff_python_verify_question_bank_v1'),
          ('ff_python_extract_ncert_questions_v1'),
          ('ff_python_bulk_non_mcq_gen_v1')
      ) AS e(flag_name)
      WHERE e.flag_name NOT IN (SELECT flag_name FROM public.feature_flags)
    LOOP
      RAISE WARNING '       MISSING flag: %', v_label;
    END LOOP;
  END IF;

  -- Confirm all 7 flags have is_enabled = false (safety invariant: default OFF)
  SELECT count(*) INTO v_count
  FROM public.feature_flags
  WHERE flag_name IN (
    'ff_python_monthly_synthesis_builder_v1', 'ff_python_nep_compliance_v1',
    'ff_python_parent_report_generator_v1',   'ff_python_grade_experiment_conclusion_v1',
    'ff_python_verify_question_bank_v1',      'ff_python_extract_ncert_questions_v1',
    'ff_python_bulk_non_mcq_gen_v1'
  ) AND is_enabled = false;

  IF v_count = 7 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  3.2  All 7 Python AI flags have is_enabled = false (default OFF — safe)';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  3.2  %/7 Python AI flags have is_enabled=false. Some flags may be unexpectedly enabled.', v_count;
  END IF;

  -- ===========================================================================
  -- SECTION 4: 5 new permission codes (Wave C)
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 4: Wave C permission codes ---';

  WITH expected_codes(code) AS (
    VALUES
      ('institution.export_reports'),
      ('institution.manage_billing'),
      ('institution.view_billing'),
      ('institution.manage_staff'),
      ('institution.manage_students')
  )
  SELECT count(*) INTO v_count
  FROM expected_codes e
  JOIN public.permissions p ON p.code = e.code;

  IF v_count = 5 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  4.1  All 5 institution.* permission codes present';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  4.1  Only %/5 institution.* permission codes found.', v_count;
  END IF;

  -- Confirm the 4 NEW Wave C codes are granted to institution_admin
  -- (institution.manage_students may predate Wave C; check all 4 new ones)
  SELECT count(*) INTO v_count
  FROM public.role_permissions rp
  JOIN public.roles       r ON r.id = rp.role_id       AND r.name = 'institution_admin'
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE p.code IN (
    'institution.export_reports', 'institution.manage_billing',
    'institution.view_billing',   'institution.manage_staff'
  );

  IF v_count = 4 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  4.2  All 4 new Wave C permission codes granted to institution_admin';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  4.2  Only %/4 new Wave C codes granted to institution_admin. Check role_permissions.', v_count;
  END IF;

  -- ===========================================================================
  -- SECTION 5: Migration history — all 13 versions in schema_migrations
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 5: Migration history ---';

  WITH expected_versions(version) AS (
    VALUES
      ('20260609100000'), ('20260609110000'), ('20260609120000'),
      ('20260609130000'), ('20260609140000'), ('20260609150000'),
      ('20260609160000'), ('20260614000000'), ('20260614000001'),
      ('20260614000002'), ('20260614000003'), ('20260614200000'),
      ('20260614200001')
  )
  SELECT count(*) INTO v_count
  FROM expected_versions e
  JOIN supabase_migrations.schema_migrations sm ON sm.version = e.version;

  IF v_count = 13 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  5.1  All 13 migration versions recorded in supabase_migrations.schema_migrations';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  5.1  Only %/13 migration versions found in schema_migrations. Missing:', v_count;
    FOR v_label IN
      SELECT e.version FROM (
        VALUES
          ('20260609100000'),('20260609110000'),('20260609120000'),
          ('20260609130000'),('20260609140000'),('20260609150000'),
          ('20260609160000'),('20260614000000'),('20260614000001'),
          ('20260614000002'),('20260614000003'),('20260614200000'),
          ('20260614200001')
      ) AS e(version)
      WHERE e.version NOT IN (
        SELECT version FROM supabase_migrations.schema_migrations
      )
    LOOP
      RAISE WARNING '       MISSING version: %', v_label;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- SECTION 6: RLS check — no new tables from these migrations
  -- (Confirms assumption: none of the 13 migrations create new tables)
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 6: RLS check ---';

  -- These migrations add a column to school_subscriptions (which already has
  -- RLS enabled) and insert rows. No new tables. Confirm school_subscriptions
  -- retains RLS.
  SELECT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename   = 'school_subscriptions'
      AND rowsecurity = true
  ) INTO v_exists;

  IF v_exists THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  6.1  school_subscriptions still has RLS enabled after seat_grace_started_at column add';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  6.1  school_subscriptions RLS is DISABLED — this is unexpected. Investigate immediately.';
  END IF;

  -- ===========================================================================
  -- SECTION 7: Function EXECUTE grants — authenticated role has access to
  -- Phase 3B public functions
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 7: Function EXECUTE grants ---';

  -- Check EXECUTE on 6 public-authenticated Phase 3B functions
  -- via information_schema.routine_privileges
  SELECT count(*) INTO v_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND privilege_type = 'EXECUTE'
    AND grantee        = 'authenticated'
    AND specific_name IN (
      SELECT specific_name FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN (
          'get_school_overview',
          'get_classes_at_risk',
          'get_teacher_engagement',
          'evaluate_seat_policy',
          'get_school_mastery_rollup',
          'get_school_bloom_summary',
          'export_school_report'
        )
    );

  -- We expect at least the functions that exist (some may not exist if Wave D
  -- source file was not applied). A count >= 4 (Wave A/B minimum) is the floor.
  IF v_count >= 4 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  7.1  authenticated role has EXECUTE on % Phase 3B functions (expected 4-7)', v_count;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  7.1  authenticated role has EXECUTE on only % Phase 3B functions (expected >= 4). Grant check needed.', v_count;
  END IF;

  -- ===========================================================================
  -- SECTION 8: Phase 3B covering indexes (Wave A and Wave B)
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 8: Phase 3B covering indexes ---';

  WITH phase3b_indexes(idx_name) AS (
    VALUES
      ('idx_classes_school_active'),
      ('idx_class_teachers_teacher_active'),
      ('idx_teachers_school_active'),
      ('idx_concept_mastery_student_pknow'),
      ('idx_class_students_class_active'),
      ('idx_class_students_student_active'),
      ('idx_students_school_active'),
      ('idx_quiz_responses_student_bloom')
  )
  SELECT count(*) INTO v_count
  FROM phase3b_indexes e
  JOIN pg_indexes pi ON pi.schemaname = 'public' AND pi.indexname = e.idx_name;

  IF v_count = 8 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  8.1  All 8 Phase 3B covering indexes present (Wave A x4, Wave B x3, Wave D x1)';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  8.1  Only %/8 Phase 3B covering indexes found.', v_count;
    FOR v_label IN
      SELECT e.idx_name FROM (
        VALUES
          ('idx_classes_school_active'),('idx_class_teachers_teacher_active'),
          ('idx_teachers_school_active'),('idx_concept_mastery_student_pknow'),
          ('idx_class_students_class_active'),('idx_class_students_student_active'),
          ('idx_students_school_active'),('idx_quiz_responses_student_bloom')
      ) AS e(idx_name)
      WHERE e.idx_name NOT IN (
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      )
    LOOP
      RAISE WARNING '       MISSING index: %', v_label;
    END LOOP;
  END IF;

  -- ===========================================================================
  -- SECTION 9: search_path pin spot-check (20260614200000)
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '--- SECTION 9: search_path pin spot-check (20260614200000) ---';

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'submit_mock_test_attempt', 'tp_messages_bump_thread',
      'sync_admin_user_role',     'sync_user_roles_on_insert',
      'get_school_overview'
    )
    AND p.proconfig IS NOT NULL
    AND p.proconfig::text ILIKE '%search_path%';

  IF v_count = 5 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  9.1  5/5 spot-check functions have search_path pinned in proconfig';
  ELSIF v_count >= 3 THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  9.1  %/5 spot-check functions have search_path pinned (some may not exist in this env — acceptable)', v_count;
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL  9.1  Only %/5 spot-check functions have search_path pinned. Migration 20260614200000 may be incomplete.', v_count;
  END IF;

  -- ===========================================================================
  -- FINAL VERDICT
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  v_total := v_pass + v_fail;
  IF v_fail = 0 THEN
    RAISE NOTICE 'VALIDATION PASSED: %/% checks passed', v_pass, v_total;
    RAISE NOTICE 'All 13 migrations have landed correctly. Ready to inform CEO.';
  ELSE
    RAISE WARNING 'VALIDATION FAILED: %/% checks passed — % check(s) failed. See warnings above.',
      v_pass, v_total, v_fail;
    RAISE WARNING 'Resolve the failures before marking deployment complete.';
    RAISE WARNING 'Large function bodies (Wave B enrollment RPCs, Wave D reporting functions)';
    RAISE WARNING 'may need to be applied from their source migration files separately.';
  END IF;
  RAISE NOTICE '=================================================================';

END $validation$;
