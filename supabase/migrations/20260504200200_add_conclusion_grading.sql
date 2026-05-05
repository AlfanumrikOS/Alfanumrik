-- Migration: 20260504200200_add_conclusion_grading.sql
-- Purpose: Tier 3 R10 — store AI-graded conclusion result on the observation row.
--
-- The grade-experiment-conclusion Edge Function calls Claude Haiku, parses a
-- 4-criterion rubric (R1..R4 each 0..3, total 0..12, tier ∈ weak|developing|
-- proficient|strong, bilingual feedback) and writes the parsed JSON here.
--
-- The column is also used as the idempotency anchor for the grading call:
-- if grading_result IS NOT NULL the Edge Function short-circuits and returns
-- the cached value (a coin transaction with metadata.observation_id is the
-- secondary anchor — see complete_experiment-style metadata pattern).
--
-- No RLS change needed: experiment_observations already has student_self
-- + guardian/teacher/admin SELECT policies; this column inherits.

ALTER TABLE public.experiment_observations
  ADD COLUMN IF NOT EXISTS grading_result JSONB;

COMMENT ON COLUMN public.experiment_observations.grading_result IS
  'AI rubric grade for guided-experiment conclusion text. Shape: {scores:{r1,r2,r3,r4}, total, tier, feedback_en, feedback_hi, coins_awarded, graded_at}. NULL until grade-experiment-conclusion Edge Function runs.';
