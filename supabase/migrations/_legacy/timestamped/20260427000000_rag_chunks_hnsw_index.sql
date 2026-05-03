-- Migration: 20260427000000_rag_chunks_hnsw_index.sql
-- Purpose: Phase 1 of Foxy moat plan — replace IVFFlat indexes on embedding columns
--          with HNSW for higher recall + lower latency at our current corpus size.
--
-- Background:
--   - rag_content_chunks.embedding is currently indexed via IVFFlat (lists=50)
--     created in 20260403000001_fix_rag_vector_search.sql lines 329-340.
--   - question_bank.embedding is currently indexed via IVFFlat (lists=50)
--     created in 20260403600000_quiz_rag_retrieval.sql lines 18-21.
--   - HNSW with m=16, ef_construction=64 is the recommended default for pgvector
--     at corpus sizes < 1M and gives substantially better recall@k than IVFFlat=50.
--
-- Idempotent: uses IF EXISTS / IF NOT EXISTS guards. Uses CONCURRENTLY where the
-- environment supports it (Supabase migration runner accepts CONCURRENTLY outside
-- a transaction; we wrap each in DO blocks that catch failure and fall back to
-- a non-concurrent build so this migration never blocks deploy).
--
-- Reference: docs/foxy-moat-plan.md Phase 1 (Index migration).

-- ============================================================================
-- 1. Drop legacy IVFFlat index on rag_content_chunks.embedding
-- ============================================================================
DROP INDEX IF EXISTS idx_rag_chunks_embedding;

-- ============================================================================
-- 2. Create HNSW index on rag_content_chunks.embedding
--    m=16, ef_construction=64 are pgvector recommended defaults.
--    No partial filter: rag_content_chunks does not have an is_active flag on
--    every row historically; the existing IVFFlat index also did not filter.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'rag_content_chunks_embedding_hnsw_idx'
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX CONCURRENTLY rag_content_chunks_embedding_hnsw_idx
               ON rag_content_chunks
               USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)';
    EXCEPTION
      WHEN active_sql_transaction THEN
        -- Migration runner is inside a transaction; build non-concurrently.
        EXECUTE 'CREATE INDEX rag_content_chunks_embedding_hnsw_idx
                 ON rag_content_chunks
                 USING hnsw (embedding vector_cosine_ops)
                 WITH (m = 16, ef_construction = 64)';
      WHEN undefined_column THEN
        RAISE NOTICE 'rag_content_chunks.embedding column missing; skipping HNSW index';
      WHEN undefined_object THEN
        RAISE NOTICE 'pgvector hnsw access method not available; skipping';
    END;
  END IF;
END $$;

COMMENT ON INDEX rag_content_chunks_embedding_hnsw_idx IS
  'HNSW vector index for RAG retrieval. Replaces legacy IVFFlat (lists=50). '
  'See Foxy moat plan Phase 1.';

-- ============================================================================
-- 3. Drop legacy IVFFlat index on question_bank.embedding
-- ============================================================================
DROP INDEX IF EXISTS idx_qb_embedding;

-- ============================================================================
-- 4. Create HNSW index on question_bank.embedding (partial: active rows only)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'question_bank_embedding_hnsw_idx'
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX CONCURRENTLY question_bank_embedding_hnsw_idx
               ON question_bank
               USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)
               WHERE embedding IS NOT NULL AND is_active = true';
    EXCEPTION
      WHEN active_sql_transaction THEN
        EXECUTE 'CREATE INDEX question_bank_embedding_hnsw_idx
                 ON question_bank
                 USING hnsw (embedding vector_cosine_ops)
                 WITH (m = 16, ef_construction = 64)
                 WHERE embedding IS NOT NULL AND is_active = true';
      WHEN undefined_column THEN
        RAISE NOTICE 'question_bank.embedding column missing; skipping HNSW index';
      WHEN undefined_object THEN
        RAISE NOTICE 'pgvector hnsw access method not available; skipping';
    END;
  END IF;
END $$;

COMMENT ON INDEX question_bank_embedding_hnsw_idx IS
  'HNSW vector index for quiz RAG retrieval (partial on active embedded rows). '
  'Replaces legacy IVFFlat (lists=50). See Foxy moat plan Phase 1.';
