-- H1 (finding C2, deferred since 20260814000000; closes it): public.question_bank
-- had a table-level ALL grant (baseline default privileges) to anon/authenticated,
-- and the only SELECT policy for authenticated ("question_bank_authenticated_read",
-- USING (true)) has no row scoping — so any authenticated user (students, parents,
-- teachers all share this DB role) could read the answer key for any of the
-- ~12.8k questions directly via PostgREST:
--   GET /rest/v1/question_bank?select=id,correct_answer_index&id=eq.<uuid>
--
-- WHY THIS IS SAFE TO CLOSE NOW (re-verified 2026-08-31, independently twice):
--   * All server-side scoring/serving RPCs (select_quiz_questions_rag,
--     select_quiz_questions_v2, get_quiz_questions x2, start_quiz_session,
--     check_quiz_answer, submit_quiz_results_v2) are SECURITY DEFINER — caller-role
--     ACLs never apply to them, and migration 20260814000023 already confirmed
--     removed the key from every serving payload.
--   * Every client-authenticated code path (web `'use client'` components
--     apps/host/src/app/(student)/quiz/page.tsx, .../pyq/page.tsx via
--     packages/lib/src/quiz-assembler.ts PYQ_COLUMNS and
--     packages/lib/src/supabase.ts getQuizQuestions/getQuizQuestionsV2/
--     getQuestionHistoryStats) already uses an explicit column list excluding
--     the answer key — some of these comments cite this exact migration by name
--     as already anticipated.
--   * Mobile: mobile/lib/data/repositories/quiz_repository.dart (commit
--     681b8b43, 2026-08-11) already calls .select(_questionColumns) — an
--     explicit list excluding correct_answer_index — on BOTH the useV2=true and
--     useV2=false (default) paths. mobile/pyq_repository.dart no longer exists
--     (retired the same commit).
--   * No evidence of a real installed mobile user base: mobile/pubspec.yaml
--     version frozen at 1.1.0+2 since 2026-06-06, zero `mobile-v*` release tags
--     ever pushed, LAUNCH_CHECKLIST.md's Play Store row unchecked, Play Store
--     listing assets explicitly marked as placeholders. 24h Edge/PostgREST logs
--     sampled across 4 windows spanning 6+ weeks show zero authenticated-role
--     traffic to question_bank at all (only service_role + internal Edge
--     Function callers). Total students table: 75 rows.
--   * content_reporter role's existing SELECT policy (20260814000015) already
--     withholds these columns via its own column grants — untouched by this
--     migration (only anon/authenticated are touched below).
--
-- MECHANISM: a column-level REVOKE alone would be a no-op against the baseline
-- table-level ALL grant (documented trap, 20260814000000) — REVOKE ALL first,
-- then GRANT SELECT on an explicit allowlist, is required. This migration
-- follows the exact, already-proven-in-production pattern of
-- 20260814000020_quiz_session_shuffles_answer_key_column_acl.sql.

BEGIN;

REVOKE ALL ON TABLE public.question_bank FROM PUBLIC;
REVOKE ALL ON TABLE public.question_bank FROM anon;
REVOKE ALL ON TABLE public.question_bank FROM authenticated;

-- Explicit allowlist: every column of question_bank as of this migration
-- EXCEPT the 9 answer-key columns (correct_answer_index, correct_answer_text,
-- expected_answer, expected_answer_hi, answer_text, answer_text_hi,
-- answer_rubric, answer_methodology, solution_steps) — the same 9-column key
-- set already pinned by
-- apps/host/src/__tests__/security/question-bank-answer-key-exposure.test.ts.
-- A future column not listed here fails CLOSED, not open.
GRANT SELECT (
  id, subject, grade, topic_id, chapter_number, question_text, question_hi,
  question_hinglish, question_type, options, explanation, explanation_hi,
  hint, difficulty, bloom_level, tags, source, irt_difficulty,
  irt_discrimination, times_shown, times_correct, avg_time_seconds,
  is_active, is_verified, created_at, generation_batch, times_wrong,
  discrimination_index, last_served_at, concept_code, layer, deleted_at,
  updated_at, board_year, marks, cbse_question_type, paper_section,
  cognitive_load, prerequisite_concepts, common_mistakes,
  time_estimate_seconds, cbse_paper_id, interleaving_eligible, irt_guessing,
  irt_calibrated, irt_response_count, hint_level_1, hint_level_2,
  hint_level_3, content_status, created_by, updated_by, reviewed_by,
  published_by, published_at, review_notes, search_vector, source_version,
  concept_tag, chapter_id, question_type_v2, case_passage, case_passage_hi,
  max_marks, ncert_exercise, ncert_page, is_ncert, board_relevance,
  board_relevance_note, source_type, marks_expected, embedding, embedded_at,
  verified_against_ncert, verification_state, verification_claimed_by,
  verification_claim_expires_at, verifier_chunk_ids, verifier_model,
  verifier_trace_id, verified_at, verifier_failure_reason, irt_a, irt_b,
  irt_calibration_n, irt_calibrated_at, quality_status, chapter_title,
  exam_session, question_number, marks_correct, marks_wrong, paper_pattern,
  exam_paper_id
) ON TABLE public.question_bank TO authenticated;

-- Belt-and-braces: explicitly strip any pre-existing column-level grant on the
-- 9 key columns (no-op after the table-level REVOKE above on a clean
-- environment; matters if a prior ad hoc column GRANT exists).
REVOKE SELECT (
  correct_answer_index, correct_answer_text, expected_answer,
  expected_answer_hi, answer_text, answer_text_hi, answer_rubric,
  answer_methodology, solution_steps
) ON TABLE public.question_bank FROM anon, authenticated;

-- Self-verifying post-conditions. Any failure rolls back the whole transaction.
DO $$
DECLARE
  v_key_cols TEXT[] := ARRAY[
    'correct_answer_index', 'correct_answer_text', 'expected_answer',
    'expected_answer_hi', 'answer_text', 'answer_text_hi', 'answer_rubric',
    'answer_methodology', 'solution_steps'
  ];
  v_open_cols TEXT[] := ARRAY[
    'id', 'subject', 'grade', 'question_text', 'options', 'explanation',
    'difficulty', 'is_active', 'chapter_number'
  ];
  c TEXT;
BEGIN
  FOREACH c IN ARRAY v_key_cols LOOP
    IF has_column_privilege('authenticated', 'public.question_bank', c, 'SELECT') THEN
      RAISE EXCEPTION 'POST-CONDITION FAILED: authenticated can still SELECT question_bank.%', c;
    END IF;
    IF has_column_privilege('anon', 'public.question_bank', c, 'SELECT') THEN
      RAISE EXCEPTION 'POST-CONDITION FAILED: anon can still SELECT question_bank.%', c;
    END IF;
    IF NOT has_column_privilege('service_role', 'public.question_bank', c, 'SELECT') THEN
      RAISE EXCEPTION 'POST-CONDITION FAILED: service_role LOST SELECT on question_bank.% — server-side scoring would break', c;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY v_open_cols LOOP
    IF NOT has_column_privilege('authenticated', 'public.question_bank', c, 'SELECT') THEN
      RAISE EXCEPTION 'POST-CONDITION FAILED: authenticated lost SELECT on non-key column question_bank.% — quiz serving would break', c;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.question_bank', 'INSERT')
     OR has_table_privilege('authenticated', 'public.question_bank', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.question_bank', 'DELETE') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: authenticated retains a write privilege on question_bank';
  END IF;

  IF has_any_column_privilege('anon', 'public.question_bank', 'SELECT') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: anon retains a SELECT privilege on question_bank';
  END IF;
END
$$;

COMMENT ON TABLE public.question_bank IS
  'The live question inventory (~12.8k rows). ACL (migration H1/finding C2, 2026-08-31): the 9 answer-key columns (correct_answer_index, correct_answer_text, expected_answer, expected_answer_hi, answer_text, answer_text_hi, answer_rubric, answer_methodology, solution_steps) are service_role/owner only. authenticated holds column-level SELECT on the remaining columns and no write verb; anon holds nothing. Do NOT re-add a table-level GRANT SELECT to authenticated — that silently reopens the answer-key read for all ~12.8k questions. Scoring/serving stays correct via the existing SECURITY DEFINER RPCs (start_quiz_session, submit_quiz_results_v2, check_quiz_answer, select_quiz_questions_*, get_quiz_questions), none of which are affected by this ACL.';

COMMIT;

-- Rollback (compensating, if ever needed — reopens the leak, do not run
-- casually):
--   GRANT ALL ON TABLE public.question_bank TO authenticated;
--   GRANT ALL ON TABLE public.question_bank TO anon;
