-- =============================================================================
-- Feature Flag Scoping: per-institution, per-role, per-environment
-- =============================================================================

ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS target_institutions UUID[] DEFAULT '{}';
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS target_roles TEXT[] DEFAULT '{}';
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS target_environments TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_ff_enabled ON feature_flags (is_enabled);
CREATE INDEX IF NOT EXISTS idx_ff_name ON feature_flags (flag_name);
