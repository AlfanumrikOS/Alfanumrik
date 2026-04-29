-- Migration: 20260429020000_quiz_oracle_feature_flag.sql
-- Purpose: Register the `ff_quiz_oracle_enabled` feature flag (REG-54).
--
-- When enabled, the AI quiz-generator validation oracle runs on every
-- candidate question produced by `bulk-question-gen` (and any future generator
-- path). Candidates that fail the oracle are rejected before INSERT into
-- `question_bank`. With one retry on failure the cost ceiling is at most
-- 4 Claude calls per accepted question (worst case) vs. 1 today; typical
-- accepted questions cost 2 Claude calls (1 generator + 1 oracle).
--
-- Default: OFF in production for first deploy so we can roll out gradually
-- and measure rejection rate via the super-admin AI health panel before
-- enforcing on student-facing question generation. Operators flip the flag
-- in the super-admin console once the rejection-rate baseline looks healthy.
--
-- Existing rows in question_bank are NOT re-validated; the oracle only
-- applies to new candidates. See `src/lib/ai/validation/quiz-oracle.ts` for
-- the deterministic + LLM-grader logic and `supabase/functions/_shared/`
-- for the Edge Function mirror.
--
-- Idempotent — uses NOT EXISTS guard like the other ff_* flags.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_quiz_oracle_enabled') THEN
    INSERT INTO feature_flags (flag_name, is_enabled, description)
    VALUES ('ff_quiz_oracle_enabled', false,
            'AI quiz-generator validation oracle (REG-54). When ON, every freshly-generated MCQ '
            'is checked by deterministic P6 rules + an LLM grader (Claude Haiku) that confirms the '
            'explanation supports the marked correct option. Candidates that fail are rejected and '
            'the generator retries once with a corrective prompt. After 1 retry the failing question '
            'is dropped (NOT silently passed through). Rejections logged to ops_events with '
            'category=quiz.oracle_rejection. Worst-case cost ceiling: 4 Claude calls per accepted '
            'question; typical: 2.');
  END IF;
END $$;
