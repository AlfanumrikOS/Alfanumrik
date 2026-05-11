-- Migration: 20260511180000_add_ff_editorial_atlas.sql
-- Purpose: Seed the feature flags for the Editorial Atlas multi-role redesign.
--          One master flag + four per-role canaries, all default OFF.
--
-- Why this exists:
--   The redesign documented in docs/design/MULTI_ROLE_REDESIGN.md lands behind
--   ff_editorial_atlas_v1. The runtime reader (src/lib/feature-flags.ts) treats
--   any of {MASTER, role-canary} being true as enabling the new surface, which
--   gives ops a one-flip-per-role rollout pattern without code changes.
--
-- Rollout pattern (forward):
--   1. Land this migration. Surfaces remain legacy because every flag is OFF.
--   2. Pilot tenant: UPDATE feature_flags SET is_enabled=true,
--      target_institutions='{<tenant-uuid>}' WHERE flag_name='ff_editorial_atlas_v1';
--   3. Per-role gradual: instead of master, flip ff_editorial_atlas_student
--      first, validate for a week, then parent → teacher → school.
--   4. Global launch: UPDATE feature_flags SET target_institutions=NULL,
--      rollout_percentage=100 WHERE flag_name='ff_editorial_atlas_v1';
--
-- Rollback:
--   UPDATE feature_flags SET is_enabled=false
--   WHERE flag_name LIKE 'ff_editorial_atlas%';
--   Instant — legacy pages render the same code paths they did pre-migration.

INSERT INTO public.feature_flags
  (flag_name, is_enabled, target_roles, target_environments,
   target_institutions, rollout_percentage, metadata)
VALUES
  ('ff_editorial_atlas_v1', false, NULL, NULL, NULL, 0,
   jsonb_build_object(
     'description', 'Master switch for the Editorial Atlas multi-role redesign.',
     'doc',         'docs/design/MULTI_ROLE_REDESIGN.md',
     'phase',       'D3'
   )),
  ('ff_editorial_atlas_student', false, ARRAY['student'], NULL, NULL, 0,
   jsonb_build_object('description', 'Atlas redesign for /dashboard. Off → legacy.')),
  ('ff_editorial_atlas_parent',  false, ARRAY['guardian'], NULL, NULL, 0,
   jsonb_build_object('description', 'Atlas redesign for /parent. Off → legacy.')),
  ('ff_editorial_atlas_teacher', false, ARRAY['teacher'], NULL, NULL, 0,
   jsonb_build_object('description', 'Atlas redesign for /teacher. Kills dark mode when on.')),
  ('ff_editorial_atlas_school',  false, ARRAY['school_admin'], NULL, NULL, 0,
   jsonb_build_object('description', 'Atlas redesign for /school-admin. Adds KPI sparks, class comparison, alerts.'))
ON CONFLICT (flag_name) DO NOTHING;

-- Documentation comment on the feature_flags table is unchanged; the new
-- rows inherit it. No data backfill required — flags read as false until
-- explicitly enabled.
