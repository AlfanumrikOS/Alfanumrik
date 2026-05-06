-- A-01: Backfill BKT mastery for all completed quiz sessions

-- Step 1: Backfill chapter_number on quiz_sessions from question_bank via quiz_responses
UPDATE quiz_sessions qs
SET chapter_number = sub.chapter_number
FROM (
  SELECT qr.quiz_session_id,
         mode() WITHIN GROUP (ORDER BY qb.chapter_number) AS chapter_number
  FROM quiz_responses qr
  JOIN question_bank qb ON qb.id = qr.question_id
  WHERE qb.chapter_number IS NOT NULL
  GROUP BY qr.quiz_session_id
) sub
WHERE qs.id = sub.quiz_session_id
  AND qs.chapter_number IS NULL
  AND qs.is_completed = true;

-- Step 2: Backfill adaptive_mastery using BKT logic for all completed sessions
DO $$
DECLARE
  r             RECORD;
  v_node_code   TEXT;
  v_correct     BOOLEAN;
  v_score_ratio FLOAT8;
  v_p_know      FLOAT8;
  v_p_learn     FLOAT8 := 0.10;
  v_p_guess     FLOAT8 := 0.20;
  v_p_slip      FLOAT8 := 0.10;
  v_p_know_post FLOAT8;
  v_p_know_next FLOAT8;
  v_denom       FLOAT8;
  v_total       INT;
  v_correct_att INT;
  v_consec_c    INT;
  v_consec_w    INT;
  v_ease        FLOAT8;
  v_interval    INT;
  v_quality     INT;
  updated_count INT := 0;
BEGIN
  FOR r IN
    SELECT id, student_id, subject, grade, chapter_number, score_percent
    FROM quiz_sessions
    WHERE is_completed = true
      AND chapter_number IS NOT NULL
    ORDER BY student_id, subject, chapter_number, completed_at
  LOOP
    v_node_code   := LOWER(r.subject) || '_' || r.grade || '_ch' || r.chapter_number;
    v_score_ratio := COALESCE(r.score_percent / 100.0, 0.0);
    v_correct     := v_score_ratio >= 0.60;

    SELECT
      COALESCE(p_know, 0.30), COALESCE(total_attempts, 0),
      COALESCE(correct_attempts, 0), COALESCE(consecutive_correct, 0),
      COALESCE(consecutive_wrong, 0), COALESCE(ease_factor, 2.5),
      COALESCE(interval_days, 1)
    INTO v_p_know, v_total, v_correct_att, v_consec_c, v_consec_w, v_ease, v_interval
    FROM adaptive_mastery
    WHERE student_id = r.student_id AND node_code = v_node_code;

    IF NOT FOUND THEN
      v_p_know := 0.30; v_total := 0; v_correct_att := 0;
      v_consec_c := 0; v_consec_w := 0; v_ease := 2.5; v_interval := 1;
    END IF;

    IF v_correct THEN
      v_denom       := v_p_know * (1 - v_p_slip) + (1 - v_p_know) * v_p_guess;
      v_p_know_post := CASE WHEN v_denom > 0 THEN (v_p_know * (1 - v_p_slip)) / v_denom ELSE v_p_know END;
      v_consec_c    := v_consec_c + 1; v_consec_w := 0; v_correct_att := v_correct_att + 1;
    ELSE
      v_denom       := v_p_know * v_p_slip + (1 - v_p_know) * (1 - v_p_guess);
      v_p_know_post := CASE WHEN v_denom > 0 THEN (v_p_know * v_p_slip) / v_denom ELSE v_p_know END;
      v_consec_c    := 0; v_consec_w := v_consec_w + 1;
    END IF;

    v_p_know_next := LEAST(GREATEST(v_p_know_post + (1.0 - v_p_know_post) * v_p_learn, 0.0), 1.0);
    v_total := v_total + 1;

    v_quality  := CASE WHEN v_correct THEN CASE WHEN v_consec_c >= 3 THEN 5 ELSE 4 END ELSE 2 END;
    v_ease     := GREATEST(1.3, v_ease + 0.1 - (5 - v_quality) * (0.08 + (5 - v_quality) * 0.02));
    v_interval := CASE WHEN v_p_know_next >= 0.90
                   THEN GREATEST(1, ROUND(v_interval * v_ease)::INT) ELSE 1 END;

    INSERT INTO adaptive_mastery (
      student_id, node_code, p_know, p_learn, p_guess, p_slip,
      mastery_prob, mastery_level, total_attempts, correct_attempts,
      consecutive_correct, consecutive_wrong, ease_factor, interval_days,
      prereqs_met, can_regress, current_layer, l1_mastery, l2_mastery, l3_mastery,
      eligible_for_interleave, interleave_count, created_at, updated_at
    ) VALUES (
      r.student_id, v_node_code, v_p_know, v_p_learn, v_p_guess, v_p_slip,
      v_p_know_next, 'not_started', v_total, v_correct_att,
      v_consec_c, v_consec_w, v_ease, v_interval,
      TRUE, FALSE, 1, 0, 0, 0, FALSE, 0, NOW(), NOW()
    )
    ON CONFLICT (student_id, node_code) DO UPDATE SET
      p_know              = EXCLUDED.p_know,
      mastery_prob        = EXCLUDED.mastery_prob,
      total_attempts      = EXCLUDED.total_attempts,
      correct_attempts    = EXCLUDED.correct_attempts,
      consecutive_correct = EXCLUDED.consecutive_correct,
      consecutive_wrong   = EXCLUDED.consecutive_wrong,
      ease_factor         = EXCLUDED.ease_factor,
      interval_days       = EXCLUDED.interval_days,
      updated_at          = NOW();

    updated_count := updated_count + 1;
  END LOOP;

  RAISE NOTICE 'BKT backfill complete: % mastery rows upserted', updated_count;
END;
$$;
