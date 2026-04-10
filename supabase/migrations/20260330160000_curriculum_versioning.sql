-- Migration: 20260330160000_curriculum_versioning.sql
-- Purpose: Curriculum versioning support for NCERT syllabus replacement.
-- Enables old/new content coexistence during migration, then clean cutover.

-- ============================================================
-- 1. rag_content_chunks: Add source provenance columns
-- ============================================================
ALTER TABLE rag_content_chunks
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS source_book TEXT,
  ADD COLUMN IF NOT EXISTS chapter_number INTEGER,
  ADD COLUMN IF NOT EXISTS page_number INTEGER,
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER,
  ADD COLUMN IF NOT EXISTS token_count INTEGER;

-- Index for fast filtering by source version
CREATE INDEX IF NOT EXISTS idx_rag_chunks_source
  ON rag_content_chunks (source, is_active);

-- Index for grade+subject+source filtering (Foxy retrieval)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_grade_subject_active
  ON rag_content_chunks (grade, subject, is_active)
  WHERE is_active = true;

-- ============================================================
-- 2. question_bank: Add source version tag
-- ============================================================
ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS source_version TEXT DEFAULT 'legacy';

-- Index for filtering questions by source version
CREATE INDEX IF NOT EXISTS idx_question_bank_source_version
  ON question_bank (source_version, is_active);

-- ============================================================
-- 3. curriculum_topics: Add source version tag
-- ============================================================
DO $$ BEGIN
  ALTER TABLE curriculum_topics
    ADD COLUMN IF NOT EXISTS source_version TEXT DEFAULT 'legacy';
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'curriculum_topics does not exist yet, skipping ALTER';
END $$;

-- ============================================================
-- 4. content_media: Textbook images/figures storage
-- ============================================================
CREATE TABLE IF NOT EXISTS content_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter_number INTEGER,
  chapter_title TEXT,
  page_number INTEGER,
  caption TEXT,
  alt_text TEXT,
  media_type TEXT NOT NULL DEFAULT 'image',
  storage_path TEXT,
  storage_url TEXT,
  source TEXT DEFAULT 'ncert_2025',
  source_book TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (mandatory for every new table)
ALTER TABLE content_media ENABLE ROW LEVEL SECURITY;

-- Public read for active content (curriculum media is not per-student data)
CREATE POLICY "content_media_public_read" ON content_media
  FOR SELECT USING (is_active = true);

-- Admin/service-role manages content via service role (bypasses RLS).
-- No student/parent/teacher INSERT/UPDATE/DELETE needed: this is
-- admin-ingested curriculum content, not user data.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_media_grade_subject
  ON content_media (grade, subject, chapter_number)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_content_media_source
  ON content_media (source, is_active);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_content_media_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_media_updated_at ON content_media;
CREATE TRIGGER trg_content_media_updated_at
  BEFORE UPDATE ON content_media
  FOR EACH ROW EXECUTE FUNCTION update_content_media_updated_at();
