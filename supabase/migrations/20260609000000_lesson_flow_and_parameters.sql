-- Migration: Add CBSE parameter score columns to chapter_progress and update update_chapter_progress RPC
-- Date: 2026-06-09

-- 1. Add score columns if they do not exist
ALTER TABLE public.chapter_progress ADD COLUMN IF NOT EXISTS score_remember NUMERIC DEFAULT 0;
ALTER TABLE public.chapter_progress ADD COLUMN IF NOT EXISTS score_understand NUMERIC DEFAULT 0;
ALTER TABLE public.chapter_progress ADD COLUMN IF NOT EXISTS score_apply NUMERIC DEFAULT 0;
ALTER TABLE public.chapter_progress ADD COLUMN IF NOT EXISTS score_hots NUMERIC DEFAULT 0;

-- 2. Update update_chapter_progress RPC to compute and store these scores
CREATE OR REPLACE FUNCTION "public"."update_chapter_progress"("p_student_id" "uuid", "p_subject" "text", "p_grade" "text", "p_chapter_number" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE 
  v_chapter_id UUID; 
  v_unique_seen INTEGER := 0; 
  v_total_in_chapter INTEGER := 0; 
  v_pool_coverage REAL := 0; 
  v_is_completed BOOLEAN := false; 
  v_test_mode_unlocked BOOLEAN := false;
  
  v_remember_attempted INTEGER := 0;
  v_remember_correct INTEGER := 0;
  v_understand_attempted INTEGER := 0;
  v_understand_correct INTEGER := 0;
  v_apply_attempted INTEGER := 0;
  v_apply_correct INTEGER := 0;
  v_hots_attempted INTEGER := 0;
  v_hots_correct INTEGER := 0;

  v_score_remember NUMERIC := 0;
  v_score_understand NUMERIC := 0;
  v_score_apply NUMERIC := 0;
  v_score_hots NUMERIC := 0;

  v_attempted INTEGER := 0;
  v_correct INTEGER := 0;
  v_accuracy REAL := 0;
  v_assessed_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()) THEN 
    RAISE EXCEPTION 'Access denied'; 
  END IF;

  SELECT c.id INTO v_chapter_id 
  FROM chapters c 
  JOIN subjects s ON s.id = c.subject_id 
  WHERE s.code = p_subject AND c.grade = p_grade AND c.chapter_number = p_chapter_number AND c.is_active = true 
  LIMIT 1;

  IF v_chapter_id IS NULL THEN 
    RETURN; 
  END IF;

  SELECT COUNT(DISTINCT h.question_id) INTO v_unique_seen 
  FROM user_question_history h 
  WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade AND h.chapter_number = p_chapter_number;

  SELECT COUNT(*) INTO v_total_in_chapter 
  FROM question_bank qb 
  WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.chapter_number = p_chapter_number AND qb.is_active = true;

  -- Compute parameters from union of quiz_responses and adaptive_interactions
  WITH combined_responses AS (
    SELECT
      qr.is_correct,
      LOWER(TRIM(qr.bloom_level)) AS bloom_level
    FROM public.quiz_responses qr
    JOIN public.question_bank qb ON qb.id = qr.question_id
    WHERE qr.student_id = p_student_id 
      AND qb.subject = p_subject 
      AND qb.grade = p_grade 
      AND qb.chapter_number = p_chapter_number

    UNION ALL

    SELECT
      ai.is_correct,
      LOWER(TRIM(ai.bloom_level)) AS bloom_level
    FROM public.adaptive_interactions ai
    JOIN public.curriculum_topics ct ON ct.id = ai.topic_id
    JOIN public.subjects s ON s.id = ct.subject_id
    WHERE ai.student_id = p_student_id 
      AND s.code = p_subject 
      AND ct.grade = p_grade 
      AND ct.chapter_number = p_chapter_number
      AND ai.interaction_type = 'practice'
  )
  SELECT
    COALESCE(COUNT(CASE WHEN bloom_level = 'remember' THEN 1 END), 0),
    COALESCE(SUM(CASE WHEN bloom_level = 'remember' AND is_correct THEN 1 ELSE 0 END), 0),
    
    COALESCE(COUNT(CASE WHEN bloom_level = 'understand' THEN 1 END), 0),
    COALESCE(SUM(CASE WHEN bloom_level = 'understand' AND is_correct THEN 1 ELSE 0 END), 0),
    
    COALESCE(COUNT(CASE WHEN bloom_level = 'apply' THEN 1 END), 0),
    COALESCE(SUM(CASE WHEN bloom_level = 'apply' AND is_correct THEN 1 ELSE 0 END), 0),
    
    COALESCE(COUNT(CASE WHEN bloom_level IN ('analyze', 'evaluate', 'create', 'hots') THEN 1 END), 0),
    COALESCE(SUM(CASE WHEN bloom_level IN ('analyze', 'evaluate', 'create', 'hots') AND is_correct THEN 1 ELSE 0 END), 0)
  INTO
    v_remember_attempted, v_remember_correct,
    v_understand_attempted, v_understand_correct,
    v_apply_attempted, v_apply_correct,
    v_hots_attempted, v_hots_correct
  FROM combined_responses;

  IF v_remember_attempted > 0 THEN
    v_score_remember := ROUND((v_remember_correct::NUMERIC / v_remember_attempted) * 100, 1);
    v_assessed_count := v_assessed_count + 1;
  END IF;

  IF v_understand_attempted > 0 THEN
    v_score_understand := ROUND((v_understand_correct::NUMERIC / v_understand_attempted) * 100, 1);
    v_assessed_count := v_assessed_count + 1;
  END IF;

  IF v_apply_attempted > 0 THEN
    v_score_apply := ROUND((v_apply_correct::NUMERIC / v_apply_attempted) * 100, 1);
    v_assessed_count := v_assessed_count + 1;
  END IF;

  IF v_hots_attempted > 0 THEN
    v_score_hots := ROUND((v_hots_correct::NUMERIC / v_hots_attempted) * 100, 1);
    v_assessed_count := v_assessed_count + 1;
  END IF;

  v_attempted := v_remember_attempted + v_understand_attempted + v_apply_attempted + v_hots_attempted;
  v_correct := v_remember_correct + v_understand_correct + v_apply_correct + v_hots_correct;

  IF v_total_in_chapter > 0 THEN 
    v_pool_coverage := ROUND((v_unique_seen::REAL / v_total_in_chapter) * 100, 1); 
  END IF;

  IF v_attempted > 0 THEN 
    v_accuracy := ROUND((v_correct::REAL / v_attempted) * 100, 1); 
  END IF;

  -- Mark chapter complete: overall accuracy >= 60% AND at least 3 parameters assessed
  v_is_completed := (v_accuracy >= 60 AND v_assessed_count >= 3);
  v_test_mode_unlocked := v_is_completed;

  INSERT INTO chapter_progress (
    student_id, chapter_id, subject, grade, chapter_number, 
    questions_attempted, questions_correct, unique_questions_seen, 
    total_questions_in_chapter, pool_coverage_percent, accuracy_percent, 
    score_remember, score_understand, score_apply, score_hots,
    is_completed, test_mode_unlocked, completed_at, last_activity_at
  )
  VALUES (
    p_student_id, v_chapter_id, p_subject, p_grade, p_chapter_number, 
    v_attempted, v_correct, v_unique_seen, 
    v_total_in_chapter, v_pool_coverage, v_accuracy, 
    v_score_remember, v_score_understand, v_score_apply, v_score_hots,
    v_is_completed, v_test_mode_unlocked, CASE WHEN v_is_completed THEN now() ELSE NULL END, now()
  )
  ON CONFLICT (student_id, chapter_id) DO UPDATE SET 
    questions_attempted = EXCLUDED.questions_attempted, 
    questions_correct = EXCLUDED.questions_correct, 
    unique_questions_seen = EXCLUDED.unique_questions_seen, 
    total_questions_in_chapter = EXCLUDED.total_questions_in_chapter, 
    pool_coverage_percent = EXCLUDED.pool_coverage_percent, 
    accuracy_percent = EXCLUDED.accuracy_percent, 
    score_remember = EXCLUDED.score_remember,
    score_understand = EXCLUDED.score_understand,
    score_apply = EXCLUDED.score_apply,
    score_hots = EXCLUDED.score_hots,
    is_completed = EXCLUDED.is_completed, 
    test_mode_unlocked = EXCLUDED.test_mode_unlocked, 
    completed_at = CASE WHEN EXCLUDED.is_completed AND chapter_progress.completed_at IS NULL THEN now() ELSE chapter_progress.completed_at END, 
    last_activity_at = now();
END; $$;
