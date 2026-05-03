-- Migration: 20260403600000_quiz_rag_retrieval.sql
-- Purpose: Add Voyage embedding column to question_bank and create RAG-based quiz selection RPC

-- A. Add embedding column to question_bank (1024 dimensions, matching existing RAG infrastructure)
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN embedding vector(1024);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add embedded_at timestamp to track when embedding was generated
DO $$ BEGIN
  ALTER TABLE question_bank ADD COLUMN embedded_at TIMESTAMPTZ DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- B. IVFFlat index for cosine similarity search (matching rag_content_chunks pattern)
-- lists=50 is appropriate for question_bank size
CREATE INDEX IF NOT EXISTS idx_qb_embedding
  ON question_bank USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL AND is_active = true;

-- C. RAG-based quiz selection RPC
-- SECURITY DEFINER: Required because this RPC reads across student history tables
-- and writes to user_question_history. The caller is verified via auth.uid() check
-- against the students table before any data access.
CREATE OR REPLACE FUNCTION select_quiz_questions_rag(
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_chapter_number INTEGER DEFAULT NULL,
  p_count INTEGER DEFAULT 10,
  p_difficulty_mode TEXT DEFAULT 'mixed',
  p_question_types TEXT[] DEFAULT '{mcq}',
  p_query_embedding vector(1024) DEFAULT NULL
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

  -- 1. Count total pool
  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND qb.question_type_v2 = ANY(p_question_types);

  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 2. Count seen questions
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

  -- 3. 80% pool reset
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

  -- 4. Select questions using RAG vector similarity (with fallback to random)
  WITH seen_ids AS (
    SELECT h.question_id
    FROM user_question_history h
    WHERE h.student_id = p_student_id
      AND h.subject = p_subject
      AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
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
      -- Seen ranking: unseen first (0), then seen (1)
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      -- NCERT priority
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
      -- RAG similarity score (higher = more relevant)
      -- When embedding is available, use cosine similarity; otherwise use random
      CASE
        WHEN p_query_embedding IS NOT NULL AND qb.embedding IS NOT NULL
        THEN 1 - (qb.embedding <=> p_query_embedding)
        ELSE random()
      END AS relevance_score,
      COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at
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
      AND (
        p_difficulty_mode = 'mixed'
        OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    -- Primary: unseen first, then NCERT, then by RAG relevance (not random)
    ORDER BY seen_rank, ncert_rank, relevance_score DESC, last_shown_at
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT
      cp.*,
      ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, relevance_score DESC) AS rn,
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
            WHEN n.rn <= GREATEST(1, (p_count * 0.3)::INTEGER) THEN n.difficulty
            WHEN n.rn <= GREATEST(2, (p_count * 0.7)::INTEGER) THEN ABS(n.difficulty - 2)
            ELSE ABS(n.difficulty - 3)
          END
        ELSE n.rn
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

  -- Record selected questions in history
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
