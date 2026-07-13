-- ADR-007 action item 3 (executed against prod 2026-07-13 via MCP; this
-- migration is the idempotent guard so migration history and non-prod
-- environments converge on the same state).
--
-- rag_content_chunks carried four EXACT-DUPLICATE indexes (identical
-- definition to a surviving twin). Duplicates add write-path maintenance —
-- the duplicate HNSW expensively so — and zero read benefit.
--
-- Dropped (surviving twin in parentheses):
--   rag_content_chunks_embedding_hnsw_idx   (idx_rag_chunks_embedding_hnsw)
--   idx_rag_chunks_chapter_lookup           (idx_rag_chunks_chapter)
--   idx_rag_chunks_grade_subject_active     (idx_rag_chunks_active_grade_subject)
--   idx_rag_chunks_search_vector            (idx_rag_chunks_search)
--
-- Plain DROP INDEX here (not CONCURRENTLY) so the migration can run inside a
-- transaction; on prod these were already dropped CONCURRENTLY, so this is a
-- no-op there. On fresh environments the table is small during migration.

DROP INDEX IF EXISTS public.rag_content_chunks_embedding_hnsw_idx;
DROP INDEX IF EXISTS public.idx_rag_chunks_chapter_lookup;
DROP INDEX IF EXISTS public.idx_rag_chunks_grade_subject_active;
DROP INDEX IF EXISTS public.idx_rag_chunks_search_vector;
