CREATE TABLE IF NOT EXISTS cbse_syllabus (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board                   text NOT NULL DEFAULT 'CBSE',
  grade                   text NOT NULL CHECK (grade IN ('6','7','8','9','10','11','12')),
  subject_code            text NOT NULL,
  subject_display         text NOT NULL,
  subject_display_hi      text,
  chapter_number          int  NOT NULL CHECK (chapter_number > 0),
  chapter_title           text NOT NULL,
  chapter_title_hi        text,
  chunk_count             int  NOT NULL DEFAULT 0,
  verified_question_count int  NOT NULL DEFAULT 0,
  rag_status              text NOT NULL DEFAULT 'missing'
    CHECK (rag_status IN ('missing','partial','ready')),
  last_verified_at        timestamptz,
  is_in_scope             boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board, grade, subject_code, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_cbse_syllabus_lookup
  ON cbse_syllabus (board, grade, subject_code, rag_status)
  WHERE is_in_scope;

CREATE INDEX IF NOT EXISTS idx_cbse_syllabus_ready
  ON cbse_syllabus (grade, subject_code)
  WHERE rag_status = 'ready' AND is_in_scope;

ALTER TABLE cbse_syllabus ENABLE ROW LEVEL SECURITY;

CREATE POLICY cbse_syllabus_read_authenticated ON cbse_syllabus
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY cbse_syllabus_write_admin ON cbse_syllabus
  FOR ALL USING (
    auth.role() = 'service_role' OR
    EXISTS (SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_code = 'content_admin')
  );

COMMENT ON TABLE cbse_syllabus IS
  'Layer 2 SSoT. One row per (board, grade, subject_code, chapter_number). '
  'rag_status derived from chunk_count + verified_question_count. '
  'See docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md §5.1';