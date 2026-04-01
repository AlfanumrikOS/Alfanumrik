-- Migration: 20260401140000_add_performance_indexes.sql
-- Purpose: Add missing indexes for frequently queried columns identified in performance audit.

-- 1. question_bank: chapter_number is filtered in getQuizQuestions() fallback
--    but has no standalone index. The composite (bloom_level, difficulty) exists
--    but difficulty alone is also filtered; adding a standalone index.
CREATE INDEX IF NOT EXISTS idx_question_bank_chapter_number
  ON question_bank(chapter_number);

CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty
  ON question_bank(difficulty);

-- 2. quiz_sessions: composite (student_id, created_at DESC) for dashboard queries.
--    Individual indexes on student_id and created_at exist but a composite avoids
--    bitmap merge for the common "student's recent quizzes" access pattern.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student_created
  ON quiz_sessions(student_id, created_at DESC);

-- 3. rag_content_chunks: pg_trgm GIN indexes for the ILIKE fallback in
--    match_rag_chunks(). Leading-wildcard LIKE cannot use btree indexes.
--    Only create if pg_trgm extension is available (it is on Supabase).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm extension not available, skipping trigram indexes';
END $$;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_topic_trgm
  ON rag_content_chunks USING gin(lower(topic) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_concept_trgm
  ON rag_content_chunks USING gin(lower(concept) gin_trgm_ops);
