-- ─── readiness_rubric_config: tunable thresholds for Exam-Ready 360° ──────
--
-- Phase 4. Moves the rubric thresholds out of the SQL function bodies into
-- a single-row config table so super-admin can tune them without a
-- migration. Default values are the same constants the Phase 1/3 functions
-- shipped with — applying this migration is a no-op for behaviour until
-- someone PATCHes the config row.
--
-- Rubric layers (mirror compute_chapter_readiness / compute_subject_readiness):
--   ready    : mastered_ratio >= ready_mastered_ratio
--              AND recent_quiz_avg >= ready_quiz_avg
--              AND spaced_reviews >= ready_spaced_reviews
--   almost   : mastered_ratio >= almost_mastered_ratio
--              AND recent_quiz_avg >= almost_quiz_avg
--              AND spaced_reviews >= almost_spaced_reviews
--   building : mastered_ratio >= building_mastered_ratio
--              AND recent_quiz_count >= building_quiz_count
--   not_yet  : everything else
--
-- Composite score:
--   weight_mastery * mastery_avg
--   + weight_recent_quiz * recent_quiz_avg
--   + weight_spaced_reviews * min(100, spaced_reviews * 10)
--
-- The three weights MUST sum to 1.0 (CHECK constraint). Other thresholds are
-- bounded by sensible CHECK constraints so a typo in the admin UI can't
-- produce a useless rubric.

BEGIN;

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.readiness_rubric_config (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Ready tier
  ready_mastered_ratio     numeric NOT NULL DEFAULT 0.85
    CHECK (ready_mastered_ratio BETWEEN 0.5 AND 1.0),
  ready_quiz_avg           numeric NOT NULL DEFAULT 80
    CHECK (ready_quiz_avg BETWEEN 50 AND 100),
  ready_spaced_reviews     int NOT NULL DEFAULT 3
    CHECK (ready_spaced_reviews BETWEEN 0 AND 20),

  -- Almost tier
  almost_mastered_ratio    numeric NOT NULL DEFAULT 0.70
    CHECK (almost_mastered_ratio BETWEEN 0.3 AND 1.0),
  almost_quiz_avg          numeric NOT NULL DEFAULT 60
    CHECK (almost_quiz_avg BETWEEN 30 AND 100),
  almost_spaced_reviews    int NOT NULL DEFAULT 1
    CHECK (almost_spaced_reviews BETWEEN 0 AND 20),

  -- Building tier
  building_mastered_ratio  numeric NOT NULL DEFAULT 0.40
    CHECK (building_mastered_ratio BETWEEN 0.1 AND 1.0),
  building_quiz_count      int NOT NULL DEFAULT 1
    CHECK (building_quiz_count BETWEEN 0 AND 20),

  -- Composite score weights — must sum to 1.0
  weight_mastery           numeric NOT NULL DEFAULT 0.50
    CHECK (weight_mastery BETWEEN 0 AND 1),
  weight_recent_quiz       numeric NOT NULL DEFAULT 0.30
    CHECK (weight_recent_quiz BETWEEN 0 AND 1),
  weight_spaced_reviews    numeric NOT NULL DEFAULT 0.20
    CHECK (weight_spaced_reviews BETWEEN 0 AND 1),

  -- Tier monotonicity: ready bar must be >= almost bar; almost >= building.
  -- Without these the rubric can become non-monotone (e.g. ready easier than
  -- almost) and the level cascade breaks.
  CONSTRAINT chk_tier_monotone_ratio CHECK (
    ready_mastered_ratio >= almost_mastered_ratio
    AND almost_mastered_ratio >= building_mastered_ratio
  ),
  CONSTRAINT chk_tier_monotone_quiz CHECK (
    ready_quiz_avg >= almost_quiz_avg
  ),
  CONSTRAINT chk_tier_monotone_spaced CHECK (
    ready_spaced_reviews >= almost_spaced_reviews
  ),
  CONSTRAINT chk_weights_sum_to_one CHECK (
    abs((weight_mastery + weight_recent_quiz + weight_spaced_reviews) - 1.0) < 0.001
  ),

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.readiness_rubric_config IS
  'Single-row config for the Exam-Ready 360° rubric (Phase 4). Tunable via '
  'super-admin UI without a migration. compute_chapter_readiness and '
  'compute_subject_readiness read these values at runtime; default values '
  'match the constants those functions originally shipped with.';

-- Seed the single config row (idempotent — uses ON CONFLICT to make this
-- migration safely re-runnable).
INSERT INTO public.readiness_rubric_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.readiness_rubric_config ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (the rubric is referenced in client UX text
-- and is not sensitive). Service role bypasses automatically.
DROP POLICY IF EXISTS readiness_rubric_config_read_authenticated ON public.readiness_rubric_config;
CREATE POLICY readiness_rubric_config_read_authenticated ON public.readiness_rubric_config
  FOR SELECT USING (true);

-- Write: service-role only. The super-admin API calls go through
-- supabaseAdmin (service-role client) which bypasses RLS, so we don't need
-- to grant authenticated callers the ability to UPDATE — that would be a
-- privilege escalation if a non-admin route ever instantiated the writeable
-- client.
DROP POLICY IF EXISTS readiness_rubric_config_write_service ON public.readiness_rubric_config;
CREATE POLICY readiness_rubric_config_write_service ON public.readiness_rubric_config
  FOR ALL USING (auth.role() = 'service_role');

-- ── Update compute_chapter_readiness to read from config ────────────────────
-- We re-CREATE the function (CREATE OR REPLACE drops + creates) so the body
-- pulls thresholds from the config row before applying the rubric. Defaults
-- are inlined as fallbacks in case the config row is somehow missing — this
-- function MUST never fail the chapter learn page.

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
  -- Tunable thresholds (read once at function start)
  v_cfg             record;
BEGIN
  -- Load thresholds. If the config row is missing for any reason, fall back
  -- to the original constants so the function never returns garbage.
  SELECT
    COALESCE(c.ready_mastered_ratio,    0.85) AS ready_ratio,
    COALESCE(c.ready_quiz_avg,          80)   AS ready_quiz,
    COALESCE(c.ready_spaced_reviews,    3)    AS ready_spaced,
    COALESCE(c.almost_mastered_ratio,   0.70) AS almost_ratio,
    COALESCE(c.almost_quiz_avg,         60)   AS almost_quiz,
    COALESCE(c.almost_spaced_reviews,   1)    AS almost_spaced,
    COALESCE(c.building_mastered_ratio, 0.40) AS building_ratio,
    COALESCE(c.building_quiz_count,     1)    AS building_quiz,
    COALESCE(c.weight_mastery,          0.50) AS w_mastery,
    COALESCE(c.weight_recent_quiz,      0.30) AS w_quiz,
    COALESCE(c.weight_spaced_reviews,   0.20) AS w_spaced
  INTO v_cfg
  FROM (SELECT 1) one
  LEFT JOIN public.readiness_rubric_config c ON c.id = 1;

  SELECT id INTO v_student_id
  FROM students
  WHERE (id = p_student_id OR auth_user_id = p_student_id)
    AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::int INTO v_concepts_total
  FROM chapter_concepts
  WHERE grade = p_grade AND subject = p_subject
    AND chapter_number = p_chapter_number AND is_active = true;

  SELECT
    COALESCE(AVG(cms.mastery_score), 0)::numeric,
    COALESCE(SUM(CASE WHEN cms.cbse_ready THEN 1 ELSE 0 END), 0)::int,
    COALESCE(SUM(cms.recall_successes), 0)::int
  INTO v_mastery_avg, v_concepts_mastered, v_spaced_reviews
  FROM chapter_concepts cc
  LEFT JOIN concept_mastery_score cms
    ON cms.concept_code = cc.slug AND cms.student_id = v_student_id
  WHERE cc.grade = p_grade AND cc.subject = p_subject
    AND cc.chapter_number = p_chapter_number
    AND cc.is_active = true AND cc.slug IS NOT NULL;

  SELECT
    COALESCE(AVG(score_percent), 0)::numeric,
    COUNT(*)::int
  INTO v_recent_avg, v_recent_count
  FROM (
    SELECT score_percent FROM quiz_sessions
    WHERE student_id = v_student_id AND grade = p_grade
      AND subject = p_subject AND chapter_number = p_chapter_number
      AND is_completed = true AND deleted_at IS NULL
    ORDER BY completed_at DESC NULLS LAST LIMIT 5
  ) recent;

  SELECT cbse_syllabus_rag_ready(p_grade, p_subject, p_chapter_number)
  INTO v_rag_ready;

  v_score := LEAST(100, GREATEST(0, ROUND(
    v_cfg.w_mastery * v_mastery_avg
    + v_cfg.w_quiz * v_recent_avg
    + v_cfg.w_spaced * LEAST(100, v_spaced_reviews * 10)
  )::int));

  v_mastered_ratio := CASE
    WHEN v_concepts_total > 0 THEN v_concepts_mastered::numeric / v_concepts_total
    ELSE 0
  END;

  IF v_mastered_ratio >= v_cfg.ready_ratio
     AND v_recent_avg >= v_cfg.ready_quiz
     AND v_spaced_reviews >= v_cfg.ready_spaced THEN
    v_level := 'ready';
    v_next_action := 'mock_exam';
    v_msg_en := 'Chapter mastered. Take a mock exam to lock it in.';
    v_msg_hi := 'अध्याय पूरी तरह तैयार है। Mock exam से confirm करो।';
  ELSIF v_mastered_ratio >= v_cfg.almost_ratio
        AND v_recent_avg >= v_cfg.almost_quiz
        AND v_spaced_reviews >= v_cfg.almost_spaced THEN
    v_level := 'almost';
    v_next_action := 'spaced_review';
    v_msg_en := 'Almost there. A few spaced reviews and a chapter quiz will get you exam-ready.';
    v_msg_hi := 'लगभग तैयार। थोड़ा और revision और एक chapter quiz, फिर exam-ready।';
  ELSIF v_mastered_ratio >= v_cfg.building_ratio
        AND v_recent_count >= v_cfg.building_quiz THEN
    v_level := 'building';
    v_next_action := 'take_quiz';
    v_msg_en := 'You''re building strong basics. Keep practicing chapter quizzes.';
    v_msg_hi := 'अच्छी शुरुआत है। Chapter quiz practice जारी रखो।';
  ELSE
    v_level := 'not_yet';
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

  IF NOT v_rag_ready AND v_level IN ('not_yet', 'building') THEN
    v_msg_en := v_msg_en || ' (Foxy is still learning this chapter — quizzes work, but in-depth chats are limited.)';
    v_msg_hi := v_msg_hi || ' (Foxy इस अध्याय पर अभी सीख रहा है — quiz चलेगी, deep chat थोड़ा सीमित।)';
  END IF;

  RETURN QUERY SELECT
    v_level, v_score,
    ROUND(v_mastery_avg, 2),
    v_concepts_total, v_concepts_mastered,
    ROUND(v_recent_avg, 2), v_recent_count,
    v_spaced_reviews, v_rag_ready,
    v_next_action, v_msg_en, v_msg_hi;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_chapter_readiness(uuid, text, text, int)
  TO authenticated, service_role;

-- ── Update compute_subject_readiness similarly ──────────────────────────────
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
  v_cfg        record;
BEGIN
  SELECT
    COALESCE(c.ready_mastered_ratio,    0.85) AS ready_ratio,
    COALESCE(c.ready_quiz_avg,          80)   AS ready_quiz,
    COALESCE(c.ready_spaced_reviews,    3)    AS ready_spaced,
    COALESCE(c.almost_mastered_ratio,   0.70) AS almost_ratio,
    COALESCE(c.almost_quiz_avg,         60)   AS almost_quiz,
    COALESCE(c.almost_spaced_reviews,   1)    AS almost_spaced,
    COALESCE(c.building_mastered_ratio, 0.40) AS building_ratio,
    COALESCE(c.building_quiz_count,     1)    AS building_quiz,
    COALESCE(c.weight_mastery,          0.50) AS w_mastery,
    COALESCE(c.weight_recent_quiz,      0.30) AS w_quiz,
    COALESCE(c.weight_spaced_reviews,   0.20) AS w_spaced
  INTO v_cfg
  FROM (SELECT 1) one
  LEFT JOIN public.readiness_rubric_config c ON c.id = 1;

  SELECT id INTO v_student_id
  FROM students
  WHERE (id = p_student_id OR auth_user_id = p_student_id)
    AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH chapter_universe AS (
    SELECT DISTINCT chapter_number FROM chapter_concepts
    WHERE grade = p_grade AND subject = p_subject AND is_active = true
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
      ON cms.concept_code = cc.slug AND cms.student_id = v_student_id
    WHERE cc.grade = p_grade AND cc.subject = p_subject
      AND cc.is_active = true
    GROUP BY cc.chapter_number
  ),
  quiz_rollup AS (
    SELECT
      cu.chapter_number,
      COALESCE(AVG(q.score_percent), 0)::numeric AS recent_quiz_avg,
      COUNT(q.score_percent)::int AS recent_quiz_count
    FROM chapter_universe cu
    LEFT JOIN LATERAL (
      SELECT score_percent FROM quiz_sessions
      WHERE student_id = v_student_id AND grade = p_grade
        AND subject = p_subject AND chapter_number = cu.chapter_number
        AND is_completed = true AND deleted_at IS NULL
      ORDER BY completed_at DESC NULLS LAST LIMIT 5
    ) q ON true
    GROUP BY cu.chapter_number
  )
  SELECT
    cu.chapter_number,
    CASE
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= v_cfg.ready_ratio
       AND COALESCE(qr.recent_quiz_avg, 0) >= v_cfg.ready_quiz
       AND COALESCE(cr.spaced_reviews, 0) >= v_cfg.ready_spaced
        THEN 'ready'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= v_cfg.almost_ratio
       AND COALESCE(qr.recent_quiz_avg, 0) >= v_cfg.almost_quiz
       AND COALESCE(cr.spaced_reviews, 0) >= v_cfg.almost_spaced
        THEN 'almost'
      WHEN COALESCE(cr.concepts_mastered::numeric / NULLIF(cr.concepts_total, 0), 0) >= v_cfg.building_ratio
       AND COALESCE(qr.recent_quiz_count, 0) >= v_cfg.building_quiz
        THEN 'building'
      ELSE 'not_yet'
    END AS level,
    LEAST(100, GREATEST(0, ROUND(
      v_cfg.w_mastery * COALESCE(cr.mastery_avg, 0)
      + v_cfg.w_quiz * COALESCE(qr.recent_quiz_avg, 0)
      + v_cfg.w_spaced * LEAST(100, COALESCE(cr.spaced_reviews, 0) * 10)
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

GRANT EXECUTE ON FUNCTION public.compute_subject_readiness(uuid, text, text)
  TO authenticated, service_role;

COMMIT;
