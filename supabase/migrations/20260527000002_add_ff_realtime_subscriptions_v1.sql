-- Migration: 20260527000002_add_ff_realtime_subscriptions_v1.sql
-- Phase C.6 of the prod-readiness plan.
-- Seeds ONE feature flag, ff_realtime_subscriptions_v1, as DISABLED on prod + staging.
-- No schema changes. Pure data seed, fully idempotent.
--
-- Owner: frontend (dashboards) + backend (realtime publication)
-- Added: 2026-05-27
--
-- WHAT IT GATES
--   Three Supabase Realtime postgres_changes subscriptions wired in
--   src/hooks/useRealtimeRevalidator.ts and consumed by:
--     1. src/app/teacher/page.tsx (heatmap)        — student_learning_profiles UPDATE
--     2. src/app/teacher/page.tsx PollTab          — classroom_poll_responses INSERT
--     3. src/app/parent/page.tsx Dashboard         — student_learning_profiles UPDATE
--   When the flag is OFF, the hook short-circuits and no subscription is
--   created. Behavior is byte-identical to the previous polling-only path.
--
-- IMPORTANT PRECONDITION
--   The Supabase Realtime publication `supabase_realtime` on prod currently
--   contains ZERO tables. A separate migration MUST run before this flag
--   can be flipped on, to ALTER PUBLICATION supabase_realtime ADD TABLE
--   student_learning_profiles, classroom_poll_responses. That migration is
--   scoped to a follow-up PR (Phase C.6.1).
--
-- Rollback: UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_realtime_subscriptions_v1';
-- Or full delete: DELETE FROM feature_flags WHERE flag_name = 'ff_realtime_subscriptions_v1';
-- The hook short-circuits on missing flag, so deletion is silent.

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage,
  metadata
) VALUES (
  'ff_realtime_subscriptions_v1',
  false,
  ARRAY[]::text[],
  ARRAY['production','staging']::text[],
  ARRAY[]::uuid[],
  0,
  jsonb_build_object(
    'description', 'Phase C.6 - gates Supabase Realtime postgres_changes subscriptions on teacher heatmap, teacher polls, and parent child-progress dashboards. When OFF, dashboards fall back to existing fetch-on-focus polling. Default OFF; per-tenant opt-in via target_institutions.',
    'owner', 'frontend+backend',
    'added', '2026-05-27',
    'phase', 'C.6',
    'rollout_strategy', 'enable on 1-2 pilot tenants via target_institutions first; verify supabase_realtime publication includes student_learning_profiles + classroom_poll_responses before flipping; ramp to all tenants once stable',
    'kill_switch', 'set is_enabled=false to instantly revert; in-process flag cache TTL is 5 min',
    'precondition', 'supabase_realtime publication must include student_learning_profiles + classroom_poll_responses; verify with: SELECT tablename FROM pg_publication_tables WHERE pubname = supabase_realtime'
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
   WHERE flag_name = 'ff_realtime_subscriptions_v1';

  IF v_count = 0 THEN
    RAISE WARNING 'Phase C.6: ff_realtime_subscriptions_v1 flag NOT seeded - investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_realtime_subscriptions_v1';
    RAISE NOTICE 'Phase C.6: ff_realtime_subscriptions_v1 present count=% is_enabled=%', v_count, v_enabled;

    IF v_enabled THEN
      RAISE WARNING 'Phase C.6: ff_realtime_subscriptions_v1 is ENABLED - intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
