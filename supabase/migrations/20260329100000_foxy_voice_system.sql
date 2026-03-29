/**
 * ALFANUMRIK — Foxy Voice Session Schema
 *
 * Stores voice session state, learner memory, and session history
 * for the real-time voice tutor. Builds on existing chat_sessions.
 */

-- ============================================================
-- FOXY VOICE SESSION TABLES
-- ============================================================

-- 1. Learner memory — persistent context Foxy uses across sessions
CREATE TABLE IF NOT EXISTS foxy_learner_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Academic profile
  preferred_language text DEFAULT 'en', -- en, hi, hinglish
  explanation_style text DEFAULT 'step_by_step', -- step_by_step, visual, analogy, example_first
  pace_preference text DEFAULT 'moderate', -- slow, moderate, fast
  confidence_level text DEFAULT 'developing', -- low, developing, moderate, high

  -- Behavioral signals
  avg_session_duration_seconds integer DEFAULT 0,
  total_voice_sessions integer DEFAULT 0,
  engagement_pattern text DEFAULT 'unknown', -- morning_learner, evening_learner, weekend_batcher, daily_consistent
  boredom_sensitivity text DEFAULT 'moderate', -- low, moderate, high (how quickly they disengage)
  struggle_threshold integer DEFAULT 3, -- consecutive wrong answers before switching to remedial

  -- Learning state
  recent_weak_concepts jsonb DEFAULT '[]', -- [{concept_id, title, last_error_type, confidence}]
  recent_strong_concepts jsonb DEFAULT '[]', -- [{concept_id, title, mastery_pct}]
  recent_mistakes jsonb DEFAULT '[]', -- [{question_text, wrong_answer, correct_answer, error_type, timestamp}]
  current_focus_topic text, -- what Foxy should prioritize
  parent_goals text, -- optional: parent-set learning goals

  -- Session continuity
  last_session_summary text, -- Foxy's own summary of last session
  last_session_mode text, -- teach, revise, quiz, motivate, recap
  last_session_at timestamptz,
  session_streak integer DEFAULT 0, -- consecutive days with voice session

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT foxy_memory_one_per_student UNIQUE (student_id)
);

-- 2. Voice session log — each voice conversation
CREATE TABLE IF NOT EXISTS foxy_voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Session metadata
  session_mode text NOT NULL DEFAULT 'teach', -- teach, revise, quiz, motivate, recap, freeform
  subject text,
  topic text,
  grade text,
  language text DEFAULT 'en',

  -- Timing
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,

  -- Quality metrics
  total_turns integer DEFAULT 0,
  student_turns integer DEFAULT 0,
  foxy_turns integer DEFAULT 0,
  questions_asked integer DEFAULT 0,
  questions_correct integer DEFAULT 0,
  interruptions integer DEFAULT 0,
  silences_detected integer DEFAULT 0,

  -- Engagement signals
  engagement_score integer, -- 0-100 calculated at session end
  struggle_moments integer DEFAULT 0,
  boredom_moments integer DEFAULT 0,
  breakthrough_moments integer DEFAULT 0,

  -- Content
  transcript jsonb DEFAULT '[]', -- [{role, text, timestamp_ms, duration_ms}]
  foxy_summary text, -- Foxy's own recap of what happened
  concepts_covered jsonb DEFAULT '[]', -- [concept_id, ...]
  xp_earned integer DEFAULT 0,

  -- Technical
  stt_provider text, -- browser, deepgram, whisper
  tts_provider text, -- browser, elevenlabs
  avg_latency_ms integer, -- avg response time

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foxy_voice_student ON foxy_voice_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_foxy_voice_recent ON foxy_voice_sessions(student_id, started_at DESC);

-- 3. Foxy voice personas — configurable voice characteristics
CREATE TABLE IF NOT EXISTS foxy_voice_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_name text NOT NULL DEFAULT 'default',
  tts_voice_id text, -- ElevenLabs or browser voice ID
  speaking_rate float DEFAULT 1.0, -- 0.8 = slower, 1.2 = faster
  pitch float DEFAULT 1.0,
  warmth text DEFAULT 'warm', -- warm, neutral, energetic
  language text DEFAULT 'en',
  sample_greeting text, -- "Hey! Ready to learn something cool today?"
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Insert default voice persona
INSERT INTO foxy_voice_config (persona_name, speaking_rate, warmth, sample_greeting, language)
VALUES
  ('default_en', 1.0, 'warm', 'Hey! Ready to learn something cool today?', 'en'),
  ('default_hi', 0.95, 'warm', 'नमस्ते! आज कुछ नया सीखने के लिए तैयार?', 'hi')
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE foxy_learner_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE foxy_voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE foxy_voice_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY foxy_memory_own ON foxy_learner_memory FOR SELECT USING (student_id = get_my_student_id());
CREATE POLICY foxy_memory_service ON foxy_learner_memory FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY foxy_voice_own ON foxy_voice_sessions FOR SELECT USING (student_id = get_my_student_id());
CREATE POLICY foxy_voice_service ON foxy_voice_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY foxy_config_read ON foxy_voice_config FOR SELECT USING (true);
CREATE POLICY foxy_config_service ON foxy_voice_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. RPC: Get or create learner memory
CREATE OR REPLACE FUNCTION get_or_create_learner_memory(p_student_id uuid)
RETURNS foxy_learner_memory LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_memory foxy_learner_memory;
BEGIN
  SELECT * INTO v_memory FROM foxy_learner_memory WHERE student_id = p_student_id;
  IF v_memory IS NULL THEN
    INSERT INTO foxy_learner_memory (student_id) VALUES (p_student_id) RETURNING * INTO v_memory;
  END IF;
  RETURN v_memory;
END;
$$;

-- 5. RPC: Update learner memory after session
CREATE OR REPLACE FUNCTION update_learner_memory_after_session(
  p_student_id uuid,
  p_session_summary text,
  p_session_mode text,
  p_weak_concepts jsonb DEFAULT NULL,
  p_strong_concepts jsonb DEFAULT NULL,
  p_recent_mistakes jsonb DEFAULT NULL,
  p_engagement_score integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE foxy_learner_memory SET
    last_session_summary = p_session_summary,
    last_session_mode = p_session_mode,
    last_session_at = NOW(),
    total_voice_sessions = total_voice_sessions + 1,
    recent_weak_concepts = COALESCE(p_weak_concepts, recent_weak_concepts),
    recent_strong_concepts = COALESCE(p_strong_concepts, recent_strong_concepts),
    recent_mistakes = COALESCE(p_recent_mistakes, recent_mistakes),
    confidence_level = CASE
      WHEN p_engagement_score IS NOT NULL AND p_engagement_score >= 80 THEN 'high'
      WHEN p_engagement_score IS NOT NULL AND p_engagement_score >= 50 THEN 'moderate'
      WHEN p_engagement_score IS NOT NULL AND p_engagement_score >= 25 THEN 'developing'
      WHEN p_engagement_score IS NOT NULL THEN 'low'
      ELSE confidence_level
    END,
    updated_at = NOW()
  WHERE student_id = p_student_id;
END;
$$;
