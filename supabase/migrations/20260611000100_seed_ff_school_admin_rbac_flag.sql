-- Migration: 20260611000100_seed_ff_school_admin_rbac_flag.sql
-- Purpose: Seed the Phase 3B — Wave C feature flag `ff_school_admin_rbac` so the
--          row EXISTS in public.feature_flags and is auditable + flippable from
--          the super-admin console. Default OFF / 0% (Gap 3).
--
--   ff_school_admin_rbac
--     When ON: authorizeSchoolAdmin() ALSO enforces the CEO-approved
--     role→permission matrix (SCHOOL_ADMIN_ROLE_CAPABILITIES in
--     src/lib/school-admin-auth.ts) AFTER the existing RBAC check + active-school
--     lookup — a school admin whose `school_admins.role` does not grant the
--     requested permission gets 403.
--     When OFF: NO role-narrowing — authorizeSchoolAdmin() behaves BYTE-IDENTICALLY
--     to pre-Wave-C (matrix check skipped entirely). All four school_admins.role
--     values continue to resolve to the single institution_admin RBAC role.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- Production enablement is HELD pending comms and is NOT part of this task. The
-- server read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false
-- for both `is_enabled = false` AND `rollout_percentage <= 0`, so role-narrowing
-- stays OFF until an operator explicitly flips this flag via the super-admin
-- console. Seeding the row makes the flag visible/auditable — it does not enable
-- the behavior.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Matches the existing flag-seed pattern (20260509120000_pedagogy_v2_wave_1_flags
-- .sql). Columns referenced all exist on public.feature_flags (baseline):
--   flag_name, is_enabled, rollout_percentage, target_roles,
--   target_environments, target_institutions. Scoping arrays are left NULL
--   (no role/env/institution narrowing) — the global is_enabled=false /
--   rollout=0 gate is what holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). No new tables → RLS N/A; the table
-- keeps its existing baseline RLS posture.
--
-- ─── Reversible ───────────────────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_school_admin_rbac';

INSERT INTO feature_flags (flag_name, is_enabled, target_roles, target_environments, target_institutions, rollout_percentage)
VALUES
  ('ff_school_admin_rbac', false, NULL, NULL, NULL, 0)
ON CONFLICT (flag_name) DO NOTHING;
