-- Unified Core Mastery Engine: Quiz → BKT → Foxy reads mastery
-- Wires the disconnected systems together

-- Rebuild submit_quiz_results to call BKT mastery update per question
CREATE OR REPLACE FUNCTION public.submit_quiz_results(
  p_student_id UUID, p_subject TEXT, p_grade TEXT,
  p_topic TEXT DEFAULT NULL, p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]', p_time INTEGER DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total INTEGER := 0; v_correct INTEGER := 0;
  v_score NUMERIC; v_xp INTEGER := 0; v_mastery_xp INTEGER := 0;
  v_session_id UUID; r JSONB;
  v_qid UUID; v_selected INTEGER; v_actual INTEGER; v_is_correct BOOLEAN;
  v_topic_id UUID; v_old_mastery FLOAT; v_new_mastery FLOAT;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_qid := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;

    SELECT correct_answer_index INTO v_actual FROM question_bank WHERE id = v_qid;
    v_is_correct := (v_selected IS NOT NULL AND v_actual IS NOT NULL AND v_selected = v_actual);
    IF v_is_correct THEN v_correct := v_correct + 1; END IF;

    BEGIN
      SELECT ct.id INTO v_topic_id
      FROM curriculum_topics ct
      JOIN question_bank qb ON qb.id = v_qid
      WHERE ct.subject_id = (SELECT id FROM subjects WHERE code = p_subject LIMIT 1)
        AND ct.grade = p_grade AND ct.chapter_number = qb.chapter_number
      LIMIT 1;

      IF v_topic_id IS NOT NULL THEN
        SELECT mastery_level INTO v_old_mastery
        FROM concept_mastery WHERE student_id = p_student_id AND topic_id = v_topic_id;
        v_old_mastery := COALESCE(v_old_mastery, 0.1);

        SELECT new_mastery INTO v_new_mastery
        FROM update_concept_mastery_bkt(p_student_id, v_topic_id, v_is_correct);

        IF v_new_mastery > v_old_mastery THEN
          v_mastery_xp := v_mastery_xp + ROUND((v_new_mastery - v_old_mastery) * 50);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'correct', 0, 'score_percent', 0, 'xp_earned', 0);
  END IF;

  v_score := ROUND((v_correct::NUMERIC / v_total) * 100);
  v_xp := v_correct * 10 + v_mastery_xp;
  IF v_score >= 80 AND v_total >= 5 THEN v_xp := v_xp + 20; END IF;
  IF v_score = 100 AND v_total >= 5 THEN v_xp := v_xp + 50; END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic, chapter_number,
    question_count, correct_count, score_percent,
    time_taken_seconds, xp_earned, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score, p_time, v_xp, NOW()
  ) RETURNING id INTO v_session_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_qid := (r->>'question_id')::UUID;
    v_selected := (r->>'selected_option')::INTEGER;
    SELECT correct_answer_index INTO v_actual FROM question_bank WHERE id = v_qid;
    v_is_correct := (v_selected IS NOT NULL AND v_actual IS NOT NULL AND v_selected = v_actual);
    INSERT INTO quiz_responses (quiz_session_id, question_id, selected_option, is_correct, time_spent_seconds)
    VALUES (v_session_id, v_qid, v_selected, v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0))
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM atomic_quiz_profile_update(p_student_id, v_xp, v_correct, v_total);

  RETURN jsonb_build_object(
    'total', v_total, 'correct', v_correct, 'score_percent', v_score,
    'xp_earned', v_xp, 'mastery_xp', v_mastery_xp, 'session_id', v_session_id
  );
END;
$$;
