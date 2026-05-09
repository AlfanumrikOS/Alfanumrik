-- Migration: 20260509120000_pedagogy_v2_wave_1_flags.sql
-- Purpose: Seed three feature flags that gate the Wave 1 (Daily Rhythm) rollout
--          of Pedagogy v2. All default OFF. Flip via super-admin console.
--
--   ff_productive_failure_v1
--     When ON: /learn/[subject]/[chapter] presents a ZPD problem BEFORE
--     revealing tutorial content (Manu Kapur productive failure).
--     When OFF: legacy tutorial-first behavior is preserved.
--
--   ff_distractor_micro_explainer_v1
--     When ON: after a wrong MCQ answer, if a curated remediation exists
--     in wrong_answer_remediations for the (question_id, distractor_index),
--     render <MisconceptionExplainer/> below the answer with a Foxy CTA.
--     When OFF: legacy generic "try again" feedback is preserved.
--
--   ff_pedagogy_v2_daily_rhythm
--     When ON: dashboard renders <DailyRhythmQueue/> above the existing hero,
--     and /api/rhythm/today is callable. When OFF: dashboard is unchanged
--     and /api/rhythm/today returns 404.
--
-- Idempotent. Safe to re-run.

INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_productive_failure_v1',          false, ARRAY['student']::text[], NULL, NULL, NULL),
  ('ff_distractor_micro_explainer_v1',  false, ARRAY['student']::text[], NULL, NULL, NULL),
  ('ff_pedagogy_v2_daily_rhythm',       false, ARRAY['student']::text[], NULL, NULL, NULL)
ON CONFLICT (flag_name) DO NOTHING;
