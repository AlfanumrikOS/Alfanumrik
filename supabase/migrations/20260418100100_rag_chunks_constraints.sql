-- supabase/migrations/20260418100100_rag_chunks_constraints.sql

-- Guard: only add constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rag_content_chunks'
      AND constraint_name = 'rag_chunks_source_ncert_only'
  ) THEN
    ALTER TABLE rag_content_chunks
      ADD CONSTRAINT rag_chunks_source_ncert_only
      CHECK (source = 'ncert_2025');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rag_content_chunks'
      AND constraint_name = 'rag_chunks_valid_grade'
  ) THEN
    ALTER TABLE rag_content_chunks
      ADD CONSTRAINT rag_chunks_valid_grade
      CHECK (grade_short IN ('6','7','8','9','10','11','12'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_catalog_join
  ON rag_content_chunks (grade_short, subject_code, chapter_number);