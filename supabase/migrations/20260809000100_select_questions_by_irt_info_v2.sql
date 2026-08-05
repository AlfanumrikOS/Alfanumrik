-- Migration: 20260809000100_select_questions_by_irt_info_v2.sql
-- Purpose: Foxy North-Star Phase 3 (CEO-approved A2) — NEW function
--   select_questions_by_irt_info_v2. The v1 function
--   (select_questions_by_irt_info, baseline_from_prod.sql:6702) is LEFT
--   UNTOUCHED — v2 is a separate name so the shadow lane (ff_irt_shadow_v1,
--   20260809000000) can compare v2 output against production selection with
--   zero risk to the live path.
--
-- Deltas vs v1 (everything else, including the Fisher-information scoring
-- CASE, is copied VERBATIM from the baseline v1 body):
--
--   1. RETURNS TABLE gains six columns the client rendering path needs so a
--      future cutover requires no second query:
--        question_hi, explanation_hi, hint, question_type, concept_tag,
--        options_version.
--      ⚠ options_version SENTINEL CONTRACT: question_bank.options_version
--      does NOT exist in the current schema — Phase C's column was lost in
--      the 2026-05-03 baselining and was never reinstated (full archaeology
--      in 20260801100800, which established sentinel `0` = "no genuine
--      version captured / skip drift comparison" as the documented contract
--      for exactly this situation, mirroring
--      quiz_session_shuffles.options_version_at_serve). v2 therefore returns
--      the literal 0::integer. When question_bank.options_version is
--      reinstated (tracked follow-up from 20260801100800), change the single
--      `0::integer AS options_version` projection to `qb.options_version` —
--      the RETURNS TABLE contract is already shaped for it.
--
--   2. Tier-0 verification-gate predicates v1 is missing, mirroring the
--      exact three predicates the TS adaptive selector applies
--      (packages/lib/src/adaptive/select-adaptive-questions.ts:364-366,
--      verified 2026-08-05, and select_quiz_questions_rag since 20260802100000):
--        qb.deleted_at IS NULL
--        AND qb.content_status = 'published'
--        AND qb.verification_state <> 'failed'
--      Column names verified against the baseline question_bank DDL
--      (deleted_at :2157, content_status :2176 + CHECK :2228,
--      verification_state :2207 NOT NULL + CHECK :2229 — NOT NULL, so
--      `<> 'failed'` is the complete TS `.not('verification_state','eq',
--      'failed')` twin with no NULL edge).
--
-- SECURITY INVOKER justification (required comment): this is a READ-ONLY
--   selector over question_bank + student_skill_state. INVOKER means the
--   caller's own RLS posture governs what rows are visible — no privilege
--   escalation surface, same posture as v1 (which has no SECURITY clause,
--   i.e. INVOKER by default) and as traverse_prerequisites (20260702000400,
--   whose grant posture this migration mirrors). The shadow evaluator runs
--   server-side under service_role, which bypasses RLS anyway.
--
-- Idempotent: CREATE OR REPLACE. Additive only — no DROP, no table/column
--   change, no RLS change. v1 untouched.
-- Owner: architect. Reviewers (P14): ai-engineer (selector math consumer),
--   assessment (retrieval correctness), testing, quality. Added: 2026-08-05.

BEGIN;

CREATE OR REPLACE FUNCTION public.select_questions_by_irt_info_v2(
  p_student_id    uuid,
  p_subject       text,
  p_grade         text,
  p_chapter_number integer DEFAULT NULL,
  p_match_count   integer DEFAULT 5,
  p_exclude_ids   uuid[]  DEFAULT '{}'::uuid[]
)
RETURNS TABLE(
  question_id          uuid,
  question_text        text,
  options              jsonb,
  correct_answer_index integer,
  explanation          text,
  difficulty           integer,
  bloom_level          text,
  chapter_number       integer,
  irt_a                numeric,
  irt_b                numeric,
  irt_calibration_n    integer,
  irt_difficulty       numeric,
  selection_score      numeric,
  selection_path       text,
  question_hi          text,
  explanation_hi       text,
  hint                 text,
  question_type        text,
  concept_tag          text,
  options_version      integer
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
-- SECURITY INVOKER: read-only selector; caller's RLS governs visibility (see
-- header). No writes, no escalation.
SET search_path = public
AS $$
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
      qb.irt_difficulty::NUMERIC AS irt_difficulty,
      qb.question_hi,
      qb.explanation_hi,
      qb.hint,
      qb.question_type,
      qb.concept_tag
    FROM question_bank qb
    WHERE qb.is_active = true
      AND qb.subject  = p_subject
      AND qb.grade    = p_grade
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (p_exclude_ids IS NULL OR NOT (qb.id = ANY(p_exclude_ids)))
      -- Tier-0 verification gate (v2 delta #2 — TS twin of
      -- select-adaptive-questions.ts:364-366):
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state <> 'failed'
  ),
  scored AS (
    SELECT
      c.*,
      -- Scoring CASE copied VERBATIM from v1 (baseline :6739-6749). Do not
      -- edit here without a paired v1 review — the shadow comparison is only
      -- meaningful while both functions rank identically.
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
    s.selection_path,
    s.question_hi,
    s.explanation_hi,
    s.hint,
    s.question_type,
    s.concept_tag,
    -- SENTINEL (see header): question_bank.options_version does not exist in
    -- the current schema; 0 = "no genuine version captured" per the contract
    -- 20260801100800 established. Swap to qb.options_version when the column
    -- is reinstated.
    0::integer AS options_version
  FROM scored s
  ORDER BY s.selection_score DESC, random()
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.select_questions_by_irt_info_v2(uuid, text, text, integer, integer, uuid[]) IS
  'Foxy North-Star Phase 3: v2 IRT selector for the ff_irt_shadow_v1 shadow '
  'lane. Scoring CASE identical to select_questions_by_irt_info (v1, baseline '
  ':6702 — untouched). Deltas: +question_hi/explanation_hi/hint/question_type/'
  'concept_tag/options_version return columns (options_version is the '
  'documented sentinel 0 until question_bank.options_version is reinstated, '
  'see 20260801100800), and the three Tier-0 verification predicates '
  '(deleted_at IS NULL, content_status=published, verification_state<>failed) '
  'mirroring select-adaptive-questions.ts:364-366. SECURITY INVOKER: '
  'read-only; caller RLS governs visibility.';

-- Least-privilege execute grants (mirror 20260702000400 posture).
REVOKE ALL ON FUNCTION public.select_questions_by_irt_info_v2(uuid, text, text, integer, integer, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_questions_by_irt_info_v2(uuid, text, text, integer, integer, uuid[]) TO authenticated, service_role;

COMMIT;
