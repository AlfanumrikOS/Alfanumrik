-- Migration: fix_irt_and_affective_race_conditions
-- Date: 2026-05-06
-- Purpose: 
-- 1. Use ON CONFLICT DO UPDATE instead of SELECT-then-INSERT in update_irt_theta
--    and compute_session_cognitive_metrics to avoid race conditions.
-- 2. Add LIMIT 200 to IRT query to avoid full table scans.
-- 3. Fix session_start in compute_session_cognitive_metrics.

-- 1. Fix update_irt_theta
CREATE OR REPLACE FUNCTION public.update_irt_theta(
  p_student_id uuid,
  p_subject     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_theta        double precision := 0.0;
  v_theta_prev   double precision;
  v_fisher_info  double precision := 0.0;
  v_l_prime      double precision;
  v_l_double     double precision;
  v_p            double precision;
  v_se           double precision;
  v_opt_diff     integer;
  v_iter         integer;
  v_n            integer;
  v_responses    RECORD;
BEGIN
  -- We use a limited subquery for recent responses
  SELECT COUNT(*)::integer INTO v_n
  FROM (
    SELECT qr.question_id
    FROM quiz_responses qr
    WHERE qr.student_id = p_student_id
      AND qr.subject    = p_subject
    ORDER BY qr.created_at DESC
    LIMIT 200
  ) recent_qr
  JOIN question_bank qb ON qb.id = recent_qr.question_id
  WHERE qb.irt_difficulty IS NOT NULL;

  IF v_n < 2 THEN RETURN; END IF;

  FOR v_iter IN 1..5 LOOP
    v_l_prime  := 0.0;
    v_l_double := 0.0;

    FOR v_responses IN
      SELECT qb.irt_difficulty AS b,
             (CASE WHEN recent_qr.is_correct THEN 1.0 ELSE 0.0 END) AS x
      FROM (
        SELECT qr.question_id, qr.is_correct
        FROM quiz_responses qr
        WHERE qr.student_id = p_student_id
          AND qr.subject    = p_subject
        ORDER BY qr.created_at DESC
        LIMIT 200
      ) recent_qr
      JOIN question_bank qb ON qb.id = recent_qr.question_id
      WHERE qb.irt_difficulty IS NOT NULL
    LOOP
      v_p := 1.0 / (1.0 + exp(-(v_theta - v_responses.b)));
      v_p := GREATEST(0.0001, LEAST(0.9999, v_p));
      v_l_prime  := v_l_prime  + (v_responses.x - v_p);
      v_l_double := v_l_double - (v_p * (1.0 - v_p));
    END LOOP;

    IF ABS(v_l_double) < 1e-8 THEN EXIT; END IF;

    v_theta_prev := v_theta;
    v_theta      := v_theta - (v_l_prime / v_l_double);
    v_theta      := GREATEST(-4.0, LEAST(4.0, v_theta));

    IF ABS(v_theta - v_theta_prev) < 0.001 THEN EXIT; END IF;
  END LOOP;

  v_fisher_info := 0.0;
  FOR v_responses IN
    SELECT qb.irt_difficulty AS b
    FROM (
      SELECT qr.question_id
      FROM quiz_responses qr
      WHERE qr.student_id = p_student_id
        AND qr.subject    = p_subject
      ORDER BY qr.created_at DESC
      LIMIT 200
    ) recent_qr
    JOIN question_bank qb ON qb.id = recent_qr.question_id
    WHERE qb.irt_difficulty IS NOT NULL
  LOOP
    v_p := 1.0 / (1.0 + exp(-(v_theta - v_responses.b)));
    v_p := GREATEST(0.0001, LEAST(0.9999, v_p));
    v_fisher_info := v_fisher_info + (v_p * (1.0 - v_p));
  END LOOP;

  v_se := CASE WHEN v_fisher_info > 0 THEN 1.0 / sqrt(v_fisher_info) ELSE 9.99 END;
  v_se := LEAST(9.99, v_se);

  v_opt_diff := CASE WHEN v_theta < -1.0 THEN 1 WHEN v_theta < 1.0 THEN 2 ELSE 3 END;

  -- Atomic Upsert for student_learning_profiles
  INSERT INTO student_learning_profiles (id, student_id, subject, irt_theta, irt_theta_se, updated_at)
  VALUES (gen_random_uuid(), p_student_id, p_subject, v_theta, v_se, now())
  ON CONFLICT (student_id, subject) DO UPDATE
  SET irt_theta = EXCLUDED.irt_theta,
      irt_theta_se = EXCLUDED.irt_theta_se,
      updated_at = EXCLUDED.updated_at;

  -- Atomic Upsert for adaptive_profile
  INSERT INTO adaptive_profile (id, student_id, optimal_difficulty, updated_at)
  VALUES (gen_random_uuid(), p_student_id, v_opt_diff, now())
  ON CONFLICT (student_id) DO UPDATE
  SET optimal_difficulty = EXCLUDED.optimal_difficulty,
      updated_at = EXCLUDED.updated_at;
END;
$$;


-- 2. Fix compute_session_cognitive_metrics
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
  v_session_start   timestamptz;
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
  v_accuracy_score := GREATEST(0.0, 1.0 - 2.0 * ABS(v_overall_acc - 0.70));
  v_time_stability := CASE
    WHEN v_avg_rt IS NULL OR v_avg_rt = 0 THEN 0.5
    ELSE GREATEST(0.0, 1.0 - LEAST(1.0, COALESCE(v_stddev_rt, 0) / v_avg_rt)) END;
  v_zpd_ratio := COALESCE(v_in_zpd::numeric / NULLIF(v_total, 0), 0.5);
  v_flow_prob := ROUND(LEAST(1.0, GREATEST(0.0,
    0.40 * v_accuracy_score + 0.30 * v_time_stability + 0.30 * v_zpd_ratio))::numeric, 4);

  SELECT qs.created_at INTO v_session_start
  FROM quiz_sessions qs WHERE qs.id = p_quiz_session_id;

  -- Atomic Upsert for cognitive_session_metrics
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
    COALESCE(v_session_start, now()), now(), now()
  )
  ON CONFLICT (student_id, quiz_session_id) DO UPDATE
  SET questions_in_zpd = EXCLUDED.questions_in_zpd,
      questions_too_easy = EXCLUDED.questions_too_easy,
      questions_too_hard = EXCLUDED.questions_too_hard,
      zpd_accuracy_rate = EXCLUDED.zpd_accuracy_rate,
      response_time_trend = EXCLUDED.response_time_trend,
      accuracy_trend = EXCLUDED.accuracy_trend,
      fatigue_detected = EXCLUDED.fatigue_detected,
      flow_state_probability = EXCLUDED.flow_state_probability,
      avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
      response_time_variability = EXCLUDED.response_time_variability,
      session_end = EXCLUDED.session_end;
END;
$$;


-- 3. Fix compute_student_affective_profile (SELECT-then-INSERT → ON CONFLICT)
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

  -- Atomic Upsert for adaptive_profile
  INSERT INTO adaptive_profile (id, student_id, boredom_floor, frustration_ceiling, updated_at)
  VALUES (gen_random_uuid(), p_student_id, v_boredom, v_frustration, now())
  ON CONFLICT (student_id) DO UPDATE
  SET boredom_floor = EXCLUDED.boredom_floor,
      frustration_ceiling = EXCLUDED.frustration_ceiling,
      updated_at = EXCLUDED.updated_at;

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
