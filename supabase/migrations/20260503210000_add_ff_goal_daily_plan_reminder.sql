-- Migration: 20260503210000_add_ff_goal_daily_plan_reminder.sql
-- Phase 5 of Goal-Adaptive Learning Layers - daily plan reminder cron flag.
-- Pure data seed, idempotent. NO schema changes.
--
-- The flag gates POST /api/cron/goal-daily-plan-reminder. When OFF, the cron
-- returns { sent: 0, reason: "flag_off" } and never reads students or writes
-- notifications.
--
-- Owner: backend (cron) + frontend (notifications display)
-- Added: 2026-05-03

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage,
  metadata
) VALUES (
  'ff_goal_daily_plan_reminder',
  false,
  ARRAY[]::text[],
  ARRAY['production','staging']::text[],
  ARRAY[]::uuid[],
  0,
  jsonb_build_object(
    'description', 'Phase 5 - gates the daily-plan-reminder cron at /api/cron/goal-daily-plan-reminder. When OFF the cron returns sent:0 and never reads students or writes notifications. When ON it reads all active students with academic_goal IS NOT NULL, builds a per-student bilingual daily-plan reminder (delivery_channel=in_app), and bulk-inserts to the notifications table with daily idempotency.',
    'owner', 'backend+frontend',
    'added', '2026-05-03',
    'phase', '5',
    'rollout_strategy', 'enable on staging via super-admin Flags first; verify a test student receives an in-app notification matching their goal; then ramp on prod 10/25/50/100 over the week',
    'kill_switch', 'set is_enabled=false to instantly stop new reminders; existing already-sent notifications stay (idempotent UTC-day check prevents re-send)'
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
   WHERE flag_name = 'ff_goal_daily_plan_reminder';
  IF v_count = 0 THEN
    RAISE WARNING 'Phase 5: ff_goal_daily_plan_reminder flag NOT seeded - investigate.';
  ELSE
    SELECT is_enabled INTO v_enabled
      FROM public.feature_flags
     WHERE flag_name = 'ff_goal_daily_plan_reminder';
    RAISE NOTICE 'Phase 5: ff_goal_daily_plan_reminder present count=% is_enabled=%', v_count, v_enabled;
    IF v_enabled THEN
      RAISE WARNING 'Phase 5: ff_goal_daily_plan_reminder is ENABLED - intent was OFF, verify.';
    END IF;
  END IF;
END $verify$;
