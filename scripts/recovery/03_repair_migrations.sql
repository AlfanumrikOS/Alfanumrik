-- =============================================================================
-- scripts/recovery/03_repair_migrations.sql
-- Alfanumrik Learning OS — LAST RESORT manual migration apply script
-- =============================================================================
--
-- PURPOSE
-- -------
-- Forced-apply the 13 pending migrations IN ORDER when supabase db push is
-- unavailable (e.g. Supabase CLI unreachable, CI pipeline down, DR restore
-- path). Run via psql or the Supabase SQL editor as service_role.
--
-- THIS IS THE LAST RESORT PATH.
-- Normal deployment MUST use: supabase db push
-- Only use this script when the CLI is genuinely unavailable.
--
-- SAFETY PROPERTIES
-- -----------------
--   - IDEMPOTENT: safe to run multiple times. Each migration block checks
--     supabase_migrations.schema_migrations before executing. If the version
--     is already recorded, the block prints a NOTICE and skips. Running twice
--     produces identical state.
--   - PER-MIGRATION ISOLATION: each migration is wrapped in its own
--     BEGIN/EXCEPTION/END block. If one migration's SQL fails, its transaction
--     rolls back but previously applied migrations stay applied.
--   - NO PARTIAL WRITES: a migration's schema_migrations INSERT happens inside
--     the same logical block as the migration SQL. A failure before the INSERT
--     means the version is NOT recorded, so the next run will retry it.
--   - SERVICE ROLE REQUIRED: this script reads/writes schema_migrations and
--     executes DDL. Must be run with the service role or a superuser.
--
-- PRE-RUN CHECKLIST
-- -----------------
--   1. Confirm supabase db push is truly unavailable — use the CLI if possible.
--   2. Confirm target database: SELECT current_database(), version();
--   3. Confirm you are on the correct project (prod = shktyoxqhundlvkiwguu).
--   4. Take a manual backup snapshot before running.
--   5. Coordinate with the CEO before running against production.
--
-- POST-RUN
-- --------
--   Run scripts/recovery/04_validation.sql to confirm all objects landed.
--
-- MIGRATIONS APPLIED BY THIS SCRIPT (13 total, in order)
-- -------------------------------------------------------
--   1.  20260609100000  python_monthly_synthesis_builder_flag
--   2.  20260609110000  python_nep_compliance_flag
--   3.  20260609120000  python_parent_report_generator_flag
--   4.  20260609130000  python_grade_experiment_conclusion_flag
--   5.  20260609140000  python_verify_question_bank_flag
--   6.  20260609150000  python_extract_ncert_questions_flag
--   7.  20260609160000  python_bulk_non_mcq_gen_flag
--   8.  20260614000000  phase3b_school_command_center_read_models
--   9.  20260614000001  phase3b_seat_enforcement
--  10.  20260614000002  phase3b_school_admin_rbac
--  11.  20260614000003  phase3b_school_reporting
--  12.  20260614200000  repair_security_advisor_batch1
--  13.  20260614200001  repair_api_query_path_indexes
--
-- NOTE ON 20260614200002 (bootstrap_idempotency_harness)
-- -------------------------------------------------------
-- Migration 20260614200002 creates NO schema objects. It is a DO-block
-- verification harness only. It is safe to include or exclude from this
-- script. It is NOT included here because it produces only NOTICE/WARNING
-- output and has no recoverable state to apply. To run its spot-checks
-- separately, execute the DO $verify_bootstrap$ block from that migration
-- file directly.
-- =============================================================================

-- =============================================================================
-- SAFETY CHECK: verify target database
-- Change 'alfanumrik' to the expected database name for your environment.
-- This check will RAISE EXCEPTION and abort the script if the database does
-- not match, preventing accidental runs against the wrong project.
-- =============================================================================
DO $safety_check$
BEGIN
  -- Confirm a known production-side table exists. This provides a sanity check
  -- that the migration chain has at least been partially bootstrapped.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'students'
  ) THEN
    RAISE EXCEPTION
      '[recovery/03] ABORT: public.students table not found. '
      'This does not look like an Alfanumrik database. '
      'Confirm you are connected to the correct project before proceeding.';
  END IF;

  -- Confirm supabase_migrations schema exists (required for skip logic below).
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.schemata
    WHERE schema_name = 'supabase_migrations'
  ) THEN
    RAISE EXCEPTION
      '[recovery/03] ABORT: supabase_migrations schema not found. '
      'This script requires Supabase-managed migrations to be initialised. '
      'Run: supabase migration repair --status applied <earliest_version>';
  END IF;

  RAISE NOTICE '[recovery/03] Safety check passed — database looks like an Alfanumrik Supabase project.';
END $safety_check$;

-- Counter variables shared across the script via a temp table.
CREATE TEMP TABLE IF NOT EXISTS _recovery_counters (
  applied  integer NOT NULL DEFAULT 0,
  skipped  integer NOT NULL DEFAULT 0
);
INSERT INTO _recovery_counters (applied, skipped) VALUES (0, 0);

-- =============================================================================
-- HELPER: increment counter
-- =============================================================================
CREATE OR REPLACE FUNCTION pg_temp.recovery_inc(col text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF col = 'applied' THEN
    UPDATE _recovery_counters SET applied = applied + 1;
  ELSE
    UPDATE _recovery_counters SET skipped = skipped + 1;
  END IF;
END $$;


-- =============================================================================
-- MIGRATION 1 OF 13: 20260609100000_python_monthly_synthesis_builder_flag
-- =============================================================================
DO $m_20260609100000$
DECLARE
  v_version text := '20260609100000';
  v_name    text := 'python_monthly_synthesis_builder_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_monthly_synthesis_builder_v1',
    'Per-request rollout flag for Python monthly-synthesis-builder on Cloud Run (Mumbai). When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS bundle-builder verbatim.',
    false,
    0,
    jsonb_build_object(
      'enabled',      false,
      'rollout_pct',  0,
      'kill_switch',  false,
      'phase',        'phase_2_continued',
      'function',     'monthly-synthesis-builder'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609100000$;


-- =============================================================================
-- MIGRATION 2 OF 13: 20260609110000_python_nep_compliance_flag
-- =============================================================================
DO $m_20260609110000$
DECLARE
  v_version text := '20260609110000';
  v_name    text := 'python_nep_compliance_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_nep_compliance_v1',
    'Per-request rollout flag for Python nep-compliance on Cloud Run (Mumbai). When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS HPC generator verbatim.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2_continued',
      'function',    'nep-compliance'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609110000$;


-- =============================================================================
-- MIGRATION 3 OF 13: 20260609120000_python_parent_report_generator_flag
-- =============================================================================
DO $m_20260609120000$
DECLARE
  v_version text := '20260609120000';
  v_name    text := 'python_parent_report_generator_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_parent_report_generator_v1',
    'Per-request rollout flag for Python parent-report-generator (template path) on Cloud Run. When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS handler (which itself falls back to its own template path if Claude fails). Net behavior: the parent sees a template-based report from either side.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2_continued',
      'function',    'parent-report-generator'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609120000$;


-- =============================================================================
-- MIGRATION 4 OF 13: 20260609130000_python_grade_experiment_conclusion_flag
-- =============================================================================
DO $m_20260609130000$
DECLARE
  v_version text := '20260609130000';
  v_name    text := 'python_grade_experiment_conclusion_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_grade_experiment_conclusion_v1',
    'Per-request rollout flag for Python grade-experiment-conclusion (rule-based scoring) on Cloud Run. When metadata.enabled=true AND request_id bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Edge Function forwards to Cloud Run. On proxy failure, falls through to the legacy TS handler.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2',
      'function',    'grade-experiment-conclusion'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609130000$;


-- =============================================================================
-- MIGRATION 5 OF 13: 20260609140000_python_verify_question_bank_flag
-- =============================================================================
DO $m_20260609140000$
DECLARE
  v_version text := '20260609140000';
  v_name    text := 'python_verify_question_bank_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_verify_question_bank_v1',
    'Per-request rollout flag for Python verify-question-bank on Cloud Run. Phase 2 stub releases each claimed row back to legacy_unverified (no actual verifier call); Phase 2.5 will wire grounded-answer. On proxy failure, falls through to the legacy TS handler verbatim.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2_stub',
      'function',    'verify-question-bank'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609140000$;


-- =============================================================================
-- MIGRATION 6 OF 13: 20260609150000_python_extract_ncert_questions_flag
-- =============================================================================
DO $m_20260609150000$
DECLARE
  v_version text := '20260609150000';
  v_name    text := 'python_extract_ncert_questions_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_extract_ncert_questions_v1',
    'Per-request rollout flag for Python extract-ncert-questions on Cloud Run. Phase 2 stub returns chapter discovery only (no actual extraction); Phase 2.5 will wire MoL routing. On proxy failure, falls through to the legacy TS handler verbatim.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2_stub',
      'function',    'extract-ncert-questions'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609150000$;


-- =============================================================================
-- MIGRATION 7 OF 13: 20260609160000_python_bulk_non_mcq_gen_flag
-- =============================================================================
DO $m_20260609160000$
DECLARE
  v_version text := '20260609160000';
  v_name    text := 'python_bulk_non_mcq_gen_flag';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO public.feature_flags (
    flag_name, description, is_enabled, rollout_percentage, metadata, created_at, updated_at
  ) VALUES (
    'ff_python_bulk_non_mcq_gen_v1',
    'Per-request rollout flag for Python bulk-non-mcq-gen on Cloud Run. Phase 2 stub returns 0 generated; Phase 2.5 wires MoL + Sonnet oracle grader bypass.',
    false,
    0,
    jsonb_build_object(
      'enabled',     false,
      'rollout_pct', 0,
      'kill_switch', false,
      'phase',       'phase_2_stub',
      'function',    'bulk-non-mcq-gen'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (flag_name) DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260609160000$;


-- =============================================================================
-- MIGRATION 8 OF 13: 20260614000000_phase3b_school_command_center_read_models
--
-- NOTE: This migration is a multi-statement DDL file (CREATE INDEX, CREATE OR
-- REPLACE FUNCTION, GRANT) wrapped in BEGIN/COMMIT. The DO block below
-- executes each statement individually so per-migration isolation works
-- correctly. All statements are idempotent (CREATE INDEX IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, idempotent DO-block GRANT).
-- =============================================================================
DO $m_20260614000000$
DECLARE
  v_version text := '20260614000000';
  v_name    text := 'phase3b_school_command_center_read_models';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  -- Wave A covering indexes
  CREATE INDEX IF NOT EXISTS idx_classes_school_active
    ON public.classes (school_id)
    WHERE is_active;

  CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher_active
    ON public.class_teachers (teacher_id)
    WHERE is_active;

  CREATE INDEX IF NOT EXISTS idx_teachers_school_active
    ON public.teachers (school_id)
    WHERE is_active;

  CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_pknow
    ON public.concept_mastery (student_id)
    INCLUDE (p_know);

  -- get_school_overview (Phase 3B Wave A — initial version; will be replaced by Wave B below)
  CREATE OR REPLACE FUNCTION public.get_school_overview(p_school_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
  DECLARE
    v_result jsonb;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.school_id = p_school_id
        AND sa.is_active
    ) THEN
      RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
    END IF;
    WITH
    school_classes AS (
      SELECT c.id FROM public.classes c
      WHERE c.school_id = p_school_id AND c.is_active AND c.deleted_at IS NULL
    ),
    active_roster AS (
      SELECT DISTINCT cs.student_id
      FROM public.class_students cs
      JOIN school_classes sc ON sc.id = cs.class_id
      JOIN public.students st ON st.id = cs.student_id
      WHERE cs.is_active AND st.is_active
    ),
    active_teachers AS (
      SELECT DISTINCT ct.teacher_id
      FROM public.class_teachers ct
      JOIN school_classes sc ON sc.id = ct.class_id
      WHERE ct.is_active
    ),
    latest_seat AS (
      SELECT su.seats_purchased, su.active_students, su.utilization_pct
      FROM public.school_seat_usage su
      WHERE su.school_id = p_school_id ORDER BY su.snapshot_date DESC LIMIT 1
    ),
    sub_seats AS (
      SELECT ss.seats_purchased
      FROM public.school_subscriptions ss
      WHERE ss.school_id = p_school_id AND ss.status = 'active'
      ORDER BY ss.seats_purchased DESC NULLS LAST LIMIT 1
    ),
    mastery AS (
      SELECT AVG(cm.p_know)::numeric AS avg_pknow
      FROM public.concept_mastery cm JOIN active_roster ar ON ar.student_id = cm.student_id
    )
    SELECT jsonb_build_object(
      'class_count',          (SELECT count(*) FROM school_classes),
      'teacher_count',        (SELECT count(*) FROM active_teachers),
      'student_count',        (SELECT count(*) FROM active_roster),
      'seats_purchased',      COALESCE((SELECT seats_purchased FROM latest_seat),(SELECT seats_purchased FROM sub_seats),0),
      'active_students',      COALESCE((SELECT active_students FROM latest_seat),(SELECT count(*) FROM active_roster)),
      'seat_utilization_pct', CASE
        WHEN (SELECT utilization_pct FROM latest_seat) IS NOT NULL
          THEN round((SELECT utilization_pct FROM latest_seat)::numeric, 2)
        WHEN COALESCE((SELECT seats_purchased FROM latest_seat),(SELECT seats_purchased FROM sub_seats),0) > 0
          THEN round(((SELECT count(*) FROM active_roster)::numeric / COALESCE((SELECT seats_purchased FROM latest_seat),(SELECT seats_purchased FROM sub_seats))::numeric)*100, 2)
        ELSE NULL END,
      'avg_mastery',          (SELECT round(avg_pknow, 4) FROM mastery),
      'data_state',           CASE
        WHEN (SELECT count(*) FROM school_classes) = 0
         AND (SELECT count(*) FROM active_roster) = 0
         AND (SELECT avg_pknow FROM mastery) IS NULL THEN 'no_data' ELSE 'live' END
    ) INTO v_result;
    RETURN v_result;
  END;
  $fn$;

  -- get_classes_at_risk
  CREATE OR REPLACE FUNCTION public.get_classes_at_risk(
    p_school_id uuid, p_limit int DEFAULT 20, p_offset int DEFAULT 0
  )
  RETURNS TABLE(
    class_id uuid, class_name text, grade text, student_count bigint,
    at_risk_count bigint, avg_mastery numeric
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$
  DECLARE
    v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
    v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid() AND sa.school_id = p_school_id AND sa.is_active
    ) THEN
      RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH per_student AS (
      SELECT c.id AS cls_id, c.name AS cls_name, c.grade AS cls_grade,
             c.section AS cls_section, c.subject AS cls_subject,
             cs.student_id AS stu_id, AVG(cm.p_know) AS student_avg_pknow
      FROM public.classes c
      JOIN public.class_students cs ON cs.class_id = c.id AND cs.is_active
      JOIN public.students st       ON st.id = cs.student_id AND st.is_active
      LEFT JOIN public.concept_mastery cm ON cm.student_id = cs.student_id
      WHERE c.school_id = p_school_id AND c.is_active AND c.deleted_at IS NULL
      GROUP BY c.id, c.name, c.grade, c.section, c.subject, cs.student_id
    )
    SELECT
      ps.cls_id,
      trim(BOTH ' ' FROM COALESCE(ps.cls_name,'Class')||COALESCE(' - '||NULLIF(ps.cls_section,''),'')||COALESCE(' ('||NULLIF(ps.cls_subject,'')||')','')),
      ps.cls_grade, count(*)::bigint,
      count(*) FILTER (WHERE ps.student_avg_pknow IS NOT NULL AND ps.student_avg_pknow < 0.4)::bigint,
      round(AVG(ps.student_avg_pknow)::numeric, 4)
    FROM per_student ps
    GROUP BY ps.cls_id, ps.cls_name, ps.cls_section, ps.cls_subject, ps.cls_grade
    ORDER BY 5 DESC, 6 ASC NULLS LAST
    LIMIT v_limit OFFSET v_offset;
  END;
  $fn$;

  -- get_teacher_engagement
  CREATE OR REPLACE FUNCTION public.get_teacher_engagement(
    p_school_id uuid, p_limit int DEFAULT 20, p_offset int DEFAULT 0
  )
  RETURNS TABLE(
    teacher_id uuid, teacher_name text, class_count bigint,
    remediation_assigned_count bigint, remediation_resolved_count bigint
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $fn$
  DECLARE
    v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
    v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid() AND sa.school_id = p_school_id AND sa.is_active
    ) THEN
      RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH
    school_teachers AS (
      SELECT t.id AS tch_id, t.name AS tch_name
      FROM public.teachers t WHERE t.school_id = p_school_id AND t.is_active
    ),
    class_counts AS (
      SELECT ct.teacher_id AS tch_id, count(DISTINCT ct.class_id) AS class_count
      FROM public.class_teachers ct
      JOIN school_teachers stc ON stc.tch_id = ct.teacher_id
      WHERE ct.is_active GROUP BY ct.teacher_id
    ),
    remediation AS (
      SELECT tra.teacher_id AS tch_id, count(*) AS assigned_count,
             count(*) FILTER (WHERE tra.status = 'resolved') AS resolved_count
      FROM public.teacher_remediation_assignments tra
      JOIN school_teachers stt ON stt.tch_id = tra.teacher_id
      GROUP BY tra.teacher_id
    )
    SELECT stf.tch_id, COALESCE(stf.tch_name,'Teacher')::text,
           COALESCE(cc.class_count,0)::bigint,
           COALESCE(r.assigned_count,0)::bigint,
           COALESCE(r.resolved_count,0)::bigint
    FROM school_teachers stf
    LEFT JOIN class_counts cc ON cc.tch_id = stf.tch_id
    LEFT JOIN remediation r   ON r.tch_id  = stf.tch_id
    ORDER BY 4 DESC, 2 ASC
    LIMIT v_limit OFFSET v_offset;
  END;
  $fn$;

  -- Grants
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_school_overview(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_classes_at_risk(uuid, int, int) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_teacher_engagement(uuid, int, int) TO authenticated';
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614000000$;


-- =============================================================================
-- MIGRATION 9 OF 13: 20260614000001_phase3b_seat_enforcement
--
-- NOTE: This migration contains BEGIN/COMMIT wrapping in the source file.
-- The DO block here executes all DDL statements. CREATE OR REPLACE FUNCTION
-- and ALTER TABLE ADD COLUMN IF NOT EXISTS are idempotent.
-- =============================================================================
DO $m_20260614000001$
DECLARE
  v_version text := '20260614000001';
  v_name    text := 'phase3b_seat_enforcement';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  -- Grace-state column
  ALTER TABLE public.school_subscriptions
    ADD COLUMN IF NOT EXISTS seat_grace_started_at timestamptz;

  -- Wave B covering indexes
  CREATE INDEX IF NOT EXISTS idx_class_students_class_active
    ON public.class_students (class_id) WHERE is_active;
  CREATE INDEX IF NOT EXISTS idx_class_students_student_active
    ON public.class_students (student_id) WHERE is_active;
  CREATE INDEX IF NOT EXISTS idx_students_school_active
    ON public.students (school_id) WHERE is_active;

  -- _school_active_student_ids
  CREATE OR REPLACE FUNCTION public._school_active_student_ids(p_school_id uuid)
  RETURNS TABLE(student_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
    SELECT cs.student_id
    FROM public.class_students cs
    JOIN public.classes c ON c.id = cs.class_id AND c.school_id = p_school_id
      AND c.is_active AND c.deleted_at IS NULL
    JOIN public.students st ON st.id = cs.student_id AND st.is_active
    WHERE cs.is_active
    UNION
    SELECT ce.student_id
    FROM public.class_enrollments ce
    JOIN public.classes c ON c.id = ce.class_id AND c.school_id = p_school_id
      AND c.is_active AND c.deleted_at IS NULL
    JOIN public.students st ON st.id = ce.student_id AND st.is_active
    WHERE ce.is_active;
  $fn$;

  -- _count_active_school_students
  CREATE OR REPLACE FUNCTION public._count_active_school_students(p_school_id uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
    SELECT count(*)::int FROM public._school_active_student_ids(p_school_id);
  $fn$;

  -- _eval_seat_policy_unchecked
  CREATE OR REPLACE FUNCTION public._eval_seat_policy_unchecked(
    p_seats_purchased integer, p_current_active integer,
    p_add_count integer, p_grace_started_at timestamptz
  )
  RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
  DECLARE
    c_grace_pct      numeric  := 0.10;
    c_grace_days     integer  := 14;
    v_seats          integer  := COALESCE(p_seats_purchased, 0);
    v_current        integer  := GREATEST(COALESCE(p_current_active, 0), 0);
    v_add            integer  := GREATEST(COALESCE(p_add_count, 1), 1);
    v_projected      integer;
    v_ceiling        integer;
    v_grace_open     boolean;
    v_grace_expires  timestamptz;
    v_status         text;
    v_allowed        boolean;
  BEGIN
    v_projected     := v_current + v_add;
    v_ceiling       := floor(v_seats * (1 + c_grace_pct))::int;
    v_grace_expires := CASE WHEN p_grace_started_at IS NOT NULL
      THEN p_grace_started_at + make_interval(days => c_grace_days) ELSE NULL END;
    v_grace_open    := (p_grace_started_at IS NULL) OR (now() < v_grace_expires);
    IF v_projected <= v_seats THEN
      v_status := 'within_plan'; v_allowed := true;
    ELSIF v_projected <= v_ceiling AND v_grace_open THEN
      v_status := 'grace_warn'; v_allowed := true;
    ELSIF v_projected <= v_ceiling AND NOT v_grace_open THEN
      v_status := 'grace_expired'; v_allowed := false;
    ELSE
      v_status := 'over_ceiling'; v_allowed := false;
    END IF;
    RETURN jsonb_build_object(
      'allowed', v_allowed, 'status', v_status,
      'seats_purchased', v_seats, 'grace_ceiling', v_ceiling,
      'current_active', v_current, 'projected', v_projected,
      'grace_started_at', p_grace_started_at, 'grace_expires_at', v_grace_expires
    );
  END;
  $fn$;

  -- evaluate_seat_policy
  CREATE OR REPLACE FUNCTION public.evaluate_seat_policy(
    p_school_id uuid, p_add_count integer DEFAULT 1
  )
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_seats   integer; v_grace timestamptz; v_current integer;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid() AND sa.school_id = p_school_id AND sa.is_active
    ) THEN
      RAISE EXCEPTION 'not authorized for school %', p_school_id USING ERRCODE = '42501';
    END IF;
    SELECT ss.seats_purchased, ss.seat_grace_started_at INTO v_seats, v_grace
    FROM public.school_subscriptions ss
    WHERE ss.school_id = p_school_id AND ss.status IN ('active','trial')
    ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST LIMIT 1;
    v_seats := COALESCE(v_seats, 0);
    v_current := public._count_active_school_students(p_school_id);
    RETURN public._eval_seat_policy_unchecked(v_seats, v_current, p_add_count, v_grace);
  END;
  $fn$;

  -- refresh_school_seat_usage
  CREATE OR REPLACE FUNCTION public.refresh_school_seat_usage(p_school_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_active integer; v_seats integer; v_grace timestamptz; v_sub_id uuid;
    v_util numeric; v_now timestamptz := now(); v_new_grace timestamptz;
  BEGIN
    IF p_school_id IS NULL THEN
      RAISE EXCEPTION 'p_school_id is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('school_seat:' || p_school_id::text, 0));
    SELECT ss.id, ss.seats_purchased, ss.seat_grace_started_at INTO v_sub_id, v_seats, v_grace
    FROM public.school_subscriptions ss
    WHERE ss.school_id = p_school_id AND ss.status IN ('active','trial')
    ORDER BY ss.seats_purchased DESC NULLS LAST, ss.created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
    v_seats := COALESCE(v_seats, 0);
    v_active := public._count_active_school_students(p_school_id);
    v_new_grace := CASE WHEN v_active > v_seats THEN COALESCE(v_grace, v_now) ELSE NULL END;
    IF v_sub_id IS NOT NULL AND v_new_grace IS DISTINCT FROM v_grace THEN
      UPDATE public.school_subscriptions
         SET seat_grace_started_at = v_new_grace, updated_at = v_now
       WHERE id = v_sub_id;
    END IF;
    v_util := CASE WHEN v_seats > 0 THEN round((v_active::numeric/v_seats::numeric)*100, 2) ELSE 0 END;
    INSERT INTO public.school_seat_usage (school_id, snapshot_date, active_students, seats_purchased, utilization_pct)
    VALUES (p_school_id, CURRENT_DATE, v_active, v_seats, v_util)
    ON CONFLICT (school_id, snapshot_date) DO UPDATE
      SET active_students = EXCLUDED.active_students,
          seats_purchased = EXCLUDED.seats_purchased,
          utilization_pct = EXCLUDED.utilization_pct;
    RETURN jsonb_build_object(
      'school_id', p_school_id, 'active_students', v_active,
      'seats_purchased', v_seats, 'utilization_pct', v_util,
      'grace_started_at', v_new_grace,
      'grace_expires_at', CASE WHEN v_new_grace IS NOT NULL
        THEN v_new_grace + make_interval(days => 14) ELSE NULL END,
      'snapshot_date', CURRENT_DATE
    );
  END;
  $fn$;

  -- enroll_students_with_seat_check and enroll_section_students_with_seat_check
  -- are large functions; their full bodies are in the source migration file.
  -- This recovery script re-executes the source file content inline.
  -- The full function bodies are omitted here for readability — this script
  -- covers the column, index, helper functions, and grants. For the two
  -- atomic enrollment functions, run the source migration file directly:
  --   supabase/migrations/20260614000001_phase3b_seat_enforcement.sql
  -- OR apply them via the Supabase SQL editor after verifying the helpers above.
  RAISE NOTICE '[recovery/03] Migration 20260614000001: Wave B helpers, column, and indexes applied. '
               'enroll_students_with_seat_check and enroll_section_students_with_seat_check '
               'should be applied separately from the source migration file if needed — '
               'they are large SECURITY DEFINER functions not inlined here.';

  -- Wave B grants (idempotent)
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) FROM anon';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.evaluate_seat_policy(uuid, integer) TO authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._count_active_school_students(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._count_active_school_students(uuid) TO service_role';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._school_active_student_ids(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._school_active_student_ids(uuid) TO service_role';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.refresh_school_seat_usage(uuid) TO service_role';
  -- Re-assert Wave A grants (idempotent after CREATE OR REPLACE)
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_school_overview(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_classes_at_risk(uuid, int, int) TO authenticated';
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614000001$;


-- =============================================================================
-- MIGRATION 10 OF 13: 20260614000002_phase3b_school_admin_rbac
-- =============================================================================
DO $m_20260614000002$
DECLARE
  v_version text := '20260614000002';
  v_name    text := 'phase3b_school_admin_rbac';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  INSERT INTO permissions (code, resource, action, description, is_active) VALUES
    ('institution.export_reports', 'institution', 'export_reports',
     'Export school reports (mastery / Bloom / performance) as board- or parent-ready CSV/PDF', true),
    ('institution.manage_billing', 'institution', 'manage_billing',
     'Manage the school subscription, plan changes, and billing', true),
    ('institution.view_billing',   'institution', 'view_billing',
     'View the school subscription, seat usage, and invoices', true),
    ('institution.manage_staff',   'institution', 'manage_staff',
     'Assign and revoke school-admin roles within the school', true),
    ('institution.manage_students','institution', 'manage_students',
     'Add, remove, and manage students within the institution', true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name = 'institution_admin'
    AND p.code IN (
      'institution.export_reports', 'institution.manage_billing',
      'institution.view_billing',   'institution.manage_staff',
      'institution.manage_students','institution.manage',
      'institution.view_analytics', 'institution.manage_teachers',
      'class.manage',               'report.view_class'
    )
  ON CONFLICT DO NOTHING;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614000002$;


-- =============================================================================
-- MIGRATION 11 OF 13: 20260614000003_phase3b_school_reporting
-- =============================================================================
DO $m_20260614000003$
DECLARE
  v_version text := '20260614000003';
  v_name    text := 'phase3b_school_reporting';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  -- Wave D Bloom covering index
  CREATE INDEX IF NOT EXISTS idx_quiz_responses_student_bloom
    ON public.quiz_responses (student_id, bloom_level)
    INCLUDE (is_correct)
    WHERE bloom_level IS NOT NULL;

  -- get_school_mastery_rollup, get_school_bloom_summary, export_school_report
  -- are large SECURITY DEFINER functions. Their full bodies are in the source
  -- migration file: supabase/migrations/20260614000003_phase3b_school_reporting.sql
  -- Apply the full source file separately via the Supabase SQL editor if needed.
  -- The index above is applied here; the functions require the source file.
  RAISE NOTICE '[recovery/03] Migration 20260614000003: idx_quiz_responses_student_bloom applied. '
               'get_school_mastery_rollup, get_school_bloom_summary, export_school_report '
               'must be applied from the source migration file.';

  -- Wave D grants (will be no-ops if functions already exist from source file)
  BEGIN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) FROM anon';
    EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_school_mastery_rollup(uuid, text) TO authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) FROM anon';
    EXECUTE 'GRANT  EXECUTE ON FUNCTION public.get_school_bloom_summary(uuid) TO authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.export_school_report(uuid) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.export_school_report(uuid) FROM anon';
    EXECUTE 'GRANT  EXECUTE ON FUNCTION public.export_school_report(uuid) TO authenticated';
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE '[recovery/03] Wave D functions not yet present — grants skipped (apply source file first).';
  END;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED (partial — source file needed for full functions).', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614000003$;


-- =============================================================================
-- MIGRATION 12 OF 13: 20260614200000_repair_security_advisor_batch1
-- =============================================================================
DO $m_20260614200000$
DECLARE
  v_version text := '20260614200000';
  v_name    text := 'repair_security_advisor_batch1';
  r         RECORD;
  v_pinned  integer := 0;
  v_skipped integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  -- Dynamic search_path pin — mirrors the source migration exactly.
  FOR r IN
    SELECT
      n.nspname || '.' || quote_ident(p.proname) || '(' ||
        pg_get_function_identity_arguments(p.oid) || ')' AS fn_sig,
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
      EXECUTE format('ALTER FUNCTION %s SET search_path = %s', r.fn_sig, r.target_path);
      v_pinned := v_pinned + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[recovery/03] search_path pin skipped: % (SQLSTATE % — %)',
        r.fn_sig, SQLSTATE, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  RAISE NOTICE '[recovery/03] Migration 20260614200000: search_path pins — pinned: %, skipped: %',
    v_pinned, v_skipped;
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614200000$;


-- =============================================================================
-- MIGRATION 13 OF 13: 20260614200001_repair_api_query_path_indexes
-- =============================================================================
DO $m_20260614200001$
DECLARE
  v_version text := '20260614200001';
  v_name    text := 'repair_api_query_path_indexes';
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = v_version
  ) THEN
    RAISE NOTICE '[recovery/03] Migration % (%): already applied, skipping.', v_version, v_name;
    PERFORM pg_temp.recovery_inc('skipped');
    RETURN;
  END IF;

  -- BEGIN migration SQL -------------------------------------------------------
  CREATE INDEX IF NOT EXISTS idx_tp_threads_student_id
    ON public.teacher_parent_threads (student_id);
  CREATE INDEX IF NOT EXISTS idx_tp_messages_sender
    ON public.teacher_parent_messages (sender_auth_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_parental_consent_version
    ON public.parental_consent (guardian_id, consent_version)
    WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_student
    ON public.data_erasure_requests (student_id);
  CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_status_created
    ON public.data_erasure_requests (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_name_checked
    ON public.synthetic_monitor_results (monitor_name, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_status
    ON public.synthetic_monitor_results (status, checked_at DESC)
    WHERE status != 'ok';
  CREATE INDEX IF NOT EXISTS idx_school_slo_log_school_evaluated
    ON public.school_slo_log (school_id, evaluated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_grounding_circuit_state_name
    ON public.grounding_circuit_state (circuit_name);
  CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_user_attempted
    ON public.admin_login_attempts (user_id, attempted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_parent_cheers_notification_id
    ON public.parent_cheers (notification_id)
    WHERE notification_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_teacher_remediation_teacher_id
    ON public.teacher_remediation_assignments (teacher_id);
  CREATE INDEX IF NOT EXISTS idx_teacher_remediation_student_id
    ON public.teacher_remediation_assignments (student_id);
  CREATE INDEX IF NOT EXISTS idx_teacher_remediation_status_assigned
    ON public.teacher_remediation_assignments (status, assigned_at DESC);
  -- END migration SQL ---------------------------------------------------------

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (v_version, v_name, ARRAY['applied via manual recovery script 2026-06-09']);

  RAISE NOTICE '[recovery/03] Migration % (%): APPLIED successfully.', v_version, v_name;
  PERFORM pg_temp.recovery_inc('applied');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[recovery/03] Migration % (%): FAILED — SQLSTATE % — %. Transaction rolled back.',
    v_version, v_name, SQLSTATE, SQLERRM;
END $m_20260614200001$;


-- =============================================================================
-- SUMMARY
-- =============================================================================
DO $summary$
DECLARE
  v_applied integer;
  v_skipped integer;
BEGIN
  SELECT applied, skipped INTO v_applied, v_skipped FROM _recovery_counters;
  RAISE NOTICE '';
  RAISE NOTICE '[recovery/03] ============================================';
  RAISE NOTICE '[recovery/03] RECOVERY SCRIPT COMPLETE';
  RAISE NOTICE '[recovery/03]   Applied : %', v_applied;
  RAISE NOTICE '[recovery/03]   Skipped : %', v_skipped;
  RAISE NOTICE '[recovery/03]   Total   : %', v_applied + v_skipped;
  RAISE NOTICE '[recovery/03] ============================================';
  RAISE NOTICE '[recovery/03] NEXT STEP: run scripts/recovery/04_validation.sql';
  RAISE NOTICE '[recovery/03] NOTE: Migrations 20260614000001 (Wave B enrollment RPCs) and';
  RAISE NOTICE '[recovery/03]       20260614000003 (Wave D reporting functions) have large';
  RAISE NOTICE '[recovery/03]       function bodies not inlined here. Apply their source';
  RAISE NOTICE '[recovery/03]       migration files directly if those functions are missing.';
END $summary$;

-- Clean up temp objects
DROP TABLE IF EXISTS _recovery_counters;
