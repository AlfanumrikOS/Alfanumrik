-- Migration: affective_state_computation_pipeline
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Implement affective state detection pipeline:
--   - Per-session: ZPD classification, flow probability, fatigue detection
--   - Per-student: boredom_floor, frustration_ceiling computation
--
-- Inputs: quiz_responses.{time_taken_seconds, is_correct, difficulty, question_number}
-- Outputs:
--   cognitive_session_metrics: ZPD counts, flow_prob, fatigue, rt_trend, acc_trend
--   adaptive_profile: boredom_floor, frustration_ceiling
--   student_learning_profiles: avg_response_time_seconds, frustration_threshold
--
-- Trigger fires AFTER UPDATE OF is_completed ON quiz_sessions.

CREATE OR REPLACE FUNCTION public.compute_session_cognitive_metrics(
  p_student_id      uuid,
  p_quiz_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total           integer;
  v_too_easy        integer;
  v_too_hard        integer;
  v_in_zpd          integer;
  v_zpd_accuracy    numeric;
  v_midpoint        integer;
  v_t1_avg          numeric;
  v_t2_avg          numeric;
  v_a1_rate         numeric;
  v_a2_rate         numeric;
  v_avg_rt          numeric;
  v_stddev_rt       numeric;
  v_rt_trend        text;
  v_acc_trend       text;
  v_fatigue         boolean;
  v_flow_prob       numeric;
  v_accuracy_score  numeric;
  v_time_stability  numeric;
  v_zpd_ratio       numeric;
  v_overall_acc     numeric;
  v_existing_id     uuid;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM quiz_responses WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;
  IF v_total = 0 THEN RETURN; END IF;

  SELECT
    COUNT(*) FILTER (WHERE difficulty = 1 AND is_correct = true),
    COUNT(*) FILTER (WHERE difficulty = 3 AND is_correct = false),
    COUNT(*) FILTER (WHERE NOT (difficulty = 1 AND is_correct = true)
                         AND NOT (difficulty = 3 AND is_correct = false))
  INTO v_too_easy, v_too_hard, v_in_zpd
  FROM quiz_responses WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;

  SELECT CASE WHEN v_in_zpd > 0 THEN
    ROUND((COUNT(*) FILTER (WHERE is_correct = true AND NOT (difficulty = 1 AND is_correct = true)
                                 AND NOT (difficulty = 3 AND is_correct = false)))::numeric / v_in_zpd, 4)
    ELSE NULL END INTO v_zpd_accuracy
  FROM quiz_responses WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;

  v_midpoint := GREATEST(1, v_total / 2);

  SELECT
    AVG(CASE WHEN question_number <= v_midpoint AND time_taken_seconds > 0 THEN time_taken_seconds END),
    AVG(CASE WHEN question_number >  v_midpoint AND time_taken_seconds > 0 THEN time_taken_seconds END),
    AVG(CASE WHEN question_number <= v_midpoint THEN is_correct::int END),
    AVG(CASE WHEN question_number >  v_midpoint THEN is_correct::int END),
    AVG(CASE WHEN time_taken_seconds > 0 THEN time_taken_seconds END),
    STDDEV(CASE WHEN time_taken_seconds > 0 THEN time_taken_seconds END)
  INTO v_t1_avg, v_t2_avg, v_a1_rate, v_a2_rate, v_avg_rt, v_stddev_rt
  FROM quiz_responses WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;

  v_rt_trend := CASE
    WHEN v_t1_avg IS NULL OR v_t2_avg IS NULL THEN 'stable'
    WHEN v_t2_avg > v_t1_avg * 1.25 THEN 'increasing'
    WHEN v_t2_avg < v_t1_avg * 0.75 THEN 'decreasing'
    ELSE 'stable' END;

  v_acc_trend := CASE
    WHEN v_a1_rate IS NULL OR v_a2_rate IS NULL THEN 'stable'
    WHEN v_a2_rate > v_a1_rate + 0.10 THEN 'improving'
    WHEN v_a2_rate < v_a1_rate - 0.10 THEN 'declining'
    ELSE 'stable' END;

  v_fatigue := (v_rt_trend = 'increasing' AND v_acc_trend = 'declining');

  SELECT AVG(is_correct::int) INTO v_overall_acc
  FROM quiz_responses WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;
  v_overall_acc := COALESCE(v_overall_acc, 0.5);

  -- Flow = 0.4*accuracy_score + 0.3*time_stability + 0.3*zpd_ratio
  -- accuracy peaks at 0.70 correct rate (challenge without frustration)
  v_accuracy_score := GREATEST(0.0, 1.0 - 2.0 * ABS(v_overall_acc - 0.70));
  v_time_stability := CASE
    WHEN v_avg_rt IS NULL OR v_avg_rt = 0 THEN 0.5
    ELSE GREATEST(0.0, 1.0 - LEAST(1.0, COALESCE(v_stddev_rt, 0) / v_avg_rt)) END;
  v_zpd_ratio := COALESCE(v_in_zpd::numeric / NULLIF(v_total, 0), 0.5);
  v_flow_prob := ROUND(LEAST(1.0, GREATEST(0.0,
    0.40 * v_accuracy_score + 0.30 * v_time_stability + 0.30 * v_zpd_ratio))::numeric, 4);

  SELECT id INTO v_existing_id
  FROM cognitive_session_metrics
  WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE cognitive_session_metrics SET
      questions_in_zpd          = v_in_zpd,
      questions_too_easy        = v_too_easy,
      questions_too_hard        = v_too_hard,
      zpd_accuracy_rate         = v_zpd_accuracy,
      response_time_trend       = v_rt_trend,
      accuracy_trend            = v_acc_trend,
      fatigue_detected          = v_fatigue,
      flow_state_probability    = v_flow_prob,
      avg_response_time_seconds = COALESCE(v_avg_rt, 0),
      response_time_variability = COALESCE(v_stddev_rt, 0),
      session_end               = now()
    WHERE student_id = p_student_id AND quiz_session_id = p_quiz_session_id;
  ELSE
    INSERT INTO cognitive_session_metrics (
      id, student_id, quiz_session_id,
      questions_in_zpd, questions_too_easy, questions_too_hard, zpd_accuracy_rate,
      response_time_trend, accuracy_trend, fatigue_detected,
      flow_state_probability, avg_response_time_seconds, response_time_variability,
      session_start, session_end, created_at
    ) VALUES (
      gen_random_uuid(), p_student_id, p_quiz_session_id,
      v_in_zpd, v_too_easy, v_too_hard, v_zpd_accuracy,
      v_rt_trend, v_acc_trend, v_fatigue,
      v_flow_prob, COALESCE(v_avg_rt, 0), COALESCE(v_stddev_rt, 0),
      now(), now(), now()
    );
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.compute_student_affective_profile(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_d1      numeric;
  v_acc_d2      numeric;
  v_acc_d3      numeric;
  v_boredom     integer;
  v_frustration integer;
  v_existing_ap uuid;
BEGIN
  SELECT
    AVG(CASE WHEN difficulty = 1 THEN is_correct::int END),
    AVG(CASE WHEN difficulty = 2 THEN is_correct::int END),
    AVG(CASE WHEN difficulty = 3 THEN is_correct::int END)
  INTO v_acc_d1, v_acc_d2, v_acc_d3
  FROM (SELECT is_correct, difficulty FROM quiz_responses
        WHERE student_id = p_student_id ORDER BY created_at DESC LIMIT 50) recent;

  -- boredom_floor: highest difficulty with ≥75% accuracy (too easy)
  v_boredom := 1;
  IF COALESCE(v_acc_d1, 0) >= 0.75 THEN v_boredom := 1; END IF;
  IF COALESCE(v_acc_d2, 0) >= 0.75 THEN v_boredom := 2; END IF;
  IF COALESCE(v_acc_d3, 0) >= 0.75 THEN v_boredom := 3; END IF;

  -- frustration_ceiling: lowest difficulty with <40% accuracy (frustrating)
  v_frustration := 3;
  IF COALESCE(v_acc_d1, 1) < 0.40 THEN v_frustration := 1;
  ELSIF COALESCE(v_acc_d2, 1) < 0.40 THEN v_frustration := 2;
  ELSIF COALESCE(v_acc_d3, 1) < 0.40 THEN v_frustration := 3;
  END IF;

  SELECT id INTO v_existing_ap FROM adaptive_profile WHERE student_id = p_student_id LIMIT 1;
  IF v_existing_ap IS NOT NULL THEN
    UPDATE adaptive_profile SET boredom_floor = v_boredom, frustration_ceiling = v_frustration,
      updated_at = now() WHERE student_id = p_student_id;
  ELSE
    INSERT INTO adaptive_profile (id, student_id, boredom_floor, frustration_ceiling, updated_at)
    VALUES (gen_random_uuid(), p_student_id, v_boredom, v_frustration, now());
  END IF;

  -- Update avg_response_time_seconds + frustration_threshold per subject
  UPDATE student_learning_profiles slp SET
    avg_response_time_seconds = COALESCE(subq.avg_rt, slp.avg_response_time_seconds),
    frustration_threshold     = COALESCE(subq.p90_rt, slp.frustration_threshold),
    updated_at                = now()
  FROM (SELECT subject,
          AVG(time_taken_seconds::float)::double precision AS avg_rt,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY time_taken_seconds)::double precision AS p90_rt
        FROM quiz_responses WHERE student_id = p_student_id AND time_taken_seconds > 0
        GROUP BY subject) subq
  WHERE slp.student_id = p_student_id AND slp.subject = subq.subject;
END;
$$;


CREATE OR REPLACE FUNCTION public.trg_fn_quiz_session_affective_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_completed = true AND (OLD.is_completed = false OR OLD.is_completed IS NULL) THEN
    PERFORM public.compute_session_cognitive_metrics(NEW.student_id, NEW.id);
    PERFORM public.compute_student_affective_profile(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quiz_session_affective_state ON quiz_sessions;
CREATE TRIGGER trg_quiz_session_affective_state
  AFTER UPDATE OF is_completed ON quiz_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_quiz_session_affective_state();

-- Backfill completed sessions
DO $$
DECLARE v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT qs.student_id, qs.id AS quiz_session_id FROM quiz_sessions qs
    WHERE qs.is_completed = true AND qs.student_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM quiz_responses qr WHERE qr.quiz_session_id = qs.id)
  LOOP
    PERFORM public.compute_session_cognitive_metrics(v_rec.student_id, v_rec.quiz_session_id);
  END LOOP;
  FOR v_rec IN SELECT DISTINCT student_id FROM quiz_sessions WHERE is_completed = true AND student_id IS NOT NULL
  LOOP
    PERFORM public.compute_student_affective_profile(v_rec.student_id);
  END LOOP;
END;
$$;
