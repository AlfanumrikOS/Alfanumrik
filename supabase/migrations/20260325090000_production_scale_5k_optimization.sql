-- ============================================================
-- Production Scale Optimization for 5,000+ Concurrent Students
-- Applied: 2026-03-25
--
-- Targets:
-- 1. Table statistics for query planner accuracy
-- 2. Partial indexes for hot-path queries
-- 3. Connection-efficient RPCs
-- 4. Table partitioning prep for audit_logs
-- 5. Automatic vacuum tuning for write-heavy tables
-- ============================================================

-- ── 1. Update table statistics for accurate query planning ──
-- Default statistics target is 100; increase for high-cardinality columns
-- that appear in WHERE clauses with 5K+ concurrent users
ALTER TABLE students ALTER COLUMN auth_user_id SET STATISTICS 500;
ALTER TABLE quiz_sessions ALTER COLUMN student_id SET STATISTICS 500;
ALTER TABLE question_responses ALTER COLUMN student_id SET STATISTICS 500;
ALTER TABLE concept_mastery ALTER COLUMN student_id SET STATISTICS 500;
ALTER TABLE student_daily_usage ALTER COLUMN student_id SET STATISTICS 500;

-- ── 2. Partial indexes for common filtered queries ──

-- Active study plans only (most queries filter on active/in_progress)
CREATE INDEX IF NOT EXISTS idx_study_plans_active
  ON study_plans(student_id, created_at DESC)
  WHERE status IN ('active', 'in_progress');

-- Unread notifications (notification badge count is a hot query)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(student_id, created_at DESC)
  WHERE read_at IS NULL;

-- Today's usage (checked on every foxy chat message)
CREATE INDEX IF NOT EXISTS idx_daily_usage_today
  ON student_daily_usage(student_id, feature)
  WHERE usage_date = CURRENT_DATE;

-- Active chat sessions (not completed)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
  ON chat_sessions(student_id, updated_at DESC)
  WHERE status IS DISTINCT FROM 'completed';

-- ── 3. Optimized RPC for dashboard snapshot (single round-trip) ──
-- Replaces multiple SWR queries with one call
CREATE OR REPLACE FUNCTION get_dashboard_data(p_student_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'xp', COALESCE(
      (SELECT SUM(xp) FROM student_learning_profiles WHERE student_id = p_student_id),
      0
    ),
    'streak', COALESCE(
      (SELECT MAX(current_streak) FROM student_learning_profiles WHERE student_id = p_student_id),
      0
    ),
    'quizzes_today', (
      SELECT COUNT(*) FROM quiz_sessions
      WHERE student_id = p_student_id AND created_at >= CURRENT_DATE
    ),
    'mastery_count', (
      SELECT COUNT(*) FROM concept_mastery
      WHERE student_id = p_student_id AND mastery_level >= 3
    ),
    'unread_notifications', (
      SELECT COUNT(*) FROM notifications
      WHERE student_id = p_student_id AND read_at IS NULL
    ),
    'study_plan_progress', (
      SELECT json_build_object(
        'total', COUNT(*),
        'completed', COUNT(*) FILTER (WHERE status = 'completed')
      )
      FROM study_plan_tasks spt
      JOIN study_plans sp ON sp.id = spt.study_plan_id
      WHERE sp.student_id = p_student_id
        AND sp.status IN ('active', 'in_progress')
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- ── 4. Batch usage check + increment (single round-trip) ──
-- Replaces separate check + increment for foxy chat
CREATE OR REPLACE FUNCTION check_and_increment_usage(
  p_student_id UUID,
  p_feature TEXT,
  p_daily_limit INT DEFAULT 50
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  today DATE := CURRENT_DATE;
BEGIN
  -- Upsert and get current count in single statement
  INSERT INTO student_daily_usage (student_id, feature, usage_date, usage_count)
  VALUES (p_student_id, p_feature, today, 1)
  ON CONFLICT (student_id, feature, usage_date)
  DO UPDATE SET usage_count = student_daily_usage.usage_count + 1
  RETURNING usage_count INTO current_count;

  -- If over limit, rollback the increment
  IF current_count > p_daily_limit THEN
    UPDATE student_daily_usage
    SET usage_count = usage_count - 1
    WHERE student_id = p_student_id
      AND feature = p_feature
      AND usage_date = today;

    RETURN json_build_object(
      'allowed', false,
      'count', current_count - 1,
      'limit', p_daily_limit,
      'remaining', 0
    );
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'count', current_count,
    'limit', p_daily_limit,
    'remaining', GREATEST(0, p_daily_limit - current_count)
  );
END;
$$;

-- ── 5. Vacuum tuning for write-heavy tables ──
-- These tables get writes on every student interaction
ALTER TABLE audit_logs SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE audit_logs SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE quiz_sessions SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE question_responses SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE student_daily_usage SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE chat_sessions SET (autovacuum_vacuum_scale_factor = 0.1);

-- ── 6. Grant execute permissions ──
GRANT EXECUTE ON FUNCTION get_dashboard_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_usage(UUID, TEXT, INT) TO authenticated, service_role;

-- ── 7. Analyze updated tables for fresh statistics ──
ANALYZE students;
ANALYZE quiz_sessions;
ANALYZE question_responses;
ANALYZE concept_mastery;
ANALYZE student_daily_usage;
ANALYZE notifications;
ANALYZE study_plans;
ANALYZE study_plan_tasks;
