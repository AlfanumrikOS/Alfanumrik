-- supabase/migrations/20260418100300_grounded_ai_traces.sql

CREATE TABLE IF NOT EXISTS grounded_ai_traces (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  caller                   text NOT NULL
    CHECK (caller IN ('foxy','ncert-solver','quiz-generator','concept-engine','diagnostic')),
  student_id               uuid REFERENCES students(id) ON DELETE SET NULL,
  grade                    text,
  subject_code             text,
  chapter_number           int,
  query_hash               text NOT NULL,
  query_preview            text,
  embedding_model          text,
  retrieved_chunk_ids      uuid[] NOT NULL,
  top_similarity           numeric(5,4),
  chunk_count              int NOT NULL,
  claude_model             text,
  prompt_template_id       text,
  prompt_hash              text,
  grounded                 boolean NOT NULL,
  abstain_reason           text,
  confidence               numeric(5,4),
  answer_length            int,
  input_tokens             int,
  output_tokens            int,
  latency_ms               int,
  client_reported_issue_id uuid
);

CREATE INDEX idx_traces_recent ON grounded_ai_traces (created_at DESC);
CREATE INDEX idx_traces_abstain ON grounded_ai_traces (created_at DESC)
  WHERE grounded = false;
CREATE INDEX idx_traces_student ON grounded_ai_traces (student_id, created_at DESC);
CREATE INDEX idx_traces_caller ON grounded_ai_traces (caller, created_at DESC);

ALTER TABLE grounded_ai_traces ENABLE ROW LEVEL SECURITY;

-- Admin read follows admin_users pattern. Service role (Edge Functions) writes;
-- admin_users read for debug + investigation. See §5.4 privacy guarantee:
-- full query/answer text lives only in foxy_chat_messages (student-RLS scoped),
-- never here — so admin_users read of traces doesn't leak PII by itself.
CREATE POLICY grounded_traces_read_admin ON grounded_ai_traces
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY grounded_traces_insert_service ON grounded_ai_traces
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Retention: grounded=true >90 days, grounded=false >180 days
CREATE OR REPLACE FUNCTION purge_old_grounded_traces()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM grounded_ai_traces
    WHERE grounded = true AND created_at < now() - INTERVAL '90 days';
  DELETE FROM grounded_ai_traces
    WHERE grounded = false AND created_at < now() - INTERVAL '180 days';
$$;

COMMENT ON TABLE grounded_ai_traces IS
  'Every AI call writes one row. Stores query_hash + 200-char preview only '
  '(P13 privacy). Full text requires consent-linked ai_issue_reports. See §5.4.';