-- Migration: 20260702200000_fix_get_adaptive_questions_srs_due_predicate.sql
-- Purpose: Fix the due-review predicate in public.get_adaptive_questions so the
--          SRS "due" test reads the REAL SM-2 schedule (concept_mastery.
--          next_review_at, timestamptz) instead of the ghost column
--          concept_mastery.next_review_date.
--
-- RCA (forensic audit of the adaptive pipeline, 2026-07-02):
--   The due_reviews CTE (bodies 20260622040000 line 139 and the currently
--   deployed 20260622060000 line 286) selected due reviews with:
--       COALESCE(cm.next_review_date, (cm.next_review_at)::date) <= CURRENT_DATE
--   But concept_mastery.next_review_date is a DATE column with
--   DEFAULT (CURRENT_DATE + '1 day'::interval) (baseline line ~10685) that
--   NOTHING ever updates — no code path writes `next_review_date =` anywhere in
--   the repo. Every concept_mastery row therefore carries next_review_date =
--   (its creation date + 1), so the COALESCE NEVER falls through to
--   next_review_at, and from day 2 after first touch EVERY concept reads as
--   "due" FOREVER. The SRS due-review lane degenerates into "any previously
--   touched topic", defeating spaced repetition entirely.
--
--   The genuine SM-2 schedule lives in concept_mastery.next_review_at
--   (timestamptz), written on every quiz submit by update_learner_state_post_quiz
--   (latest redefinition 20260623000100_fix_post_quiz_canonical_mastery.sql:
--   next_review_at = now() + (v_new_interval || ' days')::interval, interval
--   clamped by 20260622080000). It is also the field the sibling
--   get_due_reviews() RPC already filters on, covered by the existing composite
--   index idx_concept_mastery_review (student_id, next_review_at).
--
-- The fix (ONE predicate changed, nothing else):
--   BEFORE:  AND COALESCE(cm.next_review_date, (cm.next_review_at)::date) <= CURRENT_DATE
--   AFTER:   AND cm.next_review_at <= now()
--   NULL semantics: a row whose next_review_at is NULL (never SM-2-scheduled)
--   is now correctly NOT "due" — SQL three-valued logic filters it out; such
--   topics still surface through the zpd_questions lane. Under the old
--   predicate the ghost default made those rows perpetually due instead.
--
-- The function body below reproduces the CURRENTLY DEPLOYED definition
-- (20260622060000_phase1_adaptive_refinement_retention_and_softdelete.sql,
-- the newest get_adaptive_questions in the chain — verified by grepping all
-- migrations) VERBATIM except for that one predicate and its adjacent comment.
-- All 20260622040000/060000 refinements are preserved: topic_id join,
-- quiz_responses exclusion, qb.grade = student grade, qb.is_active = true,
-- qb.deleted_at IS NULL on ALL THREE branches, weakest-first deterministic
-- due-review ranking, bloom_progression ZPD boost, board/practice branches.
--
-- Contract: EXACT signature + RETURNS TABLE shape preserved —
--     get_adaptive_questions(uuid, text, integer, boolean, text)
--         -> TABLE(question_id uuid, question_type text, bloom_level text,
--                  priority_score numeric, source text, board_year integer,
--                  paper_section text)
--   Callers (src/app/api/rhythm/today/route.ts, submit paths) unaffected.
--
-- Additive-only: concept_mastery.next_review_date is NOT dropped or altered.
-- As of 2026-07-02 NO app readers of next_review_date remain: this same change
-- set repointed /api/dashboard/reviews-due and /api/revision/overview to
-- next_review_at (pinned by REG-233, which forbids those files from referencing
-- next_review_date again). The partial index
-- idx_concept_mastery_student_review_date_due (from 20260702160000) is now
-- reader-less — a drop candidate for a future user-approved cleanup migration
-- (NOT dropped here). A deprecation COMMENT ON COLUMN is added so nobody
-- re-adopts it as an SRS source.
--
-- Idempotent: DROP FUNCTION IF EXISTS (exact 5-arg sig) + CREATE OR REPLACE.
-- SECURITY DEFINER + SET search_path = public retained (justification inline,
-- unchanged from 20260622040000). No schema/RLS/index/constraint change.
-- No DROP of any table/column. Grades TEXT per P5.

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
    -- DUE reviews: topics whose REAL SM-2 due timestamp (next_review_at,
    -- written by update_learner_state_post_quiz) has passed, ordered
    -- WEAKEST-first. Fixed 20260702200000: previously COALESCEd through the
    -- ghost next_review_date column (DEFAULT CURRENT_DATE + 1, never updated),
    -- which made every touched concept perpetually "due" after day 1.
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
        AND cm.next_review_at <= now()
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
  'Adaptive selection (migration 20260702200000, refines 20260622060000): '
  'due-review predicate FIXED to read the real SM-2 schedule — '
  'cm.next_review_at <= now() (timestamptz written by '
  'update_learner_state_post_quiz). Previously COALESCEd through the ghost '
  'next_review_date column (DEFAULT CURRENT_DATE + 1, never updated by any '
  'code path), which made every touched concept perpetually due after day 1 '
  'and defeated spaced repetition. NULL next_review_at rows are not due and '
  'surface via the ZPD lane instead. All 20260622040000/060000 refinements '
  'preserved verbatim: topic_id join, quiz_responses exclusion, grade + '
  'is_active + deleted_at IS NULL filters on all branches, weakest-first '
  'deterministic due-review ranking. Same 5-arg signature + 7-column RETURNS '
  'TABLE shape. SECURITY DEFINER + search_path=public. Grades TEXT per P5. '
  'No schema/RLS change.';

GRANT EXECUTE ON FUNCTION public.get_adaptive_questions(uuid, text, integer, boolean, text)
  TO authenticated, service_role;

-- Deprecation marker on the ghost column (COMMENT only — the column itself is
-- NOT dropped or altered; dropping it needs its own user-approved plan).
COMMENT ON COLUMN public.concept_mastery.next_review_date IS
  'DEPRECATED as an SRS source (2026-07-02, migration 20260702200000): this '
  'DATE column has DEFAULT (CURRENT_DATE + 1 day) and is NEVER updated by any '
  'code path — it is stale-by-default and must not be used to decide review '
  'due-ness. Do not adopt as an SRS source. The authoritative SM-2 schedule '
  'is next_review_at (timestamptz, written by update_learner_state_post_quiz). '
  'No app readers of next_review_date remain as of 2026-07-02: '
  '/api/dashboard/reviews-due and /api/revision/overview were repointed to '
  'next_review_at in the same change set (pinned by REG-233). The partial '
  'index idx_concept_mastery_student_review_date_due (20260702160000) is now '
  'reader-less — a drop candidate for a future user-approved cleanup '
  'migration (not dropped here; additive-only).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'data_quality.get_adaptive_questions_srs_due_predicate_fixed',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'rca', '2026-07-02 forensic audit of the adaptive pipeline',
    'function', 'get_adaptive_questions',
    'predicate_before', 'COALESCE(cm.next_review_date, (cm.next_review_at)::date) <= CURRENT_DATE',
    'predicate_after', 'cm.next_review_at <= now()',
    'reason', 'concept_mastery.next_review_date is a ghost DATE column (DEFAULT CURRENT_DATE + 1, never updated), so the COALESCE never fell through and every touched concept read as due forever from day 2. next_review_at is the real SM-2 schedule written by update_learner_state_post_quiz.',
    'contract_preserved', 'get_adaptive_questions(uuid,text,integer,boolean,text) -> 7-col TABLE; all 20260622040000/060000 refinements retained',
    'column_action', 'next_review_date NOT dropped/altered; deprecation COMMENT ON COLUMN only. No app readers remain as of 2026-07-02 (/api/dashboard/reviews-due + /api/revision/overview repointed to next_review_at in the same change set, pinned by REG-233); partial index idx_concept_mastery_student_review_date_due (20260702160000) is now reader-less — drop candidate for a future user-approved cleanup migration, not dropped here (additive-only)'
  ),
  now()
);

COMMIT;
