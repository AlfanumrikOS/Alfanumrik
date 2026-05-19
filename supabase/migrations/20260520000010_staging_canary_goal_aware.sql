-- =============================================================================
-- Migration: 20260520000010_staging_canary_goal_aware.sql
-- Type:      FLAG-STATE CHANGE (not a schema change)
-- Owner:     ops
-- Purpose:   Day-0 staging-only smoke test of ff_goal_aware_selection per the
--            operator runbook seeded in 20260503140000_add_phase2_goal_aware_selection.sql
--
-- Why now:   ~180 question_bank rows with goal-aligned tags now exist
--              (150 from 20260520000006 JEE/NEET/Olympiad + ~30 from
--               20260520000009 CBSE Class-12 board seed)
--            This is below the runbook's "≥500 PYQs" gate for production rollout,
--            but is sufficient to validate that the v2 ranking RPC
--            (get_adaptive_questions_v2) returns non-empty candidate sets on
--            staging traffic during the Day-0 smoke test.
--
-- What this DOES:
--   - Flips ff_goal_aware_selection from (is_enabled=false, rollout_percentage=0)
--     to (is_enabled=true, rollout_percentage=10, target_environments=['staging'])
--   - Narrows target_environments to staging-only so the rollout-percentage hash
--     cannot accidentally route any production traffic to the v2 RPC
--   - Stamps metadata.day_0_canary_at for ops audit
--
-- What this DOES NOT do:
--   - Does NOT enable in production (target_environments excludes 'production')
--   - Does NOT modify schema, RPCs, or any other table
--   - Does NOT override manual operator state (WHERE-guarded; see below)
--
-- Idempotent: YES — re-runs are no-ops because the WHERE filter requires the
--             seed state (is_enabled=false AND rollout_percentage=0). Once
--             flipped, the WHERE clause fails and the UPDATE affects 0 rows.
--
-- Manual-override safety: If an operator has already manually altered the flag
--             (e.g. fully enabled in prod, or rolled back to disabled with a
--             non-zero percentage), the WHERE filter rejects this UPDATE — we
--             never silently override deliberate ops state.
--
-- Rollback (kill switch, any time):
--   UPDATE public.feature_flags
--      SET is_enabled = false, rollout_percentage = 0
--    WHERE flag_name = 'ff_goal_aware_selection';
--
-- Constitution: P14 ops-owned flag operation. Reviewers: architect, testing.
-- =============================================================================

BEGIN;

-- Guarded UPDATE: only flip if the flag is still in its untouched seed state.
UPDATE public.feature_flags
   SET is_enabled          = true,
       rollout_percentage  = 10,
       target_environments = ARRAY['staging']::text[],
       updated_at          = now(),
       metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{day_0_canary_at}',
         to_jsonb(now()::text)
       )
 WHERE flag_name         = 'ff_goal_aware_selection'
   AND is_enabled        = false   -- only flip if STILL DISABLED
   AND rollout_percentage = 0;     -- only flip if STILL AT 0% (seed state)

-- Verification block — observable in supabase migration logs.
DO $verify$
DECLARE
  v_enabled    boolean;
  v_pct        integer;
  v_envs       text[];
BEGIN
  SELECT is_enabled, rollout_percentage, target_environments
    INTO v_enabled, v_pct, v_envs
    FROM public.feature_flags
   WHERE flag_name = 'ff_goal_aware_selection';

  RAISE NOTICE 'ff_goal_aware_selection: is_enabled=%, rollout_percentage=%, target_environments=%',
    v_enabled, v_pct, v_envs;

  IF v_enabled = true
     AND v_pct = 10
     AND v_envs = ARRAY['staging']::text[]
  THEN
    RAISE NOTICE 'PR-4 Day-0 canary IS ACTIVE - 10%% staging goal-aware selection live';
  ELSIF v_enabled = false THEN
    RAISE WARNING 'PR-4 Day-0 canary did NOT activate - flag may have been manually altered; review feature_flags row before retrying';
  END IF;

  IF v_envs IS NOT NULL AND 'production' = ANY(v_envs) THEN
    RAISE WARNING 'PR-4: feature flag is enabled in production - this canary migration intended staging-only; verify intent';
  END IF;
END
$verify$;

COMMIT;

-- =============================================================================
-- NEXT (manual ops actions per 20260503140000 runbook):
--   Day 3 (after 48h of clean staging canary):  rollout_percentage = 25
--   Day 5:                                       rollout_percentage = 50
--   Day 7:                                       rollout_percentage = 100 (still staging-only)
--   Week 2 (after staging is clean for 7d):     extend target_environments to ['production','staging'], rollout_percentage=10
--
-- Kill switch (any time):
--   UPDATE public.feature_flags SET is_enabled=false WHERE flag_name='ff_goal_aware_selection';
-- =============================================================================
