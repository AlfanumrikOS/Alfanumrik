-- Migration: 20260615205752_institution_entitlements.sql
-- Purpose: Per-school deal-driven entitlements. Records, for each school, the
--          commercial entitlements negotiated in a sales deal — which features
--          and modules are turned on, and what usage limits apply — so the
--          runtime entitlement resolver can answer "is feature X / module Y
--          enabled, and what is limit Z, for this school?" from a single
--          authoritative table.
--
-- Relationship to the existing white-label tables (do NOT conflate):
--   - tenant_modules  = which PRODUCT MODULES are toggled on (registry-driven,
--                       school-admin self-serve, sparse-by-default).
--   - tenant_configs  = typed per-tenant config (theme/AI/locale).
--   - institution_entitlements (THIS table) = the COMMERCIAL CONTRACT terms a
--                       deal grants: feature/module enablement + usage limits
--                       that flow from what the school PAID FOR. These are
--                       commercial terms, NOT self-serve toggles — a school
--                       admin can READ their entitlements (to render "you have
--                       Simulations") but can NEVER write them. Only ops, via
--                       the service-role super-admin API, mints/edits rows.
--
-- 3-layer entitlement resolution this table serves (resolver in code, e.g.
-- src/lib/entitlements/):
--   1. institution_entitlements row for (school_id, entitlement_key) — the
--      deal-specific grant. Highest precedence. Honours effective_from/_to
--      windows (a trial/pilot grant can be time-boxed).
--   2. plan default for the school's subscription_plan (code-defined).
--   3. platform default (the registry/baseline default) when neither exists.
--   Sparse by design: only deal-specific DEVIATIONS from the plan/platform
--   default are stored here.
--
-- entitlement_key namespacing (free-form, code-owned — NOT a DB enum, mirroring
-- the tenant_modules module_key stance so new entitlements ship without a
-- migration):
--   'feature.<slug>'  -> value {"enabled": true|false}
--   'module.<slug>'   -> value {"enabled": true|false}
--   'limit.<slug>'    -> value {"max": N, "period": "day"|"week"|"month"}
--   Examples: feature.simulations, module.ai_tutor, limit.foxy_chat_daily.
--
-- contract_id is NULLABLE on purpose: ops grants trials/pilots BEFORE any
-- formal school_contracts row exists. ON DELETE SET NULL keeps the entitlement
-- alive (and ops-revocable) if a contract is later deleted/superseded; the
-- entitlement is the source of truth for runtime access, the contract is the
-- paper trail.
--
-- RLS policy stance (P8 — RLS enabled + policies in THIS file):
--   - service_role: full access. The super-admin API (server-side, service
--     role) is the ONLY writer. No school_admin / super_admin authenticated
--     WRITE policy exists by design — these are commercial terms.
--   - school_admin: SELECT own school only (mirrors the tenant_modules /
--     tenant_configs `school_admins.auth_user_id = auth.uid() AND is_active`
--     subquery shape VERBATIM) — read-only, to render their own entitlements.
--   - super_admin (admin/super_admin via user_roles JOIN roles): SELECT all,
--     for console visibility; writes go through the service-role API. Matches
--     the role-join guard used elsewhere (20260615122659_create_system_metrics).
--   - NO student / parent access (these are commercial terms, never learner
--     data).
--
-- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE POLICY).
-- Creates the table + RLS + trigger; seeds NO rows. Gated at the resolver layer
-- by ff_institution_entitlements_v1 (seeded OFF in the sibling migration
-- 20260615205753). Owner: architect.
--
-- DOWN (manual, destructive — staging only):
--   DROP TABLE IF EXISTS public.institution_entitlements CASCADE;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_institution_entitlements_v1';

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.institution_entitlements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  contract_id     uuid        REFERENCES public.school_contracts(id) ON DELETE SET NULL,
  entitlement_key text        NOT NULL,
  value           jsonb       NOT NULL,
  effective_from  timestamptz,
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_entitlements_school_key_uniq
    UNIQUE (school_id, entitlement_key)
);

COMMENT ON TABLE public.institution_entitlements IS
  'Per-school deal-driven commercial entitlements (feature/module enablement + '
  'usage limits) granted by a sales deal. Read-only for school admins; written '
  'only by the service-role super-admin API. Sparse: a missing row means "fall '
  'back to plan default, then platform default" (resolver in '
  'src/lib/entitlements/). entitlement_key namespacing is code-owned, not a DB '
  'enum. contract_id is nullable for trial/pilot grants without a formal '
  'contract.';

-- Indexes: per-school lookup, the (school_id, entitlement_key) resolver probe
-- (also backed by the UNIQUE constraint, but the explicit index keeps intent
-- clear and survives any future constraint reshaping), and contract back-refs.
CREATE INDEX IF NOT EXISTS idx_institution_entitlements_school
  ON public.institution_entitlements (school_id);

CREATE INDEX IF NOT EXISTS idx_institution_entitlements_school_key
  ON public.institution_entitlements (school_id, entitlement_key);

CREATE INDEX IF NOT EXISTS idx_institution_entitlements_contract
  ON public.institution_entitlements (contract_id)
  WHERE contract_id IS NOT NULL;

-- ── 2. updated_at trigger ───────────────────────────────────────────
-- Reuse the project-wide `set_updated_at()` trigger function if it exists;
-- otherwise create a local one. Mirrors tenant_modules' defensive lookup so the
-- migration applies cleanly on fresh DBs and out-of-order CI envs.
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

DROP TRIGGER IF EXISTS trg_institution_entitlements_updated_at ON public.institution_entitlements;
CREATE TRIGGER trg_institution_entitlements_updated_at
  BEFORE UPDATE ON public.institution_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.institution_entitlements ENABLE ROW LEVEL SECURITY;

-- service_role full access (the super-admin API is the only writer; explicit
-- role scope, not USING(true) for everyone — mirrors the 20260505155635
-- hardening pattern and the tenant_modules/tenant_configs precedent).
DROP POLICY IF EXISTS "service_role full access" ON public.institution_entitlements;
CREATE POLICY "service_role full access"
  ON public.institution_entitlements
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- School admins can READ their own school's entitlements (read-only — these are
-- commercial terms, so NO write policy). Subquery shape is VERBATIM from
-- tenant_modules / tenant_configs "school_admin read own".
DROP POLICY IF EXISTS "school_admin read own" ON public.institution_entitlements;
CREATE POLICY "school_admin read own"
  ON public.institution_entitlements
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

-- Super admins (admin/super_admin) can READ all rows for console visibility.
-- Writes go through the service-role API (above), not this policy. Role-join
-- guard matches 20260615122659_create_system_metrics: user_roles JOIN roles,
-- r.name IN ('admin','super_admin'), is_active, expires_at window.
DROP POLICY IF EXISTS "super_admin read all" ON public.institution_entitlements;
CREATE POLICY "super_admin read all"
  ON public.institution_entitlements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.auth_user_id = auth.uid()
        AND r.name IN ('admin','super_admin')
        AND ur.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  );

-- NO student / parent policy: entitlements are commercial terms, never exposed
-- to learner-facing roles. Absence of a matching policy = deny (RLS default).
