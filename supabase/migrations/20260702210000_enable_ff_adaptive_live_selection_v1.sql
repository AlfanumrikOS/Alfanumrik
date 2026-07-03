-- Migration: 20260702210000_enable_ff_adaptive_live_selection_v1.sql
-- Purpose: Flip `ff_adaptive_live_selection_v1` ON at rollout 100 — the Phase 2
--          adaptive-loop live quiz candidate provider.
--
-- Context (2026-07-02 forensic audit of the adaptive pipeline): the corrected
-- client-side adaptive selection module (src/lib/adaptive/select-adaptive-questions.ts
-- — canonical mastery_probability, Bloom ceiling, IRT-proxy ranking) is wired
-- into getQuizQuestionsV2 (src/lib/supabase.ts) behind this flag, which was
-- seeded OFF / 0% by 20260622090000_seed_ff_adaptive_live_selection_v1.sql.
-- The provider is layered IN FRONT of the existing fallback ladder — it never
-- replaces it and never hard-filters (assembleQuiz tops up to the exact
-- requested count and re-validates every row, so the P6 count/quality
-- guarantees hold), and any provider error falls straight through to the
-- unchanged ladder. Companion fix 20260702200000 repairs the
-- get_adaptive_questions SRS due-review predicate in the same batch.
--
-- Rollback:
--   UPDATE public.feature_flags
--      SET is_enabled = FALSE, rollout_percentage = 0, updated_at = now()
--    WHERE flag_name = 'ff_adaptive_live_selection_v1';
--
-- Pattern: mirrors 20260624100000_enable_engagement_flags_phase1.sql /
-- 20260620001601_enable_latest_frontend_flags.sql (idempotent UPSERT with the
-- explicit REG-125-conformant column list — flag_name/is_enabled, never
-- name/enabled). On environments where the 20260622090000 seed already ran
-- (all deployed envs — it sorts before this file on fresh DBs too), the
-- ON CONFLICT DO UPDATE flips the existing row and preserves its description.
-- Additive. Idempotent. Replayable. No DDL. No new tables. RLS not affected.
-- Guarded with IF to_regclass so it no-ops on a fresh DB without feature_flags.
-- Owner: architect.

DO $$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- Adaptive live selection — weak-topic-targeted candidate provider in
    -- front of the getQuizQuestionsV2 fallback ladder.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_adaptive_live_selection_v1', TRUE, 100,
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled = TRUE, rollout_percentage = 100, updated_at = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_adaptive_live_selection_v1 enablement (fresh DB).';
  END IF;
END $$;
