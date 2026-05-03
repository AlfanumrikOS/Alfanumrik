-- Migration: 20260406200000_bulk_upload_and_analytics.sql
-- Purpose: Bulk student upload staging table, revenue analytics RPC, AI health metrics RPC

-- ============================================================================
-- 1. Bulk Upload Staging Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS bulk_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  uploaded_by UUID NOT NULL,  -- admin auth.users id who initiated the upload
  filename TEXT NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  errors JSONB DEFAULT '[]',  -- [{row: 3, field: 'grade', message: 'Invalid grade'}]
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT bulk_upload_jobs_status_valid
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

COMMENT ON TABLE bulk_upload_jobs IS
  'Staging table for tracking CSV bulk student upload jobs from schools.';

-- RLS (mandatory)
ALTER TABLE bulk_upload_jobs ENABLE ROW LEVEL SECURITY;

-- Service role only — admin operations go through supabase-admin.ts (service role client)
DO $$ BEGIN
  CREATE POLICY bulk_upload_jobs_service ON bulk_upload_jobs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for status filtering and job listing
CREATE INDEX IF NOT EXISTS idx_bulk_upload_jobs_status
  ON bulk_upload_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulk_upload_jobs_school
  ON bulk_upload_jobs(school_id, created_at DESC);

-- ============================================================================
-- 2. Revenue Analytics RPC
-- ============================================================================

-- SECURITY DEFINER: Required to aggregate across all student rows for admin
-- dashboard; access gated by auth.role() = 'service_role' check at entry.
CREATE OR REPLACE FUNCTION admin_revenue_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Only service role can call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH plan_counts AS (
    SELECT
      COALESCE(subscription_plan, 'free') AS plan,
      COUNT(*) AS count
    FROM students
    WHERE is_demo = false AND is_active = true
    GROUP BY subscription_plan
  ),
  monthly_revenue AS (
    -- Estimate MRR from plan distribution
    -- NOTE: Prices are hardcoded estimates (INR). Update if plan pricing changes.
    SELECT
      SUM(CASE
        WHEN plan LIKE '%starter%' THEN count * 149
        WHEN plan LIKE '%pro%' THEN count * 299
        WHEN plan LIKE '%ultimate%' THEN count * 499
        WHEN plan LIKE '%premium%' THEN count * 399
        WHEN plan LIKE '%basic%' THEN count * 99
        ELSE 0
      END) AS estimated_mrr
    FROM plan_counts
  ),
  churn AS (
    -- Students who were active 30d ago but not in last 7d
    SELECT COUNT(DISTINCT s.id) AS churned
    FROM students s
    WHERE s.is_demo = false
      AND s.subscription_plan IS NOT NULL
      AND s.subscription_plan != 'free'
      AND EXISTS (
        SELECT 1 FROM quiz_sessions qs
        WHERE qs.student_id = s.id
        AND qs.created_at BETWEEN (now() - interval '37 days') AND (now() - interval '30 days')
      )
      AND NOT EXISTS (
        SELECT 1 FROM quiz_sessions qs
        WHERE qs.student_id = s.id
        AND qs.created_at > (now() - interval '7 days')
      )
  ),
  total_paid AS (
    SELECT COUNT(*) AS count FROM students
    WHERE is_demo = false AND subscription_plan IS NOT NULL AND subscription_plan != 'free'
  )
  SELECT jsonb_build_object(
    'plan_distribution', (SELECT COALESCE(jsonb_object_agg(plan, count), '{}'::JSONB) FROM plan_counts),
    'estimated_mrr', (SELECT COALESCE(estimated_mrr, 0) FROM monthly_revenue),
    'total_paid_users', (SELECT count FROM total_paid),
    'churned_last_30d', (SELECT churned FROM churn),
    'churn_rate', CASE
      WHEN (SELECT count FROM total_paid) > 0
      THEN ROUND(((SELECT churned FROM churn)::NUMERIC / (SELECT count FROM total_paid)) * 100, 1)
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION admin_revenue_metrics IS
  'Returns revenue analytics: plan distribution, estimated MRR, churn rate. Service role only.';

-- ============================================================================
-- 3. AI Health Metrics RPC
-- ============================================================================

-- Add status column to ai_tutor_logs for success/error tracking
-- (Column did not previously exist; needed for health metrics)
ALTER TABLE ai_tutor_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';

CREATE INDEX IF NOT EXISTS idx_ai_tutor_logs_status
  ON ai_tutor_logs(status, created_at DESC);

-- SECURITY DEFINER: Required to aggregate across all student AI interactions
-- for admin dashboard; access gated by auth.role() = 'service_role' check.
CREATE OR REPLACE FUNCTION admin_ai_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  WITH chat_stats AS (
    SELECT
      COUNT(*) AS total_chats,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS chats_24h,
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS chats_1h
    FROM chat_sessions
  ),
  quiz_gen_stats AS (
    SELECT
      COUNT(*) AS total_quizzes,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS quizzes_24h,
      AVG(CASE WHEN total_questions > 0 THEN correct_answers::FLOAT / total_questions ELSE NULL END) AS avg_accuracy
    FROM quiz_sessions
  ),
  tutor_logs AS (
    SELECT
      COUNT(*) AS total_requests,
      COUNT(*) FILTER (WHERE status = 'success') AS success_count,
      COUNT(*) FILTER (WHERE status = 'error') AS error_count,
      AVG(latency_ms) AS avg_latency_ms
    FROM ai_tutor_logs
    WHERE created_at > now() - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'chat_sessions', (SELECT row_to_json(chat_stats.*) FROM chat_stats),
    'quiz_generation', (SELECT row_to_json(quiz_gen_stats.*) FROM quiz_gen_stats),
    'ai_tutor', (SELECT row_to_json(tutor_logs.*) FROM tutor_logs),
    'success_rate', CASE
      WHEN (SELECT total_requests FROM tutor_logs) > 0
      THEN ROUND(((SELECT success_count FROM tutor_logs)::NUMERIC / (SELECT total_requests FROM tutor_logs)) * 100, 1)
      ELSE 100
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION admin_ai_health IS
  'Returns AI health metrics: chat/quiz stats, tutor API success rate, latency. Service role only.';
