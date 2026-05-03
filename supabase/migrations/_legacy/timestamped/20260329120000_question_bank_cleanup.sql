-- ============================================================
-- QUESTION BANK QUALITY CLEANUP
-- Removes template/garbage questions, fixes wrong answers,
-- and adds constraints to prevent future bad data.
-- ============================================================

-- 1. Delete template questions (auto-generated, not real NCERT content)
DELETE FROM question_bank
WHERE question_text LIKE 'A student studying%should focus on:%'
   OR question_text LIKE 'In the context of%which statement is most accurate?%'
   OR question_text LIKE 'Which of the following best describes the main top%';

-- 2. Delete questions with garbage options
DELETE FROM question_bank WHERE options::text LIKE '%Unrelated topic%';

-- 3. Delete questions whose explanations admit they are wrong
DELETE FROM question_bank
WHERE explanation ILIKE '%however%this does not match%'
   OR explanation ILIKE '%suggesting a possible error%'
   OR explanation ILIKE '%does not match%any option%'
   OR explanation ILIKE '%seems to be a mistake%'
   OR explanation ILIKE '%closest option%assuming typo%';

-- 4. Delete questions with wrong option count or empty text
DELETE FROM question_bank WHERE jsonb_array_length(options::jsonb) != 4;
DELETE FROM question_bank WHERE length(question_text) <= 10;

-- 5. Delete exact duplicates (keep one copy)
DELETE FROM question_bank a USING question_bank b
WHERE a.question_text = b.question_text AND a.id > b.id;

-- 6. Add constraints to prevent future bad data
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_valid_answer_index;
ALTER TABLE question_bank ADD CONSTRAINT chk_valid_answer_index
  CHECK (correct_answer_index >= 0 AND correct_answer_index <= 3);

ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_four_options;
ALTER TABLE question_bank ADD CONSTRAINT chk_four_options
  CHECK (jsonb_array_length(options::jsonb) = 4);

ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_question_not_empty;
ALTER TABLE question_bank ADD CONSTRAINT chk_question_not_empty
  CHECK (length(question_text) > 10);

-- 7. Unique constraint to prevent duplicate questions per subject+grade
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_no_duplicates
  ON question_bank (md5(question_text), subject, grade);
