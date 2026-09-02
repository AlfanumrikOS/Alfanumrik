-- URGENT CORRECTION to migration 20260902135520 (P0-1/P0-2 lockdown, merged
-- and deployed minutes ago). That migration revoked EXECUTE from the named
-- roles `anon` and `authenticated` on 20 functions. Live re-verification
-- immediately after deploy found 13 of those 20 STILL anon/authenticated-
-- executable:
--
--   SELECT proname, proacl FROM pg_proc WHERE proname = 'bootstrap_user_profile';
--   -> proacl = {=X/postgres,postgres=X/postgres,service_role=X/postgres}
--
-- ROOT CAUSE: the `=X/postgres` entry (empty grantee name before `=`) is
-- Postgres's representation of a grant to the pseudo-role PUBLIC. Every
-- role — including anon and authenticated — implicitly holds whatever
-- PUBLIC holds, with NO way to opt a specific role out of a PUBLIC grant.
-- `REVOKE EXECUTE ... FROM anon, authenticated` only removes an EXPLICIT
-- named grant to those roles; it is a complete no-op against a PUBLIC
-- grant, which is exactly how Postgres grants EXECUTE on every new
-- function by default (`CREATE FUNCTION` implicitly does
-- `GRANT EXECUTE ... TO PUBLIC` unless default privileges say otherwise).
-- 13 of the 20 targets in 20260902135520 had never received a NAMED grant
-- to anon/authenticated at all — they relied solely on the PUBLIC default —
-- so the previous migration's REVOKE statements executed successfully but
-- revoked a grant path that didn't exist, leaving the real (PUBLIC) grant
-- fully intact.
--
-- LIVE-CONFIRMED exploitable post-"fix", with only the public anon key:
--   POST /rest/v1/rpc/calculate_cohort_bkt_mastery
--     {"p_student_ids":["0000…0001"]} -> HTTP 200 (should have been 401)
--
-- Of the 20 original targets, 7 were genuinely fixed (their grant was a
-- named anon/authenticated entry, which REVOKE correctly stripped, leaving
-- only postgres+service_role): get_connection_stats, get_slow_functions_
-- stats, get_table_sizes, security_reserve_quota, security_settle_quota,
-- security_update_circuit_state, security_write_request_audit,
-- tutor_commit_attempt. The remaining 13 are corrected below.
--
-- SEVERITY NOTE: bootstrap_user_profile (P0-2 — self-provision as an
-- arbitrary school's institution_admin) was among the 13 still-open ones.
-- This correction is the actual close of P0-2, not the previous migration.
--
-- FIX: `REVOKE ... FROM PUBLIC` removes the PUBLIC grant entry itself,
-- which is the only way to close this. Three of the 13
-- (generate_weekly_study_plan, get_activity_timeline, get_progress_report)
-- ALSO carry an explicit `authenticated=X` grant alongside PUBLIC — that
-- explicit grant is untouched by REVOKE FROM PUBLIC, which is exactly the
-- desired outcome for those three (authenticated access is intentional;
-- only the anon-reachable PUBLIC path needs to go). The other 10 have no
-- named grant at all beyond PUBLIC, so REVOKE FROM PUBLIC alone locks them
-- to postgres+service_role, matching the original intent of 20260902135520.
--
-- Also hardens the default going forward: new functions created by the
-- migration-runner role no longer default to PUBLIC EXECUTE, so this exact
-- gap class cannot recur silently for a function created after this point
-- (an explicit GRANT is then required, which is self-documenting in the
-- migration that creates it).

REVOKE EXECUTE ON FUNCTION public.bootstrap_user_profile               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_cohort_bkt_mastery         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.foxy_create_pending_assistant_message FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.foxy_fail_assistant_message          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.foxy_finalize_assistant_message      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_weekly_study_plan           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_activity_timeline                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cohort_bkt_mastery_by_student    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_foxy_session           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_progress_report                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_foxy_message_atomic           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_learner_state_post_quiz       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_adaptive_intervention         FROM PUBLIC;

-- Forward-hardening: stop granting EXECUTE to PUBLIC by default for new
-- functions created by the migration-runner role. Every function created
-- in this repo's migrations to date was created by `postgres` (confirmed:
-- every proacl checked in this investigation shows `postgres=X/postgres`
-- as owner/granter). This does not retroactively change any existing
-- function's grants — only functions created AFTER this statement runs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
