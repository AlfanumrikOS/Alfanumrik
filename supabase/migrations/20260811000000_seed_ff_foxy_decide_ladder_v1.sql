-- Migration: 20260811000000_seed_ff_foxy_decide_ladder_v1.sql
-- Purpose: Foxy North-Star Phase 4 — seed the feature flag
--   `ff_foxy_decide_ladder_v1` (default OFF / 0%) so the "decide ladder"
--   (structured next-action selection over the learner-model thresholds
--   in packages/lib/src/learner-model/{thresholds,next-action}.ts) is
--   auditable + flippable from the super-admin console before any code
--   consumes it.
--
--   ff_foxy_decide_ladder_v1
--     Gates the replacement of the current hand-rolled decision tree inside
--     the Foxy Next.js route (apps/host/src/app/api/foxy/route.ts) with the
--     assessment-owned learner-model ladder (thresholds -> next-action).
--     OFF (this seed) = today's behavior, byte-for-byte. The consuming
--     TS edit is owned by ai-engineer and lands in a paired PR; this seed
--     only makes the row exist so ops/CEO can ramp it independently of the
--     code diff.
--
-- Default-OFF contract: is_enabled = FALSE, rollout_percentage = 0 — both
-- independently guarantee the no-op seed state. Idempotent (ON CONFLICT DO
-- NOTHING), to_regclass-guarded. Pure data seed — no schema change, no new
-- table, RLS N/A. Owner: architect. Reviewers (P14): assessment (ladder
-- authorship), ai-engineer (consumer), ops, testing. Added: 2026-08-05.
--
-- Reversible (manual DOWN):
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_decide_ladder_v1';
-- A missing flag row resolves the same as is_enabled = false (ladder off).

DO $ff_foxy_decide_ladder_v1$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_decide_ladder_v1', false, 0,
      'Foxy North-Star Phase 4: gates the assessment-owned learner-model decide ladder (packages/lib/src/learner-model/{thresholds,next-action}.ts) replacing the hand-rolled decision tree in apps/host/src/app/api/foxy/route.ts. OFF = current tree unchanged. Default OFF; ops/CEO own the ramp.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_decide_ladder_v1 seed (fresh DB).';
  END IF;
END $ff_foxy_decide_ladder_v1$;
