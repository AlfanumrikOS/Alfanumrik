-- Performance indexes for columns queried without index coverage
-- Addresses: feature_flags lookups, daily usage quota enforcement,
-- concept_mastery student queries, and learning_velocity student queries.

-- feature_flags: every page load checks flags by name
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_name
  ON feature_flags (flag_name)
  WHERE is_enabled = true;

-- student_daily_usage: Foxy chat quota check queries (student_id, feature, usage_date)
-- Existing idx_daily_usage_student_date only covers (student_id, usage_date)
CREATE INDEX IF NOT EXISTS idx_daily_usage_student_feature_date
  ON student_daily_usage (student_id, feature, usage_date);

-- concept_mastery: progress and analytics routes query by student_id + order by updated_at
CREATE INDEX IF NOT EXISTS idx_concept_mastery_student_updated
  ON concept_mastery (student_id, updated_at DESC);

-- learning_velocity: progress and analytics routes query by student_id
CREATE INDEX IF NOT EXISTS idx_learning_velocity_student
  ON learning_velocity (student_id);
