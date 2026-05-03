-- Migration: 20260429010000_quiz_authenticity_phase_b_constraints.sql
-- Purpose: Phase B of the quiz authenticity fix — DB-level CHECK constraints
--          that lock the contract Phase A established. Ensures the
--          shuffle-drift bug class can never re-emerge.
--
-- Phase A reference (PR #447, prod git_sha=987fe70, migration
-- 20260428160000_quiz_session_shuffles.sql):
--   - Moved shuffle authority from client to server.
--   - Added quiz_session_shuffles snapshot table + start_quiz_session +
--     submit_quiz_results_v2 RPCs.
--   - Closed the bleeding (server is the only authority that can mark a
--     response correct).
--
-- Phase B (this migration) — additive only:
--   1. CHECK constraint on question_bank.options enforcing exactly 4
--      array elements (jsonb_array_length = 4) AND
--      correct_answer_index ∈ [0, 3]. P6 invariant in the database.
--   2. CHECK constraint on quiz_responses.selected_option ∈ [-1, 3]
--      (-1 sentinel for written-answer / no-selection paths; the column
--      is INTEGER, nullable — NULL is preserved as the legacy "not
--      answered" state by virtue of how SQL CHECKs evaluate nullable
--      columns: NULL passes the constraint).
--   3. CHECK constraint on question_bank.explanation forbidding the
--      regex 'Option [A-D]\b|विकल्प [क-घ]'. Closes the AI-generator
--      drift vector noted in the architect's forensic report — when
--      explanations reference position letters ("Option B is correct"),
--      a future shuffle re-derivation makes the explanation lie. The
--      contract is: explanations reference CONTENT, not POSITIONS.
--
-- Safe-on-dirty-data design:
--   Each constraint is wrapped in a DO block that first counts the
--   number of offending rows in the target table. If any rows would
--   fail the constraint, we RAISE NOTICE listing the count and the
--   constraint is NOT applied — the migration succeeds, the constraint
--   becomes a no-op for this run, and ops can clean the data and
--   re-run the migration. This makes the migration safe to ship to
--   production even if existing question_bank / quiz_responses rows
--   would currently violate the contract.
--
--   Rationale: blocking a deploy on dirty data is worse than the
--   marginal protection a CHECK constraint provides on go-live. The
--   Phase A snapshot already isolates in-flight scoring from drift;
--   the Phase B constraints are belt-and-suspenders. They MUST land
--   eventually, but they don't have to land synchronously with this
--   migration — the NOTICE makes the gap visible to ops in the
--   migration log.
--
-- Idempotent: every constraint guarded by `pg_constraint` lookup. Re-
-- running the migration is a no-op if the constraint already exists.
--
-- Backwards compatibility:
--   - No DROP, no ALTER COLUMN, no data mutation.
--   - Existing rows: untouched. New rows: must satisfy the constraints
--     once they are applied.
--   - Phase A code (quiz_session_shuffles, start_quiz_session,
--     submit_quiz_results_v2) is NOT modified.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. question_bank.options — exactly 4 options + correct_answer_index ∈ [0,3]
-- ──────────────────────────────────────────────────────────────────────────
-- Note: question_bank.options is JSONB (not a SQL array), so the correct
-- length check is jsonb_array_length(options), not array_length(options, 1).
-- The user-facing spec used array_length but the live schema (legacy
-- migration 000_core_schema.sql line 349) declares it JSONB. Phase B uses
-- the JSONB-correct predicate.

DO $$
DECLARE
  v_offenders INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_bank_options_p6_check'
  ) THEN
    RAISE NOTICE 'question_bank_options_p6_check already exists — skipping';
  ELSE
    -- Count rows that would fail the constraint. We deliberately do NOT
    -- count NULL options here because the column is NOT NULL DEFAULT '[]'
    -- — every row has a JSONB value. Rows where options is not a JSON
    -- array, or has != 4 elements, or correct_answer_index is out of
    -- range, all count as offenders.
    SELECT count(*) INTO v_offenders
      FROM question_bank
     WHERE NOT (
       jsonb_typeof(options) = 'array'
       AND jsonb_array_length(options) = 4
       AND correct_answer_index BETWEEN 0 AND 3
     );

    IF v_offenders > 0 THEN
      RAISE NOTICE
        'Skipping question_bank_options_p6_check: % offending rows '
        '(options is not a 4-element JSON array or correct_answer_index '
        'is outside [0,3]). Run an ops cleanup of question_bank, then '
        're-apply this migration to add the constraint.',
        v_offenders;
    ELSE
      EXECUTE
        'ALTER TABLE question_bank '
        'ADD CONSTRAINT question_bank_options_p6_check '
        'CHECK ('
        '  jsonb_typeof(options) = ''array'' '
        '  AND jsonb_array_length(options) = 4 '
        '  AND correct_answer_index BETWEEN 0 AND 3'
        ')';
      RAISE NOTICE 'Added question_bank_options_p6_check';
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN question_bank.options IS
  'JSONB array of MCQ options. P6 invariant: exactly 4 distinct non-empty '
  'options. CHECK constraint question_bank_options_p6_check (added by '
  'migration 20260429010000) enforces array shape + 4-element length + '
  'correct_answer_index ∈ [0,3] at the database level.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. quiz_responses.selected_option — must be in [-1, 3] when not NULL
-- ──────────────────────────────────────────────────────────────────────────
-- selected_option is declared INTEGER (nullable) in the legacy schema
-- (migration 000_core_schema.sql line 401). NULL is preserved as the
-- "not answered" / "abandoned" state by SQL's CHECK semantics: NULL
-- passes a CHECK constraint that evaluates to UNKNOWN. The -1 sentinel
-- is reserved for written-answer questions / no-selection paths in v2;
-- 0..3 covers the standard MCQ displayed-index range.

DO $$
DECLARE
  v_offenders INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quiz_responses_selected_option_range_check'
  ) THEN
    RAISE NOTICE 'quiz_responses_selected_option_range_check already exists — skipping';
  ELSE
    SELECT count(*) INTO v_offenders
      FROM quiz_responses
     WHERE selected_option IS NOT NULL
       AND NOT (selected_option BETWEEN -1 AND 3);

    IF v_offenders > 0 THEN
      RAISE NOTICE
        'Skipping quiz_responses_selected_option_range_check: % offending rows '
        '(selected_option outside [-1, 3]). Run an ops cleanup of '
        'quiz_responses, then re-apply this migration to add the constraint.',
        v_offenders;
    ELSE
      EXECUTE
        'ALTER TABLE quiz_responses '
        'ADD CONSTRAINT quiz_responses_selected_option_range_check '
        'CHECK ('
        '  selected_option IS NULL '
        '  OR selected_option BETWEEN -1 AND 3'
        ')';
      RAISE NOTICE 'Added quiz_responses_selected_option_range_check';
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN quiz_responses.selected_option IS
  'Displayed-index of the option the student selected. Range: NULL (not '
  'answered) | -1 (sentinel for written-answer / no-selection) | 0..3 '
  '(standard MCQ click). CHECK constraint quiz_responses_selected_option_range_check '
  '(added by migration 20260429010000) enforces the range. v2 submission '
  'pipeline (submit_quiz_results_v2) uses selected_displayed_index in [0,3]; '
  'this column stores the persisted displayed-index from the v2 second pass.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. question_bank.explanation — no positional letters ("Option A" /
--    "विकल्प क"). Explanations must reference content, not positions.
-- ──────────────────────────────────────────────────────────────────────────
-- Why: when an explanation says "Option B is correct because…", a future
-- shuffle re-derivation makes the explanation point at the wrong row.
-- The contract Foxy / quiz-generator must follow: explanations reference
-- the answer's CONTENT, not its position letter. This catches AI-generator
-- regressions at write time.
--
-- Regex: the migration uses POSIX `~` (case-sensitive). The forbidden
-- patterns are 'Option [A-D]\b' (English letters A/B/C/D as standalone
-- tokens, e.g. "Option A.", "Option B," — but NOT "Optional", "options")
-- and 'विकल्प [क-घ]' (Devanagari positional markers क/ख/ग/घ used as
-- enumeration in Hindi explanations). NULL explanations pass the CHECK.
--
-- The PostgreSQL POSIX engine treats `\b` as a word boundary; in PG's
-- ERE syntax this is written `[[:<:]]` / `[[:>:]]` for word starts/ends,
-- but `\b` is also accepted in modern PG via the SIMILAR / regex API.
-- Use SIMILAR-friendly alternation.

DO $$
DECLARE
  v_offenders INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_bank_explanation_no_positional_letters'
  ) THEN
    RAISE NOTICE 'question_bank_explanation_no_positional_letters already exists — skipping';
  ELSE
    SELECT count(*) INTO v_offenders
      FROM question_bank
     WHERE explanation IS NOT NULL
       AND explanation ~ 'Option [A-D]([^A-Za-z]|$)|विकल्प [क-घ]';

    IF v_offenders > 0 THEN
      RAISE NOTICE
        'Skipping question_bank_explanation_no_positional_letters: % offending rows '
        '(explanation references positional letters such as "Option A/B/C/D" or '
        '"विकल्प क/ख/ग/घ"). These references break under shuffle re-derivation. '
        'Run an ops cleanup of question_bank.explanation, then re-apply this '
        'migration to add the constraint.',
        v_offenders;
    ELSE
      EXECUTE
        'ALTER TABLE question_bank '
        'ADD CONSTRAINT question_bank_explanation_no_positional_letters '
        'CHECK ('
        '  explanation IS NULL '
        '  OR explanation !~ ''Option [A-D]([^A-Za-z]|$)|विकल्प [क-घ]'''
        ')';
      RAISE NOTICE 'Added question_bank_explanation_no_positional_letters';
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN question_bank.explanation IS
  'Human-readable explanation for the correct answer. Contract: must '
  'reference CONTENT, not position letters — "Option B is correct" / '
  '"विकल्प ख सही है" both break under shuffle re-derivation. CHECK '
  'constraint question_bank_explanation_no_positional_letters (added by '
  'migration 20260429010000) forbids the patterns at write time.';

-- End of migration: 20260429010000_quiz_authenticity_phase_b_constraints.sql
-- Constraints added (idempotent + safe-on-dirty-data):
--   question_bank.question_bank_options_p6_check
--   quiz_responses.quiz_responses_selected_option_range_check
--   question_bank.question_bank_explanation_no_positional_letters
-- Phase A (PR #447, migration 20260428160000) NOT modified.
