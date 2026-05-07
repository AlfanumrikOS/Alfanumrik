-- Migration: 20260507120000_platform_module_overrides.sql
-- Purpose: Phase C super-admin extension — adds the
--          `platform_module_overrides` table that lets a super-admin
--          force-disable (or force-enable) a platform module across
--          ALL tenants, overriding both the per-tenant tenant_modules
--          rows and the registry defaults.
--
-- Why a separate table (vs. bulk-updating tenant_modules):
--   - tenant_modules is per-(school_id, module_key). Bulk-updating
--     thousands of rows is messy and doesn't apply to schools that
--     onboard AFTER the override is set.
--   - A platform-wide row keyed by (module_key) is one source of truth.
--     The registry resolver checks it FIRST — if force-disabled,
--     no tenant can re-enable.
--
-- Resolution order (after this migration lands):
--   1. platform_module_overrides.is_force_disabled = true → ALWAYS off,
--      regardless of tenant_modules row or tenant-type default.
--   2. platform_module_overrides.is_force_disabled = false (or no row)
--      AND ff_tenant_module_registry_v1 OFF → all on (current behaviour).
--   3. platform_module_overrides absent / not force-disabled +
--      flag ON: tenant_modules row > tenant-type default (existing path).
--
-- Audit: updates write a row to admin_audit_log with action
-- 'platform.module_overridden' (handled API-side).
--
-- Idempotent: ✅ CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- Reversible:
--   DROP TABLE IF EXISTS public.platform_module_overrides CASCADE;

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_module_overrides (
  module_key         text        PRIMARY KEY,
  is_force_disabled  boolean     NOT NULL DEFAULT false,
  reason             text,                           -- ops note: why was this overridden?
  set_by             uuid,                           -- super-admin auth_user_id
  set_at             timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_module_overrides_module_key_format
    CHECK (module_key = lower(module_key) AND module_key ~ '^[a-z][a-z0-9_]{0,63}$')
);

COMMENT ON TABLE public.platform_module_overrides IS
  'Super-admin platform-wide overrides for module enablement. A row with '
  'is_force_disabled=true makes the module unavailable for ALL tenants, '
  'regardless of their tenant_modules row or tenant-type default. Sparse '
  'by design — most modules have no override row. Owned by super-admin.';

-- ── 2. updated_at trigger (reuse existing set_updated_at function) ──
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

DROP TRIGGER IF EXISTS trg_platform_module_overrides_updated_at
  ON public.platform_module_overrides;
CREATE TRIGGER trg_platform_module_overrides_updated_at
  BEFORE UPDATE ON public.platform_module_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS — service_role only ───────────────────────────────────────
-- This table is platform-level state. NO authenticated user (school_admin
-- or otherwise) needs direct DB access — they consume the resolved
-- isModuleEnabled() result via the application layer. Super-admin writes
-- go through /api/super-admin/module-overrides which uses the service
-- role under admin-secret authentication.
ALTER TABLE public.platform_module_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.platform_module_overrides;
CREATE POLICY "service_role full access"
  ON public.platform_module_overrides
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. NO feature flag for this migration ───────────────────────────
-- The override table's effect is gated by the SAME flag that gates
-- tenant_modules consumption (ff_tenant_module_registry_v1). When that
-- flag is OFF, the resolver short-circuits to "all enabled" and platform
-- overrides have no effect — which is the safe default during rollout.
-- See src/lib/modules/registry.ts isModuleEnabled() for the resolution
-- order.
