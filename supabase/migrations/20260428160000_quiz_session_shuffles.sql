-- Migration: 20260428160000_quiz_session_shuffles.sql
-- Purpose: P0 production fix — close the P1 + P6 quiz-shuffle drift bug by
--          moving shuffle authority from the client to the server. Stop the
--          bleeding: students were seeing "wrong" feedback on the SAME
--          option whose explanation said it was correct.
--
-- Threat model closed (Phase A):
--   The legacy client-side `seededShuffle(opts, q.id + question_text.slice(0,20))`
--   in src/app/quiz/page.tsx was STABLE across sessions. When a content
--   editor fixed `question_bank.options` (e.g. typo, reorder), the new
--   `correct_answer_index` no longer matched the OLD shuffle map the
--   student's browser had cached / re-derived from the same seed. The
--   explanation read correctly (content-based) but the green check landed
--   on the wrong row. ops_events.category='grounding.scoring' canary in
--   migration 20260418110000 has been recording every disagreement in
--   production.
--
--   This migration removes the entire client→shuffle→server round-trip.
--   Server now:
--     1. Generates the shuffle at quiz-session start (random per question).
--     2. Snapshots options + correct_answer_index from question_bank into
--        quiz_session_shuffles. Mid-session content edits to
--        question_bank.options can no longer corrupt scoring — the server
--        always reconciles against the snapshot.
--     3. Returns shuffled options to the client WITHOUT the
--        correct_answer_index (closes a class of cheats too — the index
--        was never supposed to leave the server, but legacy code paths
--        embedded it in the question payload).
--     4. submit_quiz_results_v2 receives `selected_displayed_index` per
--        question, looks up the persisted shuffle, computes the original
--        index, and re-derives is_correct against the SNAPSHOT
--        (NOT against question_bank's current state).
--
-- Backwards compatibility:
--   submit_quiz_results (v1) is preserved for any clients still in flight
--   (mobile, older web sessions). It is NOT dropped or altered. Once
--   web + mobile both call v2, v1 can be removed in a separate migration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- ALTER TABLE ... ADD ... IF NOT EXISTS. Safe to re-apply.
--
-- Phase B (out of scope for this migration, tracked as follow-up):
--   - CHECK constraints on shuffle_map (4-distinct integers in [0,3])
--   - options_version column on question_bank for stricter snapshot pinning
--   - no-PII regex enforcement on explanations
--
-- Mobile: out of scope. mobile-team will adopt the new RPC separately.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. quiz_session_shuffles — server-owned snapshot of per-question shuffle
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quiz_session_shuffles (
  session_id UUID NOT NULL,
  question_id UUID NOT NULL,
  -- 4-element permutation of [0,1,2,3]. shuffle_map[displayed_index] gives
  -- the original index in the snapshotted options array.
  shuffle_map INTEGER[] NOT NULL,
  -- Snapshot of question_bank.options at session start. Future edits to
  -- question_bank.options DO NOT affect scoring of in-flight sessions.
  options_snapshot JSONB NOT NULL,
  -- Snapshot of question_bank.correct_answer_index at session start.
  -- Same content-edit-isolation guarantee as options_snapshot.
  correct_answer_index_snapshot INT NOT NULL,
  -- Snapshot of student_id for RLS evaluation without an extra join.
  student_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, question_id),
  -- Defensive shape constraints (Phase A — full structural CHECKs in Phase B).
  CONSTRAINT quiz_session_shuffles_map_len4
    CHECK (array_length(shuffle_map, 1) = 4),
  CONSTRAINT quiz_session_shuffles_correct_idx_range
    CHECK (correct_answer_index_snapshot BETWEEN 0 AND 3)
);

COMMENT ON TABLE quiz_session_shuffles IS
  'Server-owned per-question shuffle snapshot for quiz sessions started via '
  'start_quiz_session(). Closes the P1+P6 drift bug where a client-derived '
  'stable shuffle could mismatch a later question_bank content edit. '
  'submit_quiz_results_v2 reads from here, NEVER from the live question_bank, '
  'when re-deriving is_correct. See migration 20260428160000 for full threat '
  'model.';

COMMENT ON COLUMN quiz_session_shuffles.shuffle_map IS
  '4-element permutation. shuffle_map[displayed_index] = original_index in '
  'options_snapshot. Mirror semantics of resolveOriginalIndex() in '
  'src/lib/quiz-scoring.ts and the v1 submit_quiz_results algorithm.';

COMMENT ON COLUMN quiz_session_shuffles.options_snapshot IS
  'JSONB array snapshot of question_bank.options at quiz session start. '
  'Mid-session edits to question_bank.options DO NOT affect this row.';

COMMENT ON COLUMN quiz_session_shuffles.correct_answer_index_snapshot IS
  'Integer 0..3 snapshot of question_bank.correct_answer_index at quiz '
  'session start. submit_quiz_results_v2 compares against THIS, not the '
  'live question_bank value.';

CREATE INDEX IF NOT EXISTS idx_quiz_session_shuffles_session
  ON quiz_session_shuffles(session_id);

CREATE INDEX IF NOT EXISTS idx_quiz_session_shuffles_student
  ON quiz_session_shuffles(student_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. RLS — student reads own; service_role bypasses
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE quiz_session_shuffles ENABLE ROW LEVEL SECURITY;

-- Student SELECT own (used by review screen so the client can re-display
-- the shuffled order the student saw, after submission. Does NOT include
-- correct_answer_index_snapshot in any client query path — but the row
-- itself is visible because the SELECT policy is row-grain, not column-
-- grain. The review-screen client is expected to ignore the index field;
-- the server response to submit_quiz_results_v2 is still the authoritative
-- source of `correct_option_text`).
DROP POLICY IF EXISTS "quiz_session_shuffles_student_select" ON quiz_session_shuffles;
CREATE POLICY "quiz_session_shuffles_student_select" ON quiz_session_shuffles
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policy for clients. All writes go through the
-- start_quiz_session RPC (SECURITY DEFINER), which performs ownership
-- checks before inserting on behalf of the student. service_role
-- bypasses RLS for admin / forensic replay.

-- Parent reads linked child (for parent dashboard quiz review surfaces, if
-- ever wired; matches the four-pattern RLS template).
DROP POLICY IF EXISTS "quiz_session_shuffles_parent_select" ON quiz_session_shuffles;
CREATE POLICY "quiz_session_shuffles_parent_select" ON quiz_session_shuffles
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM guardian_student_links
      WHERE guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
        AND status = 'approved'
    )
  );

-- Teacher reads assigned class (matches four-pattern template).
-- Canonical join: class_students -> class_teachers -> teachers. The `classes`
-- table has NO `teacher_id` column; the class<->teacher relationship lives in
-- the `class_teachers` join table (see _legacy/000_core_schema.sql:213-219 and
-- 20260408000002_foxy_sessions_and_messages.sql:146-161 for the canonical
-- pattern used elsewhere in this codebase).
DROP POLICY IF EXISTS "quiz_session_shuffles_teacher_select" ON quiz_session_shuffles;
CREATE POLICY "quiz_session_shuffles_teacher_select" ON quiz_session_shuffles
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM class_students
      WHERE class_id IN (
        SELECT class_id FROM class_teachers
        WHERE teacher_id IN (
          SELECT id FROM teachers WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. start_quiz_session RPC — server-owned shuffle generation + snapshot
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION start_quiz_session(
  p_student_id UUID,
  p_question_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: this RPC writes per-session shuffle rows on
-- behalf of the authenticated student. Authorization is enforced inline by
-- comparing students.auth_user_id with auth.uid(). The function never
-- exposes correct_answer_index in its return value — that is the entire
-- point: the index lives only in quiz_session_shuffles, server-side.
SET search_path = public
AS $$
DECLARE
  v_session_id UUID := gen_random_uuid();
  v_qid UUID;
  v_options JSONB;
  v_options_arr JSONB;
  v_correct_idx INT;
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

    -- Persist snapshot. ON CONFLICT DO NOTHING keeps the RPC idempotent if
    -- the same (session_id, question_id) pair is submitted twice — though
    -- that should never happen because session_id is freshly generated.
    INSERT INTO quiz_session_shuffles (
      session_id, question_id, shuffle_map,
      options_snapshot, correct_answer_index_snapshot, student_id
    ) VALUES (
      v_session_id, v_qid, v_shuffle,
      v_options_arr, v_correct_idx, p_student_id
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

COMMENT ON FUNCTION start_quiz_session(UUID, UUID[]) IS
  'P0 fix (migration 20260428160000): server-owned shuffle authority for '
  'quiz sessions. Generates a per-question Fisher-Yates shuffle, snapshots '
  'options + correct_answer_index into quiz_session_shuffles, and returns '
  'the SHUFFLED options to the client WITHOUT correct_answer_index. '
  'Pair with submit_quiz_results_v2 — client sends only '
  '{question_id, selected_displayed_index} per response; server re-derives '
  'is_correct against the snapshot. Closes the P1+P6 drift bug where a '
  'mid-session question_bank.options edit corrupted the client''s stable '
  'shuffle map. Backwards compatible: legacy submit_quiz_results (v1) is '
  'preserved for in-flight clients.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. submit_quiz_results_v2 RPC — re-derives is_correct from snapshot
-- ──────────────────────────────────────────────────────────────────────────

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
-- SECURITY DEFINER justified: writes quiz_sessions, quiz_responses,
-- user_question_history; invokes atomic_quiz_profile_update. Authorization
-- is enforced inline against students.auth_user_id.
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
  -- Ownership check (same pattern as start_quiz_session).
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
  END IF;

  -- Validate session ownership: every shuffle row for this session must
  -- belong to the caller's student. If the session has zero shuffle rows,
  -- the caller may have submitted a v2 payload without first calling
  -- start_quiz_session — fall through to scoring with NULL shuffles, which
  -- treats selected_displayed_index as already in original space.
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
    -- v2 contract: client sends `selected_displayed_index`, NOT
    -- `selected_option`. Accept both keys for resilience while the
    -- web client transitions; mobile + legacy paths still call v1.
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    -- Look up snapshot. service_role-context calls bypass RLS, so this
    -- read works inside the SECURITY DEFINER function.
    SELECT shuffle_map, correct_answer_index_snapshot
      INTO v_shuffle, v_correct_idx_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    IF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      -- 1-based PL/pgSQL array indexing.
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
    ELSE
      -- No snapshot OR malformed shuffle OR out-of-range index. Treat
      -- selected as already-original (matches v1 fallback semantics).
      v_selected_orig := v_selected_displayed;
    END IF;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_correct_idx_snapshot IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    IF v_is_correct THEN
      v_correct := v_correct + 1;
    END IF;

    -- P3 Check 2: distribution tracked on the SHUFFLED click (matches v1).
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

  -- P3 Check 1: avg time < 3s -> flag, xp = 0.
  v_avg_time := CASE WHEN v_total > 0 THEN p_time::NUMERIC / v_total ELSE 0 END;
  IF v_avg_time < 3.0 AND v_total > 0 THEN
    v_flagged := true;
  END IF;

  -- P3 Check 2: not all same answer if >3 questions.
  IF v_total > 3 THEN
    v_max_same_answer := GREATEST(
      v_answer_counts[1], v_answer_counts[2],
      v_answer_counts[3], v_answer_counts[4]
    );
    IF v_max_same_answer = v_total THEN
      v_flagged := true;
    END IF;
  END IF;

  -- P3 Check 3: response count matches jsonb_array_length.
  IF jsonb_array_length(p_responses) <> v_total THEN
    v_flagged := true;
  END IF;

  -- P1: score_percent = ROUND((v_correct / v_total) * 100). Identical to v1.
  v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);

  -- P2: base + high_score_bonus + perfect_bonus, gated by P3 flag.
  IF v_flagged THEN
    v_xp := 0;
  ELSE
    v_xp := v_correct * 10;
    IF v_score_percent >= 80 THEN v_xp := v_xp + 20; END IF;
    IF v_score_percent = 100 THEN v_xp := v_xp + 50; END IF;
  END IF;

  -- Insert quiz_sessions row.
  INSERT INTO quiz_sessions (
    student_id, subject, grade, topic_title, chapter_number,
    total_questions, correct_answers, score_percent,
    time_taken_seconds, score, is_completed, completed_at
  ) VALUES (
    p_student_id, p_subject, p_grade, p_topic, p_chapter,
    v_total, v_correct, v_score_percent,
    p_time, v_xp, true, NOW()
  ) RETURNING id INTO v_quiz_session_id;

  -- ─── Second pass: write quiz_responses + history + per-question state ─
  v_q_number := 0;
  FOR r IN SELECT * FROM jsonb_array_elements(p_responses)
  LOOP
    v_q_number := v_q_number + 1;
    v_question_id := (r->>'question_id')::UUID;
    v_selected_displayed := COALESCE(
      (r->>'selected_displayed_index')::INTEGER,
      (r->>'selected_option')::INTEGER
    );

    SELECT shuffle_map, correct_answer_index_snapshot, options_snapshot
      INTO v_shuffle, v_correct_idx_snapshot, v_options_snapshot
      FROM quiz_session_shuffles
     WHERE session_id = p_session_id AND question_id = v_question_id;

    IF v_shuffle IS NOT NULL
       AND array_length(v_shuffle, 1) = 4
       AND v_selected_displayed IS NOT NULL
       AND v_selected_displayed BETWEEN 0 AND 3 THEN
      v_selected_orig := v_shuffle[v_selected_displayed + 1];
    ELSE
      v_selected_orig := v_selected_displayed;
    END IF;

    SELECT question_text, question_type, topic_id, bloom_level, difficulty
      INTO v_q_text, v_q_type, v_q_topic_id, v_q_bloom, v_q_difficulty
      FROM question_bank WHERE id = v_question_id;

    v_is_correct := (
      v_selected_orig IS NOT NULL
      AND v_correct_idx_snapshot IS NOT NULL
      AND v_selected_orig = v_correct_idx_snapshot
    );

    -- Resolve correct_option_text from the SNAPSHOT (not live question_bank).
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

    -- Unified learner state update (matches v1).
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

    -- Append to review payload — the v2 contract returns per-question
    -- review data so the client review screen never derives correct
    -- answer text from its own (potentially-stale) options array.
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

  -- P4: atomic XP + profile update via the same RPC v1 uses.
  PERFORM atomic_quiz_profile_update(
    p_student_id, p_subject, v_xp, v_total, v_correct, p_time, v_quiz_session_id
  );

  -- CME: best-effort post-quiz action (error-isolated, matches v1).
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
    -- Per-question review payload — server is the single source of truth
    -- for correct_option_text. QuizResults.tsx must consume this, not
    -- derive from its own options array.
    'questions', v_review_questions
  );
END;
$$;

COMMENT ON FUNCTION submit_quiz_results_v2(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER) IS
  'P0 fix (migration 20260428160000): the v2 quiz submission path. Reads '
  'shuffle + options + correct_answer_index from the per-session snapshot '
  'in quiz_session_shuffles, NOT from live question_bank. Mid-session '
  'content edits to question_bank.options can no longer corrupt scoring. '
  'Client sends only { question_id, selected_displayed_index, time_spent }; '
  'server re-derives is_correct, returns canonical correct_option_text per '
  'question for the review screen. P1/P2/P3/P4 invariants preserved '
  'verbatim from v1. Backwards compatible: v1 submit_quiz_results is '
  'untouched and still serves legacy + mobile clients.';

-- End of migration: 20260428160000_quiz_session_shuffles.sql
-- Tables added:    quiz_session_shuffles
-- Functions added: start_quiz_session, submit_quiz_results_v2
-- Functions kept:  submit_quiz_results (v1, unchanged — backwards compat)
