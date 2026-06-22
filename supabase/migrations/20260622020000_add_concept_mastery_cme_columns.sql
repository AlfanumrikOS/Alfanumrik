-- Migration: 20260622020000_add_concept_mastery_cme_columns.sql
-- Purpose: PHASE 0 adaptive-loop fix (Part A). Add the 13 BKT/CME/retention columns
--          that update_learner_state_post_quiz (20260615181255) INSERT/UPDATEs but
--          that are ABSENT from live public.concept_mastery. Their absence made the
--          RPC throw, which aborted the un-wrapped PERFORM inside submit_quiz_results_v2
--          (20260621000600 ~line 359), aborting the whole quiz submit -> client fell
--          back to XP-only and mastery was never written.
--
-- RCA confirmed against the linked DB (information_schema.columns): NONE of the 13
-- columns below existed prior to this migration.
--
-- Types/defaults match the RPC's VALUES / COALESCE expressions EXACTLY:
--   - error_count_*        : integer DEFAULT 0   (COALESCE(...,0); incremented by +1)
--   - avg_response_time_ms : integer (nullable)  (NULL until first timed response; EMA)
--   - max_difficulty_succeeded : integer DEFAULT 1 (COALESCE(...,1))
--   - retention_half_life  : double precision DEFAULT 48.0 (COALESCE(...,48.0))
--   - mastery_variance / current_retention / confidence_score / mastery_velocity
--                          : double precision (computed FLOAT expressions)
--   - bloom_mastery        : jsonb DEFAULT '{}'::jsonb (COALESCE to a 6-key bloom map)
--   - cme_action_type      : text   (one of teach/remediate/practice/challenge/revise)
--   - cme_action_at        : timestamptz (now())
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS. No DROP. RLS unchanged
-- (additive columns do not alter row-level policies). No index changes.

BEGIN;

ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS mastery_variance         double precision,
  ADD COLUMN IF NOT EXISTS retention_half_life      double precision DEFAULT 48.0,
  ADD COLUMN IF NOT EXISTS current_retention        double precision,
  ADD COLUMN IF NOT EXISTS max_difficulty_succeeded integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error_count_conceptual   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count_procedural   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count_careless     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_time_ms     integer,
  ADD COLUMN IF NOT EXISTS confidence_score         double precision,
  ADD COLUMN IF NOT EXISTS mastery_velocity         double precision,
  ADD COLUMN IF NOT EXISTS bloom_mastery            jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cme_action_type          text,
  ADD COLUMN IF NOT EXISTS cme_action_at            timestamptz;

COMMENT ON COLUMN public.concept_mastery.mastery_variance IS
  'BKT estimate variance; decreases with attempts. Written by update_learner_state_post_quiz.';
COMMENT ON COLUMN public.concept_mastery.retention_half_life IS
  'Forgetting-curve half-life in hours (4..720). Strengthens on correct, decays on wrong.';
COMMENT ON COLUMN public.concept_mastery.current_retention IS
  'Retention at time of last practice (= mastery at practice). Written by update_learner_state_post_quiz.';
COMMENT ON COLUMN public.concept_mastery.max_difficulty_succeeded IS
  'Highest difficulty level the student has answered correctly on this topic.';
COMMENT ON COLUMN public.concept_mastery.error_count_conceptual IS
  'Running count of conceptual errors on this topic.';
COMMENT ON COLUMN public.concept_mastery.error_count_procedural IS
  'Running count of procedural errors on this topic.';
COMMENT ON COLUMN public.concept_mastery.error_count_careless IS
  'Running count of careless errors on this topic.';
COMMENT ON COLUMN public.concept_mastery.avg_response_time_ms IS
  'Exponential moving average of response time (ms). NULL until first timed response.';
COMMENT ON COLUMN public.concept_mastery.confidence_score IS
  'Blend of mastery and low variance (0..1). Written by update_learner_state_post_quiz.';
COMMENT ON COLUMN public.concept_mastery.mastery_velocity IS
  'Rate of change of mastery on the last attempt (new_mastery - old_mastery).';
COMMENT ON COLUMN public.concept_mastery.bloom_mastery IS
  'Per-Bloom-level mastery map (remember/understand/apply/analyze/evaluate/create), 0..1 each.';
COMMENT ON COLUMN public.concept_mastery.cme_action_type IS
  'CME next-action recommendation: teach | remediate | practice | challenge | revise.';
COMMENT ON COLUMN public.concept_mastery.cme_action_at IS
  'Timestamp the cme_action_type was last computed.';

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'schema.concept_mastery_cme_columns_added',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PHASE 0 adaptive-loop fix: add 13 columns update_learner_state_post_quiz writes but were missing from live concept_mastery, which aborted quiz submit mastery writes',
    'rca', '2026-06-21',
    'columns', jsonb_build_array(
      'mastery_variance','retention_half_life','current_retention','max_difficulty_succeeded',
      'error_count_conceptual','error_count_procedural','error_count_careless','avg_response_time_ms',
      'confidence_score','mastery_velocity','bloom_mastery','cme_action_type','cme_action_at'
    ),
    'table', 'concept_mastery'
  ),
  now()
);

COMMIT;
