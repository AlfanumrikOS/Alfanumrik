-- Migration: 20260428000700_fix_irt_info_rpc_type.sql
-- Purpose: Fix select_questions_by_irt_info column type mismatch.
--
-- The original migration 20260428000600 declared `irt_difficulty NUMERIC`
-- in the RETURNS TABLE clause, but `question_bank.irt_difficulty` is
-- DOUBLE PRECISION (added in 20260408000007). PostgreSQL refuses to
-- coerce DOUBLE PRECISION → NUMERIC implicitly in RETURN QUERY rows,
-- so the RPC was failing on first call with SQLSTATE 42804.
--
-- Fix: cast irt_difficulty::NUMERIC inside the SELECT so the row shape
-- matches the declared return type. Keeping the RETURNS TABLE
-- declaration as NUMERIC means callers (TypeScript types) see a stable
-- numeric type; the cast is a no-op for the values we actually store.

CREATE OR REPLACE FUNCTION select_questions_by_irt_info(
  p_student_id      UUID,
  p_subject         TEXT,
  p_grade           TEXT,
  p_chapter_number  INT  DEFAULT NULL,
  p_match_count     INT  DEFAULT 5,
  p_exclude_ids     UUID[] DEFAULT '{}'::UUID[]
)
RETURNS TABLE (
  question_id        UUID,
  question_text      TEXT,
  options            JSONB,
  correct_answer_index INT,
  explanation        TEXT,
  difficulty         INT,
  bloom_level        TEXT,
  chapter_number     INT,
  irt_a              NUMERIC,
  irt_b              NUMERIC,
  irt_calibration_n  INT,
  irt_difficulty     NUMERIC,
  selection_score    NUMERIC,
  selection_path     TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $func$
DECLARE
  v_theta NUMERIC;
BEGIN
  SELECT COALESCE(AVG(theta), 0)
    INTO v_theta
    FROM student_skill_state
   WHERE student_id = p_student_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      qb.id,
      qb.question_text,
      qb.options,
      qb.correct_answer_index,
      qb.explanation,
      qb.difficulty,
      qb.bloom_level,
      qb.chapter_number,
      qb.irt_a,
      qb.irt_b,
      qb.irt_calibration_n,
      qb.irt_difficulty::NUMERIC AS irt_difficulty
    FROM question_bank qb
    WHERE qb.is_active = true
      AND qb.subject  = p_subject
      AND qb.grade    = p_grade
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (p_exclude_ids IS NULL OR NOT (qb.id = ANY(p_exclude_ids)))
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL THEN
          (c.irt_a * c.irt_a) *
          GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001) *
          (1.0 - GREATEST(LEAST(1.0 / (1.0 + exp(- (c.irt_a * (v_theta - c.irt_b)))), 0.999), 0.001))
          + 0.5
        WHEN c.irt_difficulty IS NOT NULL THEN
          1.0 / (1.0 + abs(v_theta - c.irt_difficulty))
        ELSE
          0.1
      END AS selection_score,
      CASE
        WHEN c.irt_calibration_n >= 30 AND c.irt_a IS NOT NULL AND c.irt_b IS NOT NULL
          THEN 'fisher_info'
        WHEN c.irt_difficulty IS NOT NULL
          THEN 'proxy_distance'
        ELSE 'uncalibrated'
      END AS selection_path
    FROM candidates c
  )
  SELECT
    s.id,
    s.question_text,
    s.options,
    s.correct_answer_index,
    s.explanation,
    s.difficulty,
    s.bloom_level,
    s.chapter_number,
    s.irt_a,
    s.irt_b,
    s.irt_calibration_n,
    s.irt_difficulty,
    s.selection_score,
    s.selection_path
  FROM scored s
  ORDER BY s.selection_score DESC, random()
  LIMIT p_match_count;
END;
$func$;
