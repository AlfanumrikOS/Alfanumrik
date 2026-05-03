-- AI Tutor interaction logs for analytics and latency tracking
CREATE TABLE IF NOT EXISTS ai_tutor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'learn',
  topic_id UUID,
  lesson_step TEXT,
  message_length INT NOT NULL DEFAULT 0,
  reply_length INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  xp_earned INT NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_ai_tutor_logs_student_date
  ON ai_tutor_logs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tutor_logs_latency
  ON ai_tutor_logs (created_at DESC, latency_ms);

-- RLS: students can read their own logs, service role can write
ALTER TABLE ai_tutor_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own tutor logs"
  ON ai_tutor_logs FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Service role can insert tutor logs"
  ON ai_tutor_logs FOR INSERT
  WITH CHECK (true);
