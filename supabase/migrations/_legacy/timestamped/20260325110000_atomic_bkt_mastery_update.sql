-- ============================================================================
-- I1: Atomic BKT mastery update
--
-- PROBLEM: The queue-consumer reads mastery, computes BKT in JS, then upserts.
-- Two concurrent quiz submissions for the same student+topic can read the same
-- old mastery value and overwrite each other's update (lost update).
--
-- FIX: Move the BKT computation into a Postgres function that uses
-- SELECT ... FOR UPDATE to lock the row during the read-modify-write cycle.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_concept_mastery_bkt(
  p_student_id UUID,
  p_topic_id UUID,
  p_is_correct BOOLEAN,
  p_p_learn FLOAT DEFAULT 0.2,
  p_p_slip FLOAT DEFAULT 0.1,
  p_p_guess FLOAT DEFAULT 0.25
)
RETURNS TABLE(new_mastery FLOAT, new_ease_factor FLOAT, new_review_interval INT)
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
  v_row_id UUID;
BEGIN
  -- Lock the row for this student+topic (or create if not exists)
  SELECT cm.id, cm.mastery_level, cm.ease_factor, cm.review_interval,
         cm.total_attempts, cm.correct_attempts
  INTO v_row_id, v_current_mastery, v_ease_factor, v_review_interval,
       v_total_attempts, v_correct_attempts
  FROM concept_mastery cm
  WHERE cm.student_id = p_student_id AND cm.topic_id = p_topic_id
  FOR UPDATE;

  -- Defaults for new rows
  IF NOT FOUND THEN
    v_current_mastery := 0.1;
    v_ease_factor := 2.5;
    v_review_interval := 0;
    v_total_attempts := 0;
    v_correct_attempts := 0;
  END IF;

  -- BKT calculation (identical to the JS version)
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

  -- Ease factor update
  IF p_is_correct THEN
    v_new_ease := LEAST(3.0, v_ease_factor + 0.1);
  ELSE
    v_new_ease := GREATEST(1.3, v_ease_factor - 0.2);
  END IF;

  -- SM-2 interval
  IF NOT p_is_correct THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 0 THEN
    v_new_interval := 1;
  ELSIF v_review_interval = 1 THEN
    v_new_interval := 6;
  ELSE
    v_new_interval := ROUND(v_review_interval * v_new_ease)::INT;
  END IF;

  -- Upsert the result
  INSERT INTO concept_mastery (
    student_id, topic_id, mastery_level, ease_factor, review_interval,
    last_reviewed_at, next_review_at, total_attempts, correct_attempts, updated_at
  ) VALUES (
    p_student_id, p_topic_id, v_new_mastery, v_new_ease, v_new_interval,
    now(), now() + (v_new_interval || ' days')::INTERVAL,
    v_total_attempts + 1,
    v_correct_attempts + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (student_id, topic_id) DO UPDATE SET
    mastery_level = EXCLUDED.mastery_level,
    ease_factor = EXCLUDED.ease_factor,
    review_interval = EXCLUDED.review_interval,
    last_reviewed_at = EXCLUDED.last_reviewed_at,
    next_review_at = EXCLUDED.next_review_at,
    total_attempts = EXCLUDED.total_attempts,
    correct_attempts = EXCLUDED.correct_attempts,
    updated_at = EXCLUDED.updated_at;

  -- Return the new values
  new_mastery := v_new_mastery;
  new_ease_factor := v_new_ease;
  new_review_interval := v_new_interval;
  RETURN NEXT;
END;
$$;
