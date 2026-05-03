-- Add CHECK constraint for bloom_level in question_bank
-- Ensures only valid Bloom's taxonomy levels can be stored.
-- Idempotent: drops existing constraint first if present.

ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_bloom_level;
ALTER TABLE question_bank ADD CONSTRAINT chk_bloom_level
  CHECK (bloom_level IS NULL OR bloom_level IN (
    'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'
  ));

-- Also add difficulty constraint if not present
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_difficulty_value;
ALTER TABLE question_bank ADD CONSTRAINT chk_difficulty_value
  CHECK (difficulty IS NULL OR (difficulty >= 1 AND difficulty <= 5));
