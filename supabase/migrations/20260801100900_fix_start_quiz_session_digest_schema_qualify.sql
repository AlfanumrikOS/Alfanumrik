-- Migration: 20260801100900_fix_start_quiz_session_digest_schema_qualify.sql
-- Purpose: P0 follow-up -- the previous fix (20260801100800) restored
--          start_quiz_session but introduced a NEW failure: function
--          digest(text, unknown) does not exist (Postgres error 42883).
--
-- Root cause: pgcrypto digest() lives in the extensions schema on this
--   Supabase project, not public. This SECURITY DEFINER function has
--   SET search_path TO public only (unchanged from the prior fix), so a
--   bare digest() call cannot resolve, even though pgcrypto IS installed
--   (CREATE EXTENSION IF NOT EXISTS is a no-op when the extension exists
--   anywhere -- it does not move it into public).
--
-- Evidence: the identical extensions.digest(...) call shape already works
--   elsewhere in this codebase --
--   supabase/migrations/20260710170000_xc3_parent_link_code_otp_rpcs.sql:231
--
-- Verified live: calling start_quiz_session with real question_ids against
--   production immediately after 20260801100800 deployed reproduced this
--   exact error. This migration is the direct, evidenced correction.
--
-- This migration takes the function/comment block from 20260801100800
-- programmatically (sliced by line boundary, not retyped) and applies
-- exactly ONE substitution: digest( -> extensions.digest( on the single
-- call site, plus one appended sentence to the trailing COMMENT ON
-- FUNCTION. Nothing else changes -- this IS genuinely byte-preserving.
--
-- Backwards compatible: additive only, no schema change, no return-shape
-- change. Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;
CREATE OR REPLACE FUNCTION "public"."start_quiz_session"("p_student_id" "uuid", "p_question_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_session_id UUID := gen_random_uuid();
  v_qid UUID;
  v_options JSONB;
  v_options_arr JSONB;
  v_correct_idx INT;
  v_options_version INT;
  v_integrity_hash TEXT;
  v_shuffle INT[];
  v_displayed JSONB;
  v_questions JSONB := '[]'::jsonb;
  v_question_meta RECORD;
  v_temp INT;
  v_swap_idx INT;
  i INT;
BEGIN
  -- Ownership check: caller must own this student.
  -- service_role bypasses RLS but not this guard, so even an admin caller
  -- has to pass p_student_id matching auth.uid()'s student row.
  -- Skip the check when called from the service_role context (auth.uid()
  -- is NULL) so admin / cron / RPC-from-edge-function paths still work.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  IF p_question_ids IS NULL OR array_length(p_question_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_session_id,
      'questions', '[]'::jsonb
    );
  END IF;

  -- Iterate over input question IDs, generate per-question shuffle, snapshot.
  FOREACH v_qid IN ARRAY p_question_ids LOOP
    SELECT id, question_text, question_hi, options, correct_answer_index,
           explanation, explanation_hi, hint, difficulty, bloom_level,
           chapter_number, question_type
      INTO v_question_meta
      FROM question_bank
      WHERE id = v_qid AND is_active = true;

    -- Skip unknown / inactive questions silently — caller is responsible
    -- for filtering. We never want a bad ID in the input array to abort
    -- the entire session start.
    IF v_question_meta IS NULL THEN
      CONTINUE;
    END IF;

    -- Normalize options to a JSONB array.
    v_options := CASE
      WHEN jsonb_typeof(v_question_meta.options::jsonb) = 'array' THEN v_question_meta.options::jsonb
      ELSE NULL
    END;

    -- For non-MCQ or malformed options, store an identity shuffle and
    -- the snapshot as-is. Scoring still works because v_correct_idx is
    -- preserved verbatim in the snapshot.
    IF v_options IS NULL OR jsonb_array_length(v_options) <> 4 THEN
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      v_options_arr := COALESCE(v_options, '[]'::jsonb);
    ELSE
      -- Fisher-Yates shuffle on [0,1,2,3] using random().
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      FOR i IN REVERSE 4..2 LOOP
        -- random returns [0,1); floor((i) * random) gives 0..i-1.
        v_swap_idx := 1 + floor(random() * i)::INT;  -- 1-based for PL/pgSQL arrays
        v_temp := v_shuffle[i];
        v_shuffle[i] := v_shuffle[v_swap_idx];
        v_shuffle[v_swap_idx] := v_temp;
      END LOOP;
      v_options_arr := v_options;
    END IF;

    v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0);

    -- Fix (migration 20260801100800): question_bank.options_version does
    -- not exist in the current schema (see migration header). 0 is the
    -- documented sentinel for "no genuine version captured" per
    -- 20260504100500 — downstream drift-comparison consumers already treat
    -- 0 as "skip the comparison" rather than a real version.
    v_options_version := 0;

    -- Fix (migration 20260801100800): compute the integrity hash so the
    -- NOT NULL constraint added by 20260504100500 is satisfied. Format
    -- matches that migration's backfill exactly, byte-for-byte, so any
    -- future hash-verification logic in submit_quiz_results_v2 treats rows
    -- written before and after this fix identically.
    v_integrity_hash := encode(
      extensions.digest(v_options_arr::text || v_correct_idx::text, 'sha256'),
      'hex'
    );

    -- Persist snapshot. ON CONFLICT DO NOTHING keeps the RPC idempotent if
    -- the same (session_id, question_id) pair is submitted twice — though
    -- that should never happen because session_id is freshly generated.
    INSERT INTO quiz_session_shuffles (
      session_id, question_id, shuffle_map,
      options_snapshot, correct_answer_index_snapshot, student_id,
      options_version_at_serve, integrity_hash
    ) VALUES (
      v_session_id, v_qid, v_shuffle,
      v_options_arr, v_correct_idx, p_student_id,
      v_options_version, v_integrity_hash
    )
    ON CONFLICT (session_id, question_id) DO NOTHING;

    -- Build the displayed options array (in shuffled order) for the client.
    -- Client never receives correct_answer_index — that's intentional.
    IF jsonb_array_length(v_options_arr) = 4 THEN
      v_displayed := jsonb_build_array(
        v_options_arr -> v_shuffle[1],
        v_options_arr -> v_shuffle[2],
        v_options_arr -> v_shuffle[3],
        v_options_arr -> v_shuffle[4]
      );
    ELSE
      v_displayed := v_options_arr;
    END IF;

    v_questions := v_questions || jsonb_build_array(
      jsonb_build_object(
        'question_id', v_qid,
        'question_text', v_question_meta.question_text,
        'question_hi', v_question_meta.question_hi,
        'question_type', v_question_meta.question_type,
        'options_displayed', v_displayed,
        'explanation', v_question_meta.explanation,
        'explanation_hi', v_question_meta.explanation_hi,
        'hint', v_question_meta.hint,
        'difficulty', v_question_meta.difficulty,
        'bloom_level', v_question_meta.bloom_level,
        'chapter_number', v_question_meta.chapter_number
        -- DO NOT include correct_answer_index here. That's the bug class
        -- this migration closes.
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'questions', v_questions
  );
END;
$$;

COMMENT ON FUNCTION "public"."start_quiz_session"("p_student_id" "uuid", "p_question_ids" "uuid"[]) IS 'P0 fix (migration 20260428160000): server-owned shuffle authority for quiz sessions. Generates a per-question Fisher-Yates shuffle, snapshots options + correct_answer_index into quiz_session_shuffles, and returns the SHUFFLED options to the client WITHOUT correct_answer_index. Pair with submit_quiz_results_v2 — client sends only {question_id, selected_displayed_index} per response; server re-derives is_correct against the snapshot. Closes the P1+P6 drift bug where a mid-session question_bank.options edit corrupted the client''s stable shuffle map. Backwards compatible: legacy submit_quiz_results (v1) is preserved for in-flight clients. UPDATED (migration 20260801100800): also populates quiz_session_shuffles.options_version_at_serve (sentinel 0 — question_bank.options_version does not exist in this schema) and integrity_hash (SHA256 of options_snapshot||correct_answer_index_snapshot), both NOT NULL since 20260504100500. Root cause + full blast-radius writeup in that migration file. UPDATED (migration 20260801100900): schema-qualified digest() as extensions.digest() (pgcrypto lives in the extensions schema, not public, and this function search_path is pinned to public only).';

COMMIT;

-- End of migration: 20260801100900_fix_start_quiz_session_digest_schema_qualify.sql
-- Functions touched: start_quiz_session (CREATE OR REPLACE, additive)
-- Tables touched:    none
-- Triggers touched:  none
-- RLS touched:       none
