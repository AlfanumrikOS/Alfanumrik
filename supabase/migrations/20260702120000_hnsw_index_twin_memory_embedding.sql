-- Migration: 20260702120000_hnsw_index_twin_memory_embedding.sql
-- Purpose: Add HNSW index on learner_twin_memory.embedding for fast cosine similarity search.
--          Without this index, buildTwinContext() performs a sequential scan over all memory
--          rows, which degrades to O(n) as the table grows. The partial WHERE clause skips
--          rows with no embedding (e.g., text-only memory entries) and keeps the index lean.
--
-- ─── Background ──────────────────────────────────────────────────────────────
-- Migration 20260702000300 created a non-partial HNSW index on this column
-- (idx_learner_twin_memory_embedding_hnsw) inside a transaction block, covering
-- all rows including nulls. This migration adds the REFINED form:
--   * Partial (WHERE embedding IS NOT NULL): skips null rows; the planner
--     automatically prefers this index for any query that carries an
--     IS NOT NULL predicate on embedding, which every semantic search does.
--   * CONCURRENTLY: built without holding an exclusive lock — safe on a live
--     table with concurrent writes.
-- This mirrors the production pattern on question_bank
-- (question_bank_embedding_hnsw_idx, baseline:18254) which uses the same
-- partial filter, same m/ef_construction, same operator class.
--
-- NOTE: embedding is vector(1024) (Voyage dimensionality), not 1536.
--       vector_cosine_ops is dimension-agnostic; the operator class resolves
--       correctly for any declared dimension.
--
-- SAFETY:
--   * CONCURRENTLY: builds without holding an exclusive lock — safe on a live table.
--   * IF NOT EXISTS: idempotent — safe to re-run.
--   * Partial index (WHERE embedding IS NOT NULL): skips null rows, keeps the index lean.
--
-- ROLLBACK: DROP INDEX CONCURRENTLY IF EXISTS learner_twin_memory_embedding_hnsw_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS learner_twin_memory_embedding_hnsw_idx
  ON public.learner_twin_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;
