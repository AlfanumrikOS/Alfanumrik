-- Migration: irt_theta_estimation_rpc_and_trigger
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Implement real-time IRT theta (student ability) estimation using
--          Newton-Raphson Rasch MLE. Fires after every quiz_responses INSERT.
--
-- Schema targeted:
--   student_learning_profiles: (student_id, subject, irt_theta float8, irt_theta_se float8)
--   adaptive_profile: (student_id, optimal_difficulty int)
--   quiz_responses: (student_id, question_id, is_correct bool, subject text)
--   question_bank: (id, irt_difficulty float8)
--
-- Algorithm: 5-iteration Newton-Raphson Rasch MLE
--   P_i = 1/(1+exp(-(theta - b_i)))
--   L'  = Σ(x_i - P_i)
--   L'' = -Σ(P_i*(1-P_i))
--   theta_new = theta - L'/L''
--   SE = 1/sqrt(Σ P_i*(1-P_i))
-- Bounds: theta ∈ [-4, 4]. Requires ≥ 2 valid responses.
-- optimal_difficulty: theta<-1→1, -1≤theta<1→2, theta≥1→3

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
  v_existing_slp uuid;
  v_existing_ap  uuid;
  v_responses    RECORD;
BEGIN
  SELECT COUNT(*)::integer INTO v_n
  FROM quiz_responses qr
  JOIN question_bank qb ON qb.id = qr.question_id
  WHERE qr.student_id = p_student_id
    AND qr.subject    = p_subject
    AND qb.irt_difficulty IS NOT NULL;

  IF v_n < 2 THEN RETURN; END IF;

  FOR v_iter IN 1..5 LOOP
    v_l_prime  := 0.0;
    v_l_double := 0.0;

    FOR v_responses IN
      SELECT qb.irt_difficulty AS b,
             (CASE WHEN qr.is_correct THEN 1.0 ELSE 0.0 END) AS x
      FROM quiz_responses qr
      JOIN question_bank qb ON qb.id = qr.question_id
      WHERE qr.student_id = p_student_id
        AND qr.subject    = p_subject
        AND qb.irt_difficulty IS NOT NULL
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
    FROM quiz_responses qr
    JOIN question_bank qb ON qb.id = qr.question_id
    WHERE qr.student_id = p_student_id
      AND qr.subject    = p_subject
      AND qb.irt_difficulty IS NOT NULL
  LOOP
    v_p := 1.0 / (1.0 + exp(-(v_theta - v_responses.b)));
    v_p := GREATEST(0.0001, LEAST(0.9999, v_p));
    v_fisher_info := v_fisher_info + (v_p * (1.0 - v_p));
  END LOOP;

  v_se := CASE WHEN v_fisher_info > 0 THEN 1.0 / sqrt(v_fisher_info) ELSE 9.99 END;
  v_se := LEAST(9.99, v_se);

  SELECT id INTO v_existing_slp
  FROM student_learning_profiles
  WHERE student_id = p_student_id AND subject = p_subject LIMIT 1;

  IF v_existing_slp IS NOT NULL THEN
    UPDATE student_learning_profiles
    SET irt_theta = v_theta, irt_theta_se = v_se, updated_at = now()
    WHERE student_id = p_student_id AND subject = p_subject;
  ELSE
    INSERT INTO student_learning_profiles (id, student_id, subject, irt_theta, irt_theta_se, updated_at)
    VALUES (gen_random_uuid(), p_student_id, p_subject, v_theta, v_se, now());
  END IF;

  v_opt_diff := CASE WHEN v_theta < -1.0 THEN 1 WHEN v_theta < 1.0 THEN 2 ELSE 3 END;

  SELECT id INTO v_existing_ap FROM adaptive_profile WHERE student_id = p_student_id LIMIT 1;

  IF v_existing_ap IS NOT NULL THEN
    UPDATE adaptive_profile SET optimal_difficulty = v_opt_diff, updated_at = now()
    WHERE student_id = p_student_id;
  ELSE
    INSERT INTO adaptive_profile (id, student_id, optimal_difficulty, updated_at)
    VALUES (gen_random_uuid(), p_student_id, v_opt_diff, now());
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.trg_fn_update_irt_theta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL AND NEW.subject IS NOT NULL THEN
    PERFORM public.update_irt_theta(NEW.student_id, NEW.subject);
  END IF;
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_quiz_response_irt_theta ON quiz_responses;

CREATE TRIGGER trg_quiz_response_irt_theta
  AFTER INSERT ON quiz_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_update_irt_theta();


-- Backfill existing responses
DO $$
DECLARE v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT student_id, subject FROM quiz_responses
    WHERE student_id IS NOT NULL AND subject IS NOT NULL
  LOOP
    PERFORM public.update_irt_theta(v_rec.student_id, v_rec.subject);
  END LOOP;
END;
$$;
