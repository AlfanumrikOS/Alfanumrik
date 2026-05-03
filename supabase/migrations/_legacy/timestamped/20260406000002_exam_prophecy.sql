-- Migration: 20260406000002_exam_prophecy.sql
-- Purpose: Predictive score engine RPC for Exam Prophecy superpower.
-- Security: SECURITY INVOKER -- caller must own the student record.
-- P5: grade is TEXT "6"-"12"

CREATE OR REPLACE FUNCTION predict_exam_score(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total_topics INT := 0;
  v_topics_attempted INT := 0;
  v_topics_mastered INT := 0;
  v_topics_in_progress INT := 0;
  v_topics_not_started INT := 0;
  v_weighted_sum FLOAT := 0;
  v_predicted_score INT;
  v_confidence_width INT;
  v_lower_bound INT;
  v_upper_bound INT;
  v_exam_readiness TEXT;
  v_has_topic_below_04 BOOLEAN := false;
  v_all_attempted BOOLEAN;
  v_strength_topics JSONB := '[]'::JSONB;
  v_weakness_topics JSONB := '[]'::JSONB;
  v_improvement_plan JSONB := '[]'::JSONB;
  v_bloom_distribution JSONB := '{"remember":0,"understand":0,"apply":0,"analyze":0,"evaluate":0,"create":0}'::JSONB;
  v_bloom_counts JSONB := '{"remember":0,"understand":0,"apply":0,"analyze":0,"evaluate":0,"create":0}'::JSONB;
  v_subject_id UUID;
  rec RECORD;
BEGIN
  -- Security: verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not your student record';
  END IF;

  -- P5 validation
  IF p_grade NOT IN ('6','7','8','9','10','11','12') THEN
    RAISE EXCEPTION 'Invalid grade: must be "6" through "12"';
  END IF;

  -- Resolve subject_id
  SELECT id INTO v_subject_id FROM subjects WHERE code = p_subject AND is_active = true;
  IF v_subject_id IS NULL THEN
    RAISE EXCEPTION 'Unknown subject code: %', p_subject;
  END IF;

  -- Count total curriculum topics
  SELECT COUNT(*) INTO v_total_topics
  FROM curriculum_topics ct
  WHERE ct.subject_id = v_subject_id AND ct.grade = p_grade AND ct.is_active = true;

  IF v_total_topics = 0 THEN
    RETURN jsonb_build_object(
      'predicted_score', 0, 'confidence_band', jsonb_build_array(0, 0),
      'strength_topics', '[]'::JSONB, 'weakness_topics', '[]'::JSONB,
      'improvement_plan', '[]'::JSONB, 'total_topics', 0,
      'topics_mastered', 0, 'topics_in_progress', 0, 'topics_not_started', 0,
      'bloom_distribution', v_bloom_distribution, 'exam_readiness', 'not_ready'
    );
  END IF;

  -- Iterate topics, compute weighted mastery
  FOR rec IN
    SELECT ct.id AS topic_id, ct.title AS topic_title,
      COALESCE(cm.mastery_level::FLOAT, 0) AS mastery,
      COALESCE(cm.current_retention, 1.0) AS retention,
      cm.bloom_mastery, cm.cme_action_type, COALESCE(cm.attempts, 0) AS attempts
    FROM curriculum_topics ct
    LEFT JOIN concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subject_id AND ct.grade = p_grade AND ct.is_active = true
  LOOP
    v_weighted_sum := v_weighted_sum + (rec.mastery * rec.retention);
    IF rec.attempts > 0 THEN
      v_topics_attempted := v_topics_attempted + 1;
      IF rec.mastery >= 0.8 THEN v_topics_mastered := v_topics_mastered + 1;
      ELSE v_topics_in_progress := v_topics_in_progress + 1; END IF;
      IF rec.mastery < 0.4 THEN v_has_topic_below_04 := true; END IF;
    ELSE
      v_topics_not_started := v_topics_not_started + 1;
    END IF;

    -- Aggregate bloom_mastery
    IF rec.bloom_mastery IS NOT NULL THEN
      DECLARE bloom_key TEXT; bloom_val FLOAT;
      BEGIN
        FOR bloom_key IN SELECT unnest(ARRAY['remember','understand','apply','analyze','evaluate','create'])
        LOOP
          bloom_val := COALESCE((rec.bloom_mastery->>bloom_key)::FLOAT, 0);
          IF bloom_val > 0 THEN
            v_bloom_distribution := jsonb_set(v_bloom_distribution, ARRAY[bloom_key],
              to_jsonb(COALESCE((v_bloom_distribution->>bloom_key)::FLOAT, 0) + bloom_val));
            v_bloom_counts := jsonb_set(v_bloom_counts, ARRAY[bloom_key],
              to_jsonb(COALESCE((v_bloom_counts->>bloom_key)::FLOAT, 0) + 1));
          END IF;
        END LOOP;
      END;
    END IF;
  END LOOP;

  -- Average bloom distribution
  DECLARE bk TEXT; bv FLOAT; bc FLOAT;
  BEGIN
    FOR bk IN SELECT unnest(ARRAY['remember','understand','apply','analyze','evaluate','create'])
    LOOP
      bc := COALESCE((v_bloom_counts->>bk)::FLOAT, 0);
      IF bc > 0 THEN
        bv := COALESCE((v_bloom_distribution->>bk)::FLOAT, 0) / bc;
        v_bloom_distribution := jsonb_set(v_bloom_distribution, ARRAY[bk], to_jsonb(ROUND(bv::NUMERIC, 2)));
      END IF;
    END LOOP;
  END;

  -- Predicted score
  v_predicted_score := ROUND(v_weighted_sum / v_total_topics * 100);
  v_predicted_score := GREATEST(0, LEAST(100, v_predicted_score));

  -- Confidence band
  v_confidence_width := GREATEST(5, ROUND(30.0 / SQRT(GREATEST(v_topics_attempted, 1)::FLOAT))::INT);
  v_lower_bound := GREATEST(0, v_predicted_score - v_confidence_width);
  v_upper_bound := LEAST(100, v_predicted_score + v_confidence_width);

  -- Exam readiness
  v_all_attempted := (v_topics_not_started = 0);
  IF v_predicted_score >= 80 AND v_all_attempted AND NOT v_has_topic_below_04 THEN
    v_exam_readiness := 'ready';
  ELSIF v_predicted_score >= 60 THEN v_exam_readiness := 'partially_ready';
  ELSIF v_predicted_score >= 40 THEN v_exam_readiness := 'needs_work';
  ELSE v_exam_readiness := 'not_ready';
  END IF;

  -- Strength topics (top 3)
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'mastery')::FLOAT DESC), '[]'::JSONB) INTO v_strength_topics
  FROM (
    SELECT jsonb_build_object('topic', ct.title,
      'mastery', ROUND((COALESCE(cm.mastery_level::FLOAT, 0) * COALESCE(cm.current_retention, 1.0))::NUMERIC, 2)) AS t
    FROM curriculum_topics ct
    JOIN concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subject_id AND ct.grade = p_grade AND ct.is_active = true
      AND COALESCE(cm.attempts, 0) > 0
    ORDER BY (COALESCE(cm.mastery_level::FLOAT, 0) * COALESCE(cm.current_retention, 1.0)) DESC
    LIMIT 3
  ) sub;

  -- Weakness topics (bottom 3)
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'mastery')::FLOAT ASC), '[]'::JSONB) INTO v_weakness_topics
  FROM (
    SELECT jsonb_build_object('topic', ct.title,
      'mastery', ROUND((COALESCE(cm.mastery_level::FLOAT, 0) * COALESCE(cm.current_retention, 1.0))::NUMERIC, 2)) AS t
    FROM curriculum_topics ct
    JOIN concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subject_id AND ct.grade = p_grade AND ct.is_active = true
      AND COALESCE(cm.attempts, 0) > 0 AND COALESCE(cm.mastery_level::FLOAT, 0) < 0.7
    ORDER BY (COALESCE(cm.mastery_level::FLOAT, 0) * COALESCE(cm.current_retention, 1.0)) ASC
    LIMIT 3
  ) sub;

  -- Improvement plan (top 5 by potential gain)
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'potential_gain')::INT DESC), '[]'::JSONB) INTO v_improvement_plan
  FROM (
    SELECT jsonb_build_object('topic', ct.title,
      'action', COALESCE(cm.cme_action_type, 'practice'),
      'potential_gain', ROUND(((0.8 - LEAST(0.8, COALESCE(cm.mastery_level::FLOAT, 0))) / v_total_topics * 100)::NUMERIC)) AS t
    FROM curriculum_topics ct
    JOIN concept_mastery cm ON cm.topic_id = ct.id AND cm.student_id = p_student_id
    WHERE ct.subject_id = v_subject_id AND ct.grade = p_grade AND ct.is_active = true
      AND COALESCE(cm.attempts, 0) > 0 AND COALESCE(cm.mastery_level::FLOAT, 0) < 0.7
    ORDER BY COALESCE(cm.mastery_level::FLOAT, 0) ASC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'predicted_score', v_predicted_score,
    'confidence_band', jsonb_build_array(v_lower_bound, v_upper_bound),
    'strength_topics', v_strength_topics,
    'weakness_topics', v_weakness_topics,
    'improvement_plan', v_improvement_plan,
    'total_topics', v_total_topics,
    'topics_mastered', v_topics_mastered,
    'topics_in_progress', v_topics_in_progress,
    'topics_not_started', v_topics_not_started,
    'bloom_distribution', v_bloom_distribution,
    'exam_readiness', v_exam_readiness
  );
END;
$$;

COMMENT ON FUNCTION predict_exam_score IS
  'Predicts exam score for a student in a subject/grade based on retention-weighted concept mastery, Bloom distribution, and improvement potential.';
