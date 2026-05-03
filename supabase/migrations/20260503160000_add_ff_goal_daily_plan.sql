-- Migration: 20260503160000_add_ff_goal_daily_plan.sql
-- Phase 3 of Goal-Adaptive Learning Layers.
-- Seeds ONE feature flag, ff_goal_daily_plan, as DISABLED on prod + staging.
-- No schema changes. Pure data seed, fully idempotent.
--
-- Owner: backend (API) + frontend (UI) + assessment (rules)
-- Added: 2026-05-03
--
-- Rollback: UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_goal_daily_plan';
-- Or full delete: DELETE FROM feature_flags WHERE flag_name = 'ff_goal_daily_plan';
-- The application returns empty plan / null UI when the flag is missing,
-- so deletion is silent on the student experience.
--
-- Operator runbook (post-deploy):
--   1. Enable on staging only via super-admin Flags console.
--   2. Smoke test: log in as a staging student with academic_goal set,
--      hit /api/student/daily-plan, verify items match buildDailyPlanByCode.
--   3. Promote to prod with rollout_percentage 10 -> 25 -> 50 -> 100.
--   4. Kill switch: set is_enabled=false; in-process flag cache TTL is 5 min.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage,
  metadata
) VALUES (
  'ff_goal_daily_plan',
  false,
  ARRAY[]::text[],
  ARRAY['production','staging']::text[],
  ARRAY[]::uuid[],
  0,
  jsonb_build_object(
    'description', 'Phase 3 - gates goal-adaptive Daily Plan dashboard card AND /api/student/daily-plan API. When OFF, API returns empty plan and card renders nothing. Default OFF preserves byte-identical legacy dashboard behavior.',
    'owner', 'backend+frontend+assessment',
    'added', '2026-05-03',
    'phase', '3',
    'rollout_strategy', 'start at 0 percent, enable on staging via super-admin first, ramp 10/25/50/100 across one week',
    'kill_switch', 'set is_enabled=false to instantly revert; API returns empty plan + card renders null'
  )
)
ON CONFLICT (flag_name) DO NOTHING;

DO $verify$
DECLARE
  v_count   integer;
  v_enabled boolean;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.feature_flags
   WHERE flag_name = 'ff_goal_daily_plan';

  IF v_count = 0 THEN
    RAISE WARNING 'Phase 3: ff_goal_daily_plan flag NOT seeded - investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_goal_daily_plan';
    RAISE NOTICE 'Phase 3: ff_goal_daily_plan present count=% is_enabled=%', v_count, v_enabled;

    IF v_enabled THEN
      RAISE WARNING 'Phase 3: ff_goal_daily_plan is ENABLED - intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
