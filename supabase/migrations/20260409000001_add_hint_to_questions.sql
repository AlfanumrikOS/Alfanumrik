-- Migration: 20260409000001_add_hint_to_questions.sql
-- Purpose: Add hint and hint_hi columns to questions table (idempotent — legacy
--          schema may already have hint; hint_hi is new for bilingual P7 support).

-- Safe: legacy schema defined hint TEXT at line 353 of 000_core_schema.sql.
-- IF NOT EXISTS makes this a no-op when the column already exists.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS hint TEXT;

-- hint_hi carries the Hindi translation of the hint (P7: bilingual UI requirement).
ALTER TABLE questions ADD COLUMN IF NOT EXISTS hint_hi TEXT;

-- Partial index: used by the "add hints to top-500 hardest questions" admin query.
-- Scans only rows that still need a hint (WHERE hint IS NULL), ordered by difficulty.
CREATE INDEX IF NOT EXISTS idx_questions_difficulty_no_hint
  ON questions (difficulty DESC, id)
  WHERE hint IS NULL;

-- Partial index: allows fast lookup of questions that already have hints,
-- e.g., for serving hint-enriched sets or auditing hint coverage.
CREATE INDEX IF NOT EXISTS idx_questions_has_hint
  ON questions (id)
  WHERE hint IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: run this after applying to confirm columns and indexes exist.
--
-- SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'questions'
--     AND column_name IN ('hint', 'hint_hi')
--   ORDER BY column_name;
-- Expected: 2 rows
--
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'questions'
--     AND indexname IN (
--       'idx_questions_difficulty_no_hint',
--       'idx_questions_has_hint'
--     );
-- Expected: 2 rows
-- ─────────────────────────────────────────────────────────────────────────────
