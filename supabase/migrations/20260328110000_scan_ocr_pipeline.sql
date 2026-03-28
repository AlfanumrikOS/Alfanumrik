-- Scan-to-OCR-to-Foxy Pipeline

CREATE TABLE IF NOT EXISTS student_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','completed','failed')),
  page_count INT DEFAULT 1,
  extracted_text TEXT,
  normalized_text TEXT,
  ocr_provider TEXT DEFAULT 'ocr.space',
  ocr_confidence FLOAT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scans_student ON student_scans(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_status ON student_scans(status);

CREATE TABLE IF NOT EXISTS foxy_scan_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  scan_id UUID NOT NULL REFERENCES student_scans(id),
  question TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foxy_scan_queries ON foxy_scan_queries(scan_id, created_at DESC);

ALTER TABLE student_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE foxy_scan_queries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY scans_service ON student_scans FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY scans_own ON student_scans FOR SELECT TO authenticated USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY scans_insert ON student_scans FOR INSERT TO authenticated WITH CHECK (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY foxy_scan_service ON foxy_scan_queries FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY foxy_scan_own ON foxy_scan_queries FOR SELECT TO authenticated USING (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY foxy_scan_insert ON foxy_scan_queries FOR INSERT TO authenticated WITH CHECK (student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('student-scans', 'student-scans', false, 10485760, ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
