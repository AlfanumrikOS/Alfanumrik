-- Migration: 20260801100700_select_quiz_questions_rag_service_role_skip.sql
-- Purpose: WhatsApp Daily-6 (Phase 3) — bring select_quiz_questions_rag's
--          ownership guard in line with the documented convention of its
--          sibling quiz RPCs so service-role callers (auth.uid() IS NULL)
--          are not rejected.
--
-- ─── Why ─────────────────────────────────────────────────────────────────────
-- The current definition (migration 20260625000200) carries a STRICT ownership
-- check with no null-skip:
--
--   IF NOT EXISTS (SELECT 1 FROM students
--                  WHERE id = p_student_id AND auth_user_id = auth.uid()) THEN
--     RAISE EXCEPTION 'Access denied';
--
-- Under a service-role client auth.uid() is NULL, so the check ALWAYS raises —
-- unlike the two sibling quiz RPCs, whose guards deliberately skip for
-- service-role / cron / edge callers:
--
--   * start_quiz_session      (baseline 00000000000000_baseline_from_prod.sql,
--                              ~line 7101): "Skip the check when called from
--                              the service_role context (auth.uid() is NULL)
--                              so admin / cron / RPC-from-edge-function paths
--                              still work."
--   * submit_quiz_results_v2  (20260729120001_fix_quiz_rpc_defects.sql,
--                              lines 141-147): "Ownership check (same pattern
--                              as start_quiz_session)."
--
-- This migration applies the SAME `auth.uid() IS NOT NULL AND` skip to
-- select_quiz_questions_rag. The WhatsApp Daily-6 top-up path
-- (apps/host/src/app/api/whatsapp/_lib/daily6.ts, composeDaily6Set) calls this
-- RPC under service role and currently degrades to the floor-3 rule on every
-- top-up because the guard raises.
--
-- ─── Security posture (why the skip is safe here) ────────────────────────────
-- The skip does NOT remove ownership enforcement for the WhatsApp bot — it
-- relocates nothing that wasn't already true for the sibling RPCs. The bot's
-- ownership boundary is the resolveActiveStudent() chokepoint
-- (packages/lib/src/whatsapp/identity.ts — plan invariant R6, P14-binding):
-- p_student_id for EVERY bot-originated quiz/mastery RPC originates ONLY from
-- that resolver (OTP-verified, live-identity-gated binding); no student id is
-- ever accepted from an inbound message, button opcode, or any other
-- channel-controlled surface. Service-role code paths are server-only (P8:
-- supabase-admin.ts never ships to clients). JWT-authenticated callers
-- (auth.uid() IS NOT NULL) keep the exact same ownership check as before.
--
-- SECURITY DEFINER (pre-existing, unchanged): required so the function can
-- read question_bank and read/write user_question_history across RLS on
-- behalf of the resolved student; search_path is pinned to 'public'.
--
-- ─── Scope ───────────────────────────────────────────────────────────────────
-- ONLY the guard's IF condition changes (`auth.uid() IS NOT NULL AND` added).
-- The rest of the body is copied byte-for-byte from the 20260625000200
-- definition (the current one). select_quiz_questions_v2 is NOT touched — no
-- service-role caller needs it today; widen it only when a concrete caller
-- exists.
--
-- Idempotent (CREATE OR REPLACE), additive. No table/RLS changes. No
-- REVOKE/GRANT statements here — the 20260625000200 definition issues none,
-- and CREATE OR REPLACE preserves the function's existing ACL, so the grant
-- posture is exactly what it was before this migration.
--
-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Re-apply the 20260625000200 definition of select_quiz_questions_rag (a
-- compensating CREATE OR REPLACE restoring the strict guard). No data
-- migration needed in either direction.
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, Phase-3 Daily-6).
-- Spec: docs/superpowers/specs/2026-07-30-whatsapp-daily6-behavioral-spec.md

BEGIN;

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
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_total_pool
  FROM question_bank qb
  WHERE qb.subject = p_subject
    AND qb.grade = p_grade
    AND qb.is_active = true
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
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  -- 80% pool reset — guarded by minimum pool size to prevent infinite cycle on
  -- thin chapters (< 10 questions would reset on every call at 100% seen).
  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
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
    ORDER BY seen_rank, ncert_rank, relevance_score DESC, last_shown_at
    LIMIT p_count * 3
  ),
  numbered AS (
    SELECT cp.*, ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, relevance_score DESC) AS rn
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
  'Phase 1.5 (2026-05-09): question-type filter widened so '
  '''ncert'' in p_question_types matches qb.is_ncert=TRUE rows of any '
  'question_type_v2. Other types behave as before. '
  '2026-06-25: pool-reset guard added (MIN_POOL_FOR_RESET=10) to prevent '
  'infinite question-cycle on thin chapters (< 10 questions). '
  '2026-08-01: ownership guard now skips when auth.uid() IS NULL '
  '(service-role/cron/edge callers), matching start_quiz_session and '
  'submit_quiz_results_v2. Bot-side ownership lives at the '
  'resolveActiveStudent chokepoint (R6).';

COMMIT;
