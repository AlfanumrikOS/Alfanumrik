-- Migration: 20260620001600_enable_latest_frontend_flags.sql
-- Purpose: CEO-approved flag ENABLEMENT for the four latest portal frontend
--          designs. All Phase 0/1D/1E implementation work is done and committed.
--          This migration flips the gates ON so the newest designs become the
--          production default across student, parent, teacher, and mobile portals.
--
-- Flags enabled (all is_enabled = true, rollout_percentage = 100):
--
--   1. ff_student_os_v1
--        Renders StudentOSDashboard in place of the legacy AtlasDashboard.
--        The new OS-style student home surface (Phase 1D) is built and
--        committed. OFF shows AtlasDashboard (byte-identical to today).
--        Row absent from feature_flags until this migration (never seeded).
--
--   2. ff_today_home_v1
--        Enables the consolidated "Today" home tab config in MobileBottomNav
--        (Phase 1, consumer minimalism Wave A). Seeded OFF by
--        20260612000000_seed_phase1_consumer_minimalism_flags.sql.
--        This migration flips is_enabled=true and sets rollout_percentage=100.
--
--   3. ff_teacher_command_center
--        Enables the dense desktop-first Class Command Center (teacher home)
--        and the slimmed TEACHER_PRIMARY_SLIM 5-item nav. Already enabled by
--        20260620000400_phase3_enable_school_saas_flags.sql — this UPSERT
--        re-asserts the ON state idempotently for completeness.
--
--   4. ff_parent_glance_v1
--        Renders ParentGlanceHome in place of AtlasParent/CosmicParentHome.
--        The parent at-a-glance summary surface (Phase 1E) is built and
--        committed. Seeded OFF by
--        20260612000000_seed_phase1_consumer_minimalism_flags.sql.
--        This migration flips is_enabled=true and sets rollout_percentage=100.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Mirrors the canonical feature_flags shape used by every prior enable migration
-- (flag_name / is_enabled / rollout_percentage / target_* / created_at /
-- updated_at). Each statement is an idempotent UPSERT with an EXPLICIT column
-- list whose first column is `flag_name`, resolving conflicts on the canonical
-- unique key `feature_flags_flag_name_key` via `ON CONFLICT (flag_name) DO
-- UPDATE`. This satisfies REG-125: every root-migration INSERT INTO feature_flags
-- carries an explicit column list that includes flag_name, and the ON CONFLICT
-- target is (flag_name), not (name).
--
-- UPSERT (not a bare UPDATE) is deliberate: ff_student_os_v1 was never seeded
-- by any prior migration. A bare UPDATE would no-op on that row and silently
-- fail to enable it. The UPSERT creates the row enabled-at-100% if absent, or
-- flips is_enabled=true and clears the rollout double-gate if present.
-- Replayable: re-running re-asserts the ON state.
--
-- Scoping: rollout_percentage = 100, target_* = NULL → enabled GLOBALLY for ALL
-- tenants on apply.
--
-- ─── Audit trail ─────────────────────────────────────────────────────────────
-- The row's updated_at is stamped now() on every apply. The change is captured
-- in the migration history (this file). Subsequent operator flips route through
-- the audited super-admin Flags console mutation path.
--
-- Additive. Idempotent. Replayable. No DROP. No DDL. No new tables → RLS N/A;
-- feature_flags keeps its existing baseline RLS posture. Guarded so it no-ops
-- cleanly on a fresh DB where feature_flags does not yet exist.
--
-- Owner: architect (this enablement migration). CEO-approved, 2026-06-20.
-- Added: 2026-06-20
--
-- ─── Reversible (instant rollback) ───────────────────────────────────────────
--   UPDATE feature_flags SET is_enabled = false, updated_at = now()
--   WHERE flag_name IN (
--     'ff_student_os_v1', 'ff_today_home_v1',
--     'ff_teacher_command_center', 'ff_parent_glance_v1'
--   );
-- Each consuming surface falls back to its legacy rendering when its flag is
-- OFF or missing, so the rollback is silent on the production experience.

DO $enable_latest_frontend$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. Student OS Dashboard (StudentOSDashboard over AtlasDashboard).
    --    Row never previously seeded — UPSERT creates it enabled.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_student_os_v1', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 2. Today home tab config in MobileBottomNav (consumer minimalism Wave A).
    --    Row seeded OFF by 20260612000000 — UPSERT flips it ON.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_today_home_v1', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 3. Teacher Command Center (CommandCenter over AtlasTeacher; TEACHER_PRIMARY_SLIM nav).
    --    Row already enabled by 20260620000400 — UPSERT re-asserts ON idempotently.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_teacher_command_center', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 4. Parent Glance Home (ParentGlanceHome over AtlasParent/CosmicParentHome).
    --    Row seeded OFF by 20260612000000 — UPSERT flips it ON.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_parent_glance_v1', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping latest-frontend flag enablement (fresh DB).';
  END IF;
END $enable_latest_frontend$;
