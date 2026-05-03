-- Fix admin_users RLS: add non-circular self-read policy
--
-- The existing admin_users_select policy is circular:
--   auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
-- This requires reading admin_users to prove you can read admin_users.
-- When SUPABASE_SERVICE_ROLE_KEY is correctly configured, the service_role
-- policy bypasses this. But if the key is misconfigured (e.g., anon key),
-- no authenticated user can read their own record.
--
-- This policy allows any authenticated user to read ONLY their own row,
-- breaking the circular dependency while maintaining security.

CREATE POLICY IF NOT EXISTS admin_users_select_own ON admin_users
  FOR SELECT TO authenticated
  USING (auth.uid() = auth_user_id);
