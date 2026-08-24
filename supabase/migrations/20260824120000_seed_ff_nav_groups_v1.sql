-- Migration: 20260824120000_seed_ff_nav_groups_v1.sql
-- Purpose: Seed the feature flag `ff_nav_groups_v1` (grouped secondary student
--          navigation — "Practice" and "Explore" groups) so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_nav_groups_v1
--     When ON: the student secondary navigation (the More sheet / sidebar
--     projections) renders two GROUPED sections — "Practice" and "Explore" —
--     that re-surface EIGHT routes which are live today but currently have no
--     nav entry:
--       Practice — /pyq, /revision, /assignments, /exams
--       Explore  — /learn, /dive, /synthesis, /library
--     When OFF: the navigation renders BYTE-IDENTICALLY to today — no new nav
--     row mounts, the primary five-slot bar is untouched, and every one of the
--     eight routes stays reachable exactly as it is now (deep links, teacher
--     assignment links, notification targets and Foxy links all already point
--     at them and do not go through the nav).
--
-- ─── /simulations is DELIBERATELY EXCLUDED — do not "helpfully" re-add it ────
-- An earlier draft of this header and of the NAV_GROUPS_FLAGS doc block in
-- packages/lib/src/flags/registries/consumer.ts said NINE routes and listed
-- /simulations. That was wrong: the shipped membership in
-- packages/ui/src/navigation/nav-config.ts is eight, and /simulations was
-- never in it.
-- /simulations is NOT a destination. Its page body is a legacy alias that does
-- `router.replace('/stem-centre')`
-- (apps/host/src/app/(student)/simulations/page.tsx), and /stem-centre ALREADY
-- ships in the nav as the row named "STEM Lab" 🔬 (MORE_ITEMS, group 'study',
-- and the desktop SIDEBAR_SECTIONS projection). Adding a /simulations row
-- would therefore put ONE destination under TWO names at ONE breakpoint —
-- the same defect as the old "Home"/"Dashboard" pair, and precisely what the
-- nav contract test (student-primary-nav-contract.test.ts) fails on.
-- The exclusion is recorded a second time, with the same reasoning, in the
-- "WHAT IS DELIBERATELY ABSENT" block of nav-config.ts. If you are here to
-- add a ninth route, that is the IA law you would be breaking.
--
-- ─── Why this exists: it partially reverses the Phase 3 IA trim ──────────────
-- The Phase 3 IA trim (2026-08-10) cut MORE_ITEMS from 18 rows to 10 and
-- SIDEBAR_SECTIONS from 22 links to 14, because ~20 named destinations one tap
-- below the bar had become a second, unranked product surface. That trim
-- removed NAV ENTRIES ONLY — every route was deliberately retained and is
-- still deep-linked to from outside the navigation. The trim's own rationale
-- and the retained-route list are documented in
-- packages/ui/src/navigation/nav-config.ts, in the comment block headed
-- "PHASE 3 IA TRIM (2026-08-10)". (Cited by heading, not line number: that
-- block sat at lines 90-115 when this migration was written and had already
-- moved to line 119 by the time it was committed.)
-- This flag gates a PARTIAL, GROUPED reversal of that trim: the same routes
-- come back to the navigation, but ranked into two named groups instead of a
-- flat overflow list. It is deliberately a separate, independently rampable
-- flag so the grouped IA can be evaluated and rolled back without touching the
-- primary nav bar or the Phase 3 trim itself.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns
-- false for both `is_enabled = false` AND `rollout_percentage <= 0`, so the
-- grouped navigation stays OFF until an operator explicitly flips this flag via
-- the super-admin console. Seeding the row makes the flag visible/auditable —
-- it does NOT enable the behavior. Merging this migration is a zero-behavior
-- change.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql and
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql for the defensive
-- to_regclass guard + explicit column list + audit description). Scoping arrays
-- are left NULL (no role/env/institution narrowing) — the global
-- is_enabled=false / rollout=0 double gate is what holds the flag OFF. The
-- explicit column list (flag_name first) + ON CONFLICT (flag_name) DO NOTHING
-- conform to REG-125 (canonical feature_flags shape: flag_name/is_enabled, NOT
-- name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; feature_flags keeps its existing baseline RLS posture and no policy,
-- grant, or privilege is added, altered, or revoked by this file.
--
-- Owner: architect (this seed) + frontend (nav group rendering gates against
--        this exact flag name, in parallel — packages/ui/src/navigation/, NOT
--        touched by this change) + ops (flip procedure)
-- Added: 2026-08-24
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_nav_groups_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience.

DO $nav_groups$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_nav_groups_v1',
      false,
      0,
      'Grouped secondary student navigation: re-surfaces eight live-but-unlinked routes as two ranked nav groups — Practice (/pyq, /revision, /assignments, /exams) and Explore (/learn, /dive, /synthesis, /library). /simulations is deliberately NOT included: it is a legacy alias that redirects to /stem-centre, which already ships as the "STEM Lab" nav row, so listing it would put one destination under two names at one breakpoint. Partial, grouped reversal of the Phase 3 IA trim of 2026-08-10 (which removed nav entries only, never the routes — see the PHASE 3 IA TRIM block in packages/ui/src/navigation/nav-config.ts). Presentation-layer only: no schema, scoring, XP or route change. When OFF the navigation renders byte-identically to today. Default off.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_nav_groups_v1 seed (fresh DB).';
  END IF;
END $nav_groups$;
