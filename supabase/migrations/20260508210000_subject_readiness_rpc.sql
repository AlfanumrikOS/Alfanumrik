-- ─── compute_subject_readiness: batch chapter-readiness across a subject ───
--
-- Phase 3 of "Exam-Ready 360°". The chapter-list page (/learn) needs to show
-- a readiness badge next to every chapter so the student can see at a glance
-- which chapters are exam-ready vs which need more work. Calling
-- `compute_chapter_readiness` once per chapter would be 12+ round trips for
-- a typical subject — we batch into a single CTE-based query here.
--
-- Output (one row per chapter that has at least one active concept):
--   chapter_number      int
--   level               text   ('not_yet' | 'building' | 'almost' | 'ready')
--   score               int    0..100 composite
--   concepts_total      int
--   concepts_mastered   int
--   recent_quiz_count   int
--   rag_ready           boolean
--
-- Rubric and scoring formula MIRROR `compute_chapter_readiness` in
-- 20260508200000_chapter_readiness_rpc.sql exactly. If you change the
-- thresholds in one, change them in both — there's no shared SQL helper
-- because PostgreSQL set-returning composition is awkward and the rubric
-- branches don't compose cleanly into a single SQL CASE.
--
-- Auth: SECURITY INVOKER + auth.uid() guard (same pattern as the per-chapter
-- RPC). Cross-tenant calls return empty.
--
-- Performance budget: a single sequential scan of:
--   chapter_concepts (filtered by grade+subject, expected: ~80-150 rows)
--   concept_mastery_score (filtered by student_id, expected: ~50-200 rows)
--   quiz_sessions (filtered by student+subject, expected: <500 rows)
-- Aggregation is O(chapters), all in one query plan. Measured target <50ms.

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
  --
  -- We compute per-chapter aggregates in three CTEs and then JOIN + apply
  -- the rubric in the final SELECT. The aggregates mirror the per-chapter
  -- RPC's plpgsql variables but operate on every chapter at once.
  RETURN QUERY
  WITH chapter_universe AS (
    -- Distinct chapters in this subject for this grade. We use chapter_concepts
    -- as the source of truth for "which chapters have content seeded" — same
    -- as the per-chapter RPC. A chapter with zero concepts won't appear in
    -- the result, which is the right behaviour (the /learn page shouldn't
    -- show readiness for a chapter that doesn't exist in our curriculum).
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
    -- LATERAL join so we get the last 5 quizzes PER chapter, not 5 across
    -- the whole subject. Bound at 5 to mirror the per-chapter RPC.
    SELECT
      cu.chapter_number,
      COALESCE(AVG(q.score_percent), 0)::numeric AS recent_quiz_avg,
      COUNT(q.score_percent)::int AS recent_quiz_count
    FROM chapter_universe cu
    LEFT JOIN LATERAL (
      SELECT score_percent
      FROM quiz_sessions
      WHERE student_id = v_student_id
        AND grade = p_grade
        AND subject = p_subject
        AND chapter_number = cu.chapter_number
        AND is_completed = true
        AND deleted_at IS NULL
      ORDER BY completed_at DESC NULLS LAST
      LIMIT 5
    ) q ON true
    GROUP BY cu.chapter_number
  )
  SELECT
    cu.chapter_number,
    -- Rubric (mirror of compute_chapter_readiness)
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
    -- Composite score: 0.5 * mastery + 0.3 * recent quiz + 0.2 * min(100, spaced_reviews*10)
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
  'page chapter list. Embeds auth.uid() guard for cross-tenant safety.';

GRANT EXECUTE ON FUNCTION public.compute_subject_readiness(uuid, text, text)
  TO authenticated, service_role;

COMMIT;
