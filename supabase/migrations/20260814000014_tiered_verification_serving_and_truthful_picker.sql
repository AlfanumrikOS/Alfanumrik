-- Migration: 20260814000014_tiered_verification_serving_and_truthful_picker.sql
--
-- SEV1 #12 / Decision A — CEO-approved OPTION 3 (TIERED).
-- Owner: assessment. Slot 14 (architect owns slot 13 this wave).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  WHAT WAS DECIDED  (state it plainly so a reversal is trivial to identify)
-- ═══════════════════════════════════════════════════════════════════════════
-- Option 3 of three: PRACTICE serves AI-verified content; MOCK TESTS / EXAMS
-- keep the human-SME gate; the chapter-picker badge is made truthful by
-- splitting one count into two.
--
-- Rejected alternatives, for the record:
--   Option 1 — make everything require human SME sign-off (kills availability;
--              is_verified DEFAULTs to false and almost nothing is set).
--   Option 2 — drop the human gate everywhere (a wrong mock-test question
--              corrupts a score a parent will screenshot).
-- Rationale: a wrong PRACTICE question costs one confusing minute and is
-- recoverable; a wrong MOCK-TEST question corrupts a permanent record. The
-- gate belongs where the cost is unrecoverable, not everywhere.
--
-- TO REVERSE THIS DECISION: re-add `AND is_verified = true` to §1 below and
-- read `exam_ready_count` instead of `practice_ready_count` in the picker UI.
-- Nothing else in this migration is decision-dependent — §3, §4 and the
-- Tier-0 floors are pure safety narrowings that hold under any option.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  THE DEFECT
-- ═══════════════════════════════════════════════════════════════════════════
-- Two different "verified" columns were being read as if they were one:
--   * is_verified              — human SME sign-off, set via
--                                POST /api/super-admin/questions/verify.
--                                DEFAULTs to false.
--   * verified_against_ncert /
--     verification_state       — automated agents (verify-question-bank, the
--                                fix-failed-questions agent).
--
-- `packages/lib/src/ai/agents/agents/fix-failed-questions/tools/commit-fix.ts`
-- sets verification_state='verified' + verified_against_ncert=true and NEVER
-- is_verified. So an AI-REPAIRED question raised chapter readiness, counted
-- toward the picker badge, and then could not be served by
-- `get_quiz_questions` — we advertised a question count we could not deliver.
--
-- Scope check done before writing this (ai-engineer, verified independently):
-- `get_quiz_questions` is the ONLY serving path in the codebase that filtered
-- `is_verified`. `select_quiz_questions_rag` (primary), `select_quiz_questions_v2`,
-- `quiz-generator` and `select-adaptive-questions.ts` all ignore it;
-- 20260802100000 records it as "human/SME flag -- remains ranking/administrative
-- metadata only". So §1 largely FORMALISES THE DE-FACTO STATUS QUO for
-- practice. The real bite of option 3 is §2's honesty and the PRESERVATION of
-- the human gate on `start_mock_test_attempt`, which this migration does not
-- touch at all.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  THE TIER-0 FLOOR  (the never-serve floor, applied at every rung here)
-- ═══════════════════════════════════════════════════════════════════════════
--     is_active = true
--     deleted_at IS NULL
--     content_status IS NULL OR content_status = 'published'
--     verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')
--
-- Two NULL-safety notes, both load-bearing:
--   * content_status is NULLABLE with DEFAULT 'published'. A strict
--     `= 'published'` silently drops every legacy row carrying an explicit
--     NULL. Every floor ADDED by this migration is therefore null-tolerant,
--     matching the sibling client rung in `packages/lib/src/supabase.ts`
--     (`or('content_status.is.null,content_status.eq.published')`).
--   * verification_state is NOT NULL, so a bare NOT IN is safe there.
--
-- The three disproved states are the complete set. The CHECK constraint was
-- widened from four states to six by 20260510064952 (the qb-fixer agent), but
-- every downstream gate kept testing only the literal 'failed'. A row in
-- 'failed_fix_in_flight' is a DISPROVED row currently claimed by the repair
-- agent; 'failed_unfixable' is a row proven wrong AND proven unrepairable.
-- Both were servable. That is an answer-correctness defect, not a cosmetic
-- one, and it is the same defect family as the badge lie.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  SECTIONS
-- ═══════════════════════════════════════════════════════════════════════════
--   §1  get_quiz_questions (both overloads) — DROP the is_verified filter,
--       ADD the Tier-0 floor it never had. Net effect is a NARROWING on every
--       axis except the SME flag.
--   §2  available_chapters_for_student_subject_v2 — split the count into
--       practice_ready_count + exam_ready_count. Additive: the existing
--       `verified_question_count` column and ALL row filtering are unchanged.
--   §3  select_quiz_questions_rag — widen 'failed' to all three disproved
--       states. Only ever removes rows.
--   §4  select_quiz_questions_v2 — add the Tier-0 floor (it had none at all).
--       Only ever removes rows.
--
-- NOT TOUCHED, DELIBERATELY:
--   * start_mock_test_attempt (20260722097000) — all three `is_verified = true`
--     predicates stand. The exam path is the whole point of choosing option 3
--     over option 2. This file contains no reference to that function beyond
--     this comment; `git show --stat` is the proof.
--   * recompute_syllabus_status(), cbse_syllabus rows, rag_status semantics —
--     architect owns those in slot 13 this wave.
--   * packages/lib/src/quiz/question-validation.ts — the read-time P6 gate is
--     unchanged and still runs on every path.
--   * P1 scoring, P2 XP, P4 atomic submission — untouched.
--
-- KNOWN INCONSISTENCY LEFT IN PLACE (reported, not silently fixed):
--   `select_quiz_questions_rag` uses a STRICT `content_status = 'published'`,
--   which excludes legacy NULL rows. Every floor this migration ADDS is
--   null-tolerant. Relaxing the RAG predicate would WIDEN what serves, and no
--   widening ships during a SEV1 without a census first. Census query is in
--   the report; follow-up owned by architect.
--
-- Idempotent: CREATE OR REPLACE throughout, except §2 which must DROP first
-- (Postgres cannot add columns to a RETURNS TABLE via REPLACE) and re-grants
-- explicitly. Additive: no table, column, or index is dropped or altered.
-- No RLS surface is created or changed (P8: nothing new to police here — all
-- four functions are pre-existing SECURITY DEFINER RPCs whose grants are
-- preserved or restated verbatim).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  get_quiz_questions — the one inconsistent rung
-- ═══════════════════════════════════════════════════════════════════════════
-- Two overloads exist (4-arg from the baseline, 5-arg from 20260505155525).
-- BOTH are updated: leaving the 4-arg one un-floored would just relocate the
-- defect. Neither overload is dropped (P: no DROP; also mobile's generated
-- client references the 4-arg shape).

-- ─── 1a. 5-arg overload (the one 20260505155525 added is_verified to) ───────
CREATE OR REPLACE FUNCTION public.get_quiz_questions(
  p_subject       text,
  p_grade         text,
  p_count         integer  DEFAULT 10,
  p_difficulty    integer  DEFAULT NULL,
  p_chapter_number integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_questions JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, question_type, options, correct_answer_index,
             explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number
        FROM question_bank
       WHERE subject   = p_subject
         AND grade     = p_grade
         AND is_active = true
         -- Tier-0 floor. REPLACES the `is_verified = true` filter that
         -- 20260505155525 added: SME sign-off no longer gates the practice
         -- path (Decision A option 3), but a soft-deleted, unpublished, or
         -- verifier-DISPROVED row must still never reach a student.
         AND deleted_at IS NULL
         AND (content_status IS NULL OR content_status = 'published')
         AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
         AND (p_difficulty     IS NULL OR difficulty     = p_difficulty)
         AND (p_chapter_number IS NULL OR chapter_number = p_chapter_number)
       -- SME-verified rows are PREFERRED, not required — the tiered posture
       -- expressed as ranking. Architecturally identical to the verified_rank
       -- column select_quiz_questions_rag already uses (20260802100000 §3.3).
       -- Reverting just this line restores pure-random order; it changes which
       -- questions come first, never which questions are eligible.
       ORDER BY (is_verified IS NOT TRUE), random()
       LIMIT p_count
    ) q;
  ELSE
    v_questions := '[]'::JSONB;
  END IF;

  RETURN v_questions;
END;
$function$;

COMMENT ON FUNCTION public.get_quiz_questions(text, text, integer, integer, integer) IS
  'Practice/daily quiz serving rung. Decision A option 3 (tiered, 2026-08-14): '
  'the is_verified (human SME) filter added by 20260505155525 is REMOVED here '
  'and preserved on start_mock_test_attempt instead; is_verified now only '
  'ranks. Tier-0 floor added in the same change (deleted_at, content_status, '
  'the three disproved verification_states) so this is a net narrowing.';

-- ─── 1b. 4-arg overload (baseline; had NO verification floor whatsoever) ────
-- Same Tier-0 floor. Also removes the curriculum_topics fallback branch, which
-- fabricated questions with placeholder options ["Option A".."Option D"] and a
-- hardcoded correct_answer_index of 0 — a P6 violation and a guaranteed-wrong
-- answer key on a scoring path (P1). It is unreachable today (its guard is
-- "does a table named question_bank exist", which is always true), so removing
-- it is a zero-blast-radius landmine removal, not a behaviour change. The
-- branch now returns '[]', matching the 5-arg overload's shape exactly.
--
-- The baseline's `SELECT id INTO v_subject_id FROM subjects WHERE code = ...`
-- early-return goes with it: it existed only to scope the curriculum_topics
-- branch. For the question_bank branch it was a no-op — an unrecognised subject
-- code matches no question_bank row either way, so both versions return '[]'.
-- Dropping it also removes an unnecessary read of `subjects` from a hot path.
CREATE OR REPLACE FUNCTION public.get_quiz_questions(
  p_subject    text,
  p_grade      text,
  p_count      integer DEFAULT 10,
  p_difficulty integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_questions JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, options, correct_answer_index,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
       WHERE subject   = p_subject
         AND grade     = p_grade
         AND is_active = true
         AND deleted_at IS NULL
         AND (content_status IS NULL OR content_status = 'published')
         AND verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
         AND (p_difficulty IS NULL OR difficulty = p_difficulty)
       ORDER BY (is_verified IS NOT TRUE), random()
       LIMIT p_count
    ) q;
  ELSE
    v_questions := '[]'::JSONB;
  END IF;

  RETURN v_questions;
END;
$function$;

COMMENT ON FUNCTION public.get_quiz_questions(text, text, integer, integer) IS
  'Legacy 4-arg overload. 2026-08-14: given the same Tier-0 floor as the 5-arg '
  'overload, and the curriculum_topics fallback branch (placeholder '
  '["Option A".."Option D"] options with correct_answer_index 0 — P6/P1 hazard) '
  'removed. Ambiguity risk with the 5-arg overload on 3-named-arg PostgREST '
  'calls is a separate, pre-existing follow-up for architect.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  available_chapters_for_student_subject_v2 — the truthful badge
-- ═══════════════════════════════════════════════════════════════════════════
-- ADDITIVE COUNT SPLIT. Row filtering (board fallback, grade, subject_code,
-- rag_status IN ('partial','ready'), is_in_scope) is carried over BYTE-FOR-BYTE
-- from 20260605000000 — architect is reconciling cbse_syllabus in slot 13 and
-- this migration deliberately does not restructure what that RPC selects, only
-- what it counts.
--
-- DROP + CREATE (not REPLACE) is REQUIRED: Postgres cannot change a function's
-- return type in place, and this adds two OUT columns. The DROP is of a
-- FUNCTION, not a table or column. Grants are lost on DROP and are restated
-- below verbatim from 20260512000000 + 20260515000002. search_path is restated
-- as 'public, auth, pg_catalog' to preserve the hardening 20260614200000
-- applied to this specific function — recreating it with plain 'public' would
-- silently revert that.
--
-- NEW RESPONSE CONTRACT (frontend handoff — see report):
--   verified_question_count  UNCHANGED. verification_state='verified' only.
--                            Kept so no existing consumer breaks. Do NOT use
--                            it for the badge any more: it is neither
--                            "servable" nor "exam-ready", it is "an agent
--                            proved this against NCERT".
--   practice_ready_count     Rows that clear the Tier-0 floor => rows the
--                            practice/daily-quiz path can actually serve
--                            TODAY. THIS is the number the picker badge must
--                            show. It is the honest answer to "how many
--                            questions do I get if I tap this chapter".
--   exam_ready_count         Tier-0 floor AND is_verified = true => rows that
--                            additionally clear the human SME gate that
--                            start_mock_test_attempt enforces.
--
-- exam_ready_count is a chapter-level UPPER BOUND on exam usability, not a
-- guarantee: start_mock_test_attempt selects at SUBJECT/GRADE scope, adds a
-- source_type restriction, and runs a 3-step difficulty fallback ladder. That
-- source_type list is deliberately NOT mirrored here — copying it would create
-- silent drift the day the mock ladder changes, in exchange for precision that
-- is unattainable anyway at chapter scope. exam_ready_count = 0 does reliably
-- mean "nothing in this chapter can appear in a mock test".
--
-- Cost: three correlated counts per chapter row instead of one. Covered by the
-- existing idx_qb_subject_grade_chapter / idx_qb_grade_subject_chapter partial
-- indexes; ~15 chapter rows per call. No new index needed.
DROP FUNCTION IF EXISTS public.available_chapters_for_student_subject_v2(UUID, TEXT);

CREATE FUNCTION public.available_chapters_for_student_subject_v2(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number          INTEGER,
  chapter_title           TEXT,
  chapter_title_hi        TEXT,
  verified_question_count INTEGER,
  practice_ready_count    INTEGER,
  exam_ready_count        INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
  v_board      TEXT;
BEGIN
  IF p_subject_code IS NULL OR LENGTH(p_subject_code) = 0 THEN
    RETURN;
  END IF;

  SELECT id, grade, COALESCE(board, 'CBSE') INTO v_student_id, v_grade, v_board
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH active_board AS (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.cbse_syllabus cs2
       WHERE cs2.board        = v_board
         AND cs2.grade        = v_grade
         AND cs2.subject_code = p_subject_code
         AND cs2.rag_status   IN ('partial', 'ready')
         AND cs2.is_in_scope  = TRUE
    ) THEN v_board ELSE 'CBSE' END AS board
  )
  SELECT
    cs.chapter_number,
    cs.chapter_title,
    cs.chapter_title_hi,
    -- UNCHANGED semantics (back-compat).
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active
         AND qb.deleted_at IS NULL
         AND qb.verification_state = 'verified'
    ), 0) AS verified_question_count,
    -- NEW: what the practice/daily-quiz path can actually serve (Tier-0 floor).
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active = true
         AND qb.deleted_at IS NULL
         AND (qb.content_status IS NULL OR qb.content_status = 'published')
         AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    ), 0) AS practice_ready_count,
    -- NEW: Tier-0 floor PLUS the human SME gate the exam path still enforces.
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active = true
         AND qb.deleted_at IS NULL
         AND (qb.content_status IS NULL OR qb.content_status = 'published')
         AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
         AND qb.is_verified = true
    ), 0) AS exam_ready_count
  FROM public.cbse_syllabus cs, active_board ab
  WHERE cs.board        = ab.board
    AND cs.grade        = v_grade
    AND cs.subject_code = p_subject_code
    AND cs.rag_status   IN ('partial', 'ready')
    AND cs.is_in_scope  = TRUE
  ORDER BY cs.chapter_number;
END;
$$;

-- Grants restated verbatim (DROP discarded them): 20260512000000 granted
-- authenticated + service_role; 20260515000002 revoked anon.
REVOKE ALL ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) IS
  'Layer-2 SSoT chapter picker. 2026-08-14 (Decision A option 3): count split '
  'into practice_ready_count (Tier-0 floor = what practice can serve) and '
  'exam_ready_count (Tier-0 + is_verified = what the SME-gated mock-test path '
  'can serve). verified_question_count kept unchanged for back-compat but is '
  'NOT a servability signal. Row filtering (board fallback, rag_status, '
  'is_in_scope) carried over unchanged from 20260605000000.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  select_quiz_questions_rag — widen the disproved-state exclusion
-- ═══════════════════════════════════════════════════════════════════════════
-- Body below is the definition from 20260802100000 lines 162-425, VERBATIM,
-- with exactly four textual substitutions and nothing else:
--     AND qb.verification_state != 'failed'
--  -> AND qb.verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')
-- at the pool-count, seen-count, reset/delete and candidate_pool blocks — the
-- same four repeated blocks 20260802100000 §2.1 requires to stay in sync (an
-- inconsistency between them mis-triggers the REG-172 80%-reset logic).
--
-- The strict-rung pool count (`verification_state = 'verified'`, line ~285 of
-- the source) is untouched: it is an equality on the positive state, not a
-- disproved-state exclusion.
--
-- Generated by textual transform of the extracted source, then diffed to prove
-- those 4 lines are the ONLY delta. This ONLY EVER REMOVES ROWS — the worst
-- case is fewer questions, never a wrong one.
CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[],
  p_query_embedding vector DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool   INTEGER;
  v_seen_count   INTEGER;
  v_result       JSONB;
  MIN_POOL_FOR_RESET CONSTANT INTEGER := 10;
  -- ── Verification-gate ladder state (spec §2.2/§2.3/§3) ──────────────────
  v_pair_enforced  BOOLEAN := false;
  v_verified_pool  INTEGER := 0;
  v_use_strict     BOOLEAN := false;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Pool-count query. Tier-0 (spec §2.1) added: deleted_at IS NULL,
  -- content_status = 'published', verification_state != 'failed'. Applied
  -- here identically to the seen-count, reset/delete, and candidate_pool
  -- blocks below (AC-7) so this count never disagrees with what
  -- candidate_pool can actually return.
  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
    AND qb.deleted_at IS NULL
    AND qb.content_status = 'published'
    AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id
    AND h.subject = p_subject
    AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND qb.deleted_at IS NULL
        AND qb.content_status = 'published'
        AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  -- 80% pool reset — guarded by minimum pool size to prevent infinite cycle on
  -- thin chapters (< 10 questions would reset on every call at 100% seen).
  -- (REG-172, unrelated to this fix, unchanged; Tier-0-consistent v_total_pool
  -- above is what keeps this heuristic sound after this migration.)
  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND qb.deleted_at IS NULL
          AND qb.content_status = 'published'
          AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  -- ── §2.2/§2.3: enforced-pairs lookup + local-thinness fallback ladder ───
  -- One cheap composite-PK (grade, subject_code) lookup. Deliberately SHORT-
  -- CIRCUITED: the verified-pool count query below only runs when the pair
  -- is enforced. For the ~100% of (grade, subject) pairs that are NOT
  -- enforced today, v_use_strict is false regardless of pool size and no
  -- telemetry fires (spec AC-3), so skipping the extra count query there is
  -- a pure performance win with zero observable behavior difference from
  -- computing it unconditionally.
  SELECT EXISTS (
    SELECT 1 FROM ff_grounded_ai_enforced_pairs
    WHERE grade = p_grade AND subject_code = p_subject AND enabled = true
  ) INTO v_pair_enforced;

  IF v_pair_enforced THEN
    -- Verified-pool count for the EXACT requested slice — same subject/
    -- grade/is_active/chapter/type/difficulty scoping as candidate_pool
    -- below (spec §2.3: the pair-level 90% aggregate can mask a
    -- locally-thin chapter/difficulty slice). verification_state='verified'
    -- is strictly narrower than != 'failed', so Tier-0's failed-exclusion is
    -- already implied here and not repeated separately.
    SELECT COUNT(*) INTO v_verified_pool
    FROM question_bank qb
    WHERE qb.subject = p_subject
      AND qb.grade = p_grade
      AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state = 'verified'
      AND qb.verified_against_ncert = true
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      );
  END IF;

  -- Rung E0 (strict) iff the pair is enforced AND the verified pool for this
  -- exact slice already meets the requested count (spec §3.1, inclusive >=).
  v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;

  -- Telemetry (spec §3.5): fires ONLY for the enforced-but-locally-thin case
  -- (Rung E1 reached because of thinness), never for the unenforced-default
  -- case (AC-3 — that path is expected, not a gap). Fail-open: a telemetry
  -- failure must never break question serving, matching the established
  -- pattern in submit_quiz_results_v2 (20260702150000 / 20260707010000).
  IF v_pair_enforced AND v_verified_pool < p_count THEN
    BEGIN
      INSERT INTO ops_events (
        occurred_at, category, source, severity,
        subject_type, subject_id, message, context, environment
      ) VALUES (
        NOW(),
        'grounding.quiz_serving',
        'select_quiz_questions_rag',
        'warning',
        'quiz_verification_pair', p_grade || '::' || p_subject,
        'quiz_verification_gap',
        jsonb_build_object(
          'grade', p_grade,
          'subject', p_subject,
          'chapter_number', p_chapter_number,
          'difficulty_mode', p_difficulty_mode,
          'question_types', p_question_types,
          'verified_pool_count', v_verified_pool,
          'requested_count', p_count
        ),
        COALESCE(current_setting('app.environment', true), 'production')
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  WITH seen_ids AS (
    SELECT h.question_id FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  candidate_pool AS (
    SELECT
      qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2,
      qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
      qb.difficulty, qb.bloom_level, qb.chapter_number,
      ch.title AS chapter_title,
      qb.concept_tag, qb.case_passage, qb.case_passage_hi,
      qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
      qb.is_ncert, qb.ncert_exercise,
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
      -- Ranking preference only (spec §3.3) — never a filter outside the
      -- strict rung's own WHERE predicate below. Zero availability impact.
      CASE WHEN qb.verification_state = 'verified' THEN 0 ELSE 1 END AS verified_rank,
      CASE
        WHEN p_query_embedding IS NOT NULL AND qb.embedding IS NOT NULL
        THEN 1 - (qb.embedding <=> p_query_embedding)
        ELSE random()
      END AS relevance_score,
      COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
      -- Rung E0/E1 ladder (spec §2.2/§2.3/§3.2): the strict verification
      -- predicate applies ONLY when v_use_strict is true (pair enforced AND
      -- this exact slice's verified pool already meets p_count). Otherwise
      -- this ANDs to TRUE and behaves exactly as the pre-existing Tier-0-only
      -- filter above (Rung E1 / unenforced default).
      AND (NOT v_use_strict OR (qb.verified_against_ncert = true AND qb.verification_state = 'verified'))
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC, last_shown_at
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC) AS rn
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT * FROM numbered WHERE rn <= p_count
    ORDER BY CASE WHEN p_difficulty_mode = 'progressive' THEN
      CASE WHEN rn <= GREATEST(1,(p_count*0.3)::INTEGER) THEN difficulty
           WHEN rn <= GREATEST(2,(p_count*0.7)::INTEGER) THEN ABS(difficulty-2)
           ELSE ABS(difficulty-3) END
    ELSE rn END, rn
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'question_text', question_text, 'question_hi', question_hi,
    'question_type', COALESCE(question_type,'mcq'), 'question_type_v2', COALESCE(question_type_v2,'mcq'),
    'options', options, 'correct_answer_index', correct_answer_index,
    'explanation', explanation, 'explanation_hi', explanation_hi, 'hint', hint,
    'difficulty', difficulty, 'bloom_level', bloom_level, 'chapter_number', chapter_number,
    'chapter_title', chapter_title, 'concept_tag', concept_tag,
    'case_passage', case_passage, 'case_passage_hi', case_passage_hi,
    'expected_answer', expected_answer, 'expected_answer_hi', expected_answer_hi,
    'max_marks', max_marks, 'is_ncert', COALESCE(is_ncert, false), 'ncert_exercise', ncert_exercise
  ) ORDER BY rn) INTO v_result FROM selected;

  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER,
         now(), now(), 1
  FROM jsonb_array_elements(COALESCE(v_result,'[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(), times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


COMMENT ON FUNCTION public.select_quiz_questions_rag IS
  'Primary quiz serving RPC. 2026-08-14: the Tier-0 disproved-state exclusion '
  'was widened from the literal ''failed'' to all three disproved states '
  '(''failed'', ''failed_fix_in_flight'', ''failed_unfixable''). The CHECK was '
  'widened to six states by 20260510064952 but every gate kept testing only '
  '''failed'', so rows the verifier had DISPROVED and the repair agent had '
  'claimed were still servable. Everything else (rung ladder, ff_grounded_ai_'
  'enforced_pairs gating, telemetry, pool-reset guard, ncert/verified ranking) '
  'is unchanged from 20260802100000.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  select_quiz_questions_v2 — add the Tier-0 floor (it had NONE)
-- ═══════════════════════════════════════════════════════════════════════════
-- This is rung 3 of the live client ladder in packages/lib/src/domains/quiz.ts
-- (rag -> v2 -> direct query), so it is reachable in production whenever the
-- RAG rung comes back empty — and it filtered `is_active` only. A row the
-- verifier had DISPROVED, or a soft-deleted row, or a draft, could be served
-- here with no gate at all. That is strictly worse than the badge defect this
-- SEV1 opened on, and it is the same defect family.
--
-- Body below is the definition from 20260625000200 lines 175-315, VERBATIM,
-- with exactly one three-line insertion after each of the four
-- `WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true`
-- anchors (pool-count, seen-count subquery, 80%-reset DELETE subquery,
-- candidate_pool CTE) and nothing else. All four blocks must stay identical or
-- the pool-count math desynchronises from the candidate set and mis-triggers
-- the MIN_POOL_FOR_RESET guard — the same failure mode 20260802100000 §2.1
-- calls out for the RAG RPC.
--
-- Generated by textual transform of the extracted source, then diffed to prove
-- those 12 lines are the ONLY delta. This ONLY EVER REMOVES ROWS.
CREATE OR REPLACE FUNCTION public.select_quiz_questions_v2(
  p_student_id uuid,
  p_subject text,
  p_grade text,
  p_chapter_number integer DEFAULT NULL,
  p_count integer DEFAULT 10,
  p_difficulty_mode text DEFAULT 'mixed',
  p_question_types text[] DEFAULT ARRAY['mcq']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_pool INTEGER;
  v_seen_count INTEGER;
  v_result     JSONB;
  MIN_POOL_FOR_RESET CONSTANT INTEGER := 10;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
    AND qb.deleted_at IS NULL
    AND (qb.content_status IS NULL OR qb.content_status = 'published')
    AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
    AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
    AND (
      qb.question_type_v2 = ANY(p_question_types)
      OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
    );

  IF v_total_pool = 0 THEN RETURN '[]'::jsonb; END IF;

  SELECT COUNT(*) INTO v_seen_count
  FROM user_question_history h
  WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
    AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
    AND h.question_id IN (
      SELECT qb.id FROM question_bank qb
      WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
        AND qb.deleted_at IS NULL
        AND (qb.content_status IS NULL OR qb.content_status = 'published')
        AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  -- 80% pool reset — guarded by minimum pool size.
  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND qb.deleted_at IS NULL
          AND (qb.content_status IS NULL OR qb.content_status = 'published')
          AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  WITH seen_ids AS (
    SELECT h.question_id FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
  ),
  candidate_pool AS (
    SELECT qb.id, qb.question_text, qb.question_hi, qb.question_type, qb.question_type_v2,
           qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
           qb.difficulty, qb.bloom_level, qb.chapter_number,
           ch.title AS chapter_title,
           qb.concept_tag, qb.case_passage, qb.case_passage_hi,
           qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
           qb.is_ncert, qb.ncert_exercise,
           CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
           CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
           COALESCE(h.last_shown_at, '1970-01-01'::timestamptz) AS last_shown_at,
           random() AS rand_order
    FROM question_bank qb
    LEFT JOIN seen_ids s ON s.question_id = qb.id
    LEFT JOIN user_question_history h ON h.student_id = p_student_id AND h.question_id = qb.id
    LEFT JOIN chapters ch ON ch.id = qb.chapter_id
    WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND (qb.content_status IS NULL OR qb.content_status = 'published')
      AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
      AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
      AND (
        qb.question_type_v2 = ANY(p_question_types)
        OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
      )
      AND (
        p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'
        OR (p_difficulty_mode = 'easy' AND qb.difficulty = 1)
        OR (p_difficulty_mode = 'medium' AND qb.difficulty = 2)
        OR (p_difficulty_mode = 'hard' AND qb.difficulty = 3)
      )
    ORDER BY seen_rank, ncert_rank, last_shown_at, rand_order
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, rand_order) AS rn
    FROM candidate_pool cp
  ),
  selected AS (
    SELECT n.* FROM numbered n WHERE n.rn <= p_count
    ORDER BY CASE WHEN p_difficulty_mode = 'progressive'
                  THEN CASE WHEN n.rn <= GREATEST(1, (p_count * 0.3)::INTEGER) THEN n.difficulty
                            WHEN n.rn <= GREATEST(2, (p_count * 0.7)::INTEGER) THEN ABS(n.difficulty - 2)
                            ELSE ABS(n.difficulty - 3) END
                  ELSE n.rn
             END, n.rn
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', sel.id, 'question_text', sel.question_text, 'question_hi', sel.question_hi,
    'question_type', COALESCE(sel.question_type, 'mcq'),
    'question_type_v2', COALESCE(sel.question_type_v2, 'mcq'),
    'options', sel.options, 'correct_answer_index', sel.correct_answer_index,
    'explanation', sel.explanation, 'explanation_hi', sel.explanation_hi, 'hint', sel.hint,
    'difficulty', sel.difficulty, 'bloom_level', sel.bloom_level, 'chapter_number', sel.chapter_number,
    'chapter_title', sel.chapter_title, 'concept_tag', sel.concept_tag,
    'case_passage', sel.case_passage, 'case_passage_hi', sel.case_passage_hi,
    'expected_answer', sel.expected_answer, 'expected_answer_hi', sel.expected_answer_hi,
    'max_marks', sel.max_marks, 'is_ncert', COALESCE(sel.is_ncert, false),
    'ncert_exercise', sel.ncert_exercise
  ) ORDER BY sel.rn) INTO v_result FROM selected sel;

  INSERT INTO user_question_history (student_id, question_id, subject, grade, chapter_number,
                                     first_shown_at, last_shown_at, times_shown)
  SELECT p_student_id, (q->>'id')::UUID, p_subject, p_grade, (q->>'chapter_number')::INTEGER,
         now(), now(), 1
  FROM jsonb_array_elements(COALESCE(v_result, '[]'::jsonb)) AS q
  ON CONFLICT (student_id, question_id) DO UPDATE SET
    last_shown_at = now(), times_shown = user_question_history.times_shown + 1;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


COMMENT ON FUNCTION public.select_quiz_questions_v2 IS
  'Fallback quiz serving RPC (rung 3 of the client ladder). 2026-08-14: given '
  'the Tier-0 floor it never had — deleted_at IS NULL, content_status '
  'null-or-published, verification_state NOT IN the three disproved states — '
  'applied identically to all four repeated predicate blocks so the pool-count '
  'math stays in sync with the candidate set (MIN_POOL_FOR_RESET guard from '
  '20260625000200 is otherwise unchanged).';

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  Audit marker
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'content_integrity.tiered_verification_serving_applied',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'decision', 'Decision A option 3 (tiered) — CEO-approved SEV1 #12',
    'practice_path', 'is_verified filter REMOVED from get_quiz_questions (both overloads); Tier-0 floor added',
    'exam_path', 'start_mock_test_attempt untouched — all three is_verified predicates preserved',
    'picker_badge', 'available_chapters_for_student_subject_v2 now returns practice_ready_count + exam_ready_count alongside the unchanged verified_question_count',
    'tier0_floor', jsonb_build_array(
      'is_active = true',
      'deleted_at IS NULL',
      'content_status IS NULL OR content_status = ''published''',
      'verification_state NOT IN (failed, failed_fix_in_flight, failed_unfixable)'
    ),
    'also_closed', jsonb_build_array(
      'select_quiz_questions_rag: disproved-state exclusion widened from failed to all three',
      'select_quiz_questions_v2: Tier-0 floor added (previously none)',
      'get_quiz_questions 4-arg: curriculum_topics placeholder-question fallback removed (P6/P1 hazard)'
    ),
    'owner', 'assessment',
    'migration_slot', '20260814000014'
  ),
  now()
);

COMMIT;
