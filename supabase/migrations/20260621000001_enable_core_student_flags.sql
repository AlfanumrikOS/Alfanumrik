-- Enable core student-facing feature flags
-- These features are fully built and tested; the flags were defaulted OFF for staged rollout.
-- Enabling globally: ff_today_home_v1, ff_pedagogy_v2_daily_rhythm, ff_goal_aware_foxy,
-- ff_goal_aware_selection, ff_distractor_micro_explainer_v1

-- Update existing rows (inserted by seed migrations)
UPDATE feature_flags
SET is_enabled = true,
    updated_at = NOW()
WHERE flag_name IN (
  'ff_today_home_v1',
  'ff_pedagogy_v2_daily_rhythm',
  'ff_goal_aware_foxy',
  'ff_goal_aware_selection',
  'ff_distractor_micro_explainer_v1'
);

-- Insert rows for any flags not yet seeded (idempotent)
INSERT INTO feature_flags (flag_name, is_enabled, description)
VALUES
  ('ff_today_home_v1', true, 'Personalized Today home page with daily learning queue'),
  ('ff_pedagogy_v2_daily_rhythm', true, 'Daily rhythm queue: 5 SRS + 1 ZPD + reflection'),
  ('ff_goal_aware_foxy', true, 'Foxy AI tutor aware of student learning goal'),
  ('ff_goal_aware_selection', true, 'Learn page personalizes chapter order by student goal'),
  ('ff_distractor_micro_explainer_v1', true, 'Wrong-answer micro-explanations after quiz')
ON CONFLICT (flag_name) DO UPDATE
  SET is_enabled = true,
      updated_at = NOW();
