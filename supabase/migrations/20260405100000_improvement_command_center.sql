-- ============================================================================
-- Migration: 20260405100000_improvement_command_center.sql
-- Purpose: Create the Product Improvement Command Center schema.
--   1. Create improvement_issues table (auto-detected and user-reported issues)
--   2. Create improvement_recommendations table (proposed fixes per issue)
--   3. Create improvement_executions table (execution tracking per recommendation)
--   4. Create product_events table (DB-persisted analytics events)
--   5. Enable RLS and create policies on all four tables
--   6. Add performance indexes
--   7. Attach updated_at triggers (reuses existing set_updated_at function)
-- ============================================================================


-- ============================================================================
-- 1. TABLE: improvement_issues
-- ============================================================================

CREATE TABLE IF NOT EXISTS improvement_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('auto_detect','user_report','data_signal','manual')),
  category TEXT NOT NULL CHECK (category IN ('onboarding','ux','learning','quiz','rag','performance','admin','payment','mobile')),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','recommendation_pending','in_progress','resolved','wont_fix')),
  evidence JSONB DEFAULT '{}',
  affected_users_count INTEGER DEFAULT 0,
  recurrence_count INTEGER DEFAULT 1,
  assigned_agent TEXT,
  detected_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================================
-- 2. TABLE: improvement_recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS improvement_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES improvement_issues(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  impact_estimate TEXT CHECK (impact_estimate IN ('high','medium','low')),
  effort_estimate TEXT CHECK (effort_estimate IN ('hours','days','weeks')),
  risk_level TEXT CHECK (risk_level IN ('low','medium','high')),
  affected_files TEXT[],
  agent_owner TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executing','completed','rolled_back')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================================
-- 3. TABLE: improvement_executions
-- ============================================================================

CREATE TABLE IF NOT EXISTS improvement_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES improvement_recommendations(id) ON DELETE CASCADE,
  execution_type TEXT NOT NULL CHECK (execution_type IN ('code_patch','config_change','content_fix','manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','staging','testing','approved','deployed','rolled_back','failed')),
  test_results JSONB,
  staging_url TEXT,
  deploy_commit TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================================
-- 4. TABLE: product_events
--    DB-persisted analytics events. NOT partitioned (Supabase managed Postgres
--    does not grant superuser). A daily-cron cleanup job handles 30-day retention.
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  student_id UUID,
  category TEXT,
  payload JSONB DEFAULT '{}',
  session_id TEXT,
  page_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE improvement_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;

-- ── improvement_issues: admin read/write ──

CREATE POLICY IF NOT EXISTS improvement_issues_admin_select
  ON improvement_issues FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_issues_admin_insert
  ON improvement_issues FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_issues_admin_update
  ON improvement_issues FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

-- ── improvement_recommendations: admin read/write ──

CREATE POLICY IF NOT EXISTS improvement_recommendations_admin_select
  ON improvement_recommendations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_recommendations_admin_insert
  ON improvement_recommendations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_recommendations_admin_update
  ON improvement_recommendations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

-- ── improvement_executions: admin read/write ──

CREATE POLICY IF NOT EXISTS improvement_executions_admin_select
  ON improvement_executions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_executions_admin_insert
  ON improvement_executions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

CREATE POLICY IF NOT EXISTS improvement_executions_admin_update
  ON improvement_executions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));

-- ── product_events: authenticated users can INSERT, admin can SELECT ──

CREATE POLICY IF NOT EXISTS product_events_authenticated_insert
  ON product_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY IF NOT EXISTS product_events_admin_select
  ON product_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true
  ));


-- ============================================================================
-- 6. INDEXES
-- ============================================================================

-- improvement_issues
CREATE INDEX IF NOT EXISTS idx_improvement_issues_status
  ON improvement_issues(status);

CREATE INDEX IF NOT EXISTS idx_improvement_issues_category
  ON improvement_issues(category);

CREATE INDEX IF NOT EXISTS idx_improvement_issues_severity
  ON improvement_issues(severity);

CREATE INDEX IF NOT EXISTS idx_improvement_issues_detected_at
  ON improvement_issues(detected_at);

-- improvement_recommendations
CREATE INDEX IF NOT EXISTS idx_improvement_recommendations_issue_id
  ON improvement_recommendations(issue_id);

CREATE INDEX IF NOT EXISTS idx_improvement_recommendations_status
  ON improvement_recommendations(status);

-- improvement_executions
CREATE INDEX IF NOT EXISTS idx_improvement_executions_recommendation_id
  ON improvement_executions(recommendation_id);

CREATE INDEX IF NOT EXISTS idx_improvement_executions_status
  ON improvement_executions(status);

-- product_events
CREATE INDEX IF NOT EXISTS idx_product_events_event_type
  ON product_events(event_type);

CREATE INDEX IF NOT EXISTS idx_product_events_student_id
  ON product_events(student_id);

CREATE INDEX IF NOT EXISTS idx_product_events_created_at
  ON product_events(created_at);

CREATE INDEX IF NOT EXISTS idx_product_events_category
  ON product_events(category);


-- ============================================================================
-- 7. UPDATED_AT TRIGGERS
--    Reuses the existing set_updated_at() function from migration
--    20260322200702_add_missing_indexes_and_triggers.sql
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname  = 'trg_improvement_issues_updated_at'
      AND tgrelid = 'improvement_issues'::regclass
  ) THEN
    CREATE TRIGGER trg_improvement_issues_updated_at
      BEFORE UPDATE ON improvement_issues
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname  = 'trg_improvement_recommendations_updated_at'
      AND tgrelid = 'improvement_recommendations'::regclass
  ) THEN
    CREATE TRIGGER trg_improvement_recommendations_updated_at
      BEFORE UPDATE ON improvement_recommendations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;


-- ============================================================================
-- End of migration: 20260405100000_improvement_command_center.sql
-- Tables created:
--   improvement_issues           — tracked product issues from all sources
--   improvement_recommendations  — proposed fixes linked to issues
--   improvement_executions       — execution/deployment tracking per recommendation
--   product_events               — DB-persisted analytics (30-day retention via cron)
-- RLS: enabled on all four tables, admin read/write, product_events authenticated insert
-- Indexes: 12 indexes across all tables
-- Triggers: updated_at on improvement_issues and improvement_recommendations
-- ============================================================================
