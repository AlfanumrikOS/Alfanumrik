-- Migration: 20260809000000_seed_ff_irt_shadow_v1.sql
-- Purpose: Foxy North-Star Phase 3 (CEO-approved A2) — seed the feature flag
--   `ff_irt_shadow_v1` (default OFF / 0%) so the IRT SHADOW evaluation lane
--   is auditable + flippable from the super-admin console before any code
--   consumes it.
--
--   ff_irt_shadow_v1
--     Gates the shadow-mode comparison lane for select_questions_by_irt_info_v2
--     (companion migration 20260809000100): when ON, the server-side selector
--     path ADDITIONALLY runs the v2 IRT selector and logs what it WOULD have
--     served next to what the production path actually served — zero
--     student-visible behavior change by design. Ramp decision and the
--     eventual promotion to `ff_irt_question_selection` live with ops/CEO
--     after the shadow evaluation gate passes.
--
-- Enablement criteria (mirrors the 20260805100300 protected-reason style):
--   Calibration runs nightly (irt-calibrate cron). Enable ff_irt_shadow_v1
--   only to START collecting shadow comparisons; enable the serving flag
--   ff_irt_question_selection only after the Phase-3 shadow evaluation gate
--   passes (see docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-
--   design.md, E2) — cohort rollout with kill switch.
--
-- NOT registered in protected_feature_flags here: protected-tier registration
--   requires the paired TS PROTECTED_FLAGS entry + count-pin/test edits in the
--   SAME change (see 20260803120001's OBLIGATION block); those files are
--   outside architect ownership. A shadow flag is read-only telemetry (no
--   student-facing behavior), so the base default-OFF seed is the correct
--   posture; protect it in a paired DB+TS change if/when CEO wants the
--   DB-trigger guard.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0 — both
-- independently guarantee the no-op seed state. Idempotent (ON CONFLICT DO
-- NOTHING), to_regclass-guarded. Pure data seed — no schema change, no new
-- table, RLS N/A. Owner: architect. Reviewers (P14): ai-engineer, ops,
-- testing, quality. Added: 2026-08-05.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_irt_shadow_v1';
-- A missing flag row resolves the same as is_enabled = false (shadow lane off).

DO $ff_irt_shadow_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_irt_shadow_v1', false, 0,
      'Foxy North-Star Phase 3: shadow-mode evaluation lane for select_questions_by_irt_info_v2 (20260809000100). When ON, the selector path additionally logs what the IRT v2 selector WOULD have served — no student-visible change. Enable only to start collecting shadow comparisons; the serving flag ff_irt_question_selection stays gated on the Phase-3 shadow evaluation gate (spec 2026-08-05-foxy-north-star-alignment-design.md, E2). Default OFF; ops/CEO own the ramp.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_irt_shadow_v1 seed (fresh DB).';
  END IF;
END $ff_irt_shadow_v1$;
