-- A-04: Set is_enabled=false for flags with rollout_percentage=0
-- These flags were is_enabled=true but serving 0% of users — inconsistent state.
-- The getFeatureFlagsSimple() client bug was fixed in code; this aligns DB truth.
UPDATE feature_flags
SET
  is_enabled = false,
  updated_at = now()
WHERE is_enabled = true
  AND rollout_percentage = 0;

-- Confirm
SELECT COUNT(*) AS fixed_count FROM feature_flags WHERE rollout_percentage = 0 AND is_enabled = true;
