-- =============================================================================
-- Platform Operations: deployment history, backup status, CMS assets
-- =============================================================================

-- Deployment history
CREATE TABLE IF NOT EXISTS deployment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_version TEXT NOT NULL,
  commit_sha TEXT,
  commit_message TEXT,
  commit_author TEXT,
  branch TEXT,
  environment TEXT DEFAULT 'production',
  deployment_id TEXT,
  region TEXT,
  triggered_by UUID REFERENCES auth.users(id),
  deployed_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'success' CHECK (status IN ('success','failed','rollback')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_deploy_history_time ON deployment_history (deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_history_env ON deployment_history (environment);
ALTER TABLE deployment_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY deploy_history_admin ON deployment_history FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backup status tracking
CREATE TABLE IF NOT EXISTS backup_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL CHECK (backup_type IN ('database','storage','full','manual')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('success','failed','in_progress','unknown','unverified')),
  provider TEXT DEFAULT 'supabase',
  coverage TEXT,
  size_bytes BIGINT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_status_time ON backup_status (completed_at DESC);
ALTER TABLE backup_status ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY backup_status_admin ON backup_status FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CMS asset metadata
CREATE TABLE IF NOT EXISTS cms_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('topic','question','simulation','general')),
  entity_id UUID,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  alt_text TEXT,
  caption TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_cms_assets_entity ON cms_assets (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cms_assets_active ON cms_assets (is_active) WHERE is_active = true;
ALTER TABLE cms_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cms_assets_admin ON cms_assets FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY cms_assets_read_published ON cms_assets FOR SELECT TO authenticated
    USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed initial backup status
INSERT INTO backup_status (backup_type, status, provider, coverage, notes)
SELECT 'database', 'unverified', 'supabase', 'Supabase Pro plan daily backups', 'Auto-seeded. Verify via Supabase dashboard.'
WHERE NOT EXISTS (SELECT 1 FROM backup_status LIMIT 1);
