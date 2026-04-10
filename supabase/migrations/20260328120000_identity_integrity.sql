-- Grade locking + academic progression
ALTER TABLE students ADD COLUMN IF NOT EXISTS grade_locked_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_session TEXT DEFAULT '2025-26';
ALTER TABLE students ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS promotion_status TEXT DEFAULT 'current' CHECK (promotion_status IN ('current','promoted','held_back'));

UPDATE students SET grade_locked_at = created_at WHERE grade_locked_at IS NULL AND grade IS NOT NULL;

-- DB trigger: prevent grade change by non-service-role
CREATE OR REPLACE FUNCTION protect_student_grade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.grade IS NOT NULL AND OLD.grade_locked_at IS NOT NULL AND NEW.grade != OLD.grade THEN
    IF current_setting('role') != 'service_role' THEN
      RAISE EXCEPTION 'Grade cannot be changed by user. Contact administration.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_grade ON students;
CREATE TRIGGER trg_protect_grade BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION protect_student_grade();

-- Promotion function (service_role only)
CREATE OR REPLACE FUNCTION promote_student_grade(p_student_id UUID, p_new_grade TEXT, p_new_session TEXT, p_actor_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE students SET grade = p_new_grade, academic_session = p_new_session, promoted_at = now(), promotion_status = 'promoted', grade_locked_at = now() WHERE id = p_student_id;
  INSERT INTO identity_events (auth_user_id, event_type, metadata)
  SELECT auth_user_id, 'grade_promoted', jsonb_build_object('new_grade', p_new_grade, 'new_session', p_new_session, 'actor_id', p_actor_id)
  FROM students WHERE id = p_student_id;
  RETURN true;
END;
$$;

-- Active sessions tracking
CREATE TABLE IF NOT EXISTS user_active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  session_token_hash TEXT NOT NULL,
  device_label TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON user_active_sessions(auth_user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON user_active_sessions(session_token_hash);
ALTER TABLE user_active_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY uas_service ON user_active_sessions FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY uas_own_read ON user_active_sessions FOR SELECT TO authenticated USING (auth_user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Identity events
CREATE TABLE IF NOT EXISTS identity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_events_user ON identity_events(auth_user_id, created_at DESC);
ALTER TABLE identity_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY ie_service ON identity_events FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
