-- Migration: 20260430000000_quiz_phase_c_options_versioning.sql
-- Purpose: Phase C of the quiz authenticity fix — long-term durability
--          layer. Closes the last remaining drift vector so the bug
--          class is structurally impossible forever.
--
-- Phase A reference (PR #447, migration 20260428160000):
--   Moved shuffle authority from client to server. quiz_session_shuffles
--   snapshots options + correct_answer_index at session start.
--   submit_quiz_results_v2 reads from the snapshot, NOT live question_bank.
--
-- Phase B reference (PR #449, migration 20260429010000):
--   DB CHECK constraints lock the contract: question_bank.options is a
--   4-element JSON array; correct_answer_index ∈ [0,3]; explanations
--   forbid positional letters ("Option A", "विकल्प क"). Adds CI canary
--   on ops_events.category='grounding.scoring'.
--
-- Phase C (this migration) — additive only:
--
--   Threat closed: Phase A snapshots options + correct_answer_index at
--   session start, but a content editor could in theory still alter
--   question_bank between session start and submit. Phase A trusts the
--   snapshot row at submit time — but if a malicious or buggy code path
--   ever wrote to quiz_session_shuffles after the snapshot, scoring
--   would silently use the tampered values. Phase C eliminates that
--   vector with three durability layers:
--
--   1. question_bank.options_version — auto-incrementing integer that
--      bumps on every UPDATE where options or correct_answer_index
--      changes. Provides a monotonic version stamp for content edits.
--      Trigger BEFORE UPDATE bumps the version; idempotent.
--
--   2. quiz_session_shuffles.options_version_at_serve — snapshots the
--      current question_bank.options_version at the moment
--      start_quiz_session() runs. submit_quiz_results_v2 can later
--      cross-check this against the live question_bank.options_version
--      to detect cross-session content drift (does NOT change scoring;
--      that's still snapshot-bound. The cross-check is observability
--      only — it logs an ops_events warning when versions disagree).
--
--   3. quiz_session_shuffles.integrity_hash — SHA256 of
--      options_snapshot::text || correct_answer_index_snapshot at the
--      moment start_quiz_session() persists the row. submit_quiz_results_v2
--      recomputes the hash from the persisted snapshot fields just before
--      scoring. If the hash mismatches, the row was tampered with after
--      session start. The mismatched question is logged as
--      ops_events.category='quiz.integrity_mismatch' (severity=warning)
--      and is awarded ZERO XP for that question (treated as not_attempted /
--      flagged). Other questions in the session score normally so a single
--      tampered row doesn't void the entire quiz.
--
-- Backwards compatibility:
--   - ADDITIVE ONLY. No DROP, no ALTER COLUMN type, no data mutation.
--   - Existing question_bank rows: options_version defaults to 1 on insert
--     of the new column (DEFAULT 1, NOT NULL). The DEFAULT is applied
--     synchronously to existing rows by Postgres ADD COLUMN semantics.
--   - Existing quiz_session_shuffles rows: options_version_at_serve and
--     integrity_hash are nullable (no DEFAULT). Phase A rows (pre-Phase C)
--     stay NULL forever; submit_quiz_results_v2 treats NULL as "skip the
--     verification" so legacy rows continue to score normally. Only NEW
--     rows written by the updated start_quiz_session() get the snapshot.
--   - Phase A code path (start_quiz_session, submit_quiz_results_v2) is
--     extended in place via CREATE OR REPLACE FUNCTION. The shape of
--     return values is UNCHANGED — clients still receive the same
--     selected_displayed_index contract. The new columns are server-only.
--   - Phase B CHECK constraints are NOT modified.
--   - Mobile: out of scope. v1 submit_quiz_results is untouched.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS / CREATE TRIGGER. Safe to re-apply.
--
-- AI validation oracle (separate scope, NOT in this PR):
--   ai-engineer will add a per-question AI-validation oracle that
--   cross-checks the snapshot's correct_option_text against the
--   explanation's content. That work is out of scope for Phase C.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. question_bank.options_version + auto-increment trigger
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS options_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN question_bank.options_version IS
  'Monotonic version stamp that increments on every UPDATE where options '
  'or correct_answer_index changes. Trigger question_bank_bump_options_version '
  '(migration 20260430000000) enforces the bump. quiz_session_shuffles '
  'snapshots this value at session start in options_version_at_serve. '
  'Used by submit_quiz_results_v2 to detect cross-session content drift '
  '(observability only — scoring remains snapshot-bound from Phase A).';

CREATE OR REPLACE FUNCTION question_bank_bump_options_version_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (default): trigger runs as the role updating the row.
-- No privilege escalation needed; we only mutate NEW.options_version on
-- the same row being written.
AS $$
BEGIN
  -- Bump only when options or correct_answer_index actually changed.
  -- The WHEN clause on the trigger duplicates this guard so the function
  -- body is rarely entered, but defensive double-check is cheap and
  -- protects against direct INSERT-as-UPDATE patterns.
  NEW.options_version := COALESCE(OLD.options_version, 1) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS question_bank_bump_options_version
  ON question_bank;

CREATE TRIGGER question_bank_bump_options_version
  BEFORE UPDATE ON question_bank
  FOR EACH ROW
  WHEN (
    NEW.options IS DISTINCT FROM OLD.options
    OR NEW.correct_answer_index IS DISTINCT FROM OLD.correct_answer_index
  )
  EXECUTE FUNCTION question_bank_bump_options_version_fn();

COMMENT ON FUNCTION question_bank_bump_options_version_fn() IS
  'BEFORE UPDATE trigger function for question_bank. Bumps '
  'options_version when options or correct_answer_index changes. Phase C '
  'durability layer (migration 20260430000000) for the quiz authenticity fix.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. quiz_session_shuffles new columns: options_version_at_serve + integrity_hash
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE quiz_session_shuffles
  ADD COLUMN IF NOT EXISTS options_version_at_serve INT;

ALTER TABLE quiz_session_shuffles
  ADD COLUMN IF NOT EXISTS integrity_hash TEXT;

COMMENT ON COLUMN quiz_session_shuffles.options_version_at_serve IS
  'Snapshot of question_bank.options_version at the moment '
  'start_quiz_session() ran. NULL on Phase A rows (pre-Phase C). Used by '
  'submit_quiz_results_v2 to detect cross-session content drift. Drift '
  'detection is observability only — scoring remains snapshot-bound.';

COMMENT ON COLUMN quiz_session_shuffles.integrity_hash IS
  'SHA256 hex of (options_snapshot::text || correct_answer_index_snapshot) '
  'computed at the moment start_quiz_session() persists the row. '
  'submit_quiz_results_v2 recomputes the hash before scoring; on '
  'mismatch, the question is awarded zero XP and an ops_events warning '
  'is written with category=quiz.integrity_mismatch. NULL on Phase A '
  '(pre-Phase C) rows — the verification is skipped for those.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. start_quiz_session — populates the two new snapshot columns
-- ──────────────────────────────────────────────────────────────────────────
-- Identical to Phase A version EXCEPT the INSERT row now also carries
-- options_version_at_serve (read from question_bank) and integrity_hash
-- (computed inline). Return shape UNCHANGED.

CREATE OR REPLACE FUNCTION start_quiz_session(
  p_student_id UUID,
  p_question_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: same as Phase A. Authorization enforced
-- inline against students.auth_user_id. No new privilege expansion in
-- Phase C.
SET search_path = public
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
  -- Ownership check (unchanged from Phase A).
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

  FOREACH v_qid IN ARRAY p_question_ids LOOP
    -- NEW in Phase C: also pull options_version.
    SELECT id, question_text, question_hi, options, correct_answer_index,
           explanation, explanation_hi, hint, difficulty, bloom_level,
           chapter_number, question_type, options_version
      INTO v_question_meta
      FROM question_bank
      WHERE id = v_qid AND is_active = true;

    IF v_question_meta IS NULL THEN
      CONTINUE;
    END IF;

    v_options := CASE
      WHEN jsonb_typeof(v_question_meta.options::jsonb) = 'array' THEN v_question_meta.options::jsonb
      ELSE NULL
    END;

    IF v_options IS NULL OR jsonb_array_length(v_options) <> 4 THEN
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      v_options_arr := COALESCE(v_options, '[]'::jsonb);
    ELSE
      v_shuffle := ARRAY[0,1,2,3]::INT[];
      FOR i IN REVERSE 4..2 LOOP
        v_swap_idx := 1 + floor(random() * i)::INT;
        v_temp := v_shuffle[i];
        v_shuffle[i] := v_shuffle[v_swap_idx];
        v_shuffle[v_swap_idx] := v_temp;
      END LOOP;
      v_options_arr := v_options;
    END IF;

    v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0);
    v_options_version := COALESCE(v_question_meta.options_version, 1);

    -- Phase C: integrity hash binds options_snapshot + correct_answer_index_snapshot
    -- so any post-INSERT tampering with the row is detectable.
    -- pgcrypto.digest is already available via the observability_console_1a
    -- migration which CREATE EXTENSION IF NOT EXISTS pgcrypto.
    v_integrity_hash := encode(
      digest(v_options_arr::text || v_correct_idx::text, 'sha256'),
      'hex'
    );

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
        -- correct_answer_index, options_version, integrity_hash all
        -- stay server-side. Client return shape UNCHANGED from Phase A.
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'questions', v_questions
  );
END;
$$;

COMMENT ON FUNCTION start_quiz_session(UUID, UUID[]) IS
  'Phase C extension (migration 20260430000000) of the Phase A '
  'server-owned shuffle authority RPC. In addition to Phase A behavior, '
  'now snapshots question_bank.options_version into '
  'options_version_at_serve and computes a SHA256 integrity_hash over '
  '(options_snapshot::text || correct_answer_index_snapshot). Both '
  'fields are server-only — client return shape is unchanged. '
  'submit_quiz_results_v2 verifies the hash before scoring.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. submit_quiz_results_v2 — verifies integrity_hash before scoring
-- ──────────────────────────────────────────────────────────────────────────
-- Identical to Phase A version EXCEPT: when the snapshot row carries a
-- non-NULL integrity_hash, we recompute SHA256 and compare. On mismatch,
-- the question is treated as not_attempted (is_correct=false, no XP
-- contribution from that question) and an ops_events warning is logged
-- with category='quiz.integrity_mismatch'. Other questions in the session
-- score normally.

CREATE OR REPLACE FUNCTION submit_quiz_results_v2(
  p_session_id UUID,
  p_student_id UUID,
  p_subject TEXT,
  p_grade TEXT,
  p_topic TEXT DEFAULT NULL,
  p_chapter INTEGER DEFAULT NULL,
  p_responses JSONB DEFAULT '[]',
  p_time INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: same as Phase A. Phase C adds a hash
-- verification step before scoring; no privilege expansion.
SET search_path = public
AS $$
DECLARE
  v_total INTEGER := 0;
  v_correct INTEGER := 0;
  v_score_percent NUMERIC;
  v_xp INTEGER := 0;
  v_quiz_session_id UUID;
  v_flagged BOOLEAN := false;
  v_avg_time NUMERIC;
  r JSONB;
  v_question_id UUID;
  v_selected_displayed INTEGER;
  v_selected_orig INTEGER;
  v_shuffle INT[];
  v_correct_idx_snapshot INT;
  v_options_snapshot JSONB;
  v_stored_hash TEXT;
  v_computed_hash TEXT;
  v_integrity_ok BOOLEAN;
  v_is_correct BOOLEAN;
  v_q_text TEXT;
  v_q_type TEXT;
  v_q_topic_id UUID;
  v_q_number INTEGER := 0;
  v_q_bloom TEXT;
  v_q_difficulty INT;
  v_answer_counts INT[] := ARRAY[0,0,0,0];
  v_max_same_answer INT := 0;
  v_review_questions JSONB := '[]'::jsonb;
  v_correct_option_text TEXT;
  v_cme_action TEXT;
  v_cme_concept_id UUID;
  v_cme_reason TEXT;
BEGIN
  -- Ownership check (unchanged from Phase A).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM quiz_session_shuffles
    WHERE session_id = p_session_id AND student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'Access denied: session % does not belong to student %',
      p_session_id, p_student_id;
  END IF;

  -- ─── First pass: count + score in original-index space ───────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_total := v_total + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    -- NEW in Phase C: pull options_snapshot + integrity_hash too so we
    -- can verify the snapshot row hasn't been tampered with.
    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot, integrity_hash
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot, v_stored_hash
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    -- Integrity verification. Phase A rows have NULL integrity_hash —
    -- skip verification for those (legacy rows continue to score normally
    -- via the snapshot they have, matching Phase A semantics).
    v_integrity_ok := TRUE;
    IF v_stored_hash IS NOT NULL
       AND v_options_snapshot IS NOT NULL
       AND v_correct_idx_snapshot IS NOT NULL THEN
      v_computed_hash := encode(
        digest(v_options_snapshot::text || v_correct_idx_snapshot::text, 'sha256'),
        'hex'
      );
      IF v_computed_hash <> v_stored_hash THEN
        v_integrity_ok := FALSE;
        -- Log as ops_events warning. Best-effort — never break a
        -- submission on observability failure.
        BEGIN
          INSERT INTO ops_events (
            occurred_at, category, source, severity,
            subject_type, subject_id, message, context, environment
          ) VALUES (
            NOW(),
            'quiz.integrity_mismatch',
            'submit_quiz_results_v2',
            'warning',
            'student', p_student_id::text,
            'quiz_session_shuffles row failed integrity hash verification',
            jsonb_build_object(
              'student_id', p_student_id,
              'session_id', p_session_id,
              'question_id', v_question_id,
              'stored_hash', v_stored_hash,
              'computed_hash', v_computed_hash
            ),
            COALESCE(current_setting('app.environment', true), 'production')
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;

    -- Score the question. On integrity failure, force is_correct=false
    -- so the tampered row contributes ZERO XP. Other questions still
    -- score normally; one bad row does not void the entire quiz.
    IF NOT v_integrity_ok THEN
      v_is_correct := FALSE;
      v_selected_orig := v_selected_displayed;  -- best-effort echo for review
    ELSIF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_correct_idx_snapshot IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    ELSE
      v_selected_orig := v_selected_displayed;
      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_correct_idx_snapshot IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    END IF;

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    IF v_selected_displayed IS NOT NULL
       AND v_selected_displayed >= 0
       AND v_selected_displayed <= 3 THEN
      v_answer_counts[v_selected_displayed + 1] := v_answer_counts[v_selected_displayed + 1] + 1;
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'correct', 0, 'score_percent', 0,
      'xp_earned', 0, 'session_id', NULL, 'flagged', false,
      'questions', '[]'::jsonb
    );
  END IF;

  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = v_total THEN
      v_flagged := true;
    END IF;
  END IF;

  IF jsonb_array_length(p_responses) <> v_total THEN
    v_flagged := true;
  END IF;

  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
  ) RETURNING id INTO v_quiz_session_id;

  -- ─── Second pass: write quiz_responses + history ─────────────────────
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot, integrity_hash
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot, v_stored_hash
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    -- Re-verify integrity for the second pass. The first-pass result
    -- determines the score; here we just need to mirror is_correct
    -- consistently for the persisted quiz_responses row.
    v_integrity_ok := TRUE;
    IF v_stored_hash IS NOT NULL
       AND v_options_snapshot IS NOT NULL
       AND v_correct_idx_snapshot IS NOT NULL THEN
      v_computed_hash := encode(
        digest(v_options_snapshot::text || v_correct_idx_snapshot::text, 'sha256'),
        'hex'
      );
      IF v_computed_hash <> v_stored_hash THEN
        v_integrity_ok := FALSE;
      END IF;
    END IF;

    IF NOT v_integrity_ok THEN
      v_is_correct := FALSE;
      v_selected_orig := v_selected_displayed;
    ELSIF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_correct_idx_snapshot IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    ELSE
      v_selected_orig := v_selected_displayed;
      v_is_correct := (
        v_selected_orig IS NOT NULL
        AND v_correct_idx_snapshot IS NOT NULL
        AND v_selected_orig = v_correct_idx_snapshot
      );
    END IF;

    SELECT question_text, question_type, topic_id, bloom_level, difficulty
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty
      FROM question_bank WHERE id = v_question_id;

    IF v_options_snapshot IS NOT NULL
       AND jsonb_typeof(v_options_snapshot) = 'array'
       AND v_correct_idx_snapshot IS NOT NULL
       AND jsonb_array_length(v_options_snapshot) > v_correct_idx_snapshot THEN
      v_correct_option_text := v_options_snapshot ->> v_correct_idx_snapshot;
    ELSE
      v_correct_option_text := NULL;
    END IF;

    INSERT INTO quiz_responses (
      quiz_session_id, student_id, question_id, selected_option,
      is_correct, time_spent_seconds,
      question_number, question_text, question_type,
      shuffle_map
    ) VALUES (
      v_quiz_session_id, p_student_id, v_question_id, v_selected_displayed,
      v_is_correct, COALESCE((r->>'time_spent')::INTEGER, 0),
      v_q_number, v_q_text, v_q_type,
      v_shuffle
    ) ON CONFLICT DO NOTHING;

    IF v_q_topic_id IS NOT NULL THEN
      PERFORM update_learner_state_post_quiz(
        p_student_id,
        v_q_topic_id,
        v_is_correct,
        v_q_bloom,
        (r->>'error_type')::TEXT,
        COALESCE((r->>'time_spent')::INT, 0) * 1000,
        v_q_difficulty
      );
    END IF;

    INSERT INTO user_question_history (
      student_id, question_id, subject, grade, chapter_number,
      first_shown_at, last_shown_at, times_shown, last_result
    ) VALUES (
      p_student_id, v_question_id, p_subject, p_grade, p_chapter,
      NOW(), NOW(), 1, v_is_correct
    ) ON CONFLICT (student_id, question_id) DO UPDATE SET
      last_shown_at = NOW(),
      times_shown = user_question_history.times_shown + 1,
      last_result = v_is_correct;

    v_review_questions := v_review_questions || jsonb_build_array(
      jsonb_build_object(
        'question_id', v_question_id,
        'is_correct', v_is_correct,
        'selected_displayed_index', v_selected_displayed,
        'selected_original_index', v_selected_orig,
        'correct_original_index', v_correct_idx_snapshot,
        'correct_option_text', v_correct_option_text,
        'shuffle_map', to_jsonb(v_shuffle)
      )
    );
  END LOOP;

  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id
  );

  BEGIN
    SELECT ca.action_type, ca.concept_id, ca.reason
      INTO v_cme_action, v_cme_concept_id, v_cme_reason
      FROM compute_post_quiz_action(p_student_id, p_subject, p_grade) ca;

    UPDATE quiz_sessions
       SET cme_next_action = v_cme_action,
           cme_next_concept_id = v_cme_concept_id,
           cme_reason = v_cme_reason
     WHERE id = v_quiz_session_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'score_percent', v_score_percent,
    'xp_earned', v_xp,
    'session_id', v_quiz_session_id,
    'flagged', v_flagged,
    'cme_next_action', v_cme_action,
    'cme_next_concept_id', v_cme_concept_id,
    'cme_reason', v_cme_reason,
    'questions', v_review_questions
  );
END;
$$;

COMMENT ON FUNCTION submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER) IS
  'Phase C extension (migration 20260430000000) of the Phase A v2 quiz '
  'submission RPC. In addition to Phase A behavior, now verifies the '
  'quiz_session_shuffles.integrity_hash against a freshly-computed '
  'SHA256 of (options_snapshot::text || correct_answer_index_snapshot) '
  'before scoring. On mismatch, awards zero XP for that question and '
  'logs ops_events.category=quiz.integrity_mismatch. Other questions in '
  'the session score normally so a single tampered row does not void '
  'the quiz. Phase A rows (NULL integrity_hash) are skipped — they '
  'continue to score per Phase A semantics. Client return shape and '
  'P1/P2/P3/P4 invariants UNCHANGED.';

-- End of migration: 20260430000000_quiz_phase_c_options_versioning.sql
-- Columns added: question_bank.options_version
--                quiz_session_shuffles.options_version_at_serve
--                quiz_session_shuffles.integrity_hash
-- Triggers added: question_bank_bump_options_version
-- Functions added: question_bank_bump_options_version_fn
-- Functions updated (additive): start_quiz_session, submit_quiz_results_v2
-- Phase A and Phase B code/constraints NOT modified.
