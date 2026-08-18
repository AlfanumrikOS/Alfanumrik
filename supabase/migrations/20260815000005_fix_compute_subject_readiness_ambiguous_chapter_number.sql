-- Migration: 20260815000005_fix_compute_subject_readiness_ambiguous_chapter_number.sql
-- Purpose: Fix a live P0 production defect in compute_subject_readiness — the
-- RPC behind GET /api/v1/subject-readiness, which backs THREE Alfa OS /learn
-- panels (SubjectHeader's readiness ring, NextStepCard, SubjectSkillTree's
-- chapter roadmap). All three render "Couldn't load ..." for every student,
-- every time, because the RPC itself raises a Postgres error before it can
-- return any row.
--
-- ROOT CAUSE (verified live against production via a direct service-role RPC
-- call, bypassing all RLS/RBAC — reproduces for every student unconditionally):
--
--   SELECT * FROM compute_subject_readiness('<any student>', '12', 'math');
--   → 42702 "column reference \"chapter_number\" is ambiguous — It could
--      refer to either a PL/pgSQL variable or a table column."
--
-- `compute_subject_readiness` RETURNS TABLE(chapter_number int, ...), which
-- PL/pgSQL implicitly binds as a variable named `chapter_number` in the
-- function's outer scope. Inside the `quiz_rollup` CTE's LATERAL subquery
-- (20260508210000_subject_readiness_rpc.sql lines ~110-121), the predicate
--
--     FROM quiz_sessions
--     WHERE ...
--       AND chapter_number = cu.chapter_number
--
-- references `chapter_number` UNQUALIFIED. `quiz_sessions` also has its own
-- `chapter_number` column, so Postgres cannot tell whether the LHS means
-- `quiz_sessions.chapter_number` or the RETURNS-TABLE OUT variable — hence
-- 42702. Every other `chapter_number` reference in the function is already
-- qualified (`cc.chapter_number`, `cu.chapter_number`) or resolved through a
-- `USING` join clause, which is why only this one LATERAL subquery is broken.
--
-- The sibling per-chapter RPC `compute_chapter_readiness`
-- (20260508200000_chapter_readiness_rpc.sql) does NOT have this defect — its
-- chapter is a scalar input parameter, not compared against a table column —
-- confirmed by a live, successful direct call during this incident's
-- investigation. No change needed there.
--
-- FIX: alias `quiz_sessions` and qualify the `chapter_number` reference (plus
-- the other bare columns in the same subquery, for the same reason and to
-- match the qualified style used everywhere else in this function). Purely a
-- qualification fix — no rubric, scoring, or output-shape change.
--
-- IDEMPOTENT: CREATE OR REPLACE of an existing function; no schema/RLS change.
-- Grants are unaffected (CREATE OR REPLACE preserves existing ACLs), but are
-- re-asserted below for parity with the defining migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_subject_readiness(
  p_student_id uuid,
  p_grade      text,
  p_subject    text
)
RETURNS TABLE (
  chapter_number    int,
  level             text,
  score             int,
  concepts_total    int,
  concepts_mastered int,
  recent_quiz_count int,
  rag_ready         boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  -- ── Student resolution with auth.uid() guard ───────────────────────────
  SELECT id INTO v_student_id
  FROM students
  WHERE (id = p_student_id OR auth_user_id = p_student_id)
    AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN;
  END IF;

  -- ── Batch readiness rollup ─────────────────────────────────────────────
  RETURN QUERY
  WITH chapter_universe AS (
    SELECT DISTINCT chapter_number
    FROM chapter_concepts
    WHERE grade = p_grade
      AND subject = p_subject
      AND is_active = true
  ),
  concept_rollup AS (
    SELECT
      cc.chapter_number,
      COUNT(*)::int AS concepts_total,
      COALESCE(AVG(cms.mastery_score), 0)::numeric AS mastery_avg,
      COALESCE(SUM(CASE WHEN cms.cbse_ready THEN 1 ELSE 0 END), 0)::int AS concepts_mastered,
      COALESCE(SUM(cms.recall_successes), 0)::int AS spaced_reviews
    FROM chapter_concepts cc
    LEFT JOIN concept_mastery_score cms
      ON cms.concept_code = cc.slug
     AND cms.student_id = v_student_id
    WHERE cc.grade = p_grade
      AND cc.subject = p_subject
      AND cc.is_active = true
    GROUP BY cc.chapter_number
  ),
  quiz_rollup AS (
    -- FIX (2026-08-15, P0): `quiz_sessions` is now aliased `qs` and every
    -- column reference inside the LATERAL subquery is qualified. The prior
    -- bare `chapter_number = cu.chapter_number` (and the other bare columns
    -- on the same lines) collided with the RETURNS-TABLE OUT variable
    -- `chapter_number`, raising 42702 on every call.
    SELECT
      cu.chapter_number,
      COALESCE(AVG(q.score_percent), 0)::numeric AS recent_quiz_avg,
      COUNT(q.score_percent)::int AS recent_quiz_count
    FROM chapter_universe cu
    LEFT JOIN LATERAL (
      SELECT qs.score_percent
      FROM quiz_sessions qs
      WHERE qs.student_id = v_student_id
        AND qs.grade = p_grade
        AND qs.subject = p_subject
        AND qs.chapter_number = cu.chapter_number
        AND qs.is_completed = true
        AND qs.deleted_at IS NULL
      ORDER BY qs.completed_at DESC NULLS LAST
      LIMIT 5
    ) q ON true
    GROUP BY cu.chapter_number
  )
  SELECT
    cu.chapter_number,
    CASE
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.85
       AND COALESCE(qr.recent_quiz_avg, 0) >= 80
       AND COALESCE(cr.spaced_reviews, 0) >= 3
        THEN 'ready'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.70
       AND COALESCE(qr.recent_quiz_avg, 0) >= 60
       AND COALESCE(cr.spaced_reviews, 0) >= 1
        THEN 'almost'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= 0.40
       AND COALESCE(qr.recent_quiz_count, 0) >= 1
        THEN 'building'
      ELSE 'not_yet'
    END AS level,
    LEAST(100, GREATEST(0, ROUND(
      0.50 * COALESCE(cr.mastery_avg, 0)
      + 0.30 * COALESCE(qr.recent_quiz_avg, 0)
      + 0.20 * LEAST(100, COALESCE(cr.spaced_reviews, 0) * 10)
    )::int))::int AS score,
    COALESCE(cr.concepts_total, 0) AS concepts_total,
    COALESCE(cr.concepts_mastered, 0) AS concepts_mastered,
    COALESCE(qr.recent_quiz_count, 0) AS recent_quiz_count,
    cbse_syllabus_rag_ready(p_grade, p_subject, cu.chapter_number) AS rag_ready
  FROM chapter_universe cu
  LEFT JOIN concept_rollup cr USING (chapter_number)
  LEFT JOIN quiz_rollup qr USING (chapter_number)
  ORDER BY cu.chapter_number;
END;
$$;

COMMENT ON FUNCTION public.compute_subject_readiness(uuid, text, text) IS
  'Batch per-chapter readiness across a subject (Exam-Ready 360° Phase 3). '
  'Returns one row per chapter with the same rubric as compute_chapter_readiness '
  'but in a single round-trip. Used by /api/v1/subject-readiness for the /learn '
  'page chapter list. Embeds auth.uid() guard for cross-tenant safety. '
  'Fixed 2026-08-15 (P0): qualified quiz_sessions column references inside the '
  'quiz_rollup LATERAL subquery — the previous bare chapter_number reference '
  'collided with the RETURNS TABLE OUT variable of the same name (42702 on '
  'every call, verified live in production).';

GRANT EXECUTE ON FUNCTION public.compute_subject_readiness(uuid, text, text)
  TO authenticated, service_role;

COMMIT;
