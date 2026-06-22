-- Migration: 20260622040000_fix_get_adaptive_questions_topic_join.sql
-- Purpose: PHASE 1 adaptive-loop fix (Part A). Repair public.get_adaptive_questions so
--          adaptive selection stops collapsing to random (it currently THROWS in
--          'cognitive' mode and returns pure-random in the other modes).
--
-- RCA (confirmed against the linked DB, 2026-06-22):
--   The v1 body (baseline 00000000000000_baseline_from_prod.sql line 4170) does:
--       JOIN concept_mastery cm ON qb.concept_id = cm.concept_id      -- (1)
--       LEFT JOIN student_zpd sz ON qb.concept_id = sz.concept_id     -- (2)
--       ... WHERE NOT EXISTS in question_responses                     -- (3)
--   But on live prod:
--     - question_bank has NO concept_id column (it has topic_id, concept_code,
--       concept_tag). So (1)/(2) raise 42703 "column qb.concept_id does not exist"
--       -> the WHOLE cognitive branch errors. The rhythm route swallows the RPC
--       error and gets an EMPTY ZPD candidate pool (verified: ERR 42703 on a real
--       student call before this fix).
--     - The "already answered" exclusion filters question_responses, which has 0
--       rows on prod (real answers live in quiz_responses, 390 rows). So even in
--       the board/practice branches every question looks unanswered AND ordering
--       is pure random() -> no adaptivity, infinite repeats possible.
--
-- Schema facts verified before writing (information_schema / live probes):
--     question_bank.topic_id            present + populated
--     question_bank.concept_id          ABSENT  (the broken join key)
--     concept_mastery.topic_id          present + populated (54 rows, FK-shaped
--                                       to curriculum_topics.id — verified by
--                                       matching sample topic_ids)
--     concept_mastery.mastery_probability  numeric (0..1)  ← the adaptive signal
--     concept_mastery.mastery_level     TEXT enum ('developing', ...) — NOT numeric
--     concept_mastery.next_review_date  date  (primary SRS due field)
--     concept_mastery.next_review_at    timestamptz (nullable fallback)
--     quiz_responses.student_id         present (direct link; no quiz_sessions join needed)
--     quiz_responses.question_id        present
--     bloom_progression                 0 rows on prod (ZPD bloom boost is a no-op
--                                       today; kept structurally for when it fills)
--
-- The fix (behavior-preserving where the v1 branch actually worked):
--   (a) join question_bank <-> concept_mastery on TOPIC_ID (both populated);
--   (b) exclude already-answered via QUIZ_RESPONSES (qr.student_id = p_student_id);
--   (c) due_reviews fires for DUE + WEAK topics first, ranked weakest-first so two
--       calls return a STABLE weak-topic ordering at the top (not pure random);
--   (d) cognitive/board/practice branches + bloom_progression ZPD logic preserved;
--   (e) grade is resolved and applied so adaptive picks stay in the student's grade
--       (concept_mastery topics are grade-scoped; questions are grade-stamped).
--
-- Contract: EXACT v1 signature + RETURNS TABLE column order/names PRESERVED
--           (callers depend on it: src/app/api/rhythm/today/route.ts AdaptiveQuestionRow,
--           and others). 5 IN params, 7 OUT columns, unchanged.
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact 5-arg sig) + CREATE OR REPLACE.
-- SECURITY DEFINER + SET search_path = public. No schema/RLS/index change. No DROP
-- of any table/column. Grades remain TEXT per P5.

BEGIN;

-- Drop the exact 5-arg overload so CREATE OR REPLACE can never leave a stale body.
DROP FUNCTION IF EXISTS public.get_adaptive_questions(
  uuid, text, integer, boolean, text
);

CREATE OR REPLACE FUNCTION public.get_adaptive_questions(
  p_student_id     uuid,
  p_subject        text,
  p_limit          integer DEFAULT 10,
  p_include_review boolean DEFAULT true,
  p_mode           text    DEFAULT 'cognitive'
) RETURNS TABLE(
  question_id    uuid,
  question_type  text,
  bloom_level    text,
  priority_score numeric,
  source         text,
  board_year     integer,
  paper_section  text
)
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: reads concept_mastery + quiz_responses for the
-- target student inside a SECURITY DEFINER chain (called from submit/rhythm
-- paths). RLS on those tables would block the cross-table join from the
-- authenticated student role; the function only ever reads rows scoped to
-- p_student_id, so no cross-student leakage is possible.
SET search_path = public
AS $$
DECLARE
  v_grade text;
BEGIN
  -- Resolve student grade (TEXT per P5). Accept either students.id or auth_user_id
  -- (mirrors get_available_subjects_v2's defensive lookup). Empty result on a
  -- missing student rather than an error.
  SELECT s.grade INTO v_grade
    FROM students s
   WHERE s.id = p_student_id OR s.auth_user_id = p_student_id
   LIMIT 1;

  IF v_grade IS NULL THEN
    RETURN;
  END IF;

  IF p_mode = 'cognitive' THEN
    RETURN QUERY
    WITH
    -- ZPD bloom target per topic (bloom_progression keys its topic on concept_id;
    -- empty on prod today, so this LEFT JOINs to NULL and the ELSE 60 priority
    -- applies — preserved structurally for when bloom_progression backfills).
    student_zpd AS (
      SELECT bp.concept_id AS topic_id, bp.zpd_bloom_level
      FROM bloom_progression bp
      WHERE bp.student_id = p_student_id
    ),
    -- DUE reviews: topics whose SRS due date has passed, ordered WEAKEST-first so
    -- the top of the list is stable across calls (not random). Joined on topic_id.
    due_reviews AS (
      SELECT
        qb.id                                   AS question_id,
        'review'::text                          AS question_type,
        qb.bloom_level                          AS bloom_level,
        -- 100 base + up to 10 for low mastery => weaker topics rank higher and
        -- the ordering is DETERMINISTIC by mastery (no random at the top).
        -- Cast to numeric: mastery_probability is double precision, and the
        -- RETURNS TABLE column priority_score is numeric (column-4 type must match).
        (100::numeric + ((1 - LEAST(GREATEST(COALESCE(cm.mastery_probability, 0.5), 0), 1)) * 10)::numeric)
                                                AS priority_score,
        qb.source                               AS source,
        qb.board_year                           AS board_year,
        qb.paper_section                        AS paper_section
      FROM question_bank qb
      JOIN concept_mastery cm
            ON cm.topic_id = qb.topic_id
           AND cm.student_id = p_student_id
      LEFT JOIN quiz_responses qr
            ON qr.question_id = qb.id
           AND qr.student_id  = p_student_id
      WHERE qb.subject   = p_subject
        AND qb.grade     = v_grade
        AND qb.is_active  = true
        AND qb.topic_id IS NOT NULL
        AND p_include_review = true
        AND COALESCE(cm.next_review_date, (cm.next_review_at)::date) <= CURRENT_DATE
        AND qr.id IS NULL
      ORDER BY priority_score DESC, qb.id
      LIMIT 3
    ),
    -- ZPD / new questions: unanswered questions in-grade-and-subject, with a
    -- bloom-match boost when a ZPD target exists for the topic.
    zpd_questions AS (
      SELECT
        qb.id                                   AS question_id,
        'new'::text                             AS question_type,
        qb.bloom_level                          AS bloom_level,
        CASE
          WHEN sz.zpd_bloom_level IS NOT NULL
           AND qb.bloom_level = sz.zpd_bloom_level THEN 80::numeric
          ELSE 60::numeric
        END                                     AS priority_score,
        qb.source                               AS source,
        qb.board_year                           AS board_year,
        qb.paper_section                        AS paper_section
      FROM question_bank qb
      LEFT JOIN student_zpd sz
            ON sz.topic_id = qb.topic_id
      LEFT JOIN quiz_responses qr
            ON qr.question_id = qb.id
           AND qr.student_id  = p_student_id
      WHERE qb.subject  = p_subject
        AND qb.grade    = v_grade
        AND qb.is_active = true
        AND qr.id IS NULL
      ORDER BY priority_score DESC, random()
      LIMIT 7
    ),
    -- Wrap the UNION in a subquery: Postgres forbids expressions/functions
    -- (e.g. random()) in a set-operation's top-level ORDER BY, so the final
    -- random tie-break must be applied OUTSIDE the UNION.
    combined AS (
      SELECT * FROM due_reviews
      UNION ALL
      SELECT * FROM zpd_questions
    )
    SELECT
      combined.question_id,
      combined.question_type,
      combined.bloom_level,
      combined.priority_score,
      combined.source,
      combined.board_year,
      combined.paper_section
    FROM combined
    ORDER BY combined.priority_score DESC, random()
    LIMIT p_limit;

  ELSIF p_mode = 'board' THEN
    RETURN QUERY
    SELECT
      qb.id            AS question_id,
      'board'::text    AS question_type,
      qb.bloom_level   AS bloom_level,
      90::numeric      AS priority_score,
      qb.source        AS source,
      qb.board_year    AS board_year,
      qb.paper_section AS paper_section
    FROM question_bank qb
    LEFT JOIN quiz_responses qr
          ON qr.question_id = qb.id
         AND qr.student_id  = p_student_id
    WHERE qb.subject  = p_subject
      AND qb.grade    = v_grade
      AND qb.is_active = true
      AND qb.source   = 'cbse_board'
      AND qr.id IS NULL
    ORDER BY qb.board_year DESC NULLS LAST, random()
    LIMIT p_limit;

  ELSE
    RETURN QUERY
    SELECT
      qb.id            AS question_id,
      'practice'::text AS question_type,
      qb.bloom_level   AS bloom_level,
      70::numeric      AS priority_score,
      qb.source        AS source,
      qb.board_year    AS board_year,
      qb.paper_section AS paper_section
    FROM question_bank qb
    LEFT JOIN quiz_responses qr
          ON qr.question_id = qb.id
         AND qr.student_id  = p_student_id
    WHERE qb.subject  = p_subject
      AND qb.grade    = v_grade
      AND qb.is_active = true
      AND qr.id IS NULL
    ORDER BY random()
    LIMIT p_limit;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_adaptive_questions(uuid, text, integer, boolean, text) IS
  'PHASE 1 (migration 20260622040000): repaired adaptive selection. v1 joined '
  'question_bank.concept_id (which does not exist -> cognitive mode threw 42703) and '
  'excluded via question_responses (empty on prod -> every question looked unanswered '
  '+ pure-random ordering). Now joins concept_mastery on topic_id, excludes via '
  'quiz_responses (student_id direct), and ranks DUE+WEAK topics first (weakest-first, '
  'deterministic at the top). Same 5-arg signature + 7-column RETURNS TABLE shape as v1. '
  'SECURITY DEFINER + search_path=public. Grades TEXT per P5. No schema/RLS change.';

GRANT EXECUTE ON FUNCTION public.get_adaptive_questions(uuid, text, integer, boolean, text)
  TO authenticated, service_role;

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.get_adaptive_questions_topic_join_fixed',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PHASE 1 adaptive-loop fix: repair get_adaptive_questions (was throwing 42703 in cognitive mode on missing qb.concept_id, and pure-random elsewhere because exclusion filtered the empty question_responses table). Now joins concept_mastery on topic_id + excludes via quiz_responses + ranks due/weak topics first.',
    'rca', '2026-06-22',
    'function', 'get_adaptive_questions',
    'join_key_before', 'question_bank.concept_id = concept_mastery.concept_id (qb.concept_id absent)',
    'join_key_after', 'question_bank.topic_id = concept_mastery.topic_id',
    'exclusion_before', 'question_responses (0 rows on prod)',
    'exclusion_after', 'quiz_responses (student_id direct)'
  ),
  now()
);

COMMIT;
