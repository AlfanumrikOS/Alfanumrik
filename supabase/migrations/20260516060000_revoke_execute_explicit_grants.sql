-- Follow-up to PR #678 (20260516050000_revoke_execute_from_public_corrective.sql).
--
-- Audit finding (2026-05-10, post-#678 deploy): 10 of the 196 functions in #678
-- still showed authenticated/anon EXECUTE = true after the migration applied.
-- Root cause: those 10 were created AFTER Supabase's default ACL was set to
-- explicitly grant EXECUTE to anon/authenticated/service_role. Their proacl is
-- `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}`
-- — note no empty-principal `=X/postgres` entry. So `REVOKE FROM PUBLIC` had
-- nothing to remove for these (PUBLIC was never granted on them at creation).
--
-- This migration revokes from anon and authenticated explicitly. It is a
-- targeted no-op for any of the 10 that are already revoked; idempotent.
--
-- Functions affected (10 — 8 trigger fns from Bucket 5 + 2 orphans):
--
--   Trigger functions (verified via pg_trigger.tgfoid lookup 2026-05-10):
--     fn_onboarding_state_on_profile_created()  -- 3 triggers on students/guardians/teachers
--     fn_populate_subscription_plan_id()         -- trigger on student_subscriptions
--     fn_quiz_response_bkt_update()              -- trigger on quiz_responses
--     fn_quiz_session_bkt_update()               -- trigger on quiz_sessions
--     fn_quiz_session_sync_profile()             -- trigger on quiz_sessions
--     fn_sync_subscription_amount_on_charge()    -- trigger on subscription_events
--     sync_school_admin_role()                   -- trigger on school_admins
--     sync_user_roles_on_insert()                -- 3 triggers on guardians/teachers/students
--
--   Orphans (no triggers, no RLS reference):
--     is_school_admin_of(p_school_id uuid)
--     rls_auto_enable()
--
-- POST-APPLY EXPECTATION: 10 fewer functions executable to authenticated/anon
-- (currently 69 → expected 59). Advisor WARN count drops by ~20 additional
-- (10 fns × 2 roles).
--
-- Service-role bypass: unaffected. Triggers run without EXECUTE check.
--
-- ROLLBACK pattern (per function):
--   GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon, authenticated;
--
-- Reference:
--   docs/superpowers/runbooks/2026-05-10-revoke-from-public-corrective.md (post-mortem section to be appended)

REVOKE EXECUTE ON FUNCTION public.fn_onboarding_state_on_profile_created() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_populate_subscription_plan_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_quiz_response_bkt_update() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_quiz_session_bkt_update() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_quiz_session_sync_profile() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_subscription_amount_on_charge() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_school_admin_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_roles_on_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_school_admin_of(p_school_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
