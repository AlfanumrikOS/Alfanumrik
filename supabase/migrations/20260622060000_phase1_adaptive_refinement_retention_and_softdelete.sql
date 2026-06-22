-- Migration: 20260622060000_phase1_adaptive_refinement_retention_and_softdelete.sql
-- Purpose: PHASE 1 adaptive-loop refinement (follow-up to 20260622040000 +
--          20260622050000). Addresses assessment's review conditions:
--
--   (1) compute_post_quiz_action — the Priority-2 'revise' branch fired on
--       COALESCE(current_retention, 0) < 0.5. current_retention is NULL for ALL
--       54 concept_mastery rows on prod (verified 2026-06-22: 0/54 non-null),
--       so COALESCE(...,0) => 0 < 0.5 always held, and EVERY student whose
--       weakest-priority topic had mastery_probability > 0.4 got a misleading
--       'revise' with "Retention dropped to 0%" (36/54 rows would false-fire).
--       FIX: gate Priority 2 on `current_retention IS NOT NULL AND
--       current_retention < 0.5` so it only fires on GENUINELY measured
--       forgetting. With retention unmeasured, the ladder now falls through to
--       the mastery_probability tiers (teach/practice/challenge/exam_prep),
--       which is the intended behavior until SM-2 retention backfills.
--       VERIFIED before/after: student 36e42cc4… math/grade-10 (mastery 0.72,
--       retention NULL) returned 'revise' BEFORE -> returns 'challenge' AFTER.
--
--   (2) get_adaptive_questions — add the soft-delete guard `qb.deleted_at IS NULL`
--       to ALL THREE branches (cognitive due_reviews + zpd_questions, board,
--       practice). question_bank.deleted_at EXISTS on prod (timestamptz; 0 rows
--       set today, so this is defensive but P6-correct: a soft-deleted question
--       must never be served). The grade filter (qb.grade = student grade) and
--       qb.is_active = true were ALREADY added by 20260622040000 and are
--       preserved verbatim; this migration only adds deleted_at. LEFT JOINs to
--       concept_mastery (via student_zpd) / bloom_progression are preserved so a
--       FRESH zero-mastery student still gets >= 1 ZPD row (verified 040000:
--       fresh grade-10 student returned 7 rows).
--
--   (3) CHECK constraint on concept_mastery.cme_action_type — VERIFIED on prod
--       (2026-06-22) that NO check constraint references cme_action_type or
--       quiz_sessions.cme_next_action. Both columns are plain `text`. The legacy
--       constraint in _legacy/timestamped/20260405000001 (which listed only
--       teach/practice/challenge/revise/remediate and would have rejected
--       'exam_prep') was NEVER applied — it lives only in the archived pre-
--       baseline chain that the Section-10 cleanup excluded. All 6 action values
--       {teach, remediate, practice, challenge, revise, exam_prep} are therefore
--       already accepted. We DO NOT add a new restrictive constraint here
--       (adding one was conditional on a too-narrow one existing — none does;
--       introducing a fresh CHECK could reject legitimate historical values and
--       is outside this refinement's scope).
--
-- Contract: BOTH functions keep their EXACT signatures + RETURNS TABLE shapes
--   (verified via pg_get_function_identity_arguments + pg_get_function_result):
--     compute_post_quiz_action(uuid, text, text)
--         -> TABLE(action_type text, concept_id uuid, reason text)
--     get_adaptive_questions(uuid, text, integer, boolean, text)
--         -> TABLE(question_id uuid, question_type text, bloom_level text,
--                  priority_score numeric, source text, board_year integer,
--                  paper_section text)
--   The live rhythm caller (src/app/api/rhythm/today/route.ts) and
--   submit_quiz_results_v2 depend on these unchanged.
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact sigs) + CREATE OR REPLACE.
-- SECURITY DEFINER + SET search_path = public retained on both. No schema/RLS/
-- index/constraint change. No DROP of any table/column. Grades TEXT per P5.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) compute_post_quiz_action: gate Priority-2 'revise' on measured retention.
--     Body is identical to 20260622050000 EXCEPT the Priority-2 WHERE clause and
--     its in-DECLARE comment.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.compute_post_quiz_action(uuid, text, text);

CREATE OR REPLACE FUNCTION public.compute_post_quiz_action(
  p_student_id uuid,
  p_subject    text,
  p_grade      text
)
RETURNS TABLE(action_type text, concept_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: invoked from submit_quiz_results_v2 (itself SECURITY
-- DEFINER) after the caller has been authorized against students.auth_user_id.
-- Reads concept_mastery rows scoped strictly to p_student_id; no cross-student
-- access and no writes.
SET search_path = public
AS $$
DECLARE
  v_concept_id     uuid;
  v_mastery        double precision;
  v_retention      double precision;
  v_err_conceptual integer;
  v_action         text;
  v_reason         text;
BEGIN
  -- Priority 1: topic with high conceptual error count (>= 3) -> remediate.
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0),
         cm.error_count_conceptual
    INTO v_concept_id, v_mastery, v_err_conceptual
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
     AND COALESCE(cm.error_count_conceptual, 0) >= 3
   ORDER BY cm.error_count_conceptual DESC,
            COALESCE(cm.mastery_probability, 0) ASC
   LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'remediate'::text,
      v_concept_id,
      ('Deep conceptual gaps detected (' || v_err_conceptual
        || ' conceptual errors). Needs targeted remediation.')::text;
    RETURN;
  END IF;

  -- Priority 2: topic being forgotten (retention decayed despite prior mastery).
  -- GATED on current_retention IS NOT NULL so it only fires on GENUINELY measured
  -- forgetting. Without this guard, NULL retention (the state of every row on
  -- prod today) coalesced to 0 and false-fired 'revise' / "Retention dropped to
  -- 0%" for every mastery>0.4 student. When retention is unmeasured we fall
  -- through to the mastery_probability ladder below.
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0),
         cm.current_retention
    INTO v_concept_id, v_mastery, v_retention
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
     AND cm.current_retention IS NOT NULL
     AND cm.current_retention < 0.5
     AND COALESCE(cm.mastery_probability, 0) > 0.4
   ORDER BY cm.current_retention ASC
   LIMIT 1;

  IF v_concept_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'revise'::text,
      v_concept_id,
      ('Retention dropped to ' || ROUND(COALESCE(v_retention, 0)::numeric * 100)
        || '% despite prior mastery. Revision needed before it is lost.')::text;
    RETURN;
  END IF;

  -- Priority 3-6: weakest topic by mastery_probability, classified by level.
  SELECT cm.topic_id,
         COALESCE(cm.mastery_probability, 0)
    INTO v_concept_id, v_mastery
    FROM concept_mastery cm
    JOIN curriculum_topics ct ON ct.id = cm.topic_id
    JOIN subjects s          ON s.id = ct.subject_id
   WHERE cm.student_id = p_student_id
     AND s.code        = p_subject
     AND ct.grade      = p_grade
   ORDER BY COALESCE(cm.mastery_probability, 0) ASC
   LIMIT 1;

  IF v_concept_id IS NULL THEN
    -- No mastery rows for this student+subject+grade -> safe default.
    RETURN QUERY SELECT
      'exam_prep'::text,
      NULL::uuid,
      'No mastery data available for this subject. Ready for general practice.'::text;
    RETURN;
  END IF;

  IF v_mastery < 0.3 THEN
    v_action := 'teach';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. This concept needs teaching from scratch.';
  ELSIF v_mastery < 0.6 THEN
    v_action := 'practice';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. More practice needed to build fluency.';
  ELSIF v_mastery < 0.85 THEN
    v_action := 'challenge';
    v_reason := 'Mastery at ' || ROUND(v_mastery::numeric * 100)
              || '%. Ready for harder problems to push toward mastery.';
  ELSE
    v_action := 'exam_prep';
    v_reason := 'All topics above 85% mastery. Ready for exam-level practice.';
  END IF;

  RETURN QUERY SELECT v_action, v_concept_id, v_reason;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.compute_post_quiz_action(uuid, text, text) IS
  'PHASE 1 (migration 20260622060000, refines 20260622050000): analyzes '
  'concept_mastery for a student+subject+grade (joined via curriculum_topics -> '
  'subjects.code; grade on curriculum_topics) and returns the recommended next '
  'action (remediate/revise/teach/practice/challenge/exam_prep) + target concept '
  '+ reason. Priority-2 ''revise'' now gated on current_retention IS NOT NULL so '
  'it no longer false-fires on unmeasured (NULL) retention; unmeasured retention '
  'falls through to the mastery_probability ladder. Uses mastery_probability '
  '(numeric) NOT mastery_level (text enum). Called best-effort from '
  'submit_quiz_results_v2 inside an EXCEPTION wrapper. Grade TEXT per P5. '
  'SECURITY DEFINER + search_path=public.';

GRANT EXECUTE ON FUNCTION public.compute_post_quiz_action(uuid, text, text)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) get_adaptive_questions: add qb.deleted_at IS NULL to all branches.
--     Body is identical to 20260622040000 EXCEPT one added predicate per branch
--     (3 due_reviews/zpd_questions/board/practice). is_active + grade unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- Resolve student grade (TEXT per P5). Accept either students.id or auth_user_id.
  -- Empty result on a missing student rather than an error.
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
    -- ZPD bloom target per topic (bloom_progression keys topic on concept_id;
    -- empty on prod today, so this LEFT JOINs to NULL and the ELSE 60 priority
    -- applies — preserved structurally for when bloom_progression backfills).
    student_zpd AS (
      SELECT bp.concept_id AS topic_id, bp.zpd_bloom_level
      FROM bloom_progression bp
      WHERE bp.student_id = p_student_id
    ),
    -- DUE reviews: topics whose SRS due date has passed, ordered WEAKEST-first.
    due_reviews AS (
      SELECT
        qb.id                                   AS question_id,
        'review'::text                          AS question_type,
        qb.bloom_level                          AS bloom_level,
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
      WHERE qb.subject     = p_subject
        AND qb.grade       = v_grade
        AND qb.is_active    = true
        AND qb.deleted_at IS NULL
        AND qb.topic_id IS NOT NULL
        AND p_include_review = true
        AND COALESCE(cm.next_review_date, (cm.next_review_at)::date) <= CURRENT_DATE
        AND qr.id IS NULL
      ORDER BY priority_score DESC, qb.id
      LIMIT 3
    ),
    -- ZPD / new questions: unanswered questions in-grade-and-subject.
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
      WHERE qb.subject     = p_subject
        AND qb.grade       = v_grade
        AND qb.is_active    = true
        AND qb.deleted_at IS NULL
        AND qr.id IS NULL
      ORDER BY priority_score DESC, random()
      LIMIT 7
    ),
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
    WHERE qb.subject     = p_subject
      AND qb.grade       = v_grade
      AND qb.is_active    = true
      AND qb.deleted_at IS NULL
      AND qb.source      = 'cbse_board'
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
    WHERE qb.subject     = p_subject
      AND qb.grade       = v_grade
      AND qb.is_active    = true
      AND qb.deleted_at IS NULL
      AND qr.id IS NULL
    ORDER BY random()
    LIMIT p_limit;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_adaptive_questions(uuid, text, integer, boolean, text) IS
  'PHASE 1 (migration 20260622060000, refines 20260622040000): adaptive '
  'selection. Joins concept_mastery on topic_id, excludes already-answered via '
  'quiz_responses, ranks DUE+WEAK topics first (weakest-first, deterministic at '
  'the top). All branches now filter qb.is_active = true AND qb.deleted_at IS '
  'NULL AND qb.grade = student grade (P6: never serve inactive/soft-deleted/'
  'wrong-grade questions). LEFT JOINs keep a fresh zero-mastery student getting '
  '>= 1 ZPD row. Same 5-arg signature + 7-column RETURNS TABLE shape. '
  'SECURITY DEFINER + search_path=public. Grades TEXT per P5. No schema/RLS change.';

GRANT EXECUTE ON FUNCTION public.get_adaptive_questions(uuid, text, integer, boolean, text)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.phase1_adaptive_refinement',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'rca', '2026-06-22',
    'reason', 'PHASE 1 adaptive-loop refinement (follow-up to 040000/050000) per assessment review.',
    'changes', jsonb_build_array(
      'compute_post_quiz_action: Priority-2 revise gated on current_retention IS NOT NULL (was COALESCE(...,0)<0.5 which false-fired on all 54 NULL-retention rows; 36 would have returned a misleading revise/Retention dropped to 0%).',
      'get_adaptive_questions: added qb.deleted_at IS NULL to all branches (P6; is_active + grade filters already present from 040000).',
      'cme_action_type CHECK: VERIFIED none exists on prod; all 6 action values already accepted; no constraint added.'
    ),
    'contract_preserved', jsonb_build_object(
      'compute_post_quiz_action', 'compute_post_quiz_action(uuid,text,text) -> TABLE(action_type text, concept_id uuid, reason text)',
      'get_adaptive_questions', 'get_adaptive_questions(uuid,text,integer,boolean,text) -> 7-col TABLE'
    )
  ),
  now()
);

COMMIT;
