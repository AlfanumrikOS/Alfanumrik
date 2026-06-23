-- verify-b2b-objects.sql
-- READ-ONLY existence audit for every B2B-critical database object (the school /
-- tenant tables, the School/Teacher Command Center read-model RPCs, the
-- seat-enforcement primitives, the Education Intelligence Cloud rollups, and the
-- Principal AI assistant objects).
--
-- WHY: the schema-reproducibility baseline was pre-marked applied on prod /
-- main-staging via `supabase migration repair` (see
-- docs/runbooks/schema-reproducibility-fix.md). That "repair-skip" means a later
-- migration can be RECORDED as applied in supabase_migrations.schema_migrations
-- WITHOUT its DDL ever executing against that environment. The symptom is a flag
-- flip that 500s because the read-model RPC the surface calls does not actually
-- exist. This script detects that drift BEFORE an operator flips a B2B flag ON.
--
-- Owner: architect. Companion runbook section:
--   docs/runbooks/schema-reproducibility-fix.md  ("B2B repair-skip detection").
-- SAFETY: pure catalog reads (pg_proc / information_schema). No writes, no DML,
--   no DDL. Safe to run against PROD by an operator. No parameters required; no
--   user input is interpolated (every identifier below is a hard-coded literal).
--
-- Usage:
--   psql:          \i scripts/sql/verify-b2b-objects.sql
--   supabase cli:  npx -y supabase db query --linked "$(cat scripts/sql/verify-b2b-objects.sql)"
--
-- Interpreting the output:
--   status = 'OK'      → the object exists in this environment.
--   status = 'MISSING' → repair-skip (or never-applied) debt. The owning
--                        migration was recorded applied but its DDL did not run
--                        here. Re-apply per the runbook BEFORE flipping the flag.

-- ─── 1. Tables ────────────────────────────────────────────────────────────────
WITH expected_tables(obj, owning_migration) AS (
  VALUES
    -- Core B2B / white-label substrate
    ('schools',                    '20260506000002_white_label_school_schema'),
    ('school_admins',              '20260506000002_white_label_school_schema'),
    ('school_memberships',         '20260506000002_white_label_school_schema'),
    ('school_subscriptions',       '20260506000002_white_label_school_schema'),
    ('school_announcements',       '20260506000002_white_label_school_schema'),
    ('school_exams',               '20260506000002_white_label_school_schema'),
    ('school_questions',           '20260506000002_white_label_school_schema'),
    ('school_audit_log',           '20260506000002_white_label_school_schema'),
    ('school_invoices',            '20260506000002_white_label_school_schema'),
    ('school_api_keys',            '20260506000002_white_label_school_schema'),
    ('school_seat_usage',          '20260614000001_phase3b_seat_enforcement'),
    ('school_invite_codes',        '20260506000002_white_label_school_schema'),
    ('school_rbac_config',         '20260614000002_phase3b_school_admin_rbac'),
    ('school_contracts',           '20260507150000_school_contracts'),
    ('school_gst_details',         '20260507130000_extend_schools_for_gst'),
    -- Tenant / white-label config
    ('tenant_modules',             '20260507000005_tenant_modules'),
    ('tenant_configs',             '20260507000006_tenant_configs'),
    ('institution_entitlements',   '20260615205753_seed_ff_institution_entitlements_v1'),
    -- Education Intelligence Cloud rollups
    ('mrr_snapshots',              '20260616000000_education_intelligence_cloud_v1'),
    ('school_health_daily',        '20260616000000_education_intelligence_cloud_v1'),
    ('school_churn_signals',       '20260616000000_education_intelligence_cloud_v1'),
    ('school_mrr_daily',           '20260616000000_education_intelligence_cloud_v1'),
    ('geographic_metrics',         '20260616000000_education_intelligence_cloud_v1'),
    -- Principal AI assistant (drafted-not-applied — MISSING here is EXPECTED
    -- until 20260616010000 is applied; informational, not necessarily debt)
    ('principal_ai_sessions',      '20260616010000_principal_ai_assistant_v1'),
    ('principal_ai_messages',      '20260616010000_principal_ai_assistant_v1')
)
SELECT
  'table'        AS kind,
  t.obj          AS object_name,
  t.owning_migration,
  CASE WHEN to_regclass('public.' || t.obj) IS NOT NULL
       THEN 'OK' ELSE 'MISSING' END AS status
FROM expected_tables t

UNION ALL

-- ─── 2. Functions (RPCs) ──────────────────────────────────────────────────────
SELECT
  'function'     AS kind,
  f.obj          AS object_name,
  f.owning_migration,
  CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = f.obj
       ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    -- School Command Center read-model RPCs (the canonical repair-skip suspects)
    ('get_school_overview',          '20260614000000_phase3b_school_command_center_read_models'),
    ('get_classes_at_risk',          '20260614000000_phase3b_school_command_center_read_models'),
    ('get_teacher_engagement',       '20260614000000_phase3b_school_command_center_read_models'),
    -- School reporting depth RPCs
    ('get_school_mastery_rollup',    '20260614000003_phase3b_school_reporting'),
    ('get_school_bloom_summary',     '20260614000003_phase3b_school_reporting'),
    ('export_school_report',         '20260614000003_phase3b_school_reporting'),
    -- Seat-enforcement primitives (provisioning — ff_school_provisioning)
    ('evaluate_seat_policy',                   '20260614000001_phase3b_seat_enforcement'),
    ('enroll_students_with_seat_check',        '20260614000001_phase3b_seat_enforcement'),
    ('enroll_section_students_with_seat_check','20260614000001_phase3b_seat_enforcement'),
    ('refresh_school_seat_usage',              '20260614000001_phase3b_seat_enforcement'),
    -- RLS helper (Phase 3 widening — the get_admin_school_id contradiction)
    ('get_admin_school_id',          '20260620000300_portal_rbac_remediation_phase3_get_admin_school_id_recognizes_school_admins'),
    ('is_school_admin_of',           '00000000000000_baseline_from_prod'),
    -- Education Intelligence Cloud aggregation functions
    ('compute_education_intelligence_rollup', '20260616000100_eic_aggregation_functions'),
    ('compute_mrr_snapshot',                  '20260616000100_eic_aggregation_functions'),
    ('compute_school_health_daily',           '20260616000100_eic_aggregation_functions'),
    ('compute_school_churn_signals',          '20260616000100_eic_aggregation_functions'),
    ('compute_school_mrr_daily',              '20260616000100_eic_aggregation_functions'),
    ('compute_geographic_metrics',            '20260616000100_eic_aggregation_functions'),
    -- Principal AI assistant context RPC (drafted-not-applied — MISSING expected
    -- until 20260616010000 is applied)
    ('get_principal_ai_context',     '20260616010000_principal_ai_assistant_v1')
) AS f(obj, owning_migration)

ORDER BY status DESC, kind, object_name;

-- ─── 3. Migration-ledger cross-check (repair-skip smoking gun) ────────────────
-- For any object reported MISSING above, confirm whether its owning migration is
-- nonetheless RECORDED as applied. A row here with a MISSING object above is a
-- definitive repair-skip. (supabase_migrations.schema_migrations stores the
-- 14-digit version prefix as `version`.)
SELECT
  version,
  COALESCE(name, '(no name recorded)') AS recorded_name
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260506000002', '20260507000005', '20260507000006', '20260507150000',
  '20260507130000', '20260614000000', '20260614000001', '20260614000002',
  '20260614000003', '20260615205753', '20260616000000', '20260616000100',
  '20260616010000', '20260620000300'
)
ORDER BY version;
