-- Migration: 20260528000005_add_ff_demo_accounts_v2.sql
-- Phase F (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: gate the new demo-account flow (5 roles, secure passwords,
-- subscription provisioning, school auto-create) behind a flag so we can
-- canary on the existing super-admins before promoting to 100%.
--
-- Default OFF. The route + UI code is structurally backwards-compatible:
-- when the flag is OFF the legacy single-role create path is what runs.
-- When ON, the route also accepts role=school_admin / role=super_admin
-- and provisions the demo school + 3 seed students for school-admin.
--
-- Rollout plan:
--  1. Flip is_enabled=true for the 3 admin_users rows (target_roles=['super_admin'])
--  2. Operator creates one demo account of each role end-to-end
--  3. Walk through the corresponding portal (student/teacher/parent/school-admin/super-admin)
--  4. Confirm all 5 work, then expand rollout_percentage from 0 -> 100
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_demo_accounts_v2';

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  target_roles,
  target_environments,
  created_at,
  updated_at
)
VALUES (
  'ff_demo_accounts_v2',
  false,
  0,
  'Phase F: expanded demo-account creation (student/teacher/parent/school_admin/super_admin) with secure passwords, subscription provisioning, school auto-create, and 30-day purge cron. Off by default; flip per role/env after smoke test.',
  ARRAY['super_admin']::TEXT[],
  ARRAY['staging', 'production']::TEXT[],
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;
