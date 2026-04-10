-- Migration: drop_redundant_unused_indexes
-- Applied: 2026-04-08 (P4 Sprint)
-- Purpose: Drop 9 zero-scan redundant/duplicate indexes to reduce write amplification.
--          Retained: all HNSW/IVFFlat vector indexes, FTS indexes, trigram indexes.

-- quiz_responses: date index (low cardinality, superseded by composite)
DROP INDEX IF EXISTS public.idx_quiz_responses_date;

-- student_daily_usage: rate_limit index (duplicate of usage enforcement query)
DROP INDEX IF EXISTS public.idx_student_daily_usage_rate_limit;

-- question_bank: redundant single-column indexes (all data in multi-column indexes)
DROP INDEX IF EXISTS public.idx_question_bank_source;
DROP INDEX IF EXISTS public.idx_questions_source_year;
DROP INDEX IF EXISTS public.idx_question_bank_board_year_subject;
DROP INDEX IF EXISTS public.idx_questions_cognitive_load;
DROP INDEX IF EXISTS public.idx_qb_board_relevance;
DROP INDEX IF EXISTS public.idx_qb_concept;
DROP INDEX IF EXISTS public.idx_question_bank_difficulty;
