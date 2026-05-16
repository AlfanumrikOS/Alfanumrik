-- Phase D.4 — 2FA (OTP) on the guardian↔student link-code redemption flow.
--
-- Today the link-code flow only checks the HMAC-signed code + that the
-- redeeming user is signed in. A leaked code lets anyone with a fake account
-- attach themselves to a student. This migration adds a one-time-password
-- challenge that the guardian must satisfy before the actual
-- guardian_student_links row is created.
--
-- Lifecycle (enforced in the API routes that write to this table):
--   1. POST /api/parent/link-code/request-otp  → insert a fresh row.
--   2. POST /api/parent/link-code/redeem       → look up by `id`, verify the
--      `otp_hash` in constant time, then delete the row on success.
--
-- After 5 failed verify attempts, `locked_until` is stamped one hour in the
-- future and the row stays put until the lock expires (or operators clean it
-- up). Per-row lockout — not per-IP — because rate-limiting collapses on
-- shared NAT and we want a deterministic ceiling per challenge.
--
-- Storage rules:
--   • `otp_hash` is sha256(otp || salt) hex, where the salt is the row id.
--     We never store the OTP plaintext. The route layer also never logs it.
--   • Only the service role reads or writes. RLS is enabled, no policies
--     are added — that revokes anon/authenticated access by default.

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."link_code_otp_challenges" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- We bind by both the immutable link-code string (so the rate-limit /
    -- lock survives any link-code → link mapping changes) and the auth user
    -- attempting redemption, so a second guardian's challenge can't collide
    -- with the first.
    "link_code"      text NOT NULL,
    "auth_user_id"   uuid NOT NULL,
    -- The student we resolved from the link code at request-otp time. Stored
    -- so the redeem route can audit who the OTP was for even after the link
    -- has been created and the challenge row deleted (via auth_audit_log).
    "student_id"     uuid,
    -- sha256(otp || id) hex. 64 chars.
    "otp_hash"       text NOT NULL,
    "expires_at"     timestamptz NOT NULL,
    "attempt_count"  integer NOT NULL DEFAULT 0,
    "locked_until"   timestamptz,
    "created_at"     timestamptz NOT NULL DEFAULT now()
);

-- Lookup-by-code path (the hot read on every verify): we always filter on
-- (link_code, auth_user_id, expires_at > now()), so a btree on link_code +
-- expires_at gives us the smallest practical index for the access pattern.
CREATE INDEX IF NOT EXISTS "idx_link_code_otp_challenges_link_expires"
    ON "public"."link_code_otp_challenges" ("link_code", "expires_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_link_code_otp_challenges_auth_user"
    ON "public"."link_code_otp_challenges" ("auth_user_id");

-- RLS: deny-by-default. No policies = no access from anon/authenticated.
-- Reads and writes happen exclusively from API routes using the service-role
-- client (bypasses RLS). Future cleanup cron likewise uses service role.
ALTER TABLE "public"."link_code_otp_challenges" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."link_code_otp_challenges" IS
  'Phase D.4: short-lived OTP challenges gating link-code redemption. Service-role only.';

-- Janitor: a same-(link_code, auth_user_id) pair gets at most one live
-- challenge at a time. Older rows are best-effort cleaned by request-otp,
-- but this trigger keeps the table from drifting if request-otp errors
-- after the insert but before its own cleanup.
CREATE OR REPLACE FUNCTION "public"."link_code_otp_challenges_prune_stale"()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  DELETE FROM public.link_code_otp_challenges
  WHERE link_code = NEW.link_code
    AND auth_user_id = NEW.auth_user_id
    AND id <> NEW.id
    AND (expires_at < now() OR locked_until IS NULL OR locked_until < now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS link_code_otp_challenges_prune_stale_trg
    ON "public"."link_code_otp_challenges";

CREATE TRIGGER link_code_otp_challenges_prune_stale_trg
    AFTER INSERT ON "public"."link_code_otp_challenges"
    FOR EACH ROW EXECUTE FUNCTION "public"."link_code_otp_challenges_prune_stale"();

-- Lock down the helper function: only the table's own writers (service role)
-- need it, never anon/authenticated.
REVOKE ALL ON FUNCTION "public"."link_code_otp_challenges_prune_stale"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."link_code_otp_challenges_prune_stale"() FROM authenticated;
REVOKE ALL ON FUNCTION "public"."link_code_otp_challenges_prune_stale"() FROM anon;

COMMIT;
