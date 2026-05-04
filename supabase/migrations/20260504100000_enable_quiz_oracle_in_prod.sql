-- Migration: 20260504100000_enable_quiz_oracle_in_prod.sql
-- Purpose:    Marking-Authenticity Phase 1.1 — flip ff_quiz_oracle_enabled to
--             TRUE in production so the AI quiz-generator validation oracle
--             cross-checks every freshly-generated MCQ before it lands in
--             question_bank.
--
-- Background (REG-54, migration _legacy/20260429020000_quiz_oracle_feature_flag.sql):
--   The flag was seeded OFF as a kill-switch during initial rollout. Operators
--   have since observed the rejection-rate baseline in the super-admin AI health
--   panel; the rate is healthy and the founder has approved Phase 1 of the
--   marking-authenticity remediation plan, which mandates the oracle ON in
--   production.
--
-- Behavior change:
--   BEFORE: AI-generated questions enter `question_bank` after only the
--           deterministic P6 shape checks (4 distinct options, index 0..3,
--           non-empty text, etc.). A wrong correct_answer_index shipped by the
--           generator would corrupt scoring even though P6 passed.
--   AFTER:  Every candidate question is additionally graded by Claude Haiku
--           against its explanation. If the LLM grader disagrees with the
--           marked correct option, the candidate is rejected; the generator
--           retries once with a corrective prompt; second failure is dropped
--           (NOT silently passed through) and recorded in
--           ops_events.category='quiz.oracle_rejection' for ops triage.
--
-- Cost ceiling per accepted question:
--   Worst case: 4 Claude calls (1 generator + 1 oracle + 1 generator-retry + 1 oracle).
--   Typical:    2 Claude calls (1 generator + 1 oracle).
--
-- Rollback:
--   UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_quiz_oracle_enabled';
--   Re-shipping wrong correct_answer_index questions is a P1+P6 violation, so
--   rollback should be paired with an immediate ai-engineer pager.
--
-- Idempotent:
--   ON CONFLICT (flag_name) DO UPDATE — safe to re-apply. The unique constraint
--   feature_flags_flag_name_key (baseline:15364) backs the UPSERT.
--
-- Side effects on existing question_bank rows: NONE. The oracle only gates
-- INSERT; existing rows are NOT re-validated. A backfill job is out of scope
-- for this migration (tracked in marking-authenticity Phase 5).

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  description
) VALUES (
  'ff_quiz_oracle_enabled',
  true,
  'AI quiz-generator validation oracle (REG-54). When ON, every freshly-generated MCQ '
  'is checked by deterministic P6 rules + an LLM grader (Claude Haiku) that confirms the '
  'explanation supports the marked correct option. Candidates that fail are rejected and '
  'the generator retries once with a corrective prompt. After 1 retry the failing question '
  'is dropped (NOT silently passed through). Rejections logged to ops_events with '
  'category=quiz.oracle_rejection. Worst-case cost ceiling: 4 Claude calls per accepted '
  'question; typical: 2.'
)
ON CONFLICT (flag_name) DO UPDATE SET
  is_enabled  = EXCLUDED.is_enabled,
  description = EXCLUDED.description,
  updated_at  = now();

DO $verify$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT is_enabled INTO v_enabled
    FROM public.feature_flags
   WHERE flag_name = 'ff_quiz_oracle_enabled';

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'Phase 1.1: ff_quiz_oracle_enabled UPSERT did not land — investigate.';
  END IF;

  IF v_enabled = false THEN
    RAISE WARNING 'Phase 1.1: ff_quiz_oracle_enabled present but is_enabled=false — '
                  'expected TRUE after this migration. Check operator override.';
  ELSE
    RAISE NOTICE 'Phase 1.1: ff_quiz_oracle_enabled is_enabled=true (oracle live).';
  END IF;
END $verify$;

-- End of migration: 20260504100000_enable_quiz_oracle_in_prod.sql
