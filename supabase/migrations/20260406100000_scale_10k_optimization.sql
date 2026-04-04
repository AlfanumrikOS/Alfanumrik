-- ============================================================
-- Migration: 20260406100000_scale_10k_optimization.sql
-- Purpose: Scale database for 10,000 concurrent users.
--
-- Builds on 20260325090000_production_scale_5k_optimization.sql.
-- Adds: composite indexes for hot paths, materialized leaderboard
-- view, increased planner statistics, and statement timeout safety.
--
-- All indexes use CONCURRENTLY to avoid blocking writes.
-- ============================================================

-- ── 1. Composite indexes for 10K hot paths ──

-- Quiz generation: adaptive question lookup by subject + grade + difficulty + bloom_level.
-- Filters to is_active = true since inactive questions are never served.
-- Covers getQuizQuestions() and quiz-generator Edge Function.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_question_bank_adaptive_lookup
  ON question_bank(subject, grade, difficulty, bloom_level)
  WHERE is_active = true;

-- Concept mastery: fast student mastery lookup used by quiz-generator,
-- foxy-tutor, CME, and the student dashboard.
-- INCLUDE columns avoid heap fetches for the most-read fields.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_concept_mastery_student_subject
  ON concept_mastery(student_id, topic_id)
  INCLUDE (mastery_level, current_retention, bloom_mastery, next_review_at);

-- Quiz sessions: recent sessions per student for dashboard and CME.
-- Descending created_at for "most recent first" access pattern.
-- INCLUDE avoids heap fetch for summary display columns.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_sessions_student_recent
  ON quiz_sessions(student_id, created_at DESC)
  INCLUDE (subject, score_percent, cme_next_action);

-- Student profiles: fast XP/streak lookup for dashboard header.
-- student_learning_profiles stores per-subject rows; index on student_id
-- with INCLUDE covers the aggregation fields without heap fetch.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_profiles_xp
  ON student_learning_profiles(student_id)
  INCLUDE (xp, streak_days);

-- Leaderboard: fast rank query on students.xp_total.
-- Partial index excludes zero-XP students (never shown on leaderboard).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_leaderboard
  ON students(xp_total DESC)
  WHERE xp_total > 0;


-- ── 2. Connection pooling guidance ──
-- Note: For 10K users, Supabase's built-in PgBouncer handles connection pooling.
-- Recommended settings (set in Supabase Dashboard > Settings > Database):
--   Pool Mode: Transaction
--   Pool Size: 15 (default for Pro plan)
--   Max Client Connections: 200
-- These handle 10K concurrent web users with ~100 active DB connections.
-- No SQL changes needed; this is a dashboard configuration.


-- ── 3. Materialized view for leaderboard ──
-- Replaces live leaderboard query that joins students + student_learning_profiles.
-- Refreshed by daily-cron Edge Function via refresh_leaderboard() RPC.
-- CONCURRENTLY refresh requires the unique index on student_id.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_leaderboard AS
SELECT
  s.id AS student_id,
  s.name AS student_name,
  s.grade,
  COALESCE(s.xp_total, 0) AS total_xp,
  COALESCE(
    (SELECT MAX(slp.streak_days) FROM student_learning_profiles slp WHERE slp.student_id = s.id),
    0
  ) AS streak,
  COALESCE(
    (SELECT SUM(slp.total_sessions) FROM student_learning_profiles slp WHERE slp.student_id = s.id),
    0
  ) AS quizzes,
  RANK() OVER (ORDER BY COALESCE(s.xp_total, 0) DESC) AS rank
FROM students s
WHERE s.is_active = true;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_leaderboard_student
  ON mv_leaderboard(student_id);

-- Rank-based lookups (top N, pagination)
CREATE INDEX IF NOT EXISTS idx_mv_leaderboard_rank
  ON mv_leaderboard(rank);

-- Grade-filtered leaderboard (class/grade leaderboards)
CREATE INDEX IF NOT EXISTS idx_mv_leaderboard_grade_rank
  ON mv_leaderboard(grade, rank);

COMMENT ON MATERIALIZED VIEW mv_leaderboard IS
  'Pre-computed leaderboard. Refreshed by daily-cron via refresh_leaderboard(). '
  'Do not query students + student_learning_profiles directly for leaderboard display.';

-- Function to refresh the materialized view.
-- SECURITY DEFINER: required because materialized view refresh needs owner privileges
-- and the daily-cron Edge Function calls this via service role RPC.
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
END;
$$;

-- Grant execute to service_role only (daily-cron runs as service role)
GRANT EXECUTE ON FUNCTION refresh_leaderboard() TO service_role;


-- ── 4. Increased planner statistics for 10K-scale columns ──
-- Higher statistics = more histogram buckets = better query plans for skewed data.
-- quiz_responses.quiz_session_id: high cardinality FK, used in joins.
ALTER TABLE quiz_responses ALTER COLUMN quiz_session_id SET STATISTICS 1000;
-- question_bank.subject/grade: low cardinality but highly filtered.
ALTER TABLE question_bank ALTER COLUMN subject SET STATISTICS 500;
ALTER TABLE question_bank ALTER COLUMN grade SET STATISTICS 500;
-- curriculum_topics.subject_id: used in topic lookups for quiz generation.
ALTER TABLE curriculum_topics ALTER COLUMN subject_id SET STATISTICS 500;


-- ── 5. Vacuum analyze hot tables ──
-- Forces fresh statistics after index creation and statistics target changes.
ANALYZE question_bank;
ANALYZE concept_mastery;
ANALYZE quiz_sessions;
ANALYZE quiz_responses;
ANALYZE student_learning_profiles;
ANALYZE students;


-- ── 6. Statement timeout safety net ──
-- Prevents runaway queries from monopolizing connections at 10K scale.
-- 30s matches the Vercel API route timeout. Admin/service-role queries
-- can override per-session with SET LOCAL statement_timeout.
ALTER DATABASE postgres SET statement_timeout = '30s';
