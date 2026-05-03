-- Migration: 20260405000001_unified_learner_state.sql
-- Purpose: Unify learner state by extending concept_mastery with CME columns,
--          creating RPCs for unified read/write, and indexing for review queries.
--          cme_concept_state is kept for backcompat during transition.

-- ============================================================================
-- 1. ADD MISSING CME COLUMNS TO concept_mastery
-- ============================================================================
-- Using IF NOT EXISTS via DO blocks for idempotency.

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN mastery_variance FLOAT DEFAULT 0.25;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN retention_half_life FLOAT DEFAULT 48.0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN current_retention FLOAT DEFAULT 0.3;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN max_difficulty_succeeded INT DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN error_count_conceptual INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN error_count_procedural INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN error_count_careless INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN avg_response_time_ms INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN confidence_score FLOAT DEFAULT 0.5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN streak_current INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN mastery_velocity FLOAT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN bloom_mastery JSONB
    DEFAULT '{"remember":0,"understand":0,"apply":0,"analyze":0,"evaluate":0,"create":0}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN cme_action_type TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE concept_mastery ADD COLUMN cme_action_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add CHECK constraint on cme_action_type
DO $$ BEGIN
  ALTER TABLE concept_mastery ADD CONSTRAINT concept_mastery_cme_action_type_check
    CHECK (cme_action_type IS NULL OR cme_action_type IN ('teach','practice','challenge','revise','remediate'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. BACKFILL FROM cme_concept_state INTO concept_mastery
-- ============================================================================
-- Only update rows where a matching student_id + concept_id = topic_id record
-- exists in both tables. Does not overwrite BKT mastery_level; only fills
-- the new CME-specific columns.

UPDATE concept_mastery cm SET
  mastery_variance        = COALESCE(cs.mastery_variance, cm.mastery_variance),
  retention_half_life     = COALESCE(cs.retention_half_life, cm.retention_half_life),
  current_retention       = COALESCE(cs.current_retention, cm.current_retention),
  max_difficulty_succeeded= COALESCE(cs.max_difficulty_succeeded, cm.max_difficulty_succeeded),
  error_count_conceptual  = COALESCE(cs.error_count_conceptual, cm.error_count_conceptual),
  error_count_procedural  = COALESCE(cs.error_count_procedural, cm.error_count_procedural),
  error_count_careless    = COALESCE(cs.error_count_careless, cm.error_count_careless),
  avg_response_time_ms    = COALESCE(cs.avg_response_time_ms, cm.avg_response_time_ms),
  confidence_score        = COALESCE(cs.confidence_score, cm.confidence_score),
  streak_current          = COALESCE(cs.streak_current, cm.streak_current),
  mastery_velocity        = COALESCE(cs.mastery_velocity, cm.mastery_velocity)
FROM cme_concept_state cs
WHERE cm.student_id = cs.student_id
  AND cm.topic_id = cs.concept_id;

-- ============================================================================
-- 3. INDEX: Due review topics (partial index for active review queries)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_concept_mastery_due_reviews
  ON concept_mastery(student_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

-- Additional index for retention-based priority ordering
CREATE INDEX IF NOT EXISTS idx_concept_mastery_retention
  ON concept_mastery(student_id, current_retention)
  WHERE current_retention IS NOT NULL;

-- ============================================================================
-- 4. VIEW: unified_learner_state (convenience view, respects RLS on base table)
-- ============================================================================
CREATE OR REPLACE VIEW unified_learner_state AS
SELECT
  cm.id,
  cm.student_id,
  cm.topic_id,
  -- BKT fields
  cm.mastery_level,
  cm.ease_factor,
  COALESCE(cm.review_interval_days, cm.sm2_interval) AS review_interval,
  cm.next_review_at,
  cm.last_attempted_at AS last_reviewed_at,
  COALESCE(cm.attempts, 0) AS total_attempts,
  cm.correct_attempts,
  -- CME fields
  cm.mastery_variance,
  cm.retention_half_life,
  cm.current_retention,
  cm.max_difficulty_succeeded,
  cm.error_count_conceptual,
  cm.error_count_procedural,
  cm.error_count_careless,
  cm.avg_response_time_ms,
  cm.confidence_score,
  cm.streak_current,
  cm.mastery_velocity,
  cm.bloom_mastery,
  cm.cme_action_type,
  cm.cme_action_at,
  -- Computed fields
  CASE
    WHEN cm.next_review_at IS NOT NULL AND cm.next_review_at <= now() THEN true
    ELSE false
  END AS is_due_for_review,
  cm.updated_at
FROM concept_mastery cm;

-- ============================================================================
-- 5. RPC: get_learner_state
-- Returns unified learner state for a student+topic or all topics.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_learner_state(
  p_student_id UUID,
  p_topic_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not your student record';
  END IF;

  IF p_topic_id IS NOT NULL THEN
    -- Single topic
    SELECT jsonb_build_object(
      'student_id', cm.student_id,
      'topic_id', cm.topic_id,
      'mastery_level', COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0),
      'ease_factor', cm.ease_factor,
      'review_interval', COALESCE(cm.review_interval_days, cm.sm2_interval),
      'next_review_at', cm.next_review_at,
      'last_reviewed_at', cm.last_attempted_at,
      'total_attempts', COALESCE(cm.attempts, 0),
      'correct_attempts', COALESCE(cm.correct_attempts, 0),
      'mastery_variance', cm.mastery_variance,
      'retention_half_life', cm.retention_half_life,
      'current_retention', cm.current_retention,
      'max_difficulty_succeeded', cm.max_difficulty_succeeded,
      'error_count_conceptual', cm.error_count_conceptual,
      'error_count_procedural', cm.error_count_procedural,
      'error_count_careless', cm.error_count_careless,
      'avg_response_time_ms', cm.avg_response_time_ms,
      'confidence_score', cm.confidence_score,
      'streak_current', cm.streak_current,
      'mastery_velocity', cm.mastery_velocity,
      'bloom_mastery', cm.bloom_mastery,
      'cme_action_type', cm.cme_action_type,
      'cme_action_at', cm.cme_action_at,
      'is_due_for_review', (cm.next_review_at IS NOT NULL AND cm.next_review_at <= now()),
      'updated_at', cm.updated_at
    ) INTO v_result
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id AND cm.topic_id = p_topic_id;

    RETURN COALESCE(v_result, '{}'::JSONB);
  ELSE
    -- All topics for this student
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'topic_id', cm.topic_id,
        'mastery_level', COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0),
        'ease_factor', cm.ease_factor,
        'review_interval', COALESCE(cm.review_interval_days, cm.sm2_interval),
        'next_review_at', cm.next_review_at,
        'total_attempts', COALESCE(cm.attempts, 0),
        'correct_attempts', COALESCE(cm.correct_attempts, 0),
        'current_retention', cm.current_retention,
        'confidence_score', cm.confidence_score,
        'streak_current', cm.streak_current,
        'bloom_mastery', cm.bloom_mastery,
        'cme_action_type', cm.cme_action_type,
        'is_due_for_review', (cm.next_review_at IS NOT NULL AND cm.next_review_at <= now()),
        'updated_at', cm.updated_at
      ) ORDER BY cm.updated_at DESC
    ), '[]'::JSONB) INTO v_result
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id;

    RETURN v_result;
  END IF;
END;
$$;

-- ============================================================================
-- 6. RPC: update_learner_state_post_quiz
-- Atomically updates BKT mastery + CME fields after a quiz attempt.
-- SECURITY DEFINER: Required because this is called from submit_quiz_results
-- which already runs as SECURITY DEFINER and needs to update rows regardless
-- of RLS. The caller (submit_quiz_results) has already validated the student.
-- ============================================================================
CREATE OR REPLACE FUNCTION update_learner_state_post_quiz(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_bloom_level TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_response_time_ms INT DEFAULT NULL,
  p_difficulty INT DEFAULT NULL,
  -- BKT parameters (defaults match existing update_concept_mastery_bkt)
  p_p_learn FLOAT DEFAULT 0.2,
  p_p_slip FLOAT DEFAULT 0.1,
  p_p_guess FLOAT DEFAULT 0.25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Justified: called from submit_quiz_results chain, student already validated
SET search_path = public
AS $$
DECLARE
  v_current_mastery FLOAT;
  v_ease_factor FLOAT;
  v_review_interval INT;
  v_total_attempts INT;
  v_correct_attempts INT;
  v_streak INT;
  v_bloom JSONB;
  v_retention_hl FLOAT;
  v_avg_rt INT;
  v_max_diff INT;
  v_err_conceptual INT;
  v_err_procedural INT;
  v_err_careless INT;
  v_mastery_velocity FLOAT;
  v_old_mastery FLOAT;

  -- BKT intermediates
  v_p_evidence FLOAT;
  v_p_know FLOAT;
  v_new_mastery FLOAT;
  v_new_ease FLOAT;
  v_new_interval INT;
  v_new_action TEXT;
  v_row_exists BOOLEAN := false;
BEGIN
  -- Lock the row for this student+topic
  SELECT
    COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0.1),
    COALESCE(cm.ease_factor, 2.5),
    COALESCE(cm.review_interval_days, cm.sm2_interval, 0),
    COALESCE(cm.attempts, 0),
    COALESCE(cm.correct_attempts, 0),
    COALESCE(cm.streak_current, 0),
    COALESCE(cm.bloom_mastery, '{"remember":0,"understand":0,"apply":0,"analyze":0,"evaluate":0,"create":0}'::JSONB),
    COALESCE(cm.retention_half_life, 48.0),
    cm.avg_response_time_ms,
    COALESCE(cm.max_difficulty_succeeded, 1),
    COALESCE(cm.error_count_conceptual, 0),
    COALESCE(cm.error_count_procedural, 0),
    COALESCE(cm.error_count_careless, 0),
    COALESCE(cm.mastery_velocity, 0)
  INTO
    v_current_mastery, v_ease_factor, v_review_interval,
    v_total_attempts, v_correct_attempts,
    v_streak, v_bloom, v_retention_hl, v_avg_rt, v_max_diff,
    v_err_conceptual, v_err_procedural, v_err_careless, v_mastery_velocity
  FROM concept_mastery cm
  WHERE cm.student_id = p_student_id AND cm.topic_id = p_topic_id
  FOR UPDATE;

  IF FOUND THEN
    v_row_exists := true;
  ELSE
    -- Defaults for brand new row
    v_current_mastery := 0.1;
    v_ease_factor := 2.5;
    v_review_interval := 0;
    v_total_attempts := 0;
    v_correct_attempts := 0;
    v_streak := 0;
    v_bloom := '{"remember":0,"understand":0,"apply":0,"analyze":0,"evaluate":0,"create":0}'::JSONB;
    v_retention_hl := 48.0;
    v_avg_rt := NULL;
    v_max_diff := 1;
    v_err_conceptual := 0;
    v_err_procedural := 0;
    v_err_careless := 0;
    v_mastery_velocity := 0;
  END IF;

  v_old_mastery := v_current_mastery;

  -- ---- BKT Update (identical to update_concept_mastery_bkt) ----
  IF p_is_correct THEN
    v_p_evidence := v_current_mastery * (1.0 - p_p_slip) + (1.0 - v_current_mastery) * p_p_guess;
    v_p_know := (v_current_mastery * (1.0 - p_p_slip)) / v_p_evidence;
  ELSE
    v_p_evidence := v_current_mastery * p_p_slip + (1.0 - v_current_mastery) * (1.0 - p_p_guess);
    v_p_know := (v_current_mastery * p_p_slip) / v_p_evidence;
  END IF;

  v_new_mastery := LEAST(1.0, GREATEST(0.0,
    v_p_know + (1.0 - v_p_know) * p_p_learn
  ));

  -- ---- Ease Factor (SM-2) ----
  IF p_is_correct THEN
    v_new_ease := LEAST(3.0, v_ease_factor + 0.1);
  ELSE
    v_new_ease := GREATEST(1.3, v_ease_factor - 0.2);
  END IF;

  -- ---- SM-2 Interval ----
  IF NOT p_is_correct THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 0 THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 1 THEN
    v_new_interval := 6;
  ELSE
    v_new_interval := ROUND(v_review_interval * v_new_ease)::INT;
  END IF;

  -- ---- Streak ----
  IF p_is_correct THEN
    v_streak := v_streak + 1;
  ELSE
    v_streak := 0;
  END IF;

  -- ---- Error counts ----
  IF NOT p_is_correct AND p_error_type IS NOT NULL THEN
    CASE p_error_type
      WHEN 'conceptual' THEN v_err_conceptual := v_err_conceptual + 1;
      WHEN 'procedural' THEN v_err_procedural := v_err_procedural + 1;
      WHEN 'careless'   THEN v_err_careless := v_err_careless + 1;
      ELSE NULL; -- unknown error types ignored
    END CASE;
  END IF;

  -- ---- Bloom mastery update ----
  IF p_bloom_level IS NOT NULL AND v_bloom ? p_bloom_level THEN
    IF p_is_correct THEN
      -- Increment bloom level score (capped at 1.0)
      v_bloom := jsonb_set(
        v_bloom,
        ARRAY[p_bloom_level],
        to_jsonb(LEAST(1.0, COALESCE((v_bloom->>p_bloom_level)::FLOAT, 0) + 0.1))
      );
    ELSE
      -- Decrement bloom level score (floored at 0)
      v_bloom := jsonb_set(
        v_bloom,
        ARRAY[p_bloom_level],
        to_jsonb(GREATEST(0.0, COALESCE((v_bloom->>p_bloom_level)::FLOAT, 0) - 0.05))
      );
    END IF;
  END IF;

  -- ---- Retention half-life update ----
  -- Correct answers increase half-life (memory strengthens), incorrect decrease it
  IF p_is_correct THEN
    v_retention_hl := LEAST(720.0, v_retention_hl * 1.1);  -- cap at 30 days (720 hours)
  ELSE
    v_retention_hl := GREATEST(4.0, v_retention_hl * 0.8);  -- floor at 4 hours
  END IF;

  -- ---- Max difficulty succeeded ----
  IF p_is_correct AND p_difficulty IS NOT NULL AND p_difficulty > v_max_diff THEN
    v_max_diff := p_difficulty;
  END IF;

  -- ---- Average response time (exponential moving average) ----
  IF p_response_time_ms IS NOT NULL THEN
    IF v_avg_rt IS NULL THEN
      v_avg_rt := p_response_time_ms;
    ELSE
      v_avg_rt := ROUND(v_avg_rt * 0.7 + p_response_time_ms * 0.3)::INT;
    END IF;
  END IF;

  -- ---- Mastery velocity (rate of change) ----
  v_mastery_velocity := v_new_mastery - v_old_mastery;

  -- ---- CME action type (what to recommend next) ----
  IF v_new_mastery < 0.3 THEN
    v_new_action := 'teach';
  ELSIF v_new_mastery < 0.5 THEN
    v_new_action := 'remediate';
  ELSIF v_new_mastery < 0.7 THEN
    v_new_action := 'practice';
  ELSIF v_new_mastery < 0.9 THEN
    v_new_action := 'challenge';
  ELSE
    v_new_action := 'revise';
  END IF;

  -- ---- Upsert ----
  INSERT INTO concept_mastery (
    student_id, topic_id,
    mastery_level, ease_factor, review_interval_days,
    last_attempted_at, next_review_at,
    attempts, correct_attempts,
    mastery_variance, retention_half_life, current_retention,
    max_difficulty_succeeded,
    error_count_conceptual, error_count_procedural, error_count_careless,
    avg_response_time_ms, confidence_score,
    streak_current, mastery_velocity,
    bloom_mastery, cme_action_type, cme_action_at,
    updated_at
  ) VALUES (
    p_student_id, p_topic_id,
    v_new_mastery::TEXT, v_new_ease, v_new_interval,
    now(), now() + (v_new_interval || ' days')::INTERVAL,
    v_total_attempts + 1,
    v_correct_attempts + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    GREATEST(0.01, 0.25 / (1 + (v_total_attempts + 1) * 0.1)),  -- variance decreases with attempts
    v_retention_hl,
    -- current_retention: exponential decay from last practice
    v_new_mastery,  -- at time of practice, retention = mastery
    v_max_diff,
    v_err_conceptual, v_err_procedural, v_err_careless,
    v_avg_rt,
    -- confidence_score: blend of mastery and low variance
    LEAST(1.0, v_new_mastery * (1.0 - GREATEST(0.01, 0.25 / (1 + (v_total_attempts + 1) * 0.1)))),
    v_streak, v_mastery_velocity,
    v_bloom, v_new_action, now(),
    now()
  )
  ON CONFLICT (student_id, topic_id) DO UPDATE SET
    mastery_level           = EXCLUDED.mastery_level,
    ease_factor             = EXCLUDED.ease_factor,
    review_interval_days    = EXCLUDED.review_interval_days,
    last_attempted_at       = EXCLUDED.last_attempted_at,
    next_review_at          = EXCLUDED.next_review_at,
    attempts                = EXCLUDED.attempts,
    correct_attempts        = EXCLUDED.correct_attempts,
    mastery_variance        = EXCLUDED.mastery_variance,
    retention_half_life     = EXCLUDED.retention_half_life,
    current_retention       = EXCLUDED.current_retention,
    max_difficulty_succeeded= EXCLUDED.max_difficulty_succeeded,
    error_count_conceptual  = EXCLUDED.error_count_conceptual,
    error_count_procedural  = EXCLUDED.error_count_procedural,
    error_count_careless    = EXCLUDED.error_count_careless,
    avg_response_time_ms    = EXCLUDED.avg_response_time_ms,
    confidence_score        = EXCLUDED.confidence_score,
    streak_current          = EXCLUDED.streak_current,
    mastery_velocity        = EXCLUDED.mastery_velocity,
    bloom_mastery           = EXCLUDED.bloom_mastery,
    cme_action_type         = EXCLUDED.cme_action_type,
    cme_action_at           = EXCLUDED.cme_action_at,
    updated_at              = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'new_mastery', v_new_mastery,
    'old_mastery', v_old_mastery,
    'mastery_delta', v_mastery_velocity,
    'new_ease_factor', v_new_ease,
    'new_review_interval', v_new_interval,
    'next_review_at', now() + (v_new_interval || ' days')::INTERVAL,
    'streak', v_streak,
    'bloom_mastery', v_bloom,
    'cme_action', v_new_action,
    'confidence_score', LEAST(1.0, v_new_mastery * (1.0 - GREATEST(0.01, 0.25 / (1 + (v_total_attempts + 1) * 0.1))))
  );
END;
$$;

-- ============================================================================
-- 7. RPC: get_due_review_topics
-- Returns topics where next_review_at <= now(), ordered by priority
-- (lowest retention first = most urgent review).
-- ============================================================================
CREATE OR REPLACE FUNCTION get_due_review_topics(
  p_student_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not your student record';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t->>'priority_score' ASC), '[]'::JSONB)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'topic_id', cm.topic_id,
      'mastery_level', COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0),
      'current_retention', COALESCE(cm.current_retention, 0),
      'retention_half_life', cm.retention_half_life,
      'next_review_at', cm.next_review_at,
      'streak_current', cm.streak_current,
      'cme_action_type', cm.cme_action_type,
      'bloom_mastery', cm.bloom_mastery,
      'error_count_conceptual', cm.error_count_conceptual,
      'error_count_procedural', cm.error_count_procedural,
      -- Priority score: lower = more urgent
      -- Combines low retention, overdue time, and error frequency
      'priority_score', ROUND((
        COALESCE(cm.current_retention, 0) * 100
        - EXTRACT(EPOCH FROM (now() - cm.next_review_at)) / 3600  -- hours overdue (negative = more urgent)
        - (COALESCE(cm.error_count_conceptual, 0) + COALESCE(cm.error_count_procedural, 0)) * 5
      )::NUMERIC, 2)
    ) AS t
    FROM concept_mastery cm
    WHERE cm.student_id = p_student_id
      AND cm.next_review_at IS NOT NULL
      AND cm.next_review_at <= now()
    LIMIT p_limit
  ) sub;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 8. COMMENTS (for documentation in pg_catalog)
-- ============================================================================
COMMENT ON FUNCTION get_learner_state IS
  'Returns unified learner state (BKT + CME) for a student, optionally filtered by topic_id.';

COMMENT ON FUNCTION update_learner_state_post_quiz IS
  'Atomically updates BKT mastery, error counts, retention, bloom mastery, streak, and CME action after a quiz attempt.';

COMMENT ON FUNCTION get_due_review_topics IS
  'Returns topics due for review (next_review_at <= now()), ordered by priority (lowest retention first).';

COMMENT ON VIEW unified_learner_state IS
  'Convenience view over concept_mastery exposing all BKT + CME fields in a clean interface.';
