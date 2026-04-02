-- ============================================================================
-- Migration: 20260402130001_quiz_qa_rpcs.sql
-- Purpose: Quiz system redesign part 2 — RPC functions for question selection,
--          chapter progress, exam paper generation, and NCERT coverage reporting.
-- Depends on: 20260402130000_quiz_qa_redesign.sql (tables, indexes, seed data)
-- ============================================================================


-- ============================================================================
-- 1. select_quiz_questions_v2
--    Core question selection RPC with seen-question tracking, NCERT priority,
--    difficulty modes, and 80% pool reset.
-- SECURITY DEFINER: Required because this function must INSERT/UPDATE/DELETE
-- user_question_history rows on behalf of the calling student, and the
-- question_bank read requires bypassing per-student RLS filters.
-- ============================================================================

CREATE OR REPLACE FUNCTION select_quiz_questions_v2(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_chapter_number INTEGER DEFAULT NULL,
  p_count INTEGER DEFAULT 10,
  p_difficulty_mode TEXT DEFAULT 'mixed',
  p_question_types TEXT[] DEFAULT '{mcq}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_pool   INTEGER;
  v_seen_count   INTEGER;
  v_result       JSONB;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- 1. Count total pool: active questions matching scope
  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND qb.question_type_v2 = ANY(p_question_types);

  -- If no questions available at all, return empty array
  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 2. Count seen questions in this scope
  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id
    AND h.subject = p_subject
    AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject
        AND qb.grade = p_grade
        AND qb.is_active = true
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND qb.question_type_v2 = ANY(p_question_types)
    );

  -- 3. If seen/total >= 80%, reset history for this scope to recycle questions
  IF v_total_pool > 0 AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id
      AND h.subject = p_subject
      AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject
          AND qb.grade = p_grade
          AND qb.is_active = true
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND qb.question_type_v2 = ANY(p_question_types)
      );
    v_seen_count := 0;
  END IF;

  -- 4-11. Select questions with NCERT priority, difficulty, and seen-avoidance
  WITH seen_ids AS (
    SELECT h.question_id
    FROM user_question_history h
    WHERE h.student_id = p_student_id
      AND h.subject = p_subject
      AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  -- Unseen questions first, then least-recently-seen as fallback
  candidate_pool AS (
    SELECT
      qb.id,
      qb.question_text,
      qb.question_hi,
      qb.question_type,
      qb.question_type_v2,
      qb.options,
      qb.correct_answer_index,
      qb.explanation,
      qb.explanation_hi,
      qb.hint,
      qb.difficulty,
      qb.bloom_level,
      qb.chapter_number,
      COALESCE(ch.title, qb.chapter_title) AS chapter_title,
      qb.concept_tag,
      qb.case_passage,
      qb.case_passage_hi,
      qb.expected_answer,
      qb.expected_answer_hi,
      qb.max_marks,
      qb.is_ncert,
      qb.ncert_exercise,
      -- Scoring: unseen first (0), then by recency (1)
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      -- NCERT questions first
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
      -- For fallback: order seen questions by least recently shown
      COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at,
      random() AS rand_order
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h
      ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch
      ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject
      AND qb.grade = p_grade
      AND qb.is_active = true
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND qb.question_type_v2 = ANY(p_question_types)
      -- Difficulty filter for non-mixed modes
      AND (
        p_difficulty_mode = 'mixed'
        OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, last_shown_at, rand_order
    LIMIT p_count * 3  -- Overfetch for progressive mode selection
  ),
  -- For progressive mode: assign difficulty tiers using row numbering
  numbered AS (
    SELECT
      cp.*,
      ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, rand_order) AS rn,
      COUNT(*) OVER () AS total_candidates
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT
      n.id,
      n.question_text,
      n.question_hi,
      n.question_type,
      n.question_type_v2,
      n.options,
      n.correct_answer_index,
      n.explanation,
      n.explanation_hi,
      n.hint,
      n.difficulty,
      n.bloom_level,
      n.chapter_number,
      n.chapter_title,
      n.concept_tag,
      n.case_passage,
      n.case_passage_hi,
      n.expected_answer,
      n.expected_answer_hi,
      n.max_marks,
      n.is_ncert,
      n.ncert_exercise,
      n.rn
    FROM numbered n
    WHERE n.rn <= p_count
    ORDER BY
      CASE
        WHEN p_difficulty_mode = 'progressive' THEN
          CASE
            -- First 30% → prefer difficulty 1
            WHEN n.rn <= GREATEST(1, (p_count * 0.3)::INTEGER) THEN n.difficulty
            -- Next 40% → prefer difficulty 2
            WHEN n.rn <= GREATEST(2, (p_count * 0.7)::INTEGER) THEN ABS(n.difficulty - 2)
            -- Last 30% → prefer difficulty 3
            ELSE ABS(n.difficulty - 3)
          END
        ELSE n.rn  -- Keep existing order for other modes
      END,
      n.rn
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sel.id,
      'question_text', sel.question_text,
      'question_hi', sel.question_hi,
      'question_type', COALESCE(sel.question_type, 'mcq'),
      'question_type_v2', COALESCE(sel.question_type_v2, 'mcq'),
      'options', sel.options,
      'correct_answer_index', sel.correct_answer_index,
      'explanation', sel.explanation,
      'explanation_hi', sel.explanation_hi,
      'hint', sel.hint,
      'difficulty', sel.difficulty,
      'bloom_level', sel.bloom_level,
      'chapter_number', sel.chapter_number,
      'chapter_title', sel.chapter_title,
      'concept_tag', sel.concept_tag,
      'case_passage', sel.case_passage,
      'case_passage_hi', sel.case_passage_hi,
      'expected_answer', sel.expected_answer,
      'expected_answer_hi', sel.expected_answer_hi,
      'max_marks', sel.max_marks,
      'is_ncert', COALESCE(sel.is_ncert, false),
      'ncert_exercise', sel.ncert_exercise
    )
    ORDER BY sel.rn
  ) INTO v_result
  FROM selected sel;

  -- 12. Record selected questions in user_question_history
  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT
    p_student_id,
    (q->>'id')::UUID,
    p_subject,
    p_grade,
    (q->>'chapter_number')::INTEGER,
    now(),
    now(),
    1
  FROM jsonb_array_elements(COALESCE(v_result, '[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(),
    times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ============================================================================
-- 2. get_chapter_progress
--    Returns per-chapter progress for a student in a given subject+grade.
-- SECURITY DEFINER: Required to read across chapters, question_bank, and
-- concept_mastery tables joining data that spans multiple RLS-protected tables.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_chapter_progress(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller owns this student or is a linked parent/teacher
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM guardian_student_links
    WHERE student_id = p_student_id
      AND guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
      AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH chapter_list AS (
    SELECT
      c.id AS chapter_id,
      c.chapter_number,
      c.title,
      c.title_hi,
      c.total_questions
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    WHERE s.code = p_subject
      AND c.grade = p_grade
      AND c.is_active = true
    ORDER BY c.chapter_number
  ),
  history_stats AS (
    SELECT
      h.chapter_number,
      COUNT(DISTINCT h.question_id) AS unique_seen,
      COUNT(DISTINCT CASE WHEN h.last_result = true THEN h.question_id END) AS correct_count,
      COUNT(DISTINCT h.question_id) FILTER (WHERE h.last_result IS NOT NULL) AS attempted
    FROM user_question_history h
    WHERE h.student_id = p_student_id
      AND h.subject = p_subject
      AND h.grade = p_grade
    GROUP BY h.chapter_number
  ),
  topic_stats AS (
    SELECT
      cl.chapter_number,
      COUNT(ct.id) AS total_concepts,
      COUNT(cm.student_id) FILTER (WHERE cm.mastery_level >= 0.7) AS concepts_mastered,
      COUNT(cm.student_id) FILTER (WHERE cm.mastery_level > 0) AS concepts_attempted
    FROM chapter_list cl
    JOIN chapter_topics ct ON ct.chapter_id = cl.chapter_id AND ct.is_active = true
    LEFT JOIN concept_mastery cm
      ON cm.topic_tag = ct.concept_tag AND cm.student_id = p_student_id
    GROUP BY cl.chapter_number
  ),
  progress_data AS (
    SELECT
      cl.chapter_id,
      cl.chapter_number,
      cl.title,
      cl.title_hi,
      -- Use existing chapter_progress if available, else calculate from history
      COALESCE(cp.questions_attempted, hs.attempted, 0) AS questions_attempted,
      COALESCE(cp.questions_correct, hs.correct_count, 0) AS questions_correct,
      COALESCE(cp.unique_questions_seen, hs.unique_seen, 0) AS unique_questions_seen,
      GREATEST(COALESCE(cp.total_questions_in_chapter, cl.total_questions), 1) AS total_questions_in_chapter,
      -- Pool coverage
      CASE
        WHEN GREATEST(COALESCE(cp.total_questions_in_chapter, cl.total_questions), 1) > 0
        THEN ROUND(
          (COALESCE(cp.unique_questions_seen, hs.unique_seen, 0)::REAL /
           GREATEST(COALESCE(cp.total_questions_in_chapter, cl.total_questions), 1)) * 100, 1
        )
        ELSE 0
      END AS pool_coverage_percent,
      -- Accuracy
      CASE
        WHEN COALESCE(cp.questions_attempted, hs.attempted, 0) > 0
        THEN ROUND(
          (COALESCE(cp.questions_correct, hs.correct_count, 0)::REAL /
           COALESCE(cp.questions_attempted, hs.attempted, 1)) * 100, 1
        )
        ELSE 0
      END AS accuracy_percent,
      COALESCE(ts.concepts_attempted, 0) AS concepts_attempted,
      COALESCE(ts.concepts_mastered, 0) AS concepts_mastered,
      COALESCE(ts.total_concepts, 0) AS total_concepts,
      cp.is_completed,
      cp.test_mode_unlocked,
      cp.completed_at,
      cp.last_activity_at
    FROM chapter_list cl
    LEFT JOIN chapter_progress cp
      ON cp.student_id = p_student_id AND cp.chapter_id = cl.chapter_id
    LEFT JOIN history_stats hs ON hs.chapter_number = cl.chapter_number
    LEFT JOIN topic_stats ts ON ts.chapter_number = cl.chapter_number
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'chapter_id', pd.chapter_id,
      'chapter_number', pd.chapter_number,
      'title', pd.title,
      'title_hi', pd.title_hi,
      'questions_attempted', pd.questions_attempted,
      'questions_correct', pd.questions_correct,
      'unique_questions_seen', pd.unique_questions_seen,
      'total_questions_in_chapter', pd.total_questions_in_chapter,
      'pool_coverage_percent', pd.pool_coverage_percent,
      'accuracy_percent', pd.accuracy_percent,
      'concepts_attempted', pd.concepts_attempted,
      'concepts_mastered', pd.concepts_mastered,
      'total_concepts', pd.total_concepts,
      'is_completed', COALESCE(pd.is_completed,
        (pd.pool_coverage_percent >= 80
         AND pd.accuracy_percent >= 60
         AND (pd.total_concepts = 0 OR (pd.concepts_mastered::REAL / GREATEST(pd.total_concepts, 1)) * 100 >= 70))
      ),
      'test_mode_unlocked', COALESCE(pd.test_mode_unlocked,
        (pd.pool_coverage_percent >= 80
         AND pd.accuracy_percent >= 60
         AND (pd.total_concepts = 0 OR (pd.concepts_mastered::REAL / GREATEST(pd.total_concepts, 1)) * 100 >= 70))
        OR (pd.total_concepts > 0 AND (pd.concepts_mastered::REAL / GREATEST(pd.total_concepts, 1)) * 100 >= 70)
      ),
      'completed_at', pd.completed_at,
      'last_activity_at', pd.last_activity_at
    )
    ORDER BY pd.chapter_number
  ) INTO v_result
  FROM progress_data pd;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ============================================================================
-- 3. update_chapter_progress
--    Recalculates and UPSERTs a single chapter_progress row.
-- SECURITY DEFINER: Required to read user_question_history, question_bank,
-- chapter_topics, and concept_mastery across RLS boundaries for aggregation,
-- and to UPSERT into chapter_progress.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_chapter_progress(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_chapter_number INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chapter_id            UUID;
  v_unique_seen           INTEGER := 0;
  v_total_in_chapter      INTEGER := 0;
  v_attempted             INTEGER := 0;
  v_correct               INTEGER := 0;
  v_pool_coverage         REAL := 0;
  v_accuracy              REAL := 0;
  v_total_concepts        INTEGER := 0;
  v_concepts_mastered     INTEGER := 0;
  v_concepts_attempted    INTEGER := 0;
  v_concept_mastery_pct   REAL := 0;
  v_is_completed          BOOLEAN := false;
  v_test_mode_unlocked    BOOLEAN := false;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Resolve chapter_id
  SELECT c.id INTO v_chapter_id
  FROM chapters c
  JOIN subjects s ON s.id = c.subject_id
  WHERE s.code = p_subject
    AND c.grade = p_grade
    AND c.chapter_number = p_chapter_number
    AND c.is_active = true
  LIMIT 1;

  IF v_chapter_id IS NULL THEN
    -- No matching chapter; nothing to update
    RETURN;
  END IF;

  -- Count unique questions seen from user_question_history
  SELECT COUNT(DISTINCT h.question_id) INTO v_unique_seen
  FROM user_question_history h
  WHERE h.student_id = p_student_id
    AND h.subject = p_subject
    AND h.grade = p_grade
    AND h.chapter_number = p_chapter_number;

  -- Count total questions in chapter from question_bank
  SELECT COUNT(*) INTO v_total_in_chapter
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.chapter_number = p_chapter_number
    AND qb.is_active = true;

  -- Calculate accuracy from quiz_responses for questions in this chapter
  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN qr.is_correct THEN 1 ELSE 0 END), 0)
  INTO v_attempted, v_correct
  FROM quiz_responses qr
  JOIN question_bank qb ON qb.id = qr.question_id
  WHERE qr.student_id = p_student_id
    AND qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.chapter_number = p_chapter_number;

  -- Pool coverage
  IF v_total_in_chapter > 0 THEN
    v_pool_coverage := ROUND((v_unique_seen::REAL / v_total_in_chapter) * 100, 1);
  END IF;

  -- Accuracy
  IF v_attempted > 0 THEN
    v_accuracy := ROUND((v_correct::REAL / v_attempted) * 100, 1);
  END IF;

  -- Count concepts from chapter_topics, mastered from concept_mastery
  SELECT
    COUNT(ct.id),
    COUNT(cm.student_id) FILTER (WHERE cm.mastery_level >= 0.7),
    COUNT(cm.student_id) FILTER (WHERE cm.mastery_level > 0)
  INTO v_total_concepts, v_concepts_mastered, v_concepts_attempted
  FROM chapter_topics ct
  LEFT JOIN concept_mastery cm
    ON cm.topic_tag = ct.concept_tag AND cm.student_id = p_student_id
  WHERE ct.chapter_id = v_chapter_id
    AND ct.is_active = true;

  -- Concept mastery percentage
  IF v_total_concepts > 0 THEN
    v_concept_mastery_pct := (v_concepts_mastered::REAL / v_total_concepts) * 100;
  END IF;

  -- Completion rules:
  -- is_completed = pool >= 80% AND accuracy >= 60% AND concept_coverage >= 70%
  v_is_completed := (
    v_pool_coverage >= 80
    AND v_accuracy >= 60
    AND (v_total_concepts = 0 OR v_concept_mastery_pct >= 70)
  );

  -- test_mode_unlocked = is_completed OR concept_mastery_pct >= 70
  v_test_mode_unlocked := v_is_completed OR (v_total_concepts > 0 AND v_concept_mastery_pct >= 70);

  -- UPSERT into chapter_progress
  INSERT INTO chapter_progress (
    student_id, chapter_id, subject, grade, chapter_number,
    questions_attempted, questions_correct,
    unique_questions_seen, total_questions_in_chapter,
    pool_coverage_percent, accuracy_percent,
    concepts_attempted, concepts_mastered, total_concepts,
    is_completed, test_mode_unlocked,
    completed_at, last_activity_at
  ) VALUES (
    p_student_id, v_chapter_id, p_subject, p_grade, p_chapter_number,
    v_attempted, v_correct,
    v_unique_seen, v_total_in_chapter,
    v_pool_coverage, v_accuracy,
    v_concepts_attempted, v_concepts_mastered, v_total_concepts,
    v_is_completed, v_test_mode_unlocked,
    CASE WHEN v_is_completed THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (student_id, chapter_id) DO UPDATE SET
    questions_attempted = EXCLUDED.questions_attempted,
    questions_correct = EXCLUDED.questions_correct,
    unique_questions_seen = EXCLUDED.unique_questions_seen,
    total_questions_in_chapter = EXCLUDED.total_questions_in_chapter,
    pool_coverage_percent = EXCLUDED.pool_coverage_percent,
    accuracy_percent = EXCLUDED.accuracy_percent,
    concepts_attempted = EXCLUDED.concepts_attempted,
    concepts_mastered = EXCLUDED.concepts_mastered,
    total_concepts = EXCLUDED.total_concepts,
    is_completed = EXCLUDED.is_completed,
    test_mode_unlocked = EXCLUDED.test_mode_unlocked,
    completed_at = CASE
      WHEN EXCLUDED.is_completed AND chapter_progress.completed_at IS NULL THEN now()
      WHEN NOT EXCLUDED.is_completed THEN NULL
      ELSE chapter_progress.completed_at
    END,
    last_activity_at = now();
END;
$$;


-- ============================================================================
-- 4. generate_exam_paper
--    Generates a structured exam paper from templates with section-wise
--    question selection, seen-question avoidance, and history tracking.
-- SECURITY DEFINER: Required to read exam_paper_templates, question_bank,
-- and user_question_history across RLS boundaries and to write history.
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_exam_paper(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_chapters INTEGER[] DEFAULT NULL,
  p_template_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template        RECORD;
  v_sections        JSONB;
  v_section         JSONB;
  v_section_result  JSONB;
  v_all_sections    JSONB := '[]'::jsonb;
  v_questions       JSONB;
  v_i               INTEGER;
  v_section_type    TEXT;
  v_section_count   INTEGER;
  v_section_name    TEXT;
  v_section_name_hi TEXT;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Get template: by ID or first matching grade
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_template
    FROM exam_paper_templates
    WHERE id = p_template_id AND is_active = true;
  ELSE
    SELECT * INTO v_template
    FROM exam_paper_templates
    WHERE grade = p_grade AND is_active = true
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_template IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'No exam template found for grade ' || p_grade
    );
  END IF;

  v_sections := v_template.sections;

  -- Iterate over each section in the template
  FOR v_i IN 0 .. jsonb_array_length(v_sections) - 1 LOOP
    v_section := v_sections -> v_i;
    v_section_type := v_section ->> 'question_type';
    v_section_count := (v_section ->> 'total_questions')::INTEGER;
    v_section_name := v_section ->> 'name';
    v_section_name_hi := v_section ->> 'name_hi';

    -- Select questions for this section:
    -- Prioritize unseen, then least-recently-seen as fallback
    -- Filter by question_type_v2 and optionally by chapters
    WITH seen_ids AS (
      SELECT h.question_id, h.last_shown_at
      FROM user_question_history h
      WHERE h.student_id = p_student_id
        AND h.subject = p_subject
        AND h.grade = p_grade
    ),
    section_questions AS (
      SELECT
        qb.id,
        qb.question_text,
        qb.question_hi,
        qb.question_type,
        qb.question_type_v2,
        qb.options,
        qb.correct_answer_index,
        qb.explanation,
        qb.explanation_hi,
        qb.hint,
        qb.difficulty,
        qb.bloom_level,
        qb.chapter_number,
        qb.concept_tag,
        qb.case_passage,
        qb.case_passage_hi,
        qb.expected_answer,
        qb.expected_answer_hi,
        qb.max_marks,
        qb.is_ncert,
        qb.ncert_exercise,
        CASE WHEN si.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
        COALESCE(si.last_shown_at, '1970-01-01'::timestamptz) AS last_shown
      FROM question_bank qb
      LEFT JOIN seen_ids si ON si.question_id = qb.id
      WHERE qb.subject = p_subject
        AND qb.grade = p_grade
        AND qb.is_active = true
        AND qb.question_type_v2 = v_section_type
        AND (p_chapters IS NULL OR qb.chapter_number = ANY(p_chapters))
      ORDER BY seen_rank, last_shown, random()
      LIMIT v_section_count
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', sq.id,
        'question_text', sq.question_text,
        'question_hi', sq.question_hi,
        'question_type', COALESCE(sq.question_type, 'mcq'),
        'question_type_v2', COALESCE(sq.question_type_v2, 'mcq'),
        'options', sq.options,
        'correct_answer_index', sq.correct_answer_index,
        'explanation', sq.explanation,
        'explanation_hi', sq.explanation_hi,
        'hint', sq.hint,
        'difficulty', sq.difficulty,
        'bloom_level', sq.bloom_level,
        'chapter_number', sq.chapter_number,
        'concept_tag', sq.concept_tag,
        'case_passage', sq.case_passage,
        'case_passage_hi', sq.case_passage_hi,
        'expected_answer', sq.expected_answer,
        'expected_answer_hi', sq.expected_answer_hi,
        'max_marks', COALESCE(sq.max_marks, (v_section ->> 'marks_per_question')::INTEGER),
        'is_ncert', COALESCE(sq.is_ncert, false),
        'ncert_exercise', sq.ncert_exercise
      )
    ) INTO v_questions
    FROM section_questions sq;

    -- Record these questions in user_question_history
    INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                       first_shown_at, last_shown_at, times_shown)
    SELECT
      p_student_id,
      (q->>'id')::UUID,
      p_subject,
      p_grade,
      (q->>'chapter_number')::INTEGER,
      now(),
      now(),
      1
    FROM jsonb_array_elements(COALESCE(v_questions, '[]'::jsonb)) AS q
    ON CONFLICT (student_id, question_id) DO UPDATE SET
      last_shown_at = now(),
      times_shown = user_question_history.times_shown + 1;

    -- Build section result
    v_section_result := jsonb_build_object(
      'name', v_section_name,
      'name_hi', v_section_name_hi,
      'question_type', v_section_type,
      'marks_per_question', (v_section ->> 'marks_per_question')::INTEGER,
      'total_questions', (v_section ->> 'total_questions')::INTEGER,
      'attempt_questions', (v_section ->> 'attempt_questions')::INTEGER,
      'instructions', v_section ->> 'instructions',
      'instructions_hi', v_section ->> 'instructions_hi',
      'questions', COALESCE(v_questions, '[]'::jsonb)
    );

    v_all_sections := v_all_sections || jsonb_build_array(v_section_result);
  END LOOP;

  RETURN jsonb_build_object(
    'template_id', v_template.id,
    'template_name', v_template.name,
    'template_name_hi', v_template.name_hi,
    'total_marks', v_template.total_marks,
    'duration_minutes', v_template.duration_minutes,
    'board', v_template.board,
    'sections', v_all_sections
  );
END;
$$;


-- ============================================================================
-- 5. get_ncert_coverage_report
--    Admin/reference data: NCERT question coverage per chapter.
--    No student_id needed. No SECURITY DEFINER needed for read-only reference
--    data, but we use it to ensure consistent access to question_bank.
-- SECURITY DEFINER: Required to query question_bank and chapters without
-- relying on caller's RLS context for this admin/reference report.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ncert_coverage_report(
  p_grade TEXT,
  p_subject TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH chapter_coverage AS (
    SELECT
      c.id AS chapter_id,
      c.chapter_number,
      c.title,
      c.title_hi,
      s.code AS subject_code,
      s.name AS subject_name,
      COUNT(qb.id) AS total_questions,
      COUNT(qb.id) FILTER (WHERE qb.is_ncert = true) AS ncert_questions,
      COUNT(qb.id) FILTER (WHERE qb.is_ncert = true AND qb.ncert_exercise IS NOT NULL) AS ncert_with_exercise,
      CASE
        WHEN COUNT(qb.id) FILTER (WHERE qb.is_ncert = true) > 0 THEN 'complete'
        ELSE 'missing'
      END AS ncert_status
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    LEFT JOIN question_bank qb
      ON qb.subject = s.code
      AND qb.grade = c.grade
      AND qb.chapter_number = c.chapter_number
      AND qb.is_active = true
    WHERE c.grade = p_grade
      AND c.is_active = true
      AND (p_subject IS NULL OR s.code = p_subject)
    GROUP BY c.id, c.chapter_number, c.title, c.title_hi, s.code, s.name
    ORDER BY s.code, c.chapter_number
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'chapter_id', cc.chapter_id,
      'chapter_number', cc.chapter_number,
      'title', cc.title,
      'title_hi', cc.title_hi,
      'subject_code', cc.subject_code,
      'subject_name', cc.subject_name,
      'total_questions', cc.total_questions,
      'ncert_questions', cc.ncert_questions,
      'ncert_with_exercise', cc.ncert_with_exercise,
      'ncert_status', cc.ncert_status,
      'ncert_coverage_percent', CASE
        WHEN cc.total_questions > 0
        THEN ROUND((cc.ncert_questions::REAL / cc.total_questions) * 100, 1)
        ELSE 0
      END
    )
    ORDER BY cc.subject_code, cc.chapter_number
  ) INTO v_result
  FROM chapter_coverage cc;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


-- ============================================================================
-- End of migration: 20260402130001_quiz_qa_rpcs.sql
-- Functions created:
--   1. select_quiz_questions_v2  — core question selection with seen tracking
--   2. get_chapter_progress      — per-chapter progress for student
--   3. update_chapter_progress   — recalculate and upsert chapter progress
--   4. generate_exam_paper       — CBSE exam paper from templates
--   5. get_ncert_coverage_report — NCERT coverage admin report
-- ============================================================================
