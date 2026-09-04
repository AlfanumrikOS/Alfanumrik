-- 20260904160000_p0_revoke_public_execute_expire_abandoned_checkouts.sql
--
-- P0 follow-up: revoke the default PUBLIC EXECUTE grant on
-- expire_abandoned_checkout_attempts(), the same bug class the 2026-09-02
-- launch audit's P0-1 sweep (waves 1-3, PRs #1700-#1703) existed to close --
-- a SECURITY DEFINER function is born with EXECUTE granted to PUBLIC unless
-- explicitly revoked, and PUBLIC is a pseudo-role every other role
-- (including anon/authenticated) implicitly inherits from, so a
-- `REVOKE ... FROM anon, authenticated` alone is a silent no-op (the exact
-- self-caught bug from wave 1's urgent correction).
--
-- This function was created AFTER the P0-1 sweep completed -- migration
-- 20260903090000_expire_abandoned_checkout_attempts.sql, part of this
-- session's own P11 alert-storm fix (PR #1724, 2026-09-03) -- so it was
-- never covered by that sweep and slipped through with the default grant.
-- Live-verified (2026-09-04 audit status re-check): anon and authenticated
-- can both currently EXECUTE it directly via PostgREST.
--
-- Severity: low. The function takes no parameters and performs a single,
-- idempotent, bounded action (move 'pending' checkout rows older than 72h
-- to a terminal status) -- there's no ownership/IDOR angle, since it does
-- not accept or scope by any caller-supplied ID. The only real exposure is
-- an unauthenticated caller being able to trigger that housekeeping pass
-- early/repeatedly, which is a nuisance, not a data or funds risk. Still
-- being closed on the same "any SECURITY DEFINER function must not carry
-- the default PUBLIC grant" principle as the rest of the P0-1 sweep.
--
-- Sole caller is apps/host/src/app/api/cron/expire-abandoned-checkouts/
-- route.ts via getSupabaseAdmin() (service_role) -- no authenticated-user
-- call path exists anywhere in the codebase (grepped before writing this).
-- Restricting to service_role only, matching the exact precedent set by
-- generate_exam_paper/generate_student_notifications in
-- 20260816000003_reinstantiate_secdef_guards_corrected.sql.

BEGIN;

REVOKE ALL ON FUNCTION public.expire_abandoned_checkout_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_abandoned_checkout_attempts() TO service_role;

COMMENT ON FUNCTION public.expire_abandoned_checkout_attempts() IS
  'Moves abandoned (>72h pending, no razorpay_payment_id) checkout rows to a terminal status. service_role only -- called exclusively by the /api/cron/expire-abandoned-checkouts route via the admin client. PUBLIC EXECUTE revoked 2026-09-04 (P0 follow-up; this function was created 2026-09-03, after the original P0-1 sweep, and was never covered by it).';

COMMIT;
