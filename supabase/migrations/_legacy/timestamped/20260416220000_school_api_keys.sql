-- Migration: 20260416220000_school_api_keys.sql
-- Purpose: API key management for school ERP/SIS integration
-- Applied via Supabase MCP on 2026-04-16

CREATE TABLE IF NOT EXISTS school_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_api_keys_school ON school_api_keys (school_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_school_api_keys_prefix ON school_api_keys (key_prefix) WHERE is_active = true;

ALTER TABLE school_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "school_api_keys_service_role" ON school_api_keys FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "school_api_keys_admin_select" ON school_api_keys FOR SELECT TO authenticated USING (school_id = get_admin_school_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION update_school_api_keys_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_school_api_keys_updated_at ON school_api_keys;
CREATE TRIGGER trg_school_api_keys_updated_at BEFORE UPDATE ON school_api_keys FOR EACH ROW EXECUTE FUNCTION update_school_api_keys_updated_at();
