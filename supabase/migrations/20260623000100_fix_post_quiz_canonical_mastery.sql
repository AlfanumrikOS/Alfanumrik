-- Migration: 20260623000100_fix_post_quiz_canonical_mastery.sql
-- Purpose: Make the BKT writer store the CANONICAL numeric mastery in the
--          canonical numeric columns. update_learner_state_post_quiz previously
--          wrote the numeric posterior as TEXT into mastery_level and never
--          touched mastery_probability / p_know (left at the 0.1 default). This
--          repairs the WRITE PATH so every future quiz attempt persists:
--            mastery_probability = v_new_mastery   (canonical numeric)
--            p_know              = v_new_mastery   (mirrors the same posterior)
--            mastery_level       = derived categorical band (existing vocabulary)
--
-- The companion backfill 20260623000000 (earlier timestamp, runs first) repairs
-- the 33 historical numeric-as-text rows so this RPC's prior-read sees canonical
-- values immediately.
--
-- ─── CHANGES vs the deployed body (20260622080000_clamp_sm2_interval.sql) ─────
-- The 10-arg signature, SECURITY DEFINER + SET search_path = public, the BKT
-- math, the SM-2 LEAST(v_new_interval, 365) clamp, ease/streak/bloom/retention,
-- error counts, consecutive_wrong maintenance, and the RETURN jsonb are all
-- reproduced VERBATIM. Only THREE things change:
--   (a) PRIOR READ: v_current_mastery now reads the canonical numeric first —
--       COALESCE(cm.mastery_probability, 0.1) — instead of
--       COALESCE(cm.mastery_level::FLOAT, cm.mastery_probability, 0.1). After the
--       backfill, mastery_level is a categorical band and must NOT be cast to
--       float; mastery_probability is the source of truth.
--   (b) INSERT: add mastery_probability and p_know (both = v_new_mastery); change
--       the mastery_level VALUE from v_new_mastery::TEXT to the band CASE.
--   (c) ON CONFLICT DO UPDATE: add
--       mastery_probability = EXCLUDED.mastery_probability,
--       p_know              = EXCLUDED.p_know;
--       mastery_level = EXCLUDED.mastery_level now carries the band (EXCLUDED
--       already references the band computed in the VALUES list).
-- mastery_mean is NOT written (separate concept_id namespace). P1/P2/P3 untouched.
--
-- Band CASE (exact, existing vocabulary):
--   attempts (post-increment) = 0 -> 'not_started'   (defensive; never 0 here)
--   v_new_mastery >= 0.95         -> 'mastered'
--   v_new_mastery >= 0.70         -> 'proficient'
--   v_new_mastery >= 0.40         -> 'developing'
--   else                          -> 'beginner'
-- NOTE: this RPC always inserts/updates with attempts = v_total_attempts + 1 >= 1,
-- so the not_started branch is dead here but kept for contract symmetry with the
-- backfill's band derivation.
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact 10-arg signature) + CREATE OR REPLACE.
-- Owner: architect.  Added: 2026-06-23.  Reviewers: assessment, testing, quality.

DROP FUNCTION IF EXISTS public.update_learner_state_post_quiz(UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, FLOAT, FLOAT, FLOAT);

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
    -- (a) canonical numeric first: mastery_probability is the source of truth.
    -- After the 20260623000000 backfill mastery_level is a categorical band and
    -- must NOT be cast to float.
    COALESCE(cm.mastery_probability, 0.1),
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

  -- ---- SM-2 interval clamp (timestamptz-overflow fix, single source) ----
  -- Caps the geometric growth so now() + (v_new_interval || ' days')::INTERVAL
  -- can never overflow timestamptz. Sub-cap values are unchanged; the first
  -- value above the cap clamps to exactly 365. Both next_review_at and the
  -- stored review_interval_days read v_new_interval, so this one line covers all.
  v_new_interval := LEAST(v_new_interval, 365);

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
    mastery_level, mastery_probability, p_know,
    ease_factor, review_interval_days,
    last_attempted_at, next_review_at,
    attempts, correct_attempts,
    mastery_variance, retention_half_life, current_retention,
    max_difficulty_succeeded,
    error_count_conceptual, error_count_procedural, error_count_careless,
    avg_response_time_ms, confidence_score,
    streak_current, mastery_velocity,
    bloom_mastery, cme_action_type, cme_action_at,
    consecutive_wrong,
    updated_at
  ) VALUES (
    p_student_id, p_topic_id,
    -- (b) mastery_level = DERIVED band; mastery_probability + p_know = canonical numeric
    CASE
      WHEN (v_total_attempts + 1) = 0 THEN 'not_started'
      WHEN v_new_mastery >= 0.95 THEN 'mastered'
      WHEN v_new_mastery >= 0.70 THEN 'proficient'
      WHEN v_new_mastery >= 0.40 THEN 'developing'
      ELSE 'beginner'
    END,
    v_new_mastery,  -- mastery_probability (canonical numeric)
    v_new_mastery,  -- p_know (mirrors the same posterior)
    v_new_ease, v_new_interval,
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
    0,  -- consecutive_wrong: neutral first answer = 0 (DO UPDATE path increments below)
    now()
  )
  ON CONFLICT (student_id, topic_id) DO UPDATE SET
    mastery_level           = EXCLUDED.mastery_level,            -- now carries the derived band
    mastery_probability     = EXCLUDED.mastery_probability,      -- (c) canonical numeric
    p_know                  = EXCLUDED.p_know,                   -- (c) mirrors posterior
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
    consecutive_wrong       = CASE WHEN p_is_correct THEN 0 ELSE concept_mastery.consecutive_wrong + 1 END,
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

COMMENT ON FUNCTION update_learner_state_post_quiz IS
  'Atomically updates BKT mastery, error counts, retention, bloom mastery, streak, consecutive_wrong, and CME action after a quiz attempt. Canonical numeric posterior stored in mastery_probability (mirrored by p_know); mastery_level is the derived categorical band. SM-2 interval clamped to 365 days to prevent timestamptz overflow (20260622080000). Canonical-mastery write fix: 20260623000100.';

-- ─── Defense-in-depth: neutralize the DEAD numeric-into-mastery_level writer ──
-- update_concept_mastery_bkt (baseline ~L8231) is DEAD: it has no live caller,
-- writes the numeric posterior straight into mastery_level (the exact bug this
-- migration fixes), and even references columns that no longer exist on
-- concept_mastery (review_interval, total_attempts, last_reviewed_at) — so a
-- revival would error at runtime anyway. We CREATE OR REPLACE it to write the
-- canonical layout (mastery_probability + p_know + derived band) against the
-- CURRENT schema, so if it is ever revived it cannot reintroduce the bug.
-- Signature + RETURNS shape are preserved byte-identical to the baseline so any
-- (currently non-existent) caller contract is unchanged.
CREATE OR REPLACE FUNCTION public.update_concept_mastery_bkt(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_p_learn DOUBLE PRECISION DEFAULT 0.2,
  p_p_slip DOUBLE PRECISION DEFAULT 0.1,
  p_p_guess DOUBLE PRECISION DEFAULT 0.25
)
RETURNS TABLE("new_mastery" DOUBLE PRECISION, "new_ease_factor" DOUBLE PRECISION, "new_review_interval" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_mastery FLOAT;
  v_ease_factor FLOAT;
  v_review_interval INT;
  v_total_attempts INT;
  v_correct_attempts INT;
  v_p_evidence FLOAT;
  v_p_know_given_evidence FLOAT;
  v_new_mastery FLOAT;
  v_new_ease FLOAT;
  v_new_interval INT;
BEGIN
  -- Read canonical numeric first (matches the live writer's posterior source).
  SELECT COALESCE(cm.mastery_probability, 0.1),
         COALESCE(cm.ease_factor, 2.5),
         COALESCE(cm.review_interval_days, cm.sm2_interval, 0),
         COALESCE(cm.attempts, 0),
         COALESCE(cm.correct_attempts, 0)
  INTO v_current_mastery, v_ease_factor, v_review_interval,
       v_total_attempts, v_correct_attempts
  FROM concept_mastery cm
  WHERE cm.student_id = p_student_id AND cm.topic_id = p_topic_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_current_mastery := 0.1;
    v_ease_factor := 2.5;
    v_review_interval := 0;
    v_total_attempts := 0;
    v_correct_attempts := 0;
  END IF;

  IF p_is_correct THEN
    v_p_evidence := v_current_mastery * (1.0 - p_p_slip) + (1.0 - v_current_mastery) * p_p_guess;
    v_p_know_given_evidence := (v_current_mastery * (1.0 - p_p_slip)) / v_p_evidence;
  ELSE
    v_p_evidence := v_current_mastery * p_p_slip + (1.0 - v_current_mastery) * (1.0 - p_p_guess);
    v_p_know_given_evidence := (v_current_mastery * p_p_slip) / v_p_evidence;
  END IF;

  v_new_mastery := LEAST(1.0, GREATEST(0.0,
    v_p_know_given_evidence + (1.0 - v_p_know_given_evidence) * p_p_learn
  ));

  IF p_is_correct THEN
    v_new_ease := LEAST(3.0, v_ease_factor + 0.1);
  ELSE
    v_new_ease := GREATEST(1.3, v_ease_factor - 0.2);
  END IF;

  IF NOT p_is_correct THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 0 THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 1 THEN
    v_new_interval := 6;
  ELSE
    v_new_interval := ROUND(v_review_interval * v_new_ease)::INT;
  END IF;
  v_new_interval := LEAST(v_new_interval, 365);  -- timestamptz-overflow clamp

  -- Write the CANONICAL layout against the current schema (no numeric-in-text).
  INSERT INTO concept_mastery (
    student_id, topic_id,
    mastery_level, mastery_probability, p_know,
    ease_factor, review_interval_days,
    last_attempted_at, next_review_at,
    attempts, correct_attempts, updated_at
  ) VALUES (
    p_student_id, p_topic_id,
    CASE
      WHEN (v_total_attempts + 1) = 0 THEN 'not_started'
      WHEN v_new_mastery >= 0.95 THEN 'mastered'
      WHEN v_new_mastery >= 0.70 THEN 'proficient'
      WHEN v_new_mastery >= 0.40 THEN 'developing'
      ELSE 'beginner'
    END,
    v_new_mastery, v_new_mastery,
    v_new_ease, v_new_interval,
    now(), now() + (v_new_interval || ' days')::INTERVAL,
    v_total_attempts + 1,
    v_correct_attempts + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (student_id, topic_id) DO UPDATE SET
    mastery_level        = EXCLUDED.mastery_level,
    mastery_probability  = EXCLUDED.mastery_probability,
    p_know               = EXCLUDED.p_know,
    ease_factor          = EXCLUDED.ease_factor,
    review_interval_days = EXCLUDED.review_interval_days,
    last_attempted_at    = EXCLUDED.last_attempted_at,
    next_review_at       = EXCLUDED.next_review_at,
    attempts             = EXCLUDED.attempts,
    correct_attempts     = EXCLUDED.correct_attempts,
    updated_at           = EXCLUDED.updated_at;

  new_mastery := v_new_mastery;
  new_ease_factor := v_new_ease;
  new_review_interval := v_new_interval;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.update_concept_mastery_bkt IS
  'DEAD (no live caller; live BKT writer is update_learner_state_post_quiz). Kept neutralized: writes canonical mastery_probability + p_know + derived mastery_level band against the current schema so a revival cannot reintroduce the numeric-into-mastery_level bug. Repointed 20260623000100.';
