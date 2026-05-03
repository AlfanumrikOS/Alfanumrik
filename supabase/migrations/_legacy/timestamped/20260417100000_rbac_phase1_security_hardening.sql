-- =============================================================================
-- RBAC Phase 1 Security Hardening
-- Migration: 20260417100000_rbac_phase1_security_hardening.sql
--
-- Sections:
--   1. Seed tutor permissions (tutor role currently has zero grants)
--   2. audit_events — unified append-only audit table
--   3. Chain-hash functions for audit tamper detection
--   4. plan_permission_overrides — plan-level permission gates & limits
--   5. permission_usage — per-user daily/weekly/monthly usage counters
--   6. check_and_increment_permission_usage RPC
--   7. Seed plan_permission_overrides for free/starter/pro/unlimited
--   8. parent_plan_permission_map — maps parent actions to child plan perms
-- =============================================================================


-- ===========================================================================
-- SECTION 1: Seed Tutor Permissions
-- ===========================================================================
-- The tutor role (hierarchy_level 40) was created in the base RBAC migration
-- but was never granted any permissions. Insert tutor-specific permissions
-- and then grant them alongside shared permissions.

INSERT INTO permissions (code, resource, action, description) VALUES
  ('tutor.view_student',     'tutor', 'view_student',     'View assigned student profiles and progress'),
  ('tutor.provide_feedback', 'tutor', 'provide_feedback', 'Provide feedback to assigned students'),
  ('tutor.view_analytics',   'tutor', 'view_analytics',   'View analytics for assigned students'),
  ('tutor.create_worksheet', 'tutor', 'create_worksheet', 'Create practice worksheets for students'),
  ('tutor.assign_worksheet', 'tutor', 'assign_worksheet', 'Assign worksheets to students')
ON CONFLICT (code) DO NOTHING;

-- Grant tutor-specific + shared permissions to the tutor role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'tutor' AND p.code IN (
  -- Tutor-specific
  'tutor.view_student',
  'tutor.provide_feedback',
  'tutor.view_analytics',
  'tutor.create_worksheet',
  'tutor.assign_worksheet',
  -- Shared permissions
  'profile.view_own',
  'profile.update_own',
  'notification.view',
  'notification.dismiss',
  'leaderboard.view'
)
ON CONFLICT DO NOTHING;

-- Backfill admin and super_admin with new tutor permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.code IN (
    'tutor.view_student',
    'tutor.provide_feedback',
    'tutor.view_analytics',
    'tutor.create_worksheet',
    'tutor.assign_worksheet'
  )
ON CONFLICT DO NOTHING;


-- ===========================================================================
-- SECTION 2: Unified audit_events Table
-- ===========================================================================
-- Replaces the split audit_logs + school_audit_log pattern with a single
-- append-only, tamper-evident event log.

CREATE TABLE IF NOT EXISTS audit_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  chain_hash      TEXT NOT NULL DEFAULT '',
  previous_event_id BIGINT,

  event_type      TEXT NOT NULL CHECK (event_type IN (
    'permission_check', 'data_access', 'role_change',
    'impersonation_start', 'impersonation_end',
    'delegation_grant', 'delegation_revoke',
    'oauth_consent', 'login', 'logout',
    'admin_action', 'anomaly_detected', 'cache_invalidation'
  )),

  actor_user_id     UUID,
  effective_user_id UUID,
  school_id         UUID,

  permission_code   TEXT,
  resource_type     TEXT NOT NULL DEFAULT 'system',
  resource_id       TEXT,

  action TEXT NOT NULL CHECK (action IN (
    'read', 'write', 'delete', 'grant', 'revoke',
    'login', 'logout', 'evaluate', 'elevate', 'impersonate'
  )),

  result TEXT NOT NULL CHECK (result IN ('granted', 'denied', 'error')),

  resolution_trace JSONB DEFAULT '{}',
  before_snapshot  JSONB,
  after_snapshot   JSONB,

  ip_address  INET,
  user_agent  TEXT,
  session_id  UUID,
  request_id  UUID,

  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_user_id
  ON audit_events (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_school_id
  ON audit_events (school_id) WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_event_type
  ON audit_events (event_type);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource
  ON audit_events (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON audit_events (request_id) WHERE request_id IS NOT NULL;

-- RLS
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated users and service_role can insert
CREATE POLICY audit_events_insert_authenticated ON audit_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY audit_events_insert_service ON audit_events
  FOR INSERT TO service_role
  WITH CHECK (true);

-- SELECT: users can read own events, admins can read all
CREATE POLICY audit_events_select ON audit_events
  FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

CREATE POLICY audit_events_select_service ON audit_events
  FOR SELECT TO service_role
  USING (true);

-- REVOKE UPDATE and DELETE from authenticated and anon to make table append-only
REVOKE UPDATE, DELETE ON audit_events FROM authenticated;
REVOKE UPDATE, DELETE ON audit_events FROM anon;


-- ===========================================================================
-- SECTION 3: Chain Hash Functions
-- ===========================================================================

-- compute_audit_chain_hash: computes SHA-256 of concatenated audit fields
-- Uses pgcrypto digest() for consistent hashing.
-- SECURITY INVOKER — no privilege escalation needed for a pure computation.
CREATE OR REPLACE FUNCTION compute_audit_chain_hash(
  p_previous_hash  TEXT,
  p_event_id       UUID,
  p_event_type     TEXT,
  p_actor_user_id  UUID,
  p_action         TEXT,
  p_result         TEXT,
  p_created_at     TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_input TEXT;
  v_prev  TEXT;
BEGIN
  v_prev := COALESCE(p_previous_hash, 'GENESIS');
  v_input := v_prev
    || '|' || COALESCE(p_event_id::TEXT, '')
    || '|' || COALESCE(p_event_type, '')
    || '|' || COALESCE(p_actor_user_id::TEXT, '')
    || '|' || COALESCE(p_action, '')
    || '|' || COALESCE(p_result, '')
    || '|' || COALESCE(p_created_at::TEXT, '');

  RETURN encode(digest(v_input, 'sha256'), 'hex');
END;
$$;

-- verify_audit_chain: iterates events and verifies chain integrity
-- SECURITY DEFINER — needs to read all audit_events regardless of caller's RLS.
-- Justification: chain verification must read the full ordered event sequence
-- to detect tampering; callers may lack SELECT on rows they didn't create.
CREATE OR REPLACE FUNCTION verify_audit_chain(
  p_from_id BIGINT DEFAULT 0,
  p_limit   INT    DEFAULT 10000
)
RETURNS TABLE (
  is_valid      BOOLEAN,
  break_at_id   BIGINT,
  expected_hash TEXT,
  actual_hash   TEXT,
  checked_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash   TEXT := 'GENESIS';
  v_expected    TEXT;
  v_rec         RECORD;
  v_count       INT := 0;
  v_break_id    BIGINT := NULL;
  v_exp_hash    TEXT := NULL;
  v_act_hash    TEXT := NULL;
BEGIN
  FOR v_rec IN
    SELECT ae.id, ae.event_id, ae.event_type, ae.actor_user_id,
           ae.action, ae.result, ae.created_at, ae.chain_hash
    FROM audit_events ae
    WHERE ae.id > p_from_id
    ORDER BY ae.id ASC
    LIMIT p_limit
  LOOP
    v_count := v_count + 1;

    v_expected := compute_audit_chain_hash(
      v_prev_hash,
      v_rec.event_id,
      v_rec.event_type,
      v_rec.actor_user_id,
      v_rec.action,
      v_rec.result,
      v_rec.created_at
    );

    IF v_rec.chain_hash <> '' AND v_rec.chain_hash <> v_expected THEN
      v_break_id := v_rec.id;
      v_exp_hash := v_expected;
      v_act_hash := v_rec.chain_hash;
      RETURN QUERY SELECT false, v_break_id, v_exp_hash, v_act_hash, v_count;
      RETURN;
    END IF;

    v_prev_hash := CASE
      WHEN v_rec.chain_hash <> '' THEN v_rec.chain_hash
      ELSE v_expected
    END;
  END LOOP;

  RETURN QUERY SELECT true, NULL::BIGINT, NULL::TEXT, NULL::TEXT, v_count;
  RETURN;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION compute_audit_chain_hash(TEXT, UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_audit_chain(BIGINT, INT) TO authenticated;


-- ===========================================================================
-- SECTION 4: plan_permission_overrides Table
-- ===========================================================================
-- Allows per-plan gating of permissions with optional usage limits and
-- feature flag overrides.

CREATE TABLE IF NOT EXISTS plan_permission_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  is_granted      BOOLEAN DEFAULT true,
  usage_limit     JSONB,
  feature_flags   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan_id, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_plan_perm_overrides_plan
  ON plan_permission_overrides (plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_perm_overrides_code
  ON plan_permission_overrides (permission_code);

ALTER TABLE plan_permission_overrides ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can read plan limits (needed for client gating)
CREATE POLICY plan_perm_overrides_select ON plan_permission_overrides
  FOR SELECT TO authenticated
  USING (true);

-- ALL: service_role has full access for admin management
CREATE POLICY plan_perm_overrides_service ON plan_permission_overrides
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_plan_permission_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_perm_overrides_updated_at ON plan_permission_overrides;
CREATE TRIGGER trg_plan_perm_overrides_updated_at
  BEFORE UPDATE ON plan_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION update_plan_permission_overrides_updated_at();


-- ===========================================================================
-- SECTION 5: permission_usage Table
-- ===========================================================================
-- Tracks per-user, per-permission, per-day usage counts for rate limiting
-- (e.g., free plan: 5 quizzes/day).

CREATE TABLE IF NOT EXISTS permission_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  permission_code TEXT NOT NULL,
  school_id       UUID,
  period          DATE NOT NULL DEFAULT CURRENT_DATE,
  usage_count     INT NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  UNIQUE(user_id, permission_code, school_id, period)
);

-- Separate unique index for NULL school_id (the UNIQUE constraint above
-- treats NULL <> NULL, so rows with school_id IS NULL would not be
-- deduplicated without this partial index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_usage_null_school
  ON permission_usage (user_id, permission_code, period)
  WHERE school_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_permission_usage_user
  ON permission_usage (user_id);

CREATE INDEX IF NOT EXISTS idx_permission_usage_period
  ON permission_usage (period);

ALTER TABLE permission_usage ENABLE ROW LEVEL SECURITY;

-- Users read their own usage
CREATE POLICY permission_usage_select_own ON permission_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can insert/update their own usage (via the RPC below)
CREATE POLICY permission_usage_insert_own ON permission_usage
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY permission_usage_update_own ON permission_usage
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- service_role has full access
CREATE POLICY permission_usage_service ON permission_usage
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ===========================================================================
-- SECTION 6: check_and_increment_permission_usage RPC
-- ===========================================================================
-- Atomically checks whether a user is within their daily limit for a
-- permission and increments the counter. Returns JSONB with the decision.
--
-- SECURITY DEFINER — needed so the function can upsert permission_usage
-- rows on behalf of the caller regardless of RLS context (e.g., when called
-- from an API route via supabase-admin).
CREATE OR REPLACE FUNCTION check_and_increment_permission_usage(
  p_user_id         UUID,
  p_permission_code TEXT,
  p_daily_limit     INT,
  p_school_id       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INT;
BEGIN
  -- Two upsert paths because PostgreSQL UNIQUE constraints treat
  -- NULL <> NULL, so the composite UNIQUE(user_id, permission_code,
  -- school_id, period) does not deduplicate NULL school_id rows.
  -- We rely on the partial unique index idx_permission_usage_null_school
  -- for the NULL case.

  IF p_school_id IS NOT NULL THEN
    -- Non-null school_id: uses the table-level UNIQUE constraint
    INSERT INTO permission_usage (user_id, permission_code, school_id, period, usage_count, last_used_at)
    VALUES (p_user_id, p_permission_code, p_school_id, CURRENT_DATE, 1, now())
    ON CONFLICT (user_id, permission_code, school_id, period)
    DO UPDATE SET
      usage_count  = permission_usage.usage_count + 1,
      last_used_at = now()
    RETURNING usage_count INTO v_new_count;
  ELSE
    -- NULL school_id: uses the partial unique index
    INSERT INTO permission_usage (user_id, permission_code, school_id, period, usage_count, last_used_at)
    VALUES (p_user_id, p_permission_code, NULL, CURRENT_DATE, 1, now())
    ON CONFLICT (user_id, permission_code, period)
      WHERE school_id IS NULL
    DO UPDATE SET
      usage_count  = permission_usage.usage_count + 1,
      last_used_at = now()
    RETURNING usage_count INTO v_new_count;
  END IF;

  -- If over limit, roll back the increment
  IF v_new_count > p_daily_limit THEN
    UPDATE permission_usage
    SET usage_count = usage_count - 1
    WHERE user_id = p_user_id
      AND permission_code = p_permission_code
      AND period = CURRENT_DATE
      AND (
        (p_school_id IS NOT NULL AND school_id = p_school_id)
        OR (p_school_id IS NULL AND school_id IS NULL)
      );

    RETURN jsonb_build_object(
      'allowed',   false,
      'count',     v_new_count - 1,
      'limit',     p_daily_limit,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',   true,
    'count',     v_new_count,
    'limit',     p_daily_limit,
    'remaining', p_daily_limit - v_new_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_and_increment_permission_usage(UUID, TEXT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_permission_usage(UUID, TEXT, INT, UUID) TO service_role;


-- ===========================================================================
-- SECTION 7: Seed plan_permission_overrides
-- ===========================================================================
-- Usage limit JSONB format: {"max": N, "period": "day"|"week"|"month"}
-- is_granted = false means the permission is fully blocked for that plan.

INSERT INTO plan_permission_overrides (plan_id, permission_code, is_granted, usage_limit) VALUES
  -- ── Free plan ──────────────────────────────────────────────────────────
  ('free', 'quiz.attempt',         true,  '{"max": 5, "period": "day"}'),
  ('free', 'foxy.chat',            true,  '{"max": 5, "period": "day"}'),
  ('free', 'foxy.interact',        false, NULL),
  ('free', 'simulation.interact',  false, NULL),
  ('free', 'report.download_own',  false, NULL),
  ('free', 'exam.create',          true,  '{"max": 2, "period": "week"}'),
  ('free', 'diagnostic.attempt',   false, NULL),
  ('free', 'stem.observe',         false, NULL),

  -- ── Starter plan ───────────────────────────────────────────────────────
  ('starter', 'quiz.attempt',        true,  '{"max": 20, "period": "day"}'),
  ('starter', 'foxy.chat',           true,  '{"max": 30, "period": "day"}'),
  ('starter', 'foxy.interact',       true,  NULL),
  ('starter', 'simulation.interact', false, NULL),
  ('starter', 'report.download_own', true,  NULL),
  ('starter', 'exam.create',         true,  '{"max": 10, "period": "week"}'),
  ('starter', 'diagnostic.attempt',  true,  '{"max": 1, "period": "month"}'),
  ('starter', 'stem.observe',        false, NULL),

  -- ── Pro plan ───────────────────────────────────────────────────────────
  ('pro', 'quiz.attempt',        true,  NULL),
  ('pro', 'foxy.chat',           true,  NULL),
  ('pro', 'foxy.interact',       true,  NULL),
  ('pro', 'simulation.interact', true,  NULL),
  ('pro', 'report.download_own', true,  NULL),
  ('pro', 'exam.create',         true,  NULL),
  ('pro', 'diagnostic.attempt',  true,  '{"max": 1, "period": "week"}'),
  ('pro', 'stem.observe',        true,  NULL),

  -- ── Unlimited plan ─────────────────────────────────────────────────────
  ('unlimited', 'quiz.attempt',        true,  NULL),
  ('unlimited', 'foxy.chat',           true,  NULL),
  ('unlimited', 'foxy.interact',       true,  NULL),
  ('unlimited', 'simulation.interact', true,  NULL),
  ('unlimited', 'report.download_own', true,  NULL),
  ('unlimited', 'exam.create',         true,  NULL),
  ('unlimited', 'diagnostic.attempt',  true,  NULL),
  ('unlimited', 'stem.observe',        true,  NULL)

ON CONFLICT (plan_id, permission_code) DO UPDATE SET
  is_granted  = EXCLUDED.is_granted,
  usage_limit = EXCLUDED.usage_limit,
  updated_at  = now();

-- Ensure foxy.interact and stem.observe permission codes exist in the
-- permissions table (they are new — not present in prior migrations).
INSERT INTO permissions (code, resource, action, description) VALUES
  ('foxy.interact',       'foxy',       'interact',  'Use advanced Foxy AI interactive features'),
  ('stem.observe',        'stem',       'observe',   'Observe STEM interactive demonstrations')
ON CONFLICT (code) DO NOTHING;

-- Grant new permissions to student role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'student'
  AND p.code IN ('foxy.interact', 'stem.observe')
ON CONFLICT DO NOTHING;

-- Grant to admin and super_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.code IN ('foxy.interact', 'stem.observe')
ON CONFLICT DO NOTHING;


-- ===========================================================================
-- SECTION 8: parent_plan_permission_map Table
-- ===========================================================================
-- Maps parent portal actions to the child's plan permission that must be
-- active for the parent action to succeed.

CREATE TABLE IF NOT EXISTS parent_plan_permission_map (
  parent_permission       TEXT PRIMARY KEY,
  required_child_permission TEXT NOT NULL
);

ALTER TABLE parent_plan_permission_map ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can read this lookup table
CREATE POLICY parent_plan_perm_map_select ON parent_plan_permission_map
  FOR SELECT TO authenticated
  USING (true);

-- service_role full access for admin management
CREATE POLICY parent_plan_perm_map_service ON parent_plan_permission_map
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed data
INSERT INTO parent_plan_permission_map (parent_permission, required_child_permission) VALUES
  ('child.download_report', 'report.download_own'),
  ('child.view_performance', 'progress.view_own')
ON CONFLICT (parent_permission) DO UPDATE SET
  required_child_permission = EXCLUDED.required_child_permission;
