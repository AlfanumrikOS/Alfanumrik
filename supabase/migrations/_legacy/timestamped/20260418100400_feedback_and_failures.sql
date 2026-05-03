-- supabase/migrations/20260418100400_feedback_and_failures.sql

-- content_requests: students ask for a chapter to be added
CREATE TABLE IF NOT EXISTS content_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid REFERENCES students(id) ON DELETE CASCADE,
  grade          text NOT NULL,
  subject_code   text NOT NULL,
  chapter_number int  NOT NULL,
  chapter_title  text,
  request_source text CHECK (request_source IN ('foxy','quiz','learn','ncert-solver')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One request per (student, chapter) per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_requests_one_per_day
  ON content_requests (student_id, grade, subject_code, chapter_number,
                       (date_trunc('day', created_at)));

CREATE INDEX IF NOT EXISTS idx_content_requests_prioritize
  ON content_requests (grade, subject_code, chapter_number);

ALTER TABLE content_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_requests_read_own ON content_requests
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()) OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY content_requests_insert_own ON content_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- ai_issue_reports: students flag bad AI answers
CREATE TABLE IF NOT EXISTS ai_issue_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  foxy_message_id    uuid,                        -- FK added later if table exists
  question_bank_id   uuid REFERENCES question_bank(id) ON DELETE SET NULL,
  trace_id           uuid REFERENCES grounded_ai_traces(id) ON DELETE SET NULL,
  reason_category    text NOT NULL
    CHECK (reason_category IN ('wrong_answer','off_topic','inappropriate','unclear','other')),
  student_comment    text,
  admin_notes        text,
  admin_resolution   text
    CHECK (admin_resolution IN ('bad_chunk','bad_prompt','bad_question','infra','no_issue','pending')),
  resolved_by        uuid,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Wire the foxy_message_id FK conditionally
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'foxy_chat_messages') THEN
    ALTER TABLE ai_issue_reports
      ADD CONSTRAINT ai_issue_reports_foxy_message_fk
      FOREIGN KEY (foxy_message_id) REFERENCES foxy_chat_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_issue_reports_pending
  ON ai_issue_reports (created_at DESC)
  WHERE admin_resolution IS NULL OR admin_resolution = 'pending';

ALTER TABLE ai_issue_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_issue_reports_read_own_or_admin ON ai_issue_reports
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid()) OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY ai_issue_reports_insert_own ON ai_issue_reports
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role' OR
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY ai_issue_reports_update_admin ON ai_issue_reports
  FOR UPDATE USING (
    auth.role() = 'service_role' OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- rag_ingestion_failures: bad chunks land here, not in rag_content_chunks
CREATE TABLE IF NOT EXISTS rag_ingestion_failures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file        text,
  grade              text,
  subject_code       text,
  chapter_number     int,
  reason             text NOT NULL,
  raw_data_preview   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rag_ingestion_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY rag_ingestion_failures_read_admin ON rag_ingestion_failures
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );