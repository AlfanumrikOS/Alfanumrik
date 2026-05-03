-- Migration: 20260404000001_rag_quality_score.sql
--
-- Adds quality_score column to rag_content_chunks and backtfills
-- existing unscored chunks with a neutral default (0.7).
--
-- Context:
--   The content pipeline inserted ~10 372 chunks without quality scores.
--   Without this column the match_rag_chunks function cannot filter
--   out low-quality / malformed content.
--
-- After this migration:
--   - All existing chunks have quality_score = 0.7 (acceptable default).
--   - New chunks inserted by future ingestion scripts should set an
--     accurate score; this migration provides a safe floor.
--   - The 20260404000003 migration updates match_rag_chunks to honour
--     this column.

DO $$ BEGIN
  ALTER TABLE rag_content_chunks
    ADD COLUMN IF NOT EXISTS quality_score FLOAT DEFAULT 0.7;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'rag_content_chunks does not exist — skipping quality_score column';
END $$;

-- Backfill: set quality_score = 0.7 for all unscored chunks
-- (safe no-op if the column already had values or the table doesn't exist)
DO $$ BEGIN
  UPDATE rag_content_chunks
  SET quality_score = 0.7
  WHERE quality_score IS NULL;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'rag_content_chunks does not exist — skipping backfill';
END $$;

-- Index for quality filtering in match_rag_chunks (WHERE is_active=true)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_quality
  ON rag_content_chunks(quality_score)
  WHERE is_active = true;
