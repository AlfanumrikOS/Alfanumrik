-- ============================================================================
-- Migration: 20260528000004_demo_account_purge_cron.sql
-- Phase F.4 (Super-Admin Production-Readiness Plan, 2026-05-17)
--
-- Purpose: Auto-purge demo accounts older than 30 days so the operator
-- doesn't have to track them manually. Mirrors the data-erasure-purger
-- pattern (see daily-cron + data-erasure-purger Edge Functions). Operates
-- only on rows flagged is_demo=true — never touches real customer data.
--
-- Sequence per demo account being purged:
--   1. delete student_subscriptions / school_subscriptions with is_demo=true
--      tied to the account's auth user (and its school, if school_admin)
--   2. delete demo_seed_data rows
--   3. clear is_demo on the profile row, then delete the profile row
--   4. delete the demo_accounts registry row
--   5. Note: deleting the auth.users row is left to the Edge Function (only
--      it has the admin API key); this migration prepares the queue.
-- ============================================================================

-- 1. Function to purge a single expired demo account by id
CREATE OR REPLACE FUNCTION purge_demo_account_by_id(p_demo_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account   RECORD;
  v_auth_uid  UUID;
  v_school_id UUID;
  v_steps     JSONB := '{}'::JSONB;
BEGIN
  SELECT * INTO v_account FROM demo_accounts WHERE id = p_demo_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  v_auth_uid  := v_account.auth_user_id;
  v_school_id := v_account.school_id;

  -- 1. Subscriptions
  DELETE FROM student_subscriptions
    WHERE is_demo = true
      AND student_id IN (SELECT id FROM students WHERE auth_user_id = v_auth_uid);
  IF v_school_id IS NOT NULL THEN
    DELETE FROM student_subscriptions
      WHERE is_demo = true
        AND student_id IN (SELECT id FROM students WHERE school_id = v_school_id);
    DELETE FROM school_subscriptions
      WHERE is_demo = true AND school_id = v_school_id;
  END IF;
  v_steps := jsonb_set(v_steps, '{subscriptions_deleted}', to_jsonb(true));

  -- 2. Seed data (cascades from FK but be explicit so we can audit)
  DELETE FROM demo_seed_data WHERE demo_account_id = p_demo_account_id;
  v_steps := jsonb_set(v_steps, '{seed_data_deleted}', to_jsonb(true));

  -- 3. Profile row(s)
  IF v_account.role = 'student' THEN
    DELETE FROM students WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'teacher' THEN
    DELETE FROM teachers WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'parent' THEN
    DELETE FROM guardian_student_links WHERE guardian_id IN (
      SELECT id FROM guardians WHERE auth_user_id = v_auth_uid AND is_demo = true
    );
    DELETE FROM guardians WHERE auth_user_id = v_auth_uid AND is_demo = true;
  ELSIF v_account.role = 'school_admin' THEN
    DELETE FROM students WHERE school_id = v_school_id AND is_demo = true;
    DELETE FROM school_admins WHERE auth_user_id = v_auth_uid AND is_demo = true;
    DELETE FROM schools WHERE id = v_school_id AND is_demo = true;
  ELSIF v_account.role = 'super_admin' THEN
    DELETE FROM admin_users WHERE auth_user_id = v_auth_uid AND is_demo = true;
  END IF;
  v_steps := jsonb_set(v_steps, '{profile_deleted}', to_jsonb(true));

  -- 4. Registry row
  DELETE FROM demo_accounts WHERE id = p_demo_account_id;
  v_steps := jsonb_set(v_steps, '{registry_deleted}', to_jsonb(true));

  -- 5. Auth user row deletion is left to the Edge Function (admin API key).
  --    Surface the auth_user_id so the function knows what to delete.
  RETURN jsonb_build_object(
    'success', true,
    'role', v_account.role,
    'auth_user_id', v_auth_uid,
    'school_id', v_school_id,
    'steps', v_steps
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_demo_account_by_id(UUID) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purge_demo_account_by_id(UUID) TO service_role;

-- 2. View: demo accounts that should be purged today (>30d old, inactive OR
--    explicitly marked for purge). Edge Function reads this view, then calls
--    purge_demo_account_by_id() for each, then deletes the auth user.
CREATE OR REPLACE VIEW demo_accounts_due_for_purge AS
SELECT
  id,
  auth_user_id,
  role,
  school_id,
  email,
  created_at,
  last_reset_at
FROM demo_accounts
WHERE
  created_at < (now() - interval '30 days')
ORDER BY created_at ASC;

COMMENT ON VIEW demo_accounts_due_for_purge IS
  'Demo accounts older than 30 days that the purge cron should clean up. '
  'Read by the demo-account-purger Edge Function (scheduled via pg_cron, '
  'configured separately so the Function has the auth-admin key to delete '
  'auth.users rows that this view cannot touch from SQL).';

-- 3. pg_cron schedule entry (commented — operator runs manually after
--    confirming the Edge Function is deployed). Keeping the SQL here so the
--    schedule lives next to the function it triggers.
--
-- SELECT cron.schedule(
--   'demo-account-purge-daily',
--   '0 3 * * *',  -- 03:00 UTC daily, off-peak for India
--   $$SELECT net.http_post(
--       url := current_setting('app.settings.edge_functions_url') || '/demo-account-purger',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
--       )
--     )$$
-- );
