-- Migration: 20260620001700_enable_pedagogy_v2_daily_rhythm_global.sql
-- Purpose: Enable ff_pedagogy_v2_daily_rhythm for ALL environments (production
--          included), clearing the development+staging restriction that has been
--          blocking the student "Today" dashboard from rendering in production.
--
-- ─── What this flag gates ────────────────────────────────────────────────────
-- ff_pedagogy_v2_daily_rhythm controls two surfaces:
--
--   1. GET /api/rhythm/today  — the server-side endpoint that assembles the
--      student's daily learning queue:
--        • 5 SRS (spaced-repetition) review slots drawn from get_due_reviews()
--          ordered by SM-2 next_review timestamp and IRT information gain
--        • 1 ZPD (zone of proximal development) challenge slot drawn from
--          get_adaptive_questions() using the student's current ability estimate
--        • 1 reflection/consolidation slot
--      Returns an empty queue with a 204 if the student has no SRS history yet
--      (safe fallback path — no 500, no crash).
--
--   2. <DailyRhythmQueue/> component — rendered above the existing hero section
--      on the student dashboard when the flag resolves true. When the flag is OFF
--      or absent the component renders null and the dashboard is unchanged
--      (byte-identical to the legacy layout).
--
-- ─── Why it was previously limited to development + staging ─────────────────
-- Wave 1 shipped the DailyRhythmQueue component and the /api/rhythm/today
-- endpoint in late 2026-05 with a deliberate conservative rollout strategy:
--   • Seed migration 20260509120000_pedagogy_v2_wave_1_flags.sql seeded the
--     flag as OFF with target_roles = ARRAY['student'].
--   • Migration 20260615100000_enable_production_flags_local_dev.sql raised it
--     to is_enabled = true but scoped it to
--     target_environments = ARRAY['development', 'staging'] so engineers could
--     exercise the full stack without touching production students.
--
-- ─── Why it is safe to enable globally now ──────────────────────────────────
-- 1. The Pedagogy v2 Wave 1 data layer RPCs (get_due_reviews and
--    get_adaptive_questions) have been live on production for several months.
--    They power the SRS and ZPD subsystems regardless of this flag.
--
-- 2. Both RPCs have defensive fallbacks for students with no SRS history:
--      get_due_reviews()        → returns 0 rows (empty set, not an error)
--      get_adaptive_questions() → falls back to random-by-bloom selection
--    The /api/rhythm/today endpoint handles either gracefully and returns a
--    valid (possibly empty) queue — no 500s, no blank-page crashes.
--
-- 3. <DailyRhythmQueue/> uses SWR with a try/catch fallback: if /api/rhythm/today
--    returns a non-2xx response, the component renders null rather than throwing.
--    The student dashboard is therefore fully backward-compatible.
--
-- 4. The student "Today" dashboard is blocked without this flag. The CEO has
--    approved enabling it globally as a prerequisite for the P1-level onboarding
--    funnel delivering a working first session to every new student in production.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Explicit column list, conflict resolved on (flag_name) — the canonical unique
-- key feature_flags_flag_name_key. Sets target_environments = NULL and
-- target_roles = NULL explicitly in the DO UPDATE clause so the dev/staging
-- restriction left by migration 20260615100000 is cleared. rollout_percentage =
-- 100 with no target scoping → enabled GLOBALLY for ALL tenants on apply.
-- The UPSERT (not a bare UPDATE) is deliberate: safe against a fresh DB where
-- the row does not yet exist, and idempotent on a DB where it does.
--
-- ─── Additive / non-destructive ──────────────────────────────────────────────
-- No DDL. No DROP. No new tables or columns. No schema changes. No RLS impact.
-- feature_flags retains its existing baseline RLS posture. Guarded with
-- IF to_regclass('public.feature_flags') IS NOT NULL so it no-ops cleanly on a
-- fresh DB where the table has not yet been created.
--
-- Owner: architect (flag enablement migration). CEO-approved, 2026-06-20.
-- Added: 2026-06-20
--
-- ─── Rollback (instant, zero-downtime) ───────────────────────────────────────
-- To revert to the previous dev+staging-only state:
--
--   UPDATE feature_flags
--     SET is_enabled          = true,
--         target_environments = ARRAY['development', 'staging'],
--         target_roles        = NULL,
--         rollout_percentage  = 100,
--         updated_at          = now()
--   WHERE flag_name = 'ff_pedagogy_v2_daily_rhythm';
--
-- This is silent on production: the dashboard falls back to the legacy layout
-- and /api/rhythm/today returns 404 — no error surfaces to the student.
-- Alternatively, set is_enabled = false to hard-disable on all environments.

DO $enable_rhythm_global$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Enable ff_pedagogy_v2_daily_rhythm globally.
    -- Row was seeded OFF with target_roles = ARRAY['student'] by
    -- 20260509120000_pedagogy_v2_wave_1_flags.sql, then raised to
    -- is_enabled = true scoped to target_environments = ARRAY['development',
    -- 'staging'] by 20260615100000_enable_production_flags_local_dev.sql.
    -- This UPSERT clears both restrictions so the flag resolves true in
    -- production.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_pedagogy_v2_daily_rhythm', true, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled          = true,
          rollout_percentage  = 100,
          target_environments = NULL,
          target_roles        = NULL,
          updated_at          = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping (fresh DB).';
  END IF;
END $enable_rhythm_global$;
