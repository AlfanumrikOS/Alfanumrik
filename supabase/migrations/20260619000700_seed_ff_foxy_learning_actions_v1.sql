-- Migration: 20260619000700_seed_ff_foxy_learning_actions_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_learning_actions_v1` (Foxy Post-Answer
--          Learning Actions, Phase 1) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console. Default
--          OFF / 0%.
--
--   ff_foxy_learning_actions_v1
--     When ON: the Foxy ChatBubble post-answer action bar renders the
--     learning-action row (Got it / Explain simpler / Show example / Quiz me on
--     this) + an overflow menu (Save to notebook / Read aloud / Report an issue
--     — single report path), replacing the legacy QA-tester chrome (thumbs +
--     dual report + vague "Save"). The repurposed actions reuse the existing
--     record_message_feedback RPC (Got it -> is_up=true; Explain simpler ->
--     is_up=false) and the existing student_bookmarks table (Save to notebook),
--     and publish a new learner.learning_action event. Self-reported signals do
--     NOT mutate BKT mastery_mean (P2 / learner-state); only real "Quiz me"
--     answers feed mastery via the existing concept-check/BKT path.
--     When OFF: the ChatBubble renders BYTE-IDENTICALLY to today — the legacy
--     action bar is shown, no learning-action route is exercised, and no new
--     event kind is published. This is the front-bar redesign gate ONLY; the
--     four dormant continuity/memory flags (ff_foxy_session_reactivate_v1,
--     ff_foxy_pending_expectations_v1, ff_foxy_long_memory_v1,
--     ff_foxy_context_rich_v1) ramp INDEPENDENTLY in Phase 2 and are NOT
--     touched by this flag.
--
-- Plan: Foxy AI Tutor — The Moat (Round 1: Post-Answer Learning Actions +
--       Living Memory), Phase 1 ("New action bar behind
--       ff_foxy_learning_actions_v1 (OFF)"). Per CEO "use recommendations": no
--       P1-P13 change, so no CEO approval gate; standard domain sign-offs apply
--       (assessment / architect / ai-engineer / frontend / backend / testing).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the redesigned bar
-- stays OFF until an operator explicitly flips this flag via the super-admin
-- console (or, for local dev, the documented local-dev seeder — see footer).
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (the ChatBubble
-- renders byte-identically to today while the flag resolves OFF).
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260619000600_seed_ff_adaptive_loops_bc_v1.sql and
-- 20260619000100_seed_ff_school_pulse_v1.sql for the defensive to_regclass guard
-- + explicit column list + audit description). The canonical feature_flags
-- columns are `flag_name` (UNIQUE) + `is_enabled` — NOT `name`/`enabled`
-- (baseline 00000000000000_baseline_from_prod.sql:11212-11230;
-- feature_flags_flag_name_key UNIQUE). The explicit column list (flag_name
-- first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125 (canonical
-- feature_flags shape; never DO UPDATE — so a pre-existing operator-set state is
-- preserved on re-run). Scoping arrays are left NULL (no role/env/institution
-- narrowing) — the global is_enabled=false / rollout=0 double gate is what holds
-- the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed.
--
-- ─── No new table (event-first) ───────────────────────────────────────────────
-- Phase 1 adds NO new table. The data model is event-first: the new
-- learner.learning_action event (registry + Zod, P13: IDs + enums only, no free
-- text) is published into the existing state_events stream, and the two existing
-- tables are REPURPOSED, not created:
--   - foxy_message_feedback (20260508230000_foxy_message_feedback.sql) — RLS on,
--     student-own SELECT + service-role write; reused via record_message_feedback.
--   - student_bookmarks (baseline 00000000000000_baseline_from_prod.sql:13648) —
--     RLS on (bookmarks_own + service_all_student_bookmarks); reused by
--     "Save to notebook".
-- No new tables → RLS N/A for this migration; both reused tables keep their
-- existing RLS posture.
--
-- Owner: architect (this seed) + frontend (action-bar gate wiring against this
--        exact flag name) + backend (/api/foxy/learning-action route + event
--        publish) + ai-engineer (simplify/example directives, Quiz me oracle
--        gate) + assessment (self-report must NOT corrupt BKT) — all in parallel.
-- Added: 2026-06-14
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_learning_actions_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (the ChatBubble falls back to the legacy bar).

DO $foxy_learning_actions$
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
      'ff_foxy_learning_actions_v1',
      false,
      0,
      'Foxy Post-Answer Learning Actions (Phase 1): replaces the ChatBubble QA-tester action bar (thumbs + dual report + vague Save) with a learning-action row (Got it / Explain simpler / Show example / Quiz me on this) + a single-path overflow menu (Save to notebook / Read aloud / Report an issue). Got it -> is_up=true and Explain simpler -> is_up=false via the existing record_message_feedback RPC; Save to notebook reuses student_bookmarks; publishes the new learner.learning_action event (IDs + enums only). Self-reports do NOT mutate BKT mastery_mean (P2); only real Quiz me answers feed mastery via the concept-check path. OFF = ChatBubble byte-identical to today (legacy bar). Front-bar redesign gate ONLY; the four continuity/memory flags ramp independently in Phase 2. Default off. Plan: Foxy AI Tutor — The Moat (Round 1), Phase 1.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_learning_actions_v1 seed (fresh DB).';
  END IF;
END $foxy_learning_actions$;
