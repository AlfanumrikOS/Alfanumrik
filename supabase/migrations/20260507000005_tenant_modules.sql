-- Migration: 20260507000005_tenant_modules.sql
-- Purpose: Phase C of the white-label SaaS foundation. Introduces the per-
--          tenant module registry — the table that records, for each school,
--          which product modules (LMS, AI Tutor, Quiz Engine, Live Classes,
--          Analytics, CRM, Assignments, Attendance, Communication, …) are
--          enabled and what per-module configuration overrides apply.
--
-- Design choices:
--   - One row per (school_id, module_key). UNIQUE constraint enforces this.
--   - `module_key` is a free-form lowercase slug controlled by code in
--     src/lib/modules/registry.ts — NOT enforced by the DB. The registry is
--     the source of truth for "what modules exist"; this table is the source
--     of truth for "which ones are turned on for this tenant".
--     Trade-off: a typo in the registry would silently miss DB rows, but the
--     registry is a single small const file with vitest coverage. Keeping the
--     DB free of an enum means we can ship new modules without a migration.
--   - `is_enabled` is the on/off switch. `config` jsonb holds module-specific
--     overrides (e.g. AI module's prompt template, attendance module's
--     working-day calendar). The shape is module-defined and validated at
--     runtime by the registry-aware resolver.
--   - Default state when no row exists for a (school, module) pair: the
--     registry-defined default for that module's tenant_type. This keeps the
--     table sparse — only override rows are stored.
--
-- RLS policy stance:
--   - service_role: full access (used by webhooks, cron, server-side resolvers).
--   - school admins: read + write rows where school_id matches the caller's
--     school_admins row (mirrors school_subscriptions policy pattern).
--   - super_admin: full access via the existing super_admin RLS bypass.
--   - everyone else: no access.
--
-- This migration creates the table + RLS + trigger but seeds NO rows. Module
-- enablement is sparse-by-default: missing row → use registry default.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.tenant_modules CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_tenant_module_registry_v1';

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_modules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  module_key  text        NOT NULL,
  is_enabled  boolean     NOT NULL DEFAULT true,
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_modules_module_key_lower
    CHECK (module_key = lower(module_key) AND module_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT tenant_modules_school_module_unique
    UNIQUE (school_id, module_key)
);

COMMENT ON TABLE public.tenant_modules IS
  'Per-tenant module enablement + config overrides. Sparse by design: the '
  'absence of a row means "use the registry default for this tenant_type". '
  'Module keys are owned by src/lib/modules/registry.ts.';

CREATE INDEX IF NOT EXISTS idx_tenant_modules_school_enabled
  ON public.tenant_modules (school_id)
  WHERE is_enabled = true;

CREATE INDEX IF NOT EXISTS idx_tenant_modules_module_key
  ON public.tenant_modules (module_key)
  WHERE is_enabled = true;

-- ── 2. updated_at trigger ───────────────────────────────────────────
-- Reuse the project-wide `set_updated_at()` trigger function if it exists;
-- otherwise create a local one. Defensive lookup to handle older envs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_modules_updated_at ON public.tenant_modules;
CREATE TRIGGER trg_tenant_modules_updated_at
  BEFORE UPDATE ON public.tenant_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;

-- service_role full access (mirrors the 20260505155635 hardening pattern —
-- explicit role scope, not USING(true) for everyone).
DROP POLICY IF EXISTS "service_role full access" ON public.tenant_modules;
CREATE POLICY "service_role full access"
  ON public.tenant_modules
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- School admins can read their own rows.
DROP POLICY IF EXISTS "school_admin read own" ON public.tenant_modules;
CREATE POLICY "school_admin read own"
  ON public.tenant_modules
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

-- School admins can write their own rows. Insert + update + delete checked
-- against the same school_admins predicate.
DROP POLICY IF EXISTS "school_admin write own" ON public.tenant_modules;
CREATE POLICY "school_admin write own"
  ON public.tenant_modules
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
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_tenant_module_registry_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_tenant_module_registry_v1',
      false,
      0,
      'Gates the per-tenant module registry. When ON, server resolvers '
      '(src/lib/modules/registry.ts) consult tenant_modules to decide '
      'whether a module is rendered/served for a given school; otherwise '
      'every module is implicitly enabled (current behaviour). When OFF, '
      'tenant_modules rows are still readable but have no runtime effect, '
      'so admins can configure ahead of rollout. Owner: principal-architect.'
    );
  END IF;
END $$;
