-- Migration: 20260807000400_update_learner_state_post_quiz_evidence.sql
-- Purpose: Foxy North-Star Phase 2 (spec §1.3) — evidence-aware learner-state
--   writer. Body copied from the NEWEST prior definition
--   (20260623000100_fix_post_quiz_canonical_mastery.sql — verified newest via
--   grep for `CREATE OR REPLACE FUNCTION (public.)?update_learner_state_post_
--   quiz` across supabase/migrations on 2026-08-05; the only later-timestamped
--   hits are under _legacy/, which the CLI never applies) with EXACTLY these
--   deltas:
--
--   (0) SIGNATURE — ONE additive arg `p_hint_level INT DEFAULT NULL`, placed
--       after p_difficulty (position 8) and BEFORE the BKT params. Safe for
--       every existing caller:
--         * submit_quiz_results_v2 passes 7 positional args (verified in
--           20260805100200 L415);
--         * v1 submit_quiz_results (baseline L7526/L7811) passes ≤7 positional;
--         * no caller anywhere passes the BKT params positionally (grep across
--           migrations + functions, 2026-08-05);
--         * PostgREST/JS callers use named args — unaffected.
--       DROP FUNCTION IF EXISTS with the exact current 10-arg signature first
--       (an added param creates an overload otherwise -> ambiguity).
--
--   (a) P8 counters — v_independent := (p_hint_level IS NULL OR p_hint_level = 0);
--       increments independent_attempts/independent_correct OR
--       hinted_attempts/hinted_correct (columns added by 20260807000100).
--
--   (b) P2 evidence_quality — running weighted mean:
--         w = CASE p_hint_level WHEN 0 THEN 1.0 WHEN 1 THEN 0.7
--                               WHEN 2 THEN 0.45 WHEN 3 THEN 0.25 ELSE 1.0 END
--         evidence_quality' = (evidence_quality*evidence_count + w)/(evidence_count+1)
--         evidence_count'   = evidence_count + 1
--       (NULL p_hint_level falls through the simple CASE to ELSE 1.0 —
--       unreported hint tier is treated as independent, matching (a).)
--
--   (c) P3 mastery_variance — BETA POSTERIOR replaces the pseudo-decay
--       GREATEST(0.01, 0.25/(1 + attempts*0.1)) in BOTH the VALUES list and
--       the confidence_score blend (INSERT + RETURN jsonb):
--         alpha = 1 + independent_correct*1.0 + hinted_correct*0.45
--         beta  = 1 + (independent_attempts - independent_correct)*1.0
--                   + (hinted_attempts   - hinted_correct)*0.45
--         mastery_variance = alpha*beta / ((alpha+beta)^2 * (alpha+beta+1))
--       computed from the POST-increment counters of this attempt.
--
--   This is the ONLY intentional numeric change. BKT posterior, SM-2 interval
--   + 365 clamp, ease factor, streak, bloom map, retention half-life, error
--   counts, consecutive_wrong, CME action, and band derivation are
--   byte-identical to 20260623000100. RETURN jsonb gains three ADDITIVE keys:
--   evidence_count, evidence_quality, mastery_variance.
--
-- SECURITY DEFINER justified (unchanged from 20260623000100): called from the
-- submit_quiz_results chain where the student is already validated; writes
-- concept_mastery across the RLS boundary. SET search_path = public pinned.
--
-- Ordering: REQUIRES 20260807000100 (evidence columns) — same PR, earlier
-- timestamp. Companion caller rewire: 20260807000500.
-- Owner: architect. Formula review: assessment (post-merge, per Phase 2 plan).
-- Added: 2026-08-05.

DROP FUNCTION IF EXISTS public.update_learner_state_post_quiz(UUID, UUID, BOOLEAN, TEXT, TEXT, INT, INT, FLOAT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION update_learner_state_post_quiz(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_bloom_level TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_response_time_ms INT DEFAULT NULL,
  p_difficulty INT DEFAULT NULL,
  -- Phase 2 (20260807000400): hint tier for THIS attempt. NULL = not reported
  -- (legacy callers) -> treated as independent, weight 1.0.
  p_hint_level INT DEFAULT NULL,
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

  -- Phase 2 (20260807000400): evidence tracking
  v_independent BOOLEAN;
  v_evidence_count INT;
  v_evidence_quality FLOAT;
  v_ind_attempts INT;
  v_ind_correct INT;
  v_hint_attempts INT;
  v_hint_correct INT;
  v_w FLOAT;
  v_alpha FLOAT;
  v_beta FLOAT;
  v_variance FLOAT;
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
    COALESCE(cm.mastery_velocity, 0),
    -- Phase 2: evidence counters (20260807000100)
    COALESCE(cm.evidence_count, 0),
    COALESCE(cm.evidence_quality, 0),
    COALESCE(cm.independent_attempts, 0),
    COALESCE(cm.independent_correct, 0),
    COALESCE(cm.hinted_attempts, 0),
    COALESCE(cm.hinted_correct, 0)
  INTO
    v_current_mastery, v_ease_factor, v_review_interval,
    v_total_attempts, v_correct_attempts,
    v_streak, v_bloom, v_retention_hl, v_avg_rt, v_max_diff,
    v_err_conceptual, v_err_procedural, v_err_careless, v_mastery_velocity,
    v_evidence_count, v_evidence_quality,
    v_ind_attempts, v_ind_correct, v_hint_attempts, v_hint_correct
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
    v_evidence_count := 0;
    v_evidence_quality := 0;
    v_ind_attempts := 0;
    v_ind_correct := 0;
    v_hint_attempts := 0;
    v_hint_correct := 0;
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

  -- ---- Phase 2 (a): independent/hinted evidence counters ----
  v_independent := (p_hint_level IS NULL OR p_hint_level = 0);
  IF v_independent THEN
    v_ind_attempts := v_ind_attempts + 1;
    IF p_is_correct THEN
      v_ind_correct := v_ind_correct + 1;
    END IF;
  ELSE
    v_hint_attempts := v_hint_attempts + 1;
    IF p_is_correct THEN
      v_hint_correct := v_hint_correct + 1;
    END IF;
  END IF;

  -- ---- Phase 2 (b): evidence_quality running weighted mean ----
  -- Simple CASE: a NULL p_hint_level matches no WHEN arm and falls to ELSE 1.0
  -- (unreported = independent, consistent with v_independent above).
  v_w := CASE p_hint_level
    WHEN 0 THEN 1.0
    WHEN 1 THEN 0.7
    WHEN 2 THEN 0.45
    WHEN 3 THEN 0.25
    ELSE 1.0
  END;
  -- Weighted mean of weights in [0.25, 1.0] is bounded 0..1 by construction;
  -- clamp defensively against FP roundoff (CHECK 0..1 on the column).
  v_evidence_quality := LEAST(1.0, GREATEST(0.0,
    (v_evidence_quality * v_evidence_count + v_w) / (v_evidence_count + 1)
  ));
  v_evidence_count := v_evidence_count + 1;

  -- ---- Phase 2 (c): mastery_variance = Beta-posterior variance ----
  -- Replaces the pseudo-decay GREATEST(0.01, 0.25/(1+attempts*0.1)).
  -- Hinted evidence is discounted at 0.45 pseudo-counts per event; computed
  -- from the POST-increment counters of this attempt.
  v_alpha := 1.0 + v_ind_correct * 1.0 + v_hint_correct * 0.45;
  v_beta  := 1.0 + (v_ind_attempts - v_ind_correct) * 1.0
                 + (v_hint_attempts - v_hint_correct) * 0.45;
  v_variance := (v_alpha * v_beta)
                / (((v_alpha + v_beta) ^ 2) * (v_alpha + v_beta + 1.0));

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
    evidence_count, evidence_quality,
    independent_attempts, independent_correct,
    hinted_attempts, hinted_correct,
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
    v_variance,  -- Phase 2 (c): Beta-posterior variance (was pseudo-decay)
    v_retention_hl,
    -- current_retention: exponential decay from last practice
    v_new_mastery,  -- at time of practice, retention = mastery
    v_max_diff,
    v_err_conceptual, v_err_procedural, v_err_careless,
    v_avg_rt,
    -- confidence_score: blend of mastery and low variance
    -- Phase 2 (c): variance term is now the Beta posterior
    LEAST(1.0, v_new_mastery * (1.0 - v_variance)),
    v_streak, v_mastery_velocity,
    v_bloom, v_new_action, now(),
    0,  -- consecutive_wrong: neutral first answer = 0 (DO UPDATE path increments below)
    v_evidence_count, v_evidence_quality,
    v_ind_attempts, v_ind_correct,
    v_hint_attempts, v_hint_correct,
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
    evidence_count          = EXCLUDED.evidence_count,
    evidence_quality        = EXCLUDED.evidence_quality,
    independent_attempts    = EXCLUDED.independent_attempts,
    independent_correct     = EXCLUDED.independent_correct,
    hinted_attempts         = EXCLUDED.hinted_attempts,
    hinted_correct          = EXCLUDED.hinted_correct,
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
    -- Phase 2 (c): variance term is now the Beta posterior
    'confidence_score', LEAST(1.0, v_new_mastery * (1.0 - v_variance)),
    -- Phase 2: additive keys
    'evidence_count', v_evidence_count,
    'evidence_quality', v_evidence_quality,
    'mastery_variance', v_variance
  );
END;
$$;

COMMENT ON FUNCTION update_learner_state_post_quiz IS
  'Atomically updates BKT mastery, error counts, retention, bloom mastery, streak, consecutive_wrong, and CME action after a quiz attempt. Canonical numeric posterior stored in mastery_probability (mirrored by p_know); mastery_level is the derived categorical band. SM-2 interval clamped to 365 days to prevent timestamptz overflow (20260622080000). Canonical-mastery write fix: 20260623000100. Phase 2 evidence tracking (20260807000400): p_hint_level (additive arg, position 8) drives independent/hinted attempt counters and the evidence_quality running weighted mean (w = 1.0/0.7/0.45/0.25 for hint tiers 0-3, NULL -> 1.0); mastery_variance is now the Beta-posterior variance with hinted evidence discounted at 0.45 pseudo-counts (replaces the pseudo-decay 0.25/(1+attempts*0.1)) — this variance also feeds the confidence_score blend. RETURN gains additive keys evidence_count, evidence_quality, mastery_variance.';
