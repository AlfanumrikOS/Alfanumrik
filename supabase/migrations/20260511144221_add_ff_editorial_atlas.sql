-- Migration: 20260511144221_add_ff_editorial_atlas.sql
-- Purpose:    Reconcile a phantom prod migration. This version was
--             applied directly to prod's supabase_migrations.schema_migrations
--             on 2026-05-11 outside the repo, then later captured under
--             a different timestamp at
--             supabase/migrations/20260511180000_add_ff_editorial_atlas.sql.
--             Committing this file with the exact phantom timestamp
--             unblocks `supabase db push --linked`.
--
-- SQL body sourced byte-for-byte from
-- supabase_migrations.schema_migrations.statements[0] on prod at the
-- time of reconciliation (verified 2026-05-12 via Supabase MCP).
--
-- Idempotency: ✅ INSERT ... ON CONFLICT (flag_name) DO NOTHING. The 5
-- ff_editorial_atlas_* rows already exist on prod after the original
-- direct-apply; this is a strict no-op there. On staging and dev
-- environments missing the rows, the INSERT seeds them.
--
-- DO NOT delete this file. See companion comment in
-- 20260510125019_grounded_traces_grounded_from_chunks.sql.

-- Editorial Atlas feature flags (matches supabase/migrations/20260511180000_add_ff_editorial_atlas.sql)
-- All flags ship is_enabled=false. ON CONFLICT DO NOTHING makes this idempotent.

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
