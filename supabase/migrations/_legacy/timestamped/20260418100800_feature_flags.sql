-- Migration: 20260418100800_feature_flags.sql
-- Purpose: Feature flags + per-pair enforcement table for the grounded-answer
-- rollout (Spec section 6.2, 6.5, 10.4).
--
-- Schema note: feature_flags uses the existing columns (flag_name, is_enabled,
-- description). flag_name has no UNIQUE constraint so we use IF NOT EXISTS
-- existence checks instead of ON CONFLICT — established pattern from
-- 20260405100001_improvement_mode_flag.sql.

-- ── Global kill switches (all OFF by default) ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_grounded_ai_enabled') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_grounded_ai_enabled', false,
            'Global grounded-answer service enabled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_grounded_ai_foxy') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_grounded_ai_foxy', false,
            'Route Foxy through grounded-answer service');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_grounded_ai_quiz_generator') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_grounded_ai_quiz_generator', false,
            'Route quiz-generator through service (two-pass verify)');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_grounded_ai_ncert_solver') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_grounded_ai_ncert_solver', false,
            'Route NCERT-solver through service');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_grounded_ai_concept_engine') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_grounded_ai_concept_engine', false,
            'Route concept-engine retrieval through service');
  END IF;
END $$;

-- ── Per-pair enforcement table ───────────────────────────────────────────────
-- Tracks which (grade, subject_code) pairs have grounding enforcement turned on.
-- Auto-disable fields record when the service self-disabled due to coverage
-- regression (spec section 10.4 enforcement auto-disable threshold).
CREATE TABLE IF NOT EXISTS ff_grounded_ai_enforced_pairs (
  grade                 text NOT NULL,
  subject_code          text NOT NULL,
  enabled               boolean NOT NULL DEFAULT false,
  enabled_at            timestamptz,
  enabled_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  auto_disabled_at      timestamptz,
  auto_disabled_reason  text,
  PRIMARY KEY (grade, subject_code)
);

ALTER TABLE ff_grounded_ai_enforced_pairs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (Edge Function + API routes consult this)
DROP POLICY IF EXISTS ff_pairs_read_all ON ff_grounded_ai_enforced_pairs;
CREATE POLICY ff_pairs_read_all ON ff_grounded_ai_enforced_pairs
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only service_role + active admin_users can write. Follows the established
-- admin_users pattern (see 20260324070000_production_rbac_system.sql) used
-- across 30+ existing migrations.
DROP POLICY IF EXISTS ff_pairs_write_admin ON ff_grounded_ai_enforced_pairs;
CREATE POLICY ff_pairs_write_admin ON ff_grounded_ai_enforced_pairs
  FOR ALL USING (
    auth.role() = 'service_role' OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

COMMENT ON TABLE ff_grounded_ai_enforced_pairs IS
  'Per-(grade, subject_code) grounding enforcement flags. '
  'When enabled, the grounded-answer service treats requests for this pair as '
  'strict mode (abstain rather than fall back). Auto-disabled when coverage '
  'drops below ENFORCEMENT_AUTO_DISABLE_THRESHOLD. Spec section 6.2, 10.4.';