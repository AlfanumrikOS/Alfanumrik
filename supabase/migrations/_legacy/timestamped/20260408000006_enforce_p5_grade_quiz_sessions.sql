-- P5 Grade Format Enforcement: quiz_sessions
--
-- Rationale: Migration 20260401100000 added the P5 CHECK constraint to
-- question_bank and curriculum_topics, but quiz_sessions was missed.
-- submit_quiz_results RPC accepts p_grade TEXT with no validation and
-- writes it verbatim — a malformed client could insert 'Grade 10' or
-- the integer 12, violating P5.
--
-- Invariant P5: grade must be one of '6','7','8','9','10','11','12'.
-- Never an integer, never 'Grade N' format.

BEGIN;

-- Step 1: Normalize any pre-existing non-compliant rows (defensive).
UPDATE quiz_sessions
SET    grade = REPLACE(grade, 'Grade ', '')
WHERE  grade LIKE 'Grade %'
  AND  REPLACE(grade, 'Grade ', '') IN ('6','7','8','9','10','11','12');

-- Step 2: Add CHECK constraint to enforce P5 at the DB level.
ALTER TABLE quiz_sessions
  ADD CONSTRAINT chk_quiz_sessions_grade_p5
  CHECK (grade IN ('6','7','8','9','10','11','12'));

COMMIT;
