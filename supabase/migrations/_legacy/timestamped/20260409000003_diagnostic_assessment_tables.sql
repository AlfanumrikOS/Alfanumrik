-- Migration: 20260409000003_diagnostic_assessment_tables.sql
-- Purpose: Create diagnostic_sessions and diagnostic_responses tables for
--          adaptive diagnostic assessments (grades 6-10, math + science),
--          with full RLS coverage and a complete_diagnostic_session() RPC.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. diagnostic_sessions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- P5: grade is a TEXT string "6"–"10", never an integer.
  grade                 TEXT        NOT NULL CHECK (grade IN ('6','7','8','9','10')),
  subject               TEXT        NOT NULL CHECK (subject IN ('math','science','physics','chemistry','biology')),
  status                TEXT        NOT NULL DEFAULT 'in_progress'
                                    CHECK (status IN ('in_progress','completed','abandoned')),
  total_questions       INTEGER     NOT NULL DEFAULT 0,
  correct_answers       INTEGER     NOT NULL DEFAULT 0,
  -- IRT ability estimate (Item Response Theory theta parameter, typically -3 to +3)
  estimated_theta       FLOAT       DEFAULT 0,
  topics_assessed       JSONB       DEFAULT '[]',
  weak_topics           JSONB       DEFAULT '[]',
  strong_topics         JSONB       DEFAULT '[]',
  recommended_difficulty TEXT       DEFAULT 'medium',
  started_at            TIMESTAMPTZ DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (P8: mandatory for every new table)
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;

-- Student reads/writes own sessions
CREATE POLICY "diagnostic_sessions_student_select" ON diagnostic_sessions
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "diagnostic_sessions_student_insert" ON diagnostic_sessions
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "diagnostic_sessions_student_update" ON diagnostic_sessions
  FOR UPDATE USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Parent reads linked child's sessions
CREATE POLICY "diagnostic_sessions_parent_select" ON diagnostic_sessions
  FOR SELECT USING (
    student_id IN (
      SELECT gsl.student_id
        FROM guardian_student_links gsl
        JOIN guardians g ON g.id = gsl.guardian_id
       WHERE g.auth_user_id = auth.uid()
         AND gsl.status = 'approved'
    )
  );

-- Teacher reads sessions for students in assigned classes
CREATE POLICY "diagnostic_sessions_teacher_select" ON diagnostic_sessions
  FOR SELECT USING (
    student_id IN (
      SELECT ce.student_id
        FROM class_enrollments ce
        JOIN classes c ON c.id = ce.class_id
        JOIN teachers t ON t.id = c.teacher_id
       WHERE t.auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. diagnostic_responses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_responses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID        NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
  student_id            UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id           UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer_index INTEGER     NOT NULL,
  is_correct            BOOLEAN     NOT NULL,
  time_taken_seconds    INTEGER     DEFAULT 0,
  topic                 TEXT,
  difficulty            INTEGER     DEFAULT 2,
  bloom_level           TEXT        DEFAULT 'remember',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (P8: mandatory for every new table)
ALTER TABLE diagnostic_responses ENABLE ROW LEVEL SECURITY;

-- Student reads/writes own responses
CREATE POLICY "diagnostic_responses_student_select" ON diagnostic_responses
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "diagnostic_responses_student_insert" ON diagnostic_responses
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Parent reads linked child's responses
CREATE POLICY "diagnostic_responses_parent_select" ON diagnostic_responses
  FOR SELECT USING (
    student_id IN (
      SELECT gsl.student_id
        FROM guardian_student_links gsl
        JOIN guardians g ON g.id = gsl.guardian_id
       WHERE g.auth_user_id = auth.uid()
         AND gsl.status = 'approved'
    )
  );

-- Teacher reads responses for students in assigned classes
CREATE POLICY "diagnostic_responses_teacher_select" ON diagnostic_responses
  FOR SELECT USING (
    student_id IN (
      SELECT ce.student_id
        FROM class_enrollments ce
        JOIN classes c ON c.id = ce.class_id
        JOIN teachers t ON t.id = c.teacher_id
       WHERE t.auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_student
  ON diagnostic_sessions (student_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_grade_subject
  ON diagnostic_sessions (grade, subject);

CREATE INDEX IF NOT EXISTS idx_diagnostic_responses_session
  ON diagnostic_responses (session_id);

-- Additional index: student_id on responses (FK + RLS lookup)
CREATE INDEX IF NOT EXISTS idx_diagnostic_responses_student
  ON diagnostic_responses (student_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger for diagnostic_sessions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_diagnostic_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_diagnostic_sessions_updated_at ON diagnostic_sessions;
CREATE TRIGGER trg_diagnostic_sessions_updated_at
  BEFORE UPDATE ON diagnostic_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_diagnostic_sessions_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: complete_diagnostic_session
--
-- SECURITY DEFINER justification: the function writes back to diagnostic_sessions
-- (updating status, weak_topics, strong_topics, recommended_difficulty) after
-- aggregating rows from diagnostic_responses.  The RLS UPDATE policy on
-- diagnostic_sessions requires the caller to own the student row; however, the
-- aggregation JOIN over diagnostic_responses also needs SELECT rights on that
-- table.  Using SECURITY DEFINER with a pinned search_path lets the function
-- perform the aggregation safely in one round-trip while still verifying
-- caller ownership at the start of the function body.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION complete_diagnostic_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         diagnostic_sessions%ROWTYPE;
  v_student_auth_id UUID;
  v_total           INTEGER;
  v_correct         INTEGER;
  v_score_pct       FLOAT;
  v_weak_topics     JSONB;
  v_strong_topics   JSONB;
  v_rec_difficulty  TEXT;
  v_result          JSONB;
BEGIN
  -- 1. Load session and verify caller owns the linked student.
  SELECT ds.*
    INTO v_session
    FROM diagnostic_sessions ds
   WHERE ds.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diagnostic session not found: %', p_session_id;
  END IF;

  -- Ownership check: the auth user must own the student row.
  SELECT auth_user_id INTO v_student_auth_id
    FROM students
   WHERE id = v_session.student_id;

  IF v_student_auth_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied: session does not belong to the calling user';
  END IF;

  -- Guard: can only complete a session that is still in_progress.
  IF v_session.status != 'in_progress' THEN
    RAISE EXCEPTION 'Session % is already %', p_session_id, v_session.status;
  END IF;

  -- 2. Aggregate response data.
  SELECT
    COUNT(*)::INTEGER,
    SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::INTEGER
    INTO v_total, v_correct
    FROM diagnostic_responses
   WHERE session_id = p_session_id;

  v_total   := COALESCE(v_total, 0);
  v_correct := COALESCE(v_correct, 0);

  v_score_pct := CASE WHEN v_total > 0
                      THEN (v_correct::FLOAT / v_total::FLOAT) * 100.0
                      ELSE 0.0 END;

  -- 3. Identify weak topics: correct_rate < 0.5, must have at least 2 responses.
  SELECT COALESCE(
    jsonb_agg(sub.topic ORDER BY sub.correct_rate ASC),
    '[]'::JSONB
  )
  INTO v_weak_topics
  FROM (
    SELECT
      topic,
      SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::FLOAT /
        NULLIF(COUNT(*), 0)::FLOAT AS correct_rate
    FROM diagnostic_responses
   WHERE session_id = p_session_id
     AND topic IS NOT NULL
   GROUP BY topic
  HAVING COUNT(*) >= 2
     AND (SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::FLOAT /
          NULLIF(COUNT(*), 0)::FLOAT) < 0.5
  ) sub;

  -- 4. Identify strong topics: correct_rate >= 0.8, must have at least 2 responses.
  SELECT COALESCE(
    jsonb_agg(sub.topic ORDER BY sub.correct_rate DESC),
    '[]'::JSONB
  )
  INTO v_strong_topics
  FROM (
    SELECT
      topic,
      SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::FLOAT /
        NULLIF(COUNT(*), 0)::FLOAT AS correct_rate
    FROM diagnostic_responses
   WHERE session_id = p_session_id
     AND topic IS NOT NULL
   GROUP BY topic
  HAVING COUNT(*) >= 2
     AND (SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::FLOAT /
          NULLIF(COUNT(*), 0)::FLOAT) >= 0.8
  ) sub;

  -- 5. Recommend next-session difficulty based on overall score.
  v_rec_difficulty := CASE
    WHEN v_score_pct >= 80 THEN 'hard'
    WHEN v_score_pct >= 50 THEN 'medium'
    ELSE 'easy'
  END;

  -- 6. Write back to diagnostic_sessions (single UPDATE, atomic).
  UPDATE diagnostic_sessions
     SET status                 = 'completed',
         total_questions        = v_total,
         correct_answers        = v_correct,
         weak_topics            = v_weak_topics,
         strong_topics          = v_strong_topics,
         recommended_difficulty = v_rec_difficulty,
         completed_at           = now(),
         updated_at             = now()
   WHERE id = p_session_id;

  -- 7. Build and return summary.
  v_result := jsonb_build_object(
    'session_id',             p_session_id,
    'total_questions',        v_total,
    'correct_answers',        v_correct,
    'score_percent',          ROUND(v_score_pct::NUMERIC, 2),
    'weak_topics',            v_weak_topics,
    'strong_topics',          v_strong_topics,
    'recommended_difficulty', v_rec_difficulty,
    'completed_at',           now()
  );

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: after applying, confirm tables, RLS, indexes, and function exist.
--
-- SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE tablename IN ('diagnostic_sessions','diagnostic_responses')
--   ORDER BY tablename;
-- Expected: 2 rows, both rowsecurity = true
--
-- SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('diagnostic_sessions','diagnostic_responses')
--   AND indexname IN (
--     'idx_diagnostic_sessions_student',
--     'idx_diagnostic_sessions_grade_subject',
--     'idx_diagnostic_responses_session',
--     'idx_diagnostic_responses_student'
--   )
--   ORDER BY indexname;
-- Expected: 4 rows
--
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_name = 'complete_diagnostic_session';
-- Expected: 1 row
-- ─────────────────────────────────────────────────────────────────────────────
