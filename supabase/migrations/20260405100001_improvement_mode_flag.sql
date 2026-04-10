-- ============================================================================
-- Migration: 20260405100001_improvement_mode_flag.sql
-- Purpose: Insert feature flags for the Product Improvement Command Center.
--   1. improvement_mode — master toggle for the improvement system
--   2. improvement_auto_detect — automated issue detection
--   3. improvement_recommendations — AI recommendation generation
--   4. improvement_auto_stage — auto-staging for low-risk recommendations
--
-- NOTE: feature_flags.flag_name has a regular index but no UNIQUE constraint,
--   so ON CONFLICT (flag_name) cannot be used. Using existence checks instead.
-- All inserts are idempotent.
-- ============================================================================

DO $$ BEGIN

  -- Master toggle: enables or disables the entire improvement system.
  -- The operating mode (observe / suggest / controlled_act) is configured
  -- within the Command Center settings, not via this flag.
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'improvement_mode') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'improvement_mode',
      true,
      'Controls the Product Improvement Command Center. When enabled, issue detection and recommendations are active. Mode (observe/suggest/controlled_act) is configured in the Command Center settings.'
    );
  END IF;

  -- Sub-flag: automated issue detection
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'improvement_auto_detect') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'improvement_auto_detect',
      true,
      'Enable automated issue detection in the improvement system'
    );
  END IF;

  -- Sub-flag: AI recommendation generation
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'improvement_recommendations') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'improvement_recommendations',
      true,
      'Enable AI recommendation generation for detected issues'
    );
  END IF;

  -- Sub-flag: auto-staging for low-risk recommendations (off by default)
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'improvement_auto_stage') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES (
      'improvement_auto_stage',
      false,
      'Enable auto-staging for low-risk recommendations (Controlled Act mode)'
    );
  END IF;

END $$;

-- ============================================================================
-- End of migration: 20260405100001_improvement_mode_flag.sql
-- Flags inserted: improvement_mode, improvement_auto_detect,
--   improvement_recommendations, improvement_auto_stage
-- ============================================================================
