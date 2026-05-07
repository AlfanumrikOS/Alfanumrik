-- Migration: 20260507000006_tenant_configs.sql
-- Purpose: Phase D of the white-label SaaS foundation. Introduces the typed
--          per-tenant key-value configuration store. Drives:
--            - dynamic theme overrides beyond the schools.* color/font cols
--            - per-tenant AI personality / pedagogy / tone / default language
--            - per-tenant locale (timezone, currency, number format)
--            - any future feature-specific config without schema migrations
--
-- Why a separate table (vs. piling more columns onto schools):
--   - schools is already wide and read on every request via proxy.ts. Adding
--     dozens of optional config columns there would bloat the hot row.
--   - jsonb per key lets each config namespace evolve its own schema, with
--     zod validation enforced at the resolver layer in code.
--   - `version` column lets us schema-migrate individual config keys later
--     without a DB migration (resolver up-converts on read).
--
-- Key naming convention (enforced by CHECK):
--   `<namespace>.<field>`, lowercase, dots and snake_case allowed.
--   Examples: theme.dark_mode_default, ai.personality, ai.tone,
--             ai.default_language, locale.timezone, locale.currency,
--             communication.from_email_name.
--
-- Sparse-by-default: missing row → resolver returns the registry default for
-- this tenant_type. Only deviations from the default are stored.
--
-- RLS: same shape as tenant_modules. service_role full; school_admin r/w own;
-- super_admin via existing bypass.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.tenant_configs CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_tenant_config_v2';

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_configs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  key         text        NOT NULL,
  value       jsonb       NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_configs_key_format
    CHECK (key = lower(key) AND key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT tenant_configs_school_key_unique
    UNIQUE (school_id, key)
);

COMMENT ON TABLE public.tenant_configs IS
  'Typed per-tenant key-value config. Keys follow `<namespace>.<field>`. '
  'Schemas owned by the resolver in src/lib/tenant-config/. Sparse: a missing '
  'row means "use the registry default for this tenant_type".';

CREATE INDEX IF NOT EXISTS idx_tenant_configs_school
  ON public.tenant_configs (school_id);

CREATE INDEX IF NOT EXISTS idx_tenant_configs_key
  ON public.tenant_configs (key);

-- ── 2. updated_at trigger ───────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_tenant_configs_updated_at ON public.tenant_configs;
CREATE TRIGGER trg_tenant_configs_updated_at
  BEFORE UPDATE ON public.tenant_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.tenant_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.tenant_configs;
CREATE POLICY "service_role full access"
  ON public.tenant_configs
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "school_admin read own" ON public.tenant_configs;
CREATE POLICY "school_admin read own"
  ON public.tenant_configs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  );

DROP POLICY IF EXISTS "school_admin write own" ON public.tenant_configs;
CREATE POLICY "school_admin write own"
  ON public.tenant_configs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (
    school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  )
  WITH CHECK (
    school_id IN (
      SELECT sa.school_id
      FROM public.school_admins sa
      WHERE sa.auth_user_id = auth.uid()
        AND sa.is_active = true
    )
  );

-- ── 4. Feature flag seed ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_tenant_config_v2'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_tenant_config_v2',
      false,
      0,
      'Gates the typed tenant_configs resolver. When ON, server code reads '
      'theme/AI/locale config from tenant_configs (with registry defaults as '
      'fallback). When OFF, the resolver returns registry defaults only and '
      'ignores any rows in the table. Lets us populate config for pilot '
      'schools before flipping the read path. Owner: principal-architect.'
    );
  END IF;
END $$;
