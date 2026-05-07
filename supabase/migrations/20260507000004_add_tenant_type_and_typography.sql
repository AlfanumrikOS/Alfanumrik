-- Migration: 20260507000004_add_tenant_type_and_typography.sql
-- Purpose: Phase B of the white-label SaaS foundation. Adds:
--          (1) `tenant_type` enum-style column to schools so the same row can
--              represent a school, coaching institute, corporate, or government
--              tenant without renaming the table or breaking school_id refs.
--          (2) typography branding fields (font_heading, font_body,
--              border_radius_px) so the dynamic theme engine can pick fonts
--              + corner radius per tenant alongside the existing primary/
--              secondary colors.
--          (3) a partial index on tenant_type for super-admin filtering.
--          (4) seeds `ff_tenant_type_v1` (default OFF) — the runtime flag that
--              gates any UI/copy changes that branch on tenant_type. The
--              column itself is always populated; the flag only controls
--              whether features differentiate behaviour by type.
--
-- Why an additive column instead of renaming `schools` → `tenants`:
--   - 25+ API namespaces, 35 migrations, dozens of RLS policies, and the
--     stabilized Razorpay billing surface all reference `school_id` /
--     `school_subscriptions` / `school_admins`. A rename would force a
--     coordinated cross-cutting change with high regression risk on a
--     billing path that just stabilized 2 days ago (#556 atomic plan-change).
--   - Adding `tenant_type` keeps all foreign keys intact, lets the abstraction
--     layer expose `Tenant` semantics in code, and reserves the option of a
--     storage rename later if it ever pays off.
--
-- Default value: 'school' (matches every existing row's intent).
-- CHECK constraint enumerates the 4 tenant types from the spec.
--
-- All changes are idempotent (IF NOT EXISTS) so the migration can be re-run
-- safely against any environment.
--
-- DOWN (manual, destructive — only for staging rollback):
--   ALTER TABLE schools DROP COLUMN IF EXISTS tenant_type;
--   ALTER TABLE schools DROP COLUMN IF EXISTS font_heading;
--   ALTER TABLE schools DROP COLUMN IF EXISTS font_body;
--   ALTER TABLE schools DROP COLUMN IF EXISTS border_radius_px;
--   DROP INDEX IF EXISTS idx_schools_tenant_type;
--   DELETE FROM feature_flags WHERE flag_name = 'ff_tenant_type_v1';

-- ── 1. Tenant type column ──────────────────────────────────────────
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS tenant_type text NOT NULL DEFAULT 'school';

-- Add the CHECK constraint separately so re-runs don't fail when it already
-- exists. Postgres has no IF NOT EXISTS for ADD CONSTRAINT, so we drop+add.
ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_tenant_type_check;

ALTER TABLE public.schools
  ADD CONSTRAINT schools_tenant_type_check
  CHECK (tenant_type IN ('school', 'coaching', 'corporate', 'government'));

COMMENT ON COLUMN public.schools.tenant_type IS
  'White-label tenant category. Drives default branding palette, default '
  'enabled modules, and copy variants. Storage table stays `schools` to '
  'preserve every existing FK; the abstraction lives in src/lib/tenant/.';

-- ── 2. Typography fields ────────────────────────────────────────────
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS font_heading text;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS font_body text;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS border_radius_px smallint;

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_border_radius_px_check;

ALTER TABLE public.schools
  ADD CONSTRAINT schools_border_radius_px_check
  CHECK (border_radius_px IS NULL OR (border_radius_px >= 0 AND border_radius_px <= 32));

-- ── 3. Partial index for super-admin filtering ──────────────────────
CREATE INDEX IF NOT EXISTS idx_schools_tenant_type
  ON public.schools (tenant_type)
  WHERE deleted_at IS NULL AND is_active = true;

-- ── 4. Feature flag seed ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_tenant_type_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_tenant_type_v1',
      false,
      0,
      'Gates UI/copy variants that branch on schools.tenant_type. The column '
      'itself is always populated and read by the tenant abstraction layer; '
      'this flag only controls whether the frontend renders type-specific '
      'language (e.g. "students" vs "learners" vs "employees" vs "officers") '
      'and surfaces type-specific defaults in /school-admin/branding. '
      'When OFF, every tenant sees school-flavoured copy regardless of type. '
      'Owner: principal-architect.'
    );
  END IF;
END $$;
