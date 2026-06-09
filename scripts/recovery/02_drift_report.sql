-- =============================================================================
-- scripts/recovery/02_drift_report.sql
-- Project: Alfanumrik Learning OS — Supabase project shktyoxqhundlvkiwguu (prod)
-- =============================================================================
-- PURPOSE
-- -------
-- Comprehensive schema drift detection. Compares what the codebase expects
-- (after applying all 13 pending migrations) against what production currently
-- has. Read-only. No DDL, no DML.
--
-- RUN AFTER deploying the pending migrations to verify drift is eliminated.
-- Can also be run BEFORE deployment to understand what is missing.
--
-- HOW TO USE
-- ----------
-- 1. Open the Supabase SQL editor on project shktyoxqhundlvkiwguu.
-- 2. Paste this file and execute.
-- 3. The final SELECT at the bottom gives the drift verdict.
-- 4. Any row with actual_status = 'MISSING' is an object the migration has
--    not yet created — run the indicated migration_version to resolve.
--
-- 13 PENDING MIGRATIONS COVERED
-- ------------------------------
-- 20260609100000  ff_python_monthly_synthesis_builder_v1 row in feature_flags
-- 20260609110000  ff_python_nep_compliance_v1 row in feature_flags
-- 20260609120000  ff_python_parent_report_generator_v1 row in feature_flags
-- 20260609130000  ff_python_grade_experiment_conclusion_v1 row in feature_flags
-- 20260609140000  ff_python_verify_question_bank_v1 row in feature_flags
-- 20260609150000  ff_python_extract_ncert_questions_v1 row in feature_flags
-- 20260609160000  ff_python_bulk_non_mcq_gen_v1 row in feature_flags
-- 20260614000000  Functions: get_school_overview, get_classes_at_risk,
--                 get_teacher_engagement; indexes: idx_classes_school_active,
--                 idx_class_teachers_teacher_active, idx_teachers_school_active,
--                 idx_concept_mastery_student_pknow
-- 20260614000001  ALTER school_subscriptions ADD seat_grace_started_at;
--                 Functions: _school_active_student_ids,
--                 _count_active_school_students, _eval_seat_policy_unchecked,
--                 evaluate_seat_policy, enroll_students_with_seat_check,
--                 enroll_section_students_with_seat_check,
--                 refresh_school_seat_usage;
--                 indexes: idx_class_students_class_active,
--                 idx_class_students_student_active, idx_students_school_active
-- 20260614000002  Permission codes: institution.export_reports,
--                 institution.manage_billing, institution.view_billing,
--                 institution.manage_staff, institution.manage_students
-- 20260614000003  Functions: get_school_mastery_rollup, get_school_bloom_summary,
--                 export_school_report; one covering index for bloom rollup
-- 20260614200000  ALTER FUNCTION search_path pins on 37 functions (no
--                 table/column changes — migration version check only)
-- 20260614200001  14 CREATE INDEX IF NOT EXISTS repair indexes
-- 20260614200002  Verification DO block only — no schema objects
-- =============================================================================


WITH

-- =============================================================================
-- CTE 1: Python AI feature flag rows (7 migrations: 20260609100000-160000)
-- =============================================================================
python_flags AS (
  SELECT
    'python_ai_flag'                                AS category,
    ff.flag_name                                    AS object_name,
    'feature_flags row'                             AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.feature_flags
        WHERE flag_name = ff.flag_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    ff.migration_version
  FROM (VALUES
    ('ff_python_monthly_synthesis_builder_v1', '20260609100000'),
    ('ff_python_nep_compliance_v1',             '20260609110000'),
    ('ff_python_parent_report_generator_v1',   '20260609120000'),
    ('ff_python_grade_experiment_conclusion_v1','20260609130000'),
    ('ff_python_verify_question_bank_v1',      '20260609140000'),
    ('ff_python_extract_ncert_questions_v1',   '20260609150000'),
    ('ff_python_bulk_non_mcq_gen_v1',          '20260609160000')
  ) AS ff(flag_name, migration_version)
),

-- =============================================================================
-- CTE 2: Phase 3B functions from 20260614000000 (Wave A — Command Center)
-- =============================================================================
wave_a_functions AS (
  SELECT
    'phase3b_function'                              AS category,
    fn.func_name                                    AS object_name,
    'function in public schema'                     AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = fn.func_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    fn.migration_version
  FROM (VALUES
    ('get_school_overview',    '20260614000000'),
    ('get_classes_at_risk',    '20260614000000'),
    ('get_teacher_engagement', '20260614000000')
  ) AS fn(func_name, migration_version)
),

-- =============================================================================
-- CTE 3: Phase 3B indexes from 20260614000000 (Wave A — Command Center)
-- =============================================================================
wave_a_indexes AS (
  SELECT
    'phase3b_index'                                 AS category,
    idx.index_name                                  AS object_name,
    'index in public schema'                        AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = idx.index_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    idx.migration_version
  FROM (VALUES
    ('idx_classes_school_active',           '20260614000000'),
    ('idx_class_teachers_teacher_active',   '20260614000000'),
    ('idx_teachers_school_active',          '20260614000000'),
    ('idx_concept_mastery_student_pknow',   '20260614000000')
  ) AS idx(index_name, migration_version)
),

-- =============================================================================
-- CTE 4: seat_grace_started_at column from 20260614000001 (Wave B)
-- =============================================================================
wave_b_column AS (
  SELECT
    'phase3b_column'                                AS category,
    'school_subscriptions.seat_grace_started_at'   AS object_name,
    'column on school_subscriptions'               AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'school_subscriptions'
          AND column_name  = 'seat_grace_started_at'
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    '20260614000001'                                AS migration_version
),

-- =============================================================================
-- CTE 5: Phase 3B Wave B functions from 20260614000001 (seat enforcement)
-- =============================================================================
wave_b_functions AS (
  SELECT
    'phase3b_function'                              AS category,
    fn.func_name                                    AS object_name,
    'function in public schema'                     AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = fn.func_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    fn.migration_version
  FROM (VALUES
    ('_school_active_student_ids',             '20260614000001'),
    ('_count_active_school_students',          '20260614000001'),
    ('_eval_seat_policy_unchecked',            '20260614000001'),
    ('evaluate_seat_policy',                   '20260614000001'),
    ('enroll_students_with_seat_check',        '20260614000001'),
    ('enroll_section_students_with_seat_check','20260614000001'),
    ('refresh_school_seat_usage',              '20260614000001')
  ) AS fn(func_name, migration_version)
),

-- =============================================================================
-- CTE 6: Phase 3B Wave B indexes from 20260614000001 (seat enforcement)
-- =============================================================================
wave_b_indexes AS (
  SELECT
    'phase3b_index'                                 AS category,
    idx.index_name                                  AS object_name,
    'index in public schema'                        AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = idx.index_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    idx.migration_version
  FROM (VALUES
    ('idx_class_students_class_active',    '20260614000001'),
    ('idx_class_students_student_active',  '20260614000001'),
    ('idx_students_school_active',         '20260614000001')
  ) AS idx(index_name, migration_version)
),

-- =============================================================================
-- CTE 7: RBAC permission codes from 20260614000002 (Wave C)
-- =============================================================================
wave_c_permissions AS (
  SELECT
    'rbac_permission'                               AS category,
    perm.code                                       AS object_name,
    'row in public.permissions'                     AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.permissions
        WHERE code = perm.code
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    '20260614000002'                                AS migration_version
  FROM (VALUES
    ('institution.export_reports'),
    ('institution.manage_billing'),
    ('institution.view_billing'),
    ('institution.manage_staff'),
    ('institution.manage_students')
  ) AS perm(code)
),

-- =============================================================================
-- CTE 8: Phase 3B Wave D functions from 20260614000003 (school reporting)
-- =============================================================================
wave_d_functions AS (
  SELECT
    'phase3b_function'                              AS category,
    fn.func_name                                    AS object_name,
    'function in public schema'                     AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = fn.func_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    fn.migration_version
  FROM (VALUES
    ('get_school_mastery_rollup', '20260614000003'),
    ('get_school_bloom_summary',  '20260614000003'),
    ('export_school_report',      '20260614000003')
  ) AS fn(func_name, migration_version)
),

-- =============================================================================
-- CTE 9: Repair indexes from 20260614200001 (api_query_path batch2 repair)
-- NOTE: idx_at_risk_alerts_school_status (Section K in that migration) is
--       intentionally excluded from the 14-index count in the verification block;
--       the 14 listed here are the ones that block the migration's own NOTICE.
-- =============================================================================
repair_indexes AS (
  SELECT
    'repair_index'                                  AS category,
    idx.index_name                                  AS object_name,
    'index in public schema'                        AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = idx.index_name
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    '20260614200001'                                AS migration_version
  FROM (VALUES
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
  ) AS idx(index_name)
),

-- =============================================================================
-- CTE 10: supabase_migrations.schema_migrations — which versions are recorded
-- NOTE: The supabase_migrations schema is accessible to service-role in the
--       SQL editor.  If you receive "permission denied" on this CTE, the
--       other CTEs (schema objects) are still valid.  The migration-version
--       check here is an additional confirmation layer.
-- =============================================================================
migration_versions AS (
  SELECT
    'migration_version'                             AS category,
    mv.version                                      AS object_name,
    'recorded in supabase_migrations.schema_migrations' AS expected,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version = mv.version
      ) THEN 'PRESENT'
      ELSE 'MISSING'
    END                                             AS actual_status,
    mv.version                                      AS migration_version
  FROM (VALUES
    ('20260609100000'),
    ('20260609110000'),
    ('20260609120000'),
    ('20260609130000'),
    ('20260609140000'),
    ('20260609150000'),
    ('20260609160000'),
    ('20260614000000'),
    ('20260614000001'),
    ('20260614000002'),
    ('20260614000003'),
    ('20260614200000'),
    ('20260614200001'),
    ('20260614200002')
  ) AS mv(version)
),

-- =============================================================================
-- CTE 11: Union all checks into one result set
-- =============================================================================
all_checks AS (
  SELECT * FROM python_flags
  UNION ALL
  SELECT * FROM wave_a_functions
  UNION ALL
  SELECT * FROM wave_a_indexes
  UNION ALL
  SELECT * FROM wave_b_column
  UNION ALL
  SELECT * FROM wave_b_functions
  UNION ALL
  SELECT * FROM wave_b_indexes
  UNION ALL
  SELECT * FROM wave_c_permissions
  UNION ALL
  SELECT * FROM wave_d_functions
  UNION ALL
  SELECT * FROM repair_indexes
  UNION ALL
  SELECT * FROM migration_versions
),

-- =============================================================================
-- CTE 12: Summary counts
-- =============================================================================
summary AS (
  SELECT
    count(*)                                        AS total_checks,
    count(*) FILTER (WHERE actual_status = 'PRESENT') AS present_count,
    count(*) FILTER (WHERE actual_status = 'MISSING') AS missing_count
  FROM all_checks
)

-- =============================================================================
-- MAIN OUTPUT — Per-object drift table
-- =============================================================================
SELECT
    category,
    object_name,
    expected,
    actual_status,
    migration_version,
    -- Inline verdict per row so the DBA can scan quickly
    CASE actual_status
        WHEN 'PRESENT' THEN 'no action needed'
        WHEN 'MISSING' THEN 'run migration ' || migration_version
        ELSE '?'
    END AS action
FROM all_checks
ORDER BY
    actual_status DESC,   -- MISSING rows surface first
    category,
    migration_version,
    object_name;

-- =============================================================================
-- FINAL SUMMARY — Single-line drift verdict
-- Run this separately or read the NOTICE below.
-- =============================================================================
DO $$
DECLARE
  v_total   int;
  v_present int;
  v_missing int;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE chk.actual_status = 'PRESENT'),
    count(*) FILTER (WHERE chk.actual_status = 'MISSING')
  INTO v_total, v_present, v_missing
  FROM (
    -- Python AI flags
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_name = f.n) THEN 'PRESENT' ELSE 'MISSING' END AS actual_status
    FROM (VALUES
      ('ff_python_monthly_synthesis_builder_v1'),
      ('ff_python_nep_compliance_v1'),
      ('ff_python_parent_report_generator_v1'),
      ('ff_python_grade_experiment_conclusion_v1'),
      ('ff_python_verify_question_bank_v1'),
      ('ff_python_extract_ncert_questions_v1'),
      ('ff_python_bulk_non_mcq_gen_v1')
    ) AS f(n)
    UNION ALL
    -- Phase 3B Wave A/B/D functions
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = fn.n) THEN 'PRESENT' ELSE 'MISSING' END
    FROM (VALUES
      ('get_school_overview'), ('get_classes_at_risk'), ('get_teacher_engagement'),
      ('_school_active_student_ids'), ('_count_active_school_students'),
      ('_eval_seat_policy_unchecked'), ('evaluate_seat_policy'),
      ('enroll_students_with_seat_check'), ('enroll_section_students_with_seat_check'),
      ('refresh_school_seat_usage'),
      ('get_school_mastery_rollup'), ('get_school_bloom_summary'), ('export_school_report')
    ) AS fn(n)
    UNION ALL
    -- Indexes (Wave A, Wave B, repair)
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx.n) THEN 'PRESENT' ELSE 'MISSING' END
    FROM (VALUES
      ('idx_classes_school_active'), ('idx_class_teachers_teacher_active'),
      ('idx_teachers_school_active'), ('idx_concept_mastery_student_pknow'),
      ('idx_class_students_class_active'), ('idx_class_students_student_active'),
      ('idx_students_school_active'),
      ('idx_tp_threads_student_id'), ('idx_tp_messages_sender'),
      ('idx_parental_consent_version'), ('idx_data_erasure_requests_student'),
      ('idx_data_erasure_requests_status_created'),
      ('idx_synthetic_monitor_results_name_checked'),
      ('idx_synthetic_monitor_results_status'),
      ('idx_school_slo_log_school_evaluated'),
      ('idx_grounding_circuit_state_name'),
      ('idx_admin_login_attempts_user_attempted'),
      ('idx_parent_cheers_notification_id'),
      ('idx_teacher_remediation_teacher_id'), ('idx_teacher_remediation_student_id'),
      ('idx_teacher_remediation_status_assigned')
    ) AS idx(n)
    UNION ALL
    -- seat_grace_started_at column
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'school_subscriptions'
        AND column_name = 'seat_grace_started_at'
    ) THEN 'PRESENT' ELSE 'MISSING' END
    UNION ALL
    -- Permission codes
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.permissions WHERE code = p.c) THEN 'PRESENT' ELSE 'MISSING' END
    FROM (VALUES
      ('institution.export_reports'), ('institution.manage_billing'),
      ('institution.view_billing'), ('institution.manage_staff'),
      ('institution.manage_students')
    ) AS p(c)
  ) chk;

  RAISE NOTICE '=============================================================';
  RAISE NOTICE 'DRIFT REPORT SUMMARY — project shktyoxqhundlvkiwguu (prod)';
  RAISE NOTICE 'Total checks : %', v_total;
  RAISE NOTICE 'PRESENT      : %', v_present;
  RAISE NOTICE 'MISSING      : %', v_missing;
  IF v_missing = 0 THEN
    RAISE NOTICE 'VERDICT      : NO DRIFT — all expected objects present';
    RAISE NOTICE 'All 13 pending migrations have been applied successfully.';
  ELSE
    RAISE NOTICE 'VERDICT      : DRIFT DETECTED — % item(s) missing', v_missing;
    RAISE NOTICE 'See the SELECT output above for object_name + migration_version.';
    RAISE NOTICE 'Run the indicated migrations in timestamp order to resolve.';
  END IF;
  RAISE NOTICE '=============================================================';
END $$;
