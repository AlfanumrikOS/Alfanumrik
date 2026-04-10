-- Fix: upsert_content_gap RPC was referenced by foxy-tutor but never created.
-- This tracks queries where no NCERT content was found, helping identify content gaps.

CREATE TABLE IF NOT EXISTS content_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  query TEXT NOT NULL,
  topic_title TEXT,
  hit_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  UNIQUE(subject, grade, query)
);

ALTER TABLE content_gaps ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (admin use only)
CREATE POLICY "Service role full access on content_gaps"
  ON content_gaps FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION upsert_content_gap(
  p_subject TEXT,
  p_grade TEXT,
  p_query TEXT,
  p_topic_title TEXT DEFAULT 'unknown'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO content_gaps (subject, grade, query, topic_title)
  VALUES (p_subject, p_grade, left(p_query, 200), p_topic_title)
  ON CONFLICT (subject, grade, query)
  DO UPDATE SET
    hit_count = content_gaps.hit_count + 1,
    last_seen_at = now(),
    topic_title = COALESCE(NULLIF(p_topic_title, 'unknown'), content_gaps.topic_title);
END;
$$;
