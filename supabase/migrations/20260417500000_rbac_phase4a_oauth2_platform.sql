-- =============================================================================
-- RBAC Phase 4A: OAuth2 Developer Platform
-- Migration: 20260417500000_rbac_phase4a_oauth2_platform.sql
--
-- Sections:
--   1. oauth_apps          — third-party app registration
--   2. oauth_scopes        — API scopes mapped to RBAC permissions
--   3. oauth_consents      — school-level consent decisions
--   4. oauth_tokens        — issued access/refresh tokens (service_role only)
--   5. school_api_keys     — simplified server-to-server API keys
--   6. Seed OAuth scopes   — initial scope definitions
--
-- Depends on:
--   _legacy/000_core_schema.sql          (schools)
--   20260324070000_production_rbac_system.sql  (admin_users)
--   20260417200000_rbac_phase2a_tenant_scoped_schema.sql (school_memberships)
-- =============================================================================


-- ===========================================================================
-- SECTION 1: oauth_apps TABLE
-- ===========================================================================
-- App registration for third-party developers integrating with Alfanumrik.

CREATE TABLE IF NOT EXISTS oauth_apps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  developer_id          UUID NOT NULL,
  developer_org         TEXT,
  logo_url              TEXT,
  homepage_url          TEXT,
  privacy_policy_url    TEXT NOT NULL,
  redirect_uris         TEXT[] NOT NULL,
  client_id             TEXT NOT NULL UNIQUE,
  client_secret_hash    TEXT NOT NULL,
  requested_scopes      TEXT[] NOT NULL DEFAULT '{}',
  app_type              TEXT NOT NULL DEFAULT 'third_party'
                          CHECK (app_type IN ('first_party', 'third_party', 'school_internal')),
  review_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (review_status IN ('pending', 'approved', 'rejected', 'suspended')),
  reviewed_by           UUID,
  reviewed_at           TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE oauth_apps ENABLE ROW LEVEL SECURITY;

-- Service role: full access (server-side app management)
CREATE POLICY IF NOT EXISTS oauth_apps_service ON oauth_apps
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Developers can read their own apps
CREATE POLICY IF NOT EXISTS oauth_apps_developer_select ON oauth_apps
  FOR SELECT TO authenticated
  USING (developer_id = auth.uid());

-- Admins can read all apps (for review workflow)
CREATE POLICY IF NOT EXISTS oauth_apps_admin_select ON oauth_apps
  FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oauth_apps_developer
  ON oauth_apps (developer_id);

CREATE INDEX IF NOT EXISTS idx_oauth_apps_review_pending
  ON oauth_apps (review_status) WHERE review_status = 'pending';

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_oauth_apps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oauth_apps_updated_at ON oauth_apps;
CREATE TRIGGER trg_oauth_apps_updated_at
  BEFORE UPDATE ON oauth_apps
  FOR EACH ROW EXECUTE FUNCTION update_oauth_apps_updated_at();


-- ===========================================================================
-- SECTION 2: oauth_scopes TABLE
-- ===========================================================================
-- Available API scopes that map to RBAC permissions.
-- Public reference data — all authenticated users can read.

CREATE TABLE IF NOT EXISTS oauth_scopes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  display_name_hi       TEXT,
  description           TEXT NOT NULL,
  permissions_required  TEXT[] NOT NULL,
  risk_level            TEXT NOT NULL DEFAULT 'low'
                          CHECK (risk_level IN ('low', 'medium', 'high')),
  is_active             BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE oauth_scopes ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY IF NOT EXISTS oauth_scopes_service ON oauth_scopes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- All authenticated users can read scopes (public reference data)
CREATE POLICY IF NOT EXISTS oauth_scopes_authenticated_select ON oauth_scopes
  FOR SELECT TO authenticated
  USING (true);


-- ===========================================================================
-- SECTION 3: oauth_consents TABLE
-- ===========================================================================
-- School-level consent decisions for OAuth apps.
-- A school admin grants or denies specific scopes to an app.

CREATE TABLE IF NOT EXISTS oauth_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  app_id            UUID NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  consented_by      UUID NOT NULL,
  granted_scopes    TEXT[] NOT NULL,
  denied_scopes     TEXT[],
  consent_type      TEXT NOT NULL DEFAULT 'school_wide',
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'revoked', 'expired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id, app_id)
);

ALTER TABLE oauth_consents ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY IF NOT EXISTS oauth_consents_service ON oauth_consents
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- School members can read their school's consents
CREATE POLICY IF NOT EXISTS oauth_consents_school_member_select ON oauth_consents
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT sm.school_id FROM school_memberships sm
      WHERE sm.auth_user_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Admins can read all consents
CREATE POLICY IF NOT EXISTS oauth_consents_admin_select ON oauth_consents
  FOR SELECT TO authenticated
  USING (auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oauth_consents_school
  ON oauth_consents (school_id);

CREATE INDEX IF NOT EXISTS idx_oauth_consents_app
  ON oauth_consents (app_id);

CREATE INDEX IF NOT EXISTS idx_oauth_consents_active
  ON oauth_consents (school_id, app_id) WHERE status = 'active';


-- ===========================================================================
-- SECTION 4: oauth_tokens TABLE
-- ===========================================================================
-- Issued access and refresh tokens. Server-only — never accessed directly
-- by authenticated users or anonymous clients.

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                      UUID NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  school_id                   UUID NOT NULL,
  user_id                     UUID NOT NULL,
  access_token_hash           TEXT NOT NULL,
  refresh_token_hash          TEXT,
  scopes                      TEXT[] NOT NULL,
  access_token_expires_at     TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at    TIMESTAMPTZ,
  revoked_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Service role ONLY — deny all authenticated and anon access
CREATE POLICY IF NOT EXISTS oauth_tokens_service ON oauth_tokens
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicit deny for authenticated users (defense in depth — RLS default-deny
-- already blocks access when no USING policy matches, but this makes intent
-- visible to reviewers and pg_policies audits).
CREATE POLICY IF NOT EXISTS oauth_tokens_deny_authenticated ON oauth_tokens
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access_hash
  ON oauth_tokens (access_token_hash);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_app_school
  ON oauth_tokens (app_id, school_id);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user
  ON oauth_tokens (user_id);


-- ===========================================================================
-- SECTION 5: school_api_keys TABLE
-- ===========================================================================
-- Simplified API keys for school server-to-server integrations.
-- Conditional creation: only if the table does not already exist.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'school_api_keys'
  ) THEN

    CREATE TABLE school_api_keys (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id             UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      key_hash              TEXT NOT NULL,
      created_by            UUID NOT NULL,
      scopes                TEXT[] NOT NULL,
      ip_allowlist          INET[],
      rate_limit_per_minute INT NOT NULL DEFAULT 30,
      last_used_at          TIMESTAMPTZ,
      expires_at            TIMESTAMPTZ,
      is_active             BOOLEAN NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

  END IF;
END $$;

ALTER TABLE school_api_keys ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'school_api_keys' AND policyname = 'school_api_keys_service'
  ) THEN
    CREATE POLICY school_api_keys_service ON school_api_keys
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- School members can read their school's API keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'school_api_keys' AND policyname = 'school_api_keys_school_member_select'
  ) THEN
    CREATE POLICY school_api_keys_school_member_select ON school_api_keys
      FOR SELECT TO authenticated
      USING (
        school_id IN (
          SELECT sm.school_id FROM school_memberships sm
          WHERE sm.auth_user_id = auth.uid()
            AND sm.is_active = true
        )
      );
  END IF;
END $$;

-- Admins can read all API keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'school_api_keys' AND policyname = 'school_api_keys_admin_select'
  ) THEN
    CREATE POLICY school_api_keys_admin_select ON school_api_keys
      FOR SELECT TO authenticated
      USING (auth.uid() IN (SELECT au.auth_user_id FROM admin_users au WHERE au.is_active = true));
  END IF;
END $$;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_school_api_keys_hash
  ON school_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS idx_school_api_keys_school
  ON school_api_keys (school_id);


-- ===========================================================================
-- SECTION 6: Seed OAuth Scopes
-- ===========================================================================
-- Initial scope definitions mapping to existing RBAC permissions.
-- ON CONFLICT DO NOTHING ensures idempotency on re-run.

INSERT INTO oauth_scopes (code, display_name, display_name_hi, description, permissions_required, risk_level) VALUES
  ('read:student_profile',   'Read Student Profile',      E'\u091B\u093E\u0924\u094D\u0930 \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u092A\u0922\u093C\u0947\u0902',
    'Read student profile information',
    ARRAY['profile.view_own'], 'low'),
  ('read:quiz_results',      'Read Quiz Results',         E'\u0915\u094D\u0935\u093F\u091C\u093C \u092A\u0930\u093F\u0923\u093E\u092E \u092A\u0922\u093C\u0947\u0902',
    'Read quiz scores and results',
    ARRAY['quiz.view_results'], 'low'),
  ('read:class_analytics',   'Read Class Analytics',      E'\u0915\u0915\u094D\u0937\u093E \u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u092A\u0922\u093C\u0947\u0902',
    'Read class-level analytics and dashboards',
    ARRAY['class.view_analytics'], 'medium'),
  ('read:student_progress',  'Read Student Progress',     E'\u091B\u093E\u0924\u094D\u0930 \u092A\u094D\u0930\u0917\u0924\u093F \u092A\u0922\u093C\u0947\u0902',
    'Read learning progress and mastery data',
    ARRAY['progress.view_own'], 'medium'),
  ('write:class_roster',     'Manage Class Roster',       E'\u0915\u0915\u094D\u0937\u093E \u0938\u0942\u091A\u0940 \u092A\u094D\u0930\u092C\u0902\u0927\u093F\u0924 \u0915\u0930\u0947\u0902',
    'Add, remove, and manage students in classes',
    ARRAY['class.manage','institution.manage_students'], 'high'),
  ('read:financial_reports',  'Read Financial Reports',   E'\u0935\u093F\u0924\u094D\u0924\u0940\u092F \u0930\u093F\u092A\u094B\u0930\u094D\u091F \u092A\u0922\u093C\u0947\u0902',
    'Read revenue and subscription reports',
    ARRAY['finance.view_revenue','finance.view_subscriptions'], 'high')
ON CONFLICT (code) DO NOTHING;


-- ===========================================================================
-- END OF MIGRATION
-- ===========================================================================
