-- ─── Phase 1.5: Wire 'ncert' picker into select_quiz_questions_{rag,v2} ────
--
-- Spec: docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md
--
-- Background:
--
-- QuizSetup has five question-type pickers: MCQ Only / Short Answer / Long
-- Answer / Mixed / NCERT Exercise. The first four send their selection
-- directly to the RPC's `p_question_types` array — those values match the
-- `chk_question_type_v2` enum (mcq | short_answer | long_answer |
-- assertion_reason | case_based) so the existing
--
--   qb.question_type_v2 = ANY(p_question_types)
--
-- filter works fine.
--
-- The NCERT Exercise picker sends `['ncert']` though — and 'ncert' is NOT a
-- valid question_type_v2 value. The filter never matches and the picker
-- always returns 0 rows. This was harmless when no non-MCQ content existed;
-- now that Phase 1 has promoted 494 NCERT-source rows (with
-- is_ncert=true, source_type='ncert_exercise', and question_type_v2 set
-- to short_answer / long_answer), the picker should fetch them.
--
-- Fix: widen the question-type filter to ALSO match `is_ncert = true` when
-- 'ncert' appears in p_question_types. Concretely:
--
--   (qb.question_type_v2 = ANY(p_question_types)
--    OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE))
--
-- This is backward compatible. Pickers that don't include 'ncert' behave
-- exactly as before. The 'ncert' picker now matches any NCERT-source row
-- regardless of its underlying question_type_v2 (SA, LA, or future MCQ).
--
-- Both RPCs use the same filter pattern in 4 places each (pool count,
-- seen count, history-reset, candidate pool). All four are updated.

BEGIN;

-- ─── 1. select_quiz_questions_rag ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[],
  p_query_embedding vector DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool   INTEGER;
  v_seen_count   INTEGER;
  v_result       JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id
    AND h.subject = p_subject
    AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  -- 80% pool reset
  IF v_total_pool > 0 AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  WITH seen_ids AS (
    SELECT h.question_id FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  candidate_pool AS (
    SELECT
      qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2,
      qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
      qb.difficulty, qb.bloom_level, qb.chapter_number,
      COALESCE(ch.title, qb.chapter_title) AS chapter_title,
      qb.concept_tag, qb.case_passage, qb.case_passage_hi,
      qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
      qb.is_ncert, qb.ncert_exercise,
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
      CASE
        WHEN p_query_embedding IS NOT NULL AND qb.embedding IS NOT NULL
        THEN 1 - (qb.embedding <=> p_query_embedding)
        ELSE random()
      END AS relevance_score,
      COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, relevance_score DESC, last_shown_at
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, relevance_score DESC) AS rn
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT * FROM numbered WHERE rn <= p_count
    ORDER BY CASE WHEN p_difficulty_mode = 'progressive' THEN
      CASE WHEN rn <= GREATEST(1,(p_count*0.3)::INTEGER) THEN difficulty
           WHEN rn <= GREATEST(2,(p_count*0.7)::INTEGER) THEN ABS(difficulty-2)
           ELSE ABS(difficulty-3) END
    ELSE rn END, rn
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'question_text', question_text, 'question_hi', question_hi,
    'question_type', COALESCE(question_type,'mcq'), 'question_type_v2', COALESCE(question_type_v2,'mcq'),
    'options', options, 'correct_answer_index', correct_answer_index,
    'explanation', explanation, 'explanation_hi', explanation_hi, 'hint', hint,
    'difficulty', difficulty, 'bloom_level', bloom_level, 'chapter_number', chapter_number,
    'chapter_title', chapter_title, 'concept_tag', concept_tag,
    'case_passage', case_passage, 'case_passage_hi', case_passage_hi,
    'expected_answer', expected_answer, 'expected_answer_hi', expected_answer_hi,
    'max_marks', max_marks, 'is_ncert', COALESCE(is_ncert, false), 'ncert_exercise', ncert_exercise
  ) ORDER BY rn) INTO v_result FROM selected;

  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER,
         now(), now(), 1
  FROM jsonb_array_elements(COALESCE(v_result,'[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(), times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.select_quiz_questions_rag IS
  'Phase 1.5 (2026-05-09): question-type filter widened so '
  '''ncert'' in p_question_types matches qb.is_ncert=TRUE rows of any '
  'question_type_v2. Other types behave as before.';

-- ─── 2. select_quiz_questions_v2 ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.select_quiz_questions_v2(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool INTEGER;
  v_seen_count INTEGER;
  v_result     JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN RETURN '[]'::jsonb; END IF;

  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  IF v_total_pool > 0 AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  WITH seen_ids AS (
    SELECT h.question_id FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  candidate_pool AS (
    SELECT qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2,
           qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
           qb.difficulty, qb.bloom_level, qb.chapter_number,
           COALESCE(ch.title, qb.chapter_title) AS chapter_title,
           qb.concept_tag, qb.case_passage, qb.case_passage_hi,
           qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
           qb.is_ncert, qb.ncert_exercise,
           CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
           CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
           COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at,
           random() AS rand_order
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, last_shown_at, rand_order
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, rand_order) AS rn
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT n.* FROM numbered n WHERE n.rn <= p_count
    ORDER BY CASE WHEN p_difficulty_mode = 'progressive'
                  THEN CASE WHEN n.rn <= GREATEST(1, (p_count * 0.3)::INTEGER) THEN n.difficulty
                            WHEN n.rn <= GREATEST(2, (p_count * 0.7)::INTEGER) THEN ABS(n.difficulty - 2)
                            ELSE ABS(n.difficulty - 3) END
                  ELSE n.rn
             END, n.rn
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', sel.id, 'question_text', sel.question_text, 'question_hi', sel.question_hi,
    'question_type', COALESCE(sel.question_type, 'mcq'),
    'question_type_v2', COALESCE(sel.question_type_v2, 'mcq'),
    'options', sel.options, 'correct_answer_index', sel.correct_answer_index,
    'explanation', sel.explanation, 'explanation_hi', sel.explanation_hi, 'hint', sel.hint,
    'difficulty', sel.difficulty, 'bloom_level', sel.bloom_level, 'chapter_number', sel.chapter_number,
    'chapter_title', sel.chapter_title, 'concept_tag', sel.concept_tag,
    'case_passage', sel.case_passage, 'case_passage_hi', sel.case_passage_hi,
    'expected_answer', sel.expected_answer, 'expected_answer_hi', sel.expected_answer_hi,
    'max_marks', sel.max_marks, 'is_ncert', COALESCE(sel.is_ncert, false),
    'ncert_exercise', sel.ncert_exercise
  ) ORDER BY sel.rn) INTO v_result FROM selected sel;

  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER,
         now(), now(), 1
  FROM jsonb_array_elements(COALESCE(v_result, '[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(), times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.select_quiz_questions_v2 IS
  'Phase 1.5 (2026-05-09): question-type filter widened so '
  '''ncert'' in p_question_types matches qb.is_ncert=TRUE rows of any '
  'question_type_v2. Other types behave as before.';

-- ─── 3. Audit ───────────────────────────────────────────────────────────────

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'quiz_serve.ncert_picker_wired',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'phase', 'phase_1.5_ncert_picker_wire_up',
    'rpcs', jsonb_build_array('select_quiz_questions_rag','select_quiz_questions_v2'),
    'change', '''ncert'' in p_question_types now matches is_ncert=TRUE rows',
    'spec', 'docs/superpowers/plans/2026-05-09-non-mcq-question-seeding.md'
  ),
  now()
);

COMMIT;
