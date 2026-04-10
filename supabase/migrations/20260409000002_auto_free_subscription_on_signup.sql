-- Migration: 20260409000002_auto_free_subscription_on_signup.sql
-- Purpose: Auto-insert a free-plan student_subscriptions row whenever a new
--          student row is created, guaranteeing every account has a subscription
--          record from the moment of signup.
--
-- SECURITY DEFINER justification: the trigger fires in the context of the
-- INSERT caller (typically the bootstrap_user_profile RPC or the auth
-- callback, both of which use the anon/service role). The function must write
-- to student_subscriptions on behalf of the new student record before that
-- student's RLS policies are evaluated. Without SECURITY DEFINER the INSERT
-- would fail for anon-role callers who do not yet own the row.
-- search_path is pinned to public to prevent search-path injection.

CREATE OR REPLACE FUNCTION auto_create_free_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  -- Look up the canonical 'free' plan.  If the plan doesn't exist yet
  -- (e.g., during a fresh seed), skip silently rather than aborting the
  -- student INSERT — the subscription can be back-filled by the cron job.
  SELECT id INTO v_plan_id
    FROM subscription_plans
    WHERE plan_code = 'free'
      AND is_active = true
    LIMIT 1;

  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO student_subscriptions (
    student_id,
    plan_id,
    plan_code,
    status,
    billing_cycle,
    current_period_start,
    current_period_end
  ) VALUES (
    NEW.id,
    v_plan_id,
    'free',
    'active',
    'free',
    now(),
    now() + INTERVAL '100 years'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop before (re)creating so the migration is idempotent on re-runs.
DROP TRIGGER IF EXISTS trg_auto_free_subscription ON students;

CREATE TRIGGER trg_auto_free_subscription
  AFTER INSERT ON students
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_free_subscription();

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: after applying, insert a test student and check the subscription row.
--
-- SELECT trigger_name, event_manipulation, action_timing
--   FROM information_schema.triggers
--   WHERE event_object_table = 'students'
--     AND trigger_name = 'trg_auto_free_subscription';
-- Expected: 1 row (AFTER INSERT)
-- ─────────────────────────────────────────────────────────────────────────────
