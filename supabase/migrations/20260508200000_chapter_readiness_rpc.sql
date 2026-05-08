-- ─── compute_chapter_readiness: per-chapter exam-ready signal ──────────────
--
-- Phase 1 of the "Exam-Ready 360°" pedagogy build. Closes the question
-- "am I ready for the Ch.4 test?" with a multi-dimensional rubric that
-- aggregates the cognitive-engine signals already in production:
--
--   • concept_mastery_score.mastery_score  -- BKT-driven 0..100
--   • concept_mastery_score.cbse_ready     -- per-concept demonstrated competency
--   • concept_mastery_score.recall_successes -- spaced-repetition retention
--   • quiz_sessions.score_percent           -- last 5 attempts on the chapter
--   • cbse_syllabus.rag_status              -- can Foxy actually help on this chapter?
--
-- Output is a single-row TABLE with:
--   level         text  -- 'not_yet' | 'building' | 'almost' | 'ready'
--   score         int   -- 0..100 numeric, weighted composite
--   mastery_avg   numeric
--   concepts_total int
--   concepts_mastered int  -- count where cbse_ready = true
--   recent_quiz_avg numeric
--   recent_quiz_count int
--   spaced_reviews int
--   rag_ready     boolean -- whether Foxy can ground answers on this chapter
--   next_action   text
--   message_en    text
--   message_hi    text
--
-- Rubric (matches standard CBSE "demonstrated mastery" + spaced-repetition
-- consolidation literature; thresholds owned by product, tunable here):
--
--   ready    : concepts_mastered/concepts_total >= 0.85
--              AND recent_quiz_avg >= 80
--              AND spaced_reviews >= 3
--   almost   : concepts_mastered/concepts_total >= 0.70
--              AND recent_quiz_avg >= 60
--              AND spaced_reviews >= 1
--   building : concepts_mastered/concepts_total >= 0.40
--              AND recent_quiz_count >= 1
--   not_yet  : everything else (including zero data)
--
-- Composite score (0..100):
--   0.50 * mastery_avg
--   + 0.30 * recent_quiz_avg
--   + 0.20 * min(100, spaced_reviews * 10)
--
-- Auth: SECURITY INVOKER so caller RLS applies. The function additionally
-- embeds an auth.uid() guard in the student resolution so a logged-in
-- student cannot read another student's chapter readiness even if a future
-- RLS regression on concept_mastery_score / quiz_sessions occurred. Service
-- role (auth.uid() IS NULL) skips the guard for admin/dashboard reads.
--
-- P5 contract: grades are TEXT '6' through '12' throughout. Chapter number
-- is INT to match chapter_concepts / quiz_sessions / cbse_syllabus.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_chapter_readiness(
  p_student_id  uuid,
  p_grade       text,
  p_subject     text,
  p_chapter_number int
)
RETURNS TABLE (
  level             text,
  score             int,
  mastery_avg       numeric,
  concepts_total    int,
  concepts_mastered int,
  recent_quiz_avg   numeric,
  recent_quiz_count int,
  spaced_reviews    int,
  rag_ready         boolean,
  next_action       text,
  message_en        text,
  message_hi        text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_student_id      uuid;
  v_concepts_total  int;
  v_concepts_mastered int;
  v_mastery_avg     numeric;
  v_spaced_reviews  int;
  v_recent_avg      numeric;
  v_recent_count    int;
  v_rag_ready       boolean;
  v_score           int;
  v_level           text;
  v_next_action     text;
  v_msg_en          text;
  v_msg_hi          text;
  v_mastered_ratio  numeric;
BEGIN
  -- ── Student resolution with auth.uid() guard ────────────────────────────
  -- Accept either students.id or students.auth_user_id (legacy + v2 callers
  -- diverge). The auth.uid() guard ensures cross-tenant calls return empty.
  SELECT id INTO v_student_id
  FROM students
  WHERE (id = p_student_id OR auth_user_id = p_student_id)
    AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN; -- empty resultset; caller cannot distinguish "no student" from "wrong caller"
  END IF;

  -- ── Total concepts in this chapter ──────────────────────────────────────
  SELECT COUNT(*)::int INTO v_concepts_total
  FROM chapter_concepts
  WHERE grade = p_grade
    AND subject = p_subject
    AND chapter_number = p_chapter_number
    AND is_active = true;

  -- ── Concept-level mastery aggregation ───────────────────────────────────
  -- Joins chapter_concepts.slug → concept_mastery_score.concept_code.
  -- Concepts without a mastery_score row count as 0 (not_started).
  SELECT
    COALESCE(AVG(cms.mastery_score), 0)::numeric,
    COALESCE(SUM(CASE WHEN cms.cbse_ready THEN 1 ELSE 0 END), 0)::int,
    COALESCE(SUM(cms.recall_successes), 0)::int
  INTO v_mastery_avg, v_concepts_mastered, v_spaced_reviews
  FROM chapter_concepts cc
  LEFT JOIN concept_mastery_score cms
    ON cms.concept_code = cc.slug
   AND cms.student_id = v_student_id
  WHERE cc.grade = p_grade
    AND cc.subject = p_subject
    AND cc.chapter_number = p_chapter_number
    AND cc.is_active = true
    AND cc.slug IS NOT NULL;

  -- ── Recent quiz performance (last 5 chapter quizzes) ────────────────────
  SELECT
    COALESCE(AVG(score_percent), 0)::numeric,
    COUNT(*)::int
  INTO v_recent_avg, v_recent_count
  FROM (
    SELECT score_percent
    FROM quiz_sessions
    WHERE student_id = v_student_id
      AND grade = p_grade
      AND subject = p_subject
      AND chapter_number = p_chapter_number
      AND is_completed = true
      AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 5
  ) recent;

  -- ── Foxy ground-truth availability for this chapter ─────────────────────
  -- Reuses cbse_syllabus_rag_ready (chunk-count threshold). Students who
  -- need help on a not-RAG-ready chapter get a friendly "we're still
  -- preparing this chapter" hint via next_action.
  SELECT cbse_syllabus_rag_ready(p_grade, p_subject, p_chapter_number)
  INTO v_rag_ready;

  -- ── Composite score (0..100) ────────────────────────────────────────────
  v_score := LEAST(100, GREATEST(0, ROUND(
    0.50 * v_mastery_avg
    + 0.30 * v_recent_avg
    + 0.20 * LEAST(100, v_spaced_reviews * 10)
  )::int));

  -- ── Rubric ──────────────────────────────────────────────────────────────
  -- Avoid division-by-zero when chapter has no concepts catalogued (rare;
  -- means the chapter wasn't seeded yet). Treat as not_yet.
  v_mastered_ratio := CASE
    WHEN v_concepts_total > 0 THEN v_concepts_mastered::numeric / v_concepts_total
    ELSE 0
  END;

  IF v_mastered_ratio >= 0.85
     AND v_recent_avg >= 80
     AND v_spaced_reviews >= 3 THEN
    v_level := 'ready';
    v_next_action := 'mock_exam';
    v_msg_en := 'Chapter mastered. Take a mock exam to lock it in.';
    v_msg_hi := 'अध्याय पूरी तरह तैयार है। Mock exam से confirm करो।';
  ELSIF v_mastered_ratio >= 0.70
        AND v_recent_avg >= 60
        AND v_spaced_reviews >= 1 THEN
    v_level := 'almost';
    v_next_action := 'spaced_review';
    v_msg_en := 'Almost there. A few spaced reviews and a chapter quiz will get you exam-ready.';
    v_msg_hi := 'लगभग तैयार। थोड़ा और revision और एक chapter quiz, फिर exam-ready।';
  ELSIF v_mastered_ratio >= 0.40
        AND v_recent_count >= 1 THEN
    v_level := 'building';
    -- Building students benefit most from targeted quizzing on weak concepts.
    v_next_action := 'take_quiz';
    v_msg_en := 'You''re building strong basics. Keep practicing chapter quizzes.';
    v_msg_hi := 'अच्छी शुरुआत है। Chapter quiz practice जारी रखो।';
  ELSE
    v_level := 'not_yet';
    -- not_yet without quiz data → study first; not_yet with quiz data → review concepts.
    IF v_recent_count = 0 THEN
      v_next_action := 'introduce_concept';
      v_msg_en := 'New chapter. Start with the first concept and a short quiz.';
      v_msg_hi := 'नया अध्याय। पहले concept से शुरू करो, फिर एक छोटी quiz।';
    ELSE
      v_next_action := 'review_concept';
      v_msg_en := 'Some concepts need a closer look. Review the weak ones, then re-quiz.';
      v_msg_hi := 'कुछ concepts पर और मेहनत चाहिए। पहले review, फिर quiz।';
    END IF;
  END IF;

  -- ── RAG-not-ready override ──────────────────────────────────────────────
  -- If Foxy can't ground answers on this chapter yet, the next_action
  -- recommendation has to honour that — sending a student to "ask Foxy"
  -- when the corpus is incomplete is worse than telling them to wait.
  IF NOT v_rag_ready AND v_level IN ('not_yet', 'building') THEN
    v_msg_en := v_msg_en || ' (Foxy is still learning this chapter — quizzes work, but in-depth chats are limited.)';
    v_msg_hi := v_msg_hi || ' (Foxy इस अध्याय पर अभी सीख रहा है — quiz चलेगी, deep chat थोड़ा सीमित।)';
  END IF;

  RETURN QUERY SELECT
    v_level,
    v_score,
    ROUND(v_mastery_avg, 2),
    v_concepts_total,
    v_concepts_mastered,
    ROUND(v_recent_avg, 2),
    v_recent_count,
    v_spaced_reviews,
    v_rag_ready,
    v_next_action,
    v_msg_en,
    v_msg_hi;
END;
$$;

COMMENT ON FUNCTION public.compute_chapter_readiness(uuid, text, text, int) IS
  'Per-chapter exam-readiness rubric (Phase 1 of Exam-Ready 360°). '
  'Aggregates concept mastery + recent quiz performance + spaced repetition '
  'into a 4-level signal (not_yet/building/almost/ready) plus a composite '
  '0-100 score, next-action recommendation, and bilingual student-facing '
  'messages. Embeds auth.uid() guard for cross-tenant safety. Caller is '
  'expected to be /api/v1/chapter-readiness or super-admin dashboards.';

GRANT EXECUTE ON FUNCTION public.compute_chapter_readiness(uuid, text, text, int)
  TO authenticated, service_role;

COMMIT;
