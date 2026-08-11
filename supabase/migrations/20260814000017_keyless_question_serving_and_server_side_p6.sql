-- Migration: 20260814000017_keyless_question_serving_and_server_side_p6.sql
-- Purpose: Stop shipping question_bank.correct_answer_index to the client on any
--          student serving path, and move the ONE P6 check that needs the answer
--          key out of the browser and into the server.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS (the ACL alone does not close the leak)
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260814000014 closed the SESSION-scoped answer-key read
-- (quiz_session_shuffles.correct_answer_index_snapshot / integrity_hash) with a
-- column-level ACL, and its own RESIDUAL section says the wider vector is still
-- open: policy `question_bank_authenticated_read` (20260728090000:311-312) is
-- `FOR SELECT TO authenticated USING (true)`, so
--     GET /rest/v1/question_bank?select=id,correct_answer_index
-- still returns the key for every one of the ~12.8k questions.
--
-- A column ACL on question_bank.correct_answer_index is drafted but CANNOT SHIP
-- on its own, for two independent reasons:
--
--   (1) It would not close the leak. The four question-serving RPCs are all
--       SECURITY DEFINER, so a caller-role ACL is invisible to them, and three
--       of them RETURN the key inside their JSON payload:
--         select_quiz_questions_rag  (20260802100000:345, :405)
--         select_quiz_questions_v2   (20260625000200:248, :294)
--         get_quiz_questions         (20260505155525:21 — 5-arg;
--                                     baseline:4847  — 4-arg overload)
--       A student calling those for their own grade+subject harvests keys
--       regardless of any column privilege. `get_adaptive_questions`
--       (20260702200000) was audited and does NOT return the key — it returns
--       question_id + metadata only — so it is not changed here.
--
--   (2) It would break the live quiz. The P6 gate that guarantees a served
--       question is GRADEABLE — `correct_answer_index` present and in 0..3 —
--       runs in the BROWSER (packages/lib/src/quiz/question-validation.ts:292-304).
--       Revoke the column and that check sees `undefined` for every row and
--       rejects 100% of MCQs.
--
-- This migration is the server half of the fix. It does BOTH halves of the
-- dependency: it removes the key from the outbound payloads (so the ACL has
-- something to protect) AND it relocates the key-dependent P6 check to the
-- server (so the client no longer needs the key to enforce P6). After this
-- migration + its companion client change, the ACL is shippable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT LEAVES THE PAYLOAD, AND WHAT DOES NOT
-- ─────────────────────────────────────────────────────────────────────────────
-- Exactly one JSON key is removed from three functions:  'correct_answer_index'.
-- Every other key, its name, its order in the object, its COALESCE default and
-- the row ordering are preserved verbatim — these are P1-adjacent payloads and
-- a silent shape change downstream would be worse than the leak.
--
-- The key is STILL READ server-side everywhere it is needed:
--   * start_quiz_session          — snapshots it into quiz_session_shuffles
--   * submit_quiz_results_v2      — the P1 scoring authority (UNTOUCHED here)
--   * check_quiz_answer           — one-question reveal (UNTOUCHED here)
--   * submit_quiz_results (v1)    — legacy scoring (UNTOUCHED here)
--   * question_bank_p6_valid()    — the new server-side P6 predicate below
-- No scoring path loses access to anything. P1/P2/P3/P4 are bit-for-bit
-- unchanged: this migration does not touch a single scoring function body.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHERE P6 LIVES NOW
-- ─────────────────────────────────────────────────────────────────────────────
-- `public.question_bank_p6_valid(...)` (section 1) is the SQL twin of the
-- ANSWERABILITY/GRADEABILITY half of the canonical TS gate
-- (packages/lib/src/quiz/question-validation.ts), at the `allowNonMcq: true`
-- posture the live assembler already uses. It is applied:
--
--   * as a FILTER in every question-serving RPC — a malformed row is never
--     selected, so it can never reach a student through the serve path;
--   * as a HARD SKIP in start_quiz_session — the last server checkpoint before
--     a question is rendered. Every direct-`question_bank` student path
--     (deep-link ?qid=, SRS review, the PYQ preferred fetch, the adaptive
--     candidate provider, the v1 direct-query fallback) funnels through
--     start_quiz_session, so this single gate covers all of them without any
--     of them needing to read the key.
--
-- P6 IS NOT WEAKENED. The client keeps every check it can still perform without
-- the key (text, template markers, garbage-text rules, 4 distinct non-empty
-- options, garbage-option rules, explanation length/word-count/self-contradiction).
-- The server now enforces those SAME checks PLUS the two the client can no
-- longer make: `correct_answer_index IS NOT NULL` and `BETWEEN 0 AND 3`. The
-- union is strictly stronger than before, because the server rules are applied
-- to rows the client never sees at all.
--
-- The one check deliberately NOT ported to SQL is the garbage/self-contradiction
-- SUBSTRING set. Those are heuristics over free text, they are strictly ADDITIVE
-- to P6-verbatim, and they still run client-side on every row. Porting them to a
-- WHERE clause would add a large ILIKE cost to the hot serve path for zero
-- additional safety.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- AVAILABILITY: WHY THIS CANNOT EMPTY A CHAPTER
-- ─────────────────────────────────────────────────────────────────────────────
-- Every row the new server-side filter removes is a row the EXISTING client-side
-- gate already dropped before rendering (assembleQuiz →
-- validateQuestion(q, { allowNonMcq: true }), quiz-assembler.ts:108-110; and
-- validateQuestions() on the getQuizQuestions / domains-quiz paths). The set of
-- questions a student can actually see is therefore UNCHANGED. What changes is
-- WHERE the row is dropped: the pool handed to the assembler is now already
-- clean, so the assembler's fallback ladder wastes fewer rungs topping up after
-- a client-side rejection. This can only improve fill rate, never worsen it.
--
-- The P6 predicate is applied to ALL FOUR repeated predicate blocks in the two
-- pool-aware RPCs (pool-count, seen-count, 80%-reset DELETE, candidate_pool) for
-- exactly the reason 20260802100000 gives for its own Tier-0 predicates
-- (that migration's AC-7): a count that disagrees with the candidate set
-- mis-triggers the unrelated REG-172 80%-reset heuristic.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OVERLOAD SAFETY
-- ─────────────────────────────────────────────────────────────────────────────
-- Every CREATE OR REPLACE below reuses the EXACT existing signature (names,
-- types, order, defaults). No parameter is added, removed, renamed, retyped or
-- reordered, so no new overload can be created. Verified against:
--   select_quiz_questions_rag  8 args  (20260802100000:162-171)
--   select_quiz_questions_v2   7 args  (20260625000200:175-183)
--   get_quiz_questions         5 args  (20260505155525:3-9)
--   get_quiz_questions         4 args  (baseline:4827 — the ORIGINAL overload,
--                                       still reachable by name from PostgREST)
--   start_quiz_session         2 args  (20260801100900:31)
-- This repo has a documented history of the opposite mistake
-- (20260702170000, 20260729130000) — it does not apply here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY POSTURE
-- ─────────────────────────────────────────────────────────────────────────────
-- All replaced functions keep their pre-existing SECURITY DEFINER +
-- `SET search_path` and their existing ACL (CREATE OR REPLACE preserves it).
-- The ONE new SECURITY DEFINER function that grades on behalf of a caller
-- (`check_formative_answer`, section 6) carries its own inline ownership guard,
-- bounds-checks its input, and refuses to say anything about a question the
-- student could not already be served. `question_bank_p6_valid` is a pure
-- IMMUTABLE predicate over values it is HANDED — it reads no table, so it is
-- SECURITY INVOKER (the default) and grants no new read.
-- No string is concatenated into executed SQL anywhere in this file.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENCY / MIGRATION RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION + GRANT + COMMENT throughout — replay-safe. No new
-- table (so no new RLS surface), no ALTER TABLE, no DROP of any kind, no RLS
-- policy change, no index change. Grades are TEXT everywhere (P5).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────────
-- Compensating: re-apply 20260802100000 (rag), 20260625000200 (v2),
-- 20260505155525 (get_quiz_questions 5-arg), baseline:4827 (4-arg), and
-- 20260801100900 (start_quiz_session). Doing so reopens the bulk answer-key
-- read AND re-requires the client-side key — do not run it after the companion
-- client change has shipped.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The server-side P6 predicate.
--
--    Pure function over VALUES, not a table read: callers pass the five columns
--    P6 constrains. That keeps it IMMUTABLE (usable in a WHERE clause and
--    index-friendly), keeps it SECURITY INVOKER, and means it cannot become a
--    back-door read of any row the caller could not already see.
--
--    Mirrors packages/lib/src/quiz/question-validation.ts at the
--    `allowNonMcq: true` posture (the live assembler's posture — the least
--    restrictive of the two the TS gate supports), so this filter can never
--    remove a row the client-side gate would have kept.
--      MIN_QUESTION_TEXT_LENGTH = 15   (question-validation.ts:102)
--      MIN_EXPLANATION_LENGTH   = 20   (question-validation.ts:104)
--      MIN_EXPLANATION_WORDS    = 8    (question-validation.ts:106)
--      REQUIRED_OPTION_COUNT    = 4    (question-validation.ts:108)
--    Distinctness is compared lower(btrim(...)) — same normalisation as the TS
--    gate's `optTexts` (question-validation.ts:306).
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.question_bank_p6_valid(
  p_question_text        text,
  p_options              jsonb,
  p_correct_answer_index integer,
  p_explanation          text,
  p_question_type        text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT
    -- ── Question text: non-empty, long enough to be a question, no template
    --    markers. (P6 verbatim: "non-empty text (no {{ / [BLANK])".)
    p_question_text IS NOT NULL
    AND length(btrim(p_question_text)) >= 15
    AND position('{{' in p_question_text) = 0
    AND position('[BLANK]' in p_question_text) = 0

    -- ── Explanation: required for EVERY type. (P6 verbatim: "non-empty
    --    explanation".) The word floor is the TS gate's MIN_EXPLANATION_WORDS —
    --    below it the explanation cannot teach anything.
    AND p_explanation IS NOT NULL
    AND length(btrim(p_explanation)) >= 20
    AND coalesce(
          array_length(regexp_split_to_array(btrim(p_explanation), '\s+'), 1),
          0
        ) >= 8

    -- ── Shape. MCQ rows must satisfy the full MCQ contract; non-MCQ rows
    --    (short/long answer, NCERT exercises) are graded from expected_answer /
    --    explanation and are exempt from the option/key checks, exactly as
    --    `allowNonMcq: true` behaves in the TS gate.
    AND (
      CASE
        WHEN lower(coalesce(p_question_type, 'mcq')) <> 'mcq' THEN true
        ELSE
          p_options IS NOT NULL
          AND jsonb_typeof(p_options) = 'array'
          -- P6 verbatim: "exactly 4 ... options"
          AND jsonb_array_length(p_options) = 4
          -- ★ THE CHECK THAT MOVED HERE FROM THE BROWSER ★
          --   P6 verbatim: "correct_answer_index 0-3".
          --   The NULL guard is first on purpose: this is the exact defect the
          --   2026-07-29 forensic audit found in the TS gate, where
          --   `null < 0` and `null > 3` are BOTH false in JS so a keyless
          --   question sailed through and was graded as index 0.
          --   start_quiz_session's own `COALESCE(correct_answer_index, 0)`
          --   (section 5) is the SQL-side twin of that same bug; this predicate
          --   is what now stops a NULL-key row ever reaching it.
          AND p_correct_answer_index IS NOT NULL
          AND p_correct_answer_index BETWEEN 0 AND 3
          -- P6 verbatim: options are non-empty ...
          AND NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements(p_options) AS e
             WHERE e.value IS NULL
                OR btrim(coalesce(e.value #>> '{}', '')) = ''
          )
          -- ... and DISTINCT. (A duplicated distractor turns a 4-way MCQ into
          -- a 3-way guess and inflates the P1 score by construction.)
          AND (
            SELECT count(DISTINCT lower(btrim(coalesce(e.value #>> '{}', ''))))
              FROM jsonb_array_elements(p_options) AS e
          ) = 4
      END
    );
$function$;

COMMENT ON FUNCTION public.question_bank_p6_valid(text, jsonb, integer, text, text) IS
  'Server-side P6 question-quality predicate (migration 20260814000017). SQL '
  'twin of the ANSWERABILITY/GRADEABILITY half of the canonical TS gate '
  'packages/lib/src/quiz/question-validation.ts, at its `allowNonMcq: true` '
  'posture. Pure/IMMUTABLE over the five values it is handed — reads no table, '
  'so it grants no new read and is safe in a WHERE clause. It exists because '
  'the `correct_answer_index 0-3` half of P6 could only ever be checked in the '
  'browser, which forced the answer key into every serving payload. Callers: '
  'select_quiz_questions_rag, select_quiz_questions_v2, get_quiz_questions '
  '(both overloads), start_quiz_session. The garbage-text / garbage-option / '
  'self-contradicting-explanation SUBSTRING heuristics are deliberately NOT '
  'ported here: they are additive to P6-verbatim, they still run client-side on '
  'every served row, and they would cost a large ILIKE scan on the hot path.';

GRANT EXECUTE ON FUNCTION public.question_bank_p6_valid(text, jsonb, integer, text, text)
  TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. select_quiz_questions_rag — keyless payload + server-side P6.
--
--    Body is 20260802100000's verbatim, with exactly three classes of change:
--      (a) `AND question_bank_p6_valid(...)` added to all FOUR predicate blocks
--          (pool-count, seen-count, reset DELETE, candidate_pool) — AC-7 of
--          that migration requires the four to agree;
--      (b) `qb.correct_answer_index` dropped from the candidate_pool projection;
--      (c) `'correct_answer_index', correct_answer_index,` dropped from the
--          returned jsonb_build_object.
--    Every other predicate, the verification ladder (E0/E1), the ops_events
--    telemetry, the ORDER BY, the LIMITs and the user_question_history upsert
--    are byte-identical to 20260802100000.
-- ══════════════════════════════════════════════════════════════════════════
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
  v_pair_enforced  BOOLEAN := false;
  v_verified_pool  INTEGER := 0;
  v_use_strict     BOOLEAN := false;
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
    AND qb.deleted_at IS NULL
    AND qb.content_status = 'published'
    AND qb.verification_state != 'failed'
    AND public.question_bank_p6_valid(
          qb.question_text, qb.options, qb.correct_answer_index,
          qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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
        AND qb.verification_state != 'failed'
        AND public.question_bank_p6_valid(
              qb.question_text, qb.options, qb.correct_answer_index,
              qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND qb.deleted_at IS NULL
          AND qb.content_status = 'published'
          AND qb.verification_state != 'failed'
          AND public.question_bank_p6_valid(
                qb.question_text, qb.options, qb.correct_answer_index,
                qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
          AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
          AND (
            qb.question_type_v2 = ANY(p_question_types)
            OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
          )
      );
    v_seen_count := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ff_grounded_ai_enforced_pairs
    WHERE grade = p_grade AND subject_code = p_subject AND enabled = true
  ) INTO v_pair_enforced;

  IF v_pair_enforced THEN
    SELECT COUNT(*) INTO v_verified_pool
    FROM question_bank qb
    WHERE qb.subject = p_subject
      AND qb.grade = p_grade
      AND qb.is_active = true
      AND qb.deleted_at IS NULL
      AND qb.content_status = 'published'
      AND qb.verification_state = 'verified'
      AND qb.verified_against_ncert = true
      AND public.question_bank_p6_valid(
            qb.question_text, qb.options, qb.correct_answer_index,
            qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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

  v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;

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
      qb.options, qb.explanation, qb.explanation_hi, qb.hint,
      qb.difficulty, qb.bloom_level, qb.chapter_number,
      ch.title AS chapter_title,
      qb.concept_tag, qb.case_passage, qb.case_passage_hi,
      qb.expected_answer, qb.expected_answer_hi, qb.max_marks,
      qb.is_ncert, qb.ncert_exercise,
      CASE WHEN s.question_id IS NULL THEN 0 ELSE 1 END AS seen_rank,
      CASE WHEN qb.is_ncert = true THEN 0 ELSE 1 END AS ncert_rank,
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
      AND qb.verification_state != 'failed'
      -- Server-side P6 (migration 20260814000017). A row that cannot be graded
      -- must never be selected — this is the check that used to run in the
      -- browser against the answer key this function no longer returns.
      AND public.question_bank_p6_valid(
            qb.question_text, qb.options, qb.correct_answer_index,
            qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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
  -- KEYLESS PAYLOAD (20260814000017): the correct_answer_index member that used
  -- to sit between the options and explanation members is GONE. Every other
  -- member keeps its name, order and COALESCE default.
  -- (Written without quoting the member name on purpose: section 7a asserts on
  -- pg_proc.prosrc, which INCLUDES comments, so a quoted mention here would
  -- trip this migration's own post-condition.)
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'question_text', question_text, 'question_hi', question_hi,
    'question_type', COALESCE(question_type,'mcq'), 'question_type_v2', COALESCE(question_type_v2,'mcq'),
    'options', options,
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
  '2026-08-14 (20260814000017): KEYLESS PAYLOAD — correct_answer_index is no '
  'longer returned to the caller, closing the bulk answer-key harvest that a '
  'question_bank column ACL alone could not close (this RPC is SECURITY '
  'DEFINER, so a caller-role ACL is invisible to it). Server-side P6 '
  '(question_bank_p6_valid) is now a filter in all four predicate blocks, which '
  'is what makes the keyless payload safe: the browser can no longer check '
  '"correct_answer_index 0-3" because it no longer has it. Everything below is '
  'unchanged. '
  'Phase 1.5 (2026-05-09): question-type filter widened so ''ncert'' in '
  'p_question_types matches qb.is_ncert=TRUE rows of any question_type_v2. '
  '2026-06-25: pool-reset guard (MIN_POOL_FOR_RESET=10). '
  '2026-08-01: ownership guard skips when auth.uid() IS NULL (service-role). '
  '2026-08-02: verification gate — Tier-0 predicates (deleted_at IS NULL, '
  'content_status = ''published'', verification_state != ''failed'') plus the '
  'ff_grounded_ai_enforced_pairs E0/E1 ladder and its ops_events telemetry.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3. select_quiz_questions_v2 — keyless payload + server-side P6.
--    Body is 20260625000200's verbatim plus the same three change classes.
-- ══════════════════════════════════════════════════════════════════════════
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
    AND public.question_bank_p6_valid(
          qb.question_text, qb.options, qb.correct_answer_index,
          qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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
        AND public.question_bank_p6_valid(
              qb.question_text, qb.options, qb.correct_answer_index,
              qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
        AND (p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)
        AND (
          qb.question_type_v2 = ANY(p_question_types)
          OR ('ncert' = ANY(p_question_types) AND qb.is_ncert = TRUE)
        )
    );

  IF v_total_pool >= MIN_POOL_FOR_RESET AND v_seen_count::REAL / v_total_pool >= 0.80 THEN
    DELETE FROM user_question_history h
    WHERE h.student_id = p_student_id AND h.subject = p_subject AND h.grade = p_grade
      AND (p_chapter_number IS NULL OR h.chapter_number = p_chapter_number)
      AND h.question_id IN (
        SELECT qb.id FROM question_bank qb
        WHERE qb.subject = p_subject AND qb.grade = p_grade AND qb.is_active = true
          AND public.question_bank_p6_valid(
                qb.question_text, qb.options, qb.correct_answer_index,
                qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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
           qb.options, qb.explanation, qb.explanation_hi, qb.hint,
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
      -- Server-side P6 (migration 20260814000017) — see the rag RPC above.
      AND public.question_bank_p6_valid(
            qb.question_text, qb.options, qb.correct_answer_index,
            qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
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
  -- KEYLESS PAYLOAD (20260814000017) — see the rag RPC above.
  SELECT jsonb_agg(jsonb_build_object(
    'id', sel.id, 'question_text', sel.question_text, 'question_hi', sel.question_hi,
    'question_type', COALESCE(sel.question_type, 'mcq'),
    'question_type_v2', COALESCE(sel.question_type_v2, 'mcq'),
    'options', sel.options,
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
  '2026-08-14 (20260814000017): KEYLESS PAYLOAD — correct_answer_index removed '
  'from the returned objects; server-side P6 (question_bank_p6_valid) added as '
  'a filter to all four predicate blocks. Same rationale as '
  'select_quiz_questions_rag. '
  'Phase 1.5 (2026-05-09): question-type filter widened so ''ncert'' in '
  'p_question_types matches qb.is_ncert=TRUE rows of any question_type_v2. '
  '2026-06-25: pool-reset guard added (MIN_POOL_FOR_RESET=10).';

-- ══════════════════════════════════════════════════════════════════════════
-- 4. get_quiz_questions — BOTH overloads. Keyless payload + server-side P6.
--
--    The 4-arg overload (baseline:4827) is not dead: PostgREST resolves an RPC
--    call by the named-argument set, so a body of
--    {p_subject,p_grade,p_count,p_difficulty} binds to it exactly and it leaks
--    the key with no chapter filter at all. Both overloads are fixed; neither
--    is dropped (dropping either is a caller-visible contract change and is not
--    needed to close the leak).
-- ══════════════════════════════════════════════════════════════════════════
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
    -- KEYLESS PAYLOAD (20260814000017): correct_answer_index dropped from the
    -- projection. Server-side P6 added as a filter.
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, question_type, options,
             explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number
        FROM question_bank
       WHERE subject   = p_subject
         AND grade     = p_grade
         AND is_active   = true
         AND is_verified = true   -- A-03: only verified questions
         AND public.question_bank_p6_valid(
               question_text, options, correct_answer_index,
               explanation, COALESCE(question_type_v2, question_type, 'mcq'))
         AND (p_difficulty     IS NULL OR difficulty     = p_difficulty)
         AND (p_chapter_number IS NULL OR chapter_number = p_chapter_number)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    v_questions := '[]'::JSONB;
  END IF;

  RETURN v_questions;
END;
$function$;

COMMENT ON FUNCTION public.get_quiz_questions(text, text, integer, integer, integer) IS
  '2026-08-14 (20260814000017): KEYLESS PAYLOAD — correct_answer_index removed '
  'from the projection; server-side P6 (question_bank_p6_valid) added as a '
  'filter. A-03 (20260505155525): is_verified = true filter + p_chapter_number '
  'support. Only SME-verified, P6-valid questions reach students.';

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
  v_subject_id UUID;
  v_questions JSONB;
BEGIN
  SELECT id INTO v_subject_id FROM subjects WHERE code = p_subject LIMIT 1;

  IF v_subject_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'question_bank') THEN
    -- KEYLESS PAYLOAD (20260814000017): correct_answer_index dropped; P6 filter
    -- added. topic_id / the column order of everything else are preserved.
    SELECT COALESCE(jsonb_agg(q), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, question_text, question_hi, options,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
       WHERE subject = p_subject
         AND grade = p_grade
         AND is_active = true
         AND public.question_bank_p6_valid(
               question_text, options, correct_answer_index,
               explanation, COALESCE(question_type_v2, question_type, 'mcq'))
         AND (p_difficulty IS NULL OR difficulty = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) q;
  ELSE
    -- Legacy curriculum_topics shim. It synthesised a placeholder
    -- `0 AS correct_answer_index` — that member is dropped too, so this branch
    -- also stops handing the client a (fake) key. The four placeholder options
    -- are kept so the shape is otherwise unchanged.
    SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) INTO v_questions
    FROM (
      SELECT id, title AS question_text, title_hi AS question_hi,
             '["Option A","Option B","Option C","Option D"]'::JSONB AS options,
             description AS explanation,
             NULL AS explanation_hi,
             difficulty_level AS difficulty,
             'remember' AS bloom_level,
             id AS topic_id
        FROM curriculum_topics
       WHERE subject_id = v_subject_id
         AND grade = p_grade
         AND is_active = true
         AND (p_difficulty IS NULL OR difficulty_level = p_difficulty)
       ORDER BY random()
       LIMIT p_count
    ) t;
  END IF;

  RETURN v_questions;
END;
$function$;

COMMENT ON FUNCTION public.get_quiz_questions(text, text, integer, integer) IS
  '2026-08-14 (20260814000017): KEYLESS PAYLOAD — correct_answer_index removed '
  'from BOTH branches (including the curriculum_topics shim''s synthetic '
  '0-valued key); server-side P6 (question_bank_p6_valid) added as a filter on '
  'the question_bank branch. This is the ORIGINAL 4-arg overload from the '
  'baseline; it is still reachable by name from PostgREST, which is why it had '
  'to be fixed alongside the 5-arg version rather than assumed dead.';

-- ══════════════════════════════════════════════════════════════════════════
-- 5. start_quiz_session — the last server checkpoint before render.
--
--    Body is 20260801100900's verbatim plus ONE change: a P6 gate that SKIPS a
--    question failing question_bank_p6_valid, so it gets no snapshot row and is
--    not returned to the client. The client drops any served question the
--    server did not snapshot (companion change in
--    apps/host/src/app/(student)/quiz/page.tsx).
--
--    This is what makes every DIRECT-question_bank student path keyless without
--    each of them needing its own gate: the deep link (?qid=), the SRS review
--    set, the PYQ preferred fetch, the adaptive candidate provider and the v1
--    direct-query fallback all reach the student THROUGH this function.
--
--    It also closes a latent P6 hole of its own: line 111 of the prior body did
--    `v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0)`, which
--    silently snapshotted index 0 as the answer key for a NULL-key MCQ — the
--    exact SQL twin of the JS `null < 0` bug the TS gate fixed in 2026-07.
--    A NULL-key MCQ can no longer get this far. The COALESCE is retained only
--    for the non-MCQ branch, where the key is legitimately absent and scoring
--    goes through the written-answer path instead.
-- ══════════════════════════════════════════════════════════════════════════
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
    SELECT id, question_text, question_hi, options, correct_answer_index,
           explanation, explanation_hi, hint, difficulty, bloom_level,
           chapter_number, question_type, question_type_v2
      INTO v_question_meta
      FROM question_bank
      WHERE id = v_qid AND is_active = true;

    IF v_question_meta IS NULL THEN
      CONTINUE;
    END IF;

    -- ★ SERVER-SIDE P6 GATE (migration 20260814000017) ★
    -- The single checkpoint every direct-question_bank student path funnels
    -- through. A row that cannot be graded is skipped: no snapshot row, and it
    -- is absent from the returned `questions` array, which is the client's
    -- signal to drop it. Silent-skip (not RAISE) matches the pre-existing
    -- unknown/inactive-id behaviour above: one bad id must never abort a whole
    -- session start.
    IF NOT public.question_bank_p6_valid(
         v_question_meta.question_text,
         v_question_meta.options,
         v_question_meta.correct_answer_index,
         v_question_meta.explanation,
         COALESCE(v_question_meta.question_type_v2, v_question_meta.question_type, 'mcq')
       ) THEN
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

    -- The COALESCE survives ONLY for the non-MCQ branch (where the key is
    -- legitimately NULL and scoring runs through the written-answer path). The
    -- P6 gate above guarantees an MCQ row reaching here has a real 0..3 key, so
    -- this can no longer fabricate index 0 for a keyless MCQ.
    v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0);

    v_options_version := 0;

    v_integrity_hash := encode(
      extensions.digest(v_options_arr::text || v_correct_idx::text, 'sha256'),
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
        -- DO NOT include correct_answer_index here. That's the bug class
        -- migration 20260428160000 closed for this function.
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'questions', v_questions
  );
END;
$$;

COMMENT ON FUNCTION "public"."start_quiz_session"("uuid", "uuid"[]) IS
  '2026-08-14 (20260814000017): now also the SERVER-SIDE P6 CHECKPOINT. A '
  'question failing question_bank_p6_valid is skipped — no quiz_session_shuffles '
  'row is written and it is absent from the returned array, which is the '
  'client''s signal to drop it. This is what lets every direct-question_bank '
  'student path (deep link ?qid=, SRS review, PYQ preferred fetch, adaptive '
  'candidate provider, v1 direct-query fallback) stop selecting '
  'correct_answer_index: the browser no longer performs the "index 0-3" half of '
  'P6, so it no longer needs the key. It also closes a latent hole of its own — '
  'COALESCE(correct_answer_index, 0) used to snapshot index 0 as the answer key '
  'for a NULL-key MCQ; that row can no longer reach the COALESCE. '
  'P0 fix (20260428160000): server-owned shuffle authority — per-question '
  'Fisher-Yates, snapshots options + correct_answer_index into '
  'quiz_session_shuffles, returns SHUFFLED options WITHOUT correct_answer_index. '
  'Pair with submit_quiz_results_v2. UPDATED (20260801100800): populates '
  'options_version_at_serve (sentinel 0) and integrity_hash. UPDATED '
  '(20260801100900): schema-qualified extensions.digest().';

-- ══════════════════════════════════════════════════════════════════════════
-- 6. check_formative_answer — keyless grading for the /learn Quick Check.
--
--    WHY A NEW FUNCTION RATHER THAN REUSING check_quiz_answer: that RPC grades
--    against a quiz_session_shuffles row, which only exists for a session
--    minted by start_quiz_session. Minting one for the FORMATIVE Quick Check
--    would poison the /today "Continue where you stopped" card:
--    resolveResumableQuiz (packages/lib/src/state/student-state-builder.ts:512)
--    reads the student''s NEWEST snapshot row and returns null when its
--    session_mode is unrecognised — so a Quick Check session would suppress a
--    genuinely resumable quiz that happened to be older. A formative surface
--    must not be able to cancel a summative affordance.
--
--    WHAT THIS IS: the smallest possible server-side verdict for ONE question
--    the student is looking at. It reads the answer key server-side and returns
--    correctness. It does NOT touch XP, quiz_sessions, quiz_responses,
--    concept_mastery, student_learning_profiles or bloom_progression — the
--    Quick Check is un-scored (see the "ONE ASSESSMENT ENGINE PER CHAPTER" note
--    in apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx) and its
--    only learner-state sink is the UNCHANGED recordLearningEvent path.
--    P1/P2/P4 are untouched.
--
--    RESIDUAL, STATED PLAINLY: like check_quiz_answer, this reveals the correct
--    index for the ONE question asked about, so a determined caller can still
--    learn one key per request. That is a deliberate and much smaller exposure
--    than the status quo, which shipped every key in the page payload for free:
--    harvesting now costs one authenticated, rate-limited, individually
--    attributable round trip per question instead of zero. A replay-lock (the
--    defence check_quiz_answer has) needs per-(student, question) answer state,
--    which needs a new table — deferred to architect rather than bolted onto
--    user_question_history.last_result, which the scored submit path also writes
--    and would therefore replay a stale summative verdict onto a formative one.
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_formative_answer(
  p_question_id  uuid,
  p_selected_index integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER justified: reads question_bank.correct_answer_index, which
-- the companion column ACL puts out of reach of the `authenticated` role. The
-- caller is authorised inline (must be a signed-in student) and the row is
-- restricted to what the serve path would have given them anyway.
SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_is_correct BOOLEAN;
BEGIN
  IF p_selected_index IS NULL OR p_selected_index NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'invalid_selected_index: % is out of range 0..3', p_selected_index
      USING ERRCODE = 'P0001';
  END IF;

  -- Ownership/identity guard. auth.uid() IS NULL means a service-role caller
  -- (cron / edge function), which is allowed through exactly as every other
  -- quiz RPC in this codebase does. A JWT caller must be a real student.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM students WHERE auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT id, correct_answer_index, explanation, explanation_hi
    INTO v_row
    FROM question_bank
   WHERE id = p_question_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'question_not_available: %', p_question_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.correct_answer_index IS NULL THEN
    -- Unreachable through the serve path (P6 filters these out) but it must not
    -- be graded as index 0 if it ever is. Refuse loudly instead.
    RAISE EXCEPTION 'question_not_gradeable: % has no answer key', p_question_id
      USING ERRCODE = 'P0001';
  END IF;

  v_is_correct := (v_row.correct_answer_index = p_selected_index);

  RETURN jsonb_build_object(
    'question_id', v_row.id,
    'is_correct', v_is_correct,
    'correct_answer_index', v_row.correct_answer_index,
    'explanation', v_row.explanation,
    'explanation_hi', v_row.explanation_hi
  );
END;
$function$;

COMMENT ON FUNCTION public.check_formative_answer(uuid, integer) IS
  'Keyless grading for the /learn chapter Quick Check (migration '
  '20260814000017). The Quick Check used to compare the student''s tap against '
  'question_bank.correct_answer_index IN THE BROWSER, which is why '
  'getChapterQuestions had to select the answer key for up to 50 questions at '
  'once. This RPC moves that comparison server-side so the page can stop '
  'selecting the column. Reveals ONE question''s verdict per call and nothing '
  'about any other question. Touches NO scoring state: no XP, no quiz_sessions, '
  'no quiz_responses, no concept_mastery — the Quick Check is formative and its '
  'only learner-state sink remains recordLearningEvent (P1/P2/P4 untouched). '
  'Deliberately NOT built on check_quiz_answer: that needs a '
  'quiz_session_shuffles row, and minting one for a formative surface would '
  'suppress the /today resume card for a genuinely resumable older quiz '
  '(resolveResumableQuiz reads the NEWEST snapshot row and refuses on an '
  'unrecognised session_mode).';

GRANT EXECUTE ON FUNCTION public.check_formative_answer(uuid, integer)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_formative_answer(uuid, integer) FROM anon;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. Self-verifying post-conditions. Any failure rolls the whole transaction
--    back rather than leaving a half-applied keyless/keyed mix.
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_src TEXT;
  v_name TEXT;
  v_serving TEXT[] := ARRAY[
    'select_quiz_questions_rag',
    'select_quiz_questions_v2',
    'get_quiz_questions'
  ];
  v_hits INT;
BEGIN
  -- 7a. NO serving RPC may emit a 'correct_answer_index' JSON member any more.
  --     The quoted form is what a jsonb_build_object key looks like in prosrc;
  --     the bare identifier still legitimately appears as an ARGUMENT to
  --     question_bank_p6_valid, which is why the assertion is on the quoted
  --     literal and not on the word.
  FOREACH v_name IN ARRAY v_serving LOOP
    FOR v_src IN
      SELECT p.prosrc
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      IF strpos(v_src, '''correct_answer_index''') > 0 THEN
        RAISE EXCEPTION
          'POST-CONDITION FAILED: %() still emits a ''correct_answer_index'' member — the answer key is still shipped to the client', v_name;
      END IF;
    END LOOP;
  END LOOP;

  -- 7b. start_quiz_session must STILL read the key (it snapshots it) and must
  --     NOT emit it.
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'start_quiz_session';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: start_quiz_session is missing';
  END IF;
  IF strpos(v_src, 'correct_answer_index_snapshot') = 0 THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: start_quiz_session no longer snapshots the answer key — submit_quiz_results_v2 would have nothing to grade against (P1)';
  END IF;
  IF strpos(v_src, '''correct_answer_index''') > 0 THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: start_quiz_session emits a ''correct_answer_index'' member';
  END IF;
  IF strpos(v_src, 'question_bank_p6_valid') = 0 THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: start_quiz_session lost its server-side P6 gate — the direct-question_bank student paths would serve ungradeable questions keylessly';
  END IF;

  -- 7c. The P6 predicate must be wired into EVERY serving RPC. A keyless
  --     payload without the server-side gate is strictly worse than the status
  --     quo: nothing would enforce "correct_answer_index 0-3" at all.
  FOREACH v_name IN ARRAY v_serving LOOP
    SELECT count(*) INTO v_hits
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name
       AND strpos(p.prosrc, 'question_bank_p6_valid') > 0;
    IF v_hits = 0 THEN
      RAISE EXCEPTION
        'POST-CONDITION FAILED: %() does not call question_bank_p6_valid — P6 would be unenforced on that path', v_name;
    END IF;
  END LOOP;

  -- 7d. BOTH get_quiz_questions overloads must be keyless. 7a already scans
  --     every row pg_proc returns for that name, so this asserts the count so a
  --     silently-dropped overload is also caught.
  SELECT count(*) INTO v_hits
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_quiz_questions';
  IF v_hits < 2 THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: expected both get_quiz_questions overloads (4-arg and 5-arg), found %', v_hits;
  END IF;

  -- 7e. The scoring authority is untouched and still reads the key.
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_quiz_results_v2'
   LIMIT 1;
  IF v_src IS NULL OR strpos(v_src, 'correct_answer_index_snapshot') = 0 THEN
    RAISE EXCEPTION
      'POST-CONDITION FAILED: submit_quiz_results_v2 can no longer read the snapshot answer key — P1 scoring would be broken';
  END IF;

  -- 7f. The P6 predicate itself behaves. These are the exact cases the browser
  --     gate used to catch; if the SQL twin disagrees, fail the migration.
  IF public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","4","6","8"]'::jsonb, NULL,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted a NULL correct_answer_index';
  END IF;
  IF public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","4","6","8"]'::jsonb, 4,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted an out-of-range correct_answer_index';
  END IF;
  IF public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","2","6","8"]'::jsonb, 0,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted duplicate options';
  END IF;
  IF public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","4","6"]'::jsonb, 0,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted a 3-option MCQ';
  END IF;
  IF public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","4","6","8"]'::jsonb, 0, 'Because.', 'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted a terse explanation';
  END IF;
  IF public.question_bank_p6_valid(
       'What is {{topic}}?',
       '["2","4","6","8"]'::jsonb, 0,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid accepted a template marker';
  END IF;
  IF NOT public.question_bank_p6_valid(
       'Which of these is a prime number?',
       '["2","4","6","8"]'::jsonb, 0,
       'A prime number has exactly two distinct positive divisors, one and itself.',
       'mcq') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid REJECTED a well-formed MCQ — every quiz would be empty';
  END IF;
  -- Non-MCQ rows are exempt from the option/key checks (allowNonMcq posture).
  IF NOT public.question_bank_p6_valid(
       'State Newton''s first law of motion in your own words.',
       '[]'::jsonb, NULL,
       'A body continues in its state of rest or uniform motion unless acted upon by an external force.',
       'long_answer') THEN
    RAISE EXCEPTION 'POST-CONDITION FAILED: question_bank_p6_valid REJECTED a valid non-MCQ question — written-answer quizzes would be empty';
  END IF;
END
$$;

COMMIT;

-- Tables touched:    none
-- Columns added:     none
-- Columns dropped:   none
-- RLS policies:      unchanged
-- Functions changed: select_quiz_questions_rag, select_quiz_questions_v2,
--                    get_quiz_questions (4-arg AND 5-arg), start_quiz_session
-- Functions added:   question_bank_p6_valid, check_formative_answer
-- Scoring functions: submit_quiz_results, submit_quiz_results_v2,
--                    atomic_quiz_profile_update, check_quiz_answer — NONE
--                    touched. P1/P2/P3/P4 bit-for-bit unchanged.
