-- Migration: 20260815000006_whatsapp_link_attempt_throttle.sql
-- Purpose: WhatsApp study bot DB-layer bug-audit pass. Closes an OTP
--          brute-force rate-limiting gap in the `LINK <otp>` phone-binding
--          flow (apps/host/src/app/api/whatsapp/_lib/link-binding.ts) by
--          adding a per-sender-phone attempt throttle table + atomic RPC.
--
-- ─── THE BUG ──────────────────────────────────────────────────────────────
-- whatsapp_link_challenges (20260801100000) has `attempt_count` and
-- `locked_until` columns, and link-binding.ts checks
-- `challenge.attempt_count >= OTP_MAX_ATTEMPTS` to decide whether a MATCHED
-- challenge is locked out. But nothing anywhere in the codebase ever
-- increments `whatsapp_link_challenges.attempt_count` (verified: it is
-- written only by its own migration's DEFAULT 0; grepped for every writer —
-- none exists). The lockout branch is structurally unreachable, by design:
-- link-binding.ts's own comment explains why — the flow verifies a bare OTP
-- code against a SCAN of the newest 20 unexpired, unlocked challenges
-- SYSTEM-WIDE (no phone/sender scoping possible at that point, since the OTP
-- itself is the only correlator), so on a non-matching guess "the intended
-- challenge is unknowable" and no specific row can be attributed the failed
-- attempt. That reasoning is correct for the PER-CHALLENGE counter, but it
-- leaves this flow with NO rate limiting at all on the sender's OWN
-- identity, which IS known (phone_hash) even when the guessed challenge is
-- not. Contrast with the structurally different `link_code_otp_challenges`
-- flow (20260710170000_xc3_parent_link_code_otp_rpcs.sql), where the caller
-- looks up a SPECIFIC challenge by `link_code + auth.uid()` first, so
-- per-challenge attempt counting is well-defined there — that pattern does
-- not transfer to a bare-OTP brute-force scan.
--
-- Net effect: the only backstops on `LINK <code>` guessing today are the
-- OTP's own 6-digit keyspace (packages/lib/src/link-code-otp.ts:
-- OTP_LENGTH = 6, OTP_TTL_MS = 10 minutes) and the 20-row candidate-scan
-- cap — there is no cap on how many guesses a single WhatsApp sender may
-- submit. This is a real defense-in-depth gap in an account-binding flow
-- (a successful guess binds an attacker's phone to a DIFFERENT, unrelated
-- student/guardian's identity) even though the realistic exploitability is
-- low (a 6-digit space against a 10-minute TTL requires a sustained guess
-- rate that WhatsApp/Twilio transport-level throughput does not practically
-- allow) — it is exactly the kind of defense that should not rely solely on
-- "the other layer probably rate-limits this."
--
-- ─── THE FIX ──────────────────────────────────────────────────────────────
-- A new, phone_hash-scoped throttle, independent of (and complementary to)
-- the per-challenge attempt_count columns (left in place, unmodified — a
-- future per-challenge fix, if ever wired, is additive on top of this, not
-- blocked by it). `whatsapp_check_link_attempt(p_phone_hash)`:
--   - Atomically increments a per-phone attempt counter (SELECT ... FOR
--     UPDATE, matching whatsapp_record_send's locking discipline — same
--     read-then-conditionally-write-under-lock pattern, not a bare
--     read-then-write).
--   - Window matches the OTP's own TTL (OTP_TTL_MS = 10 minutes) so a
--     legitimate user who requests several fresh OTPs across sessions is
--     not punished for a stale window.
--   - Lockout ceiling and duration mirror the existing
--     link-code-otp.ts constants exactly (OTP_MAX_ATTEMPTS = 5,
--     OTP_LOCKOUT_MS = 1 hour) for consistency with the sibling flow.
--   - allowed = false on either an active lockout OR the just-incremented
--     count exceeding the ceiling; the caller (link-binding.ts) is expected
--     to call this BEFORE the candidate scan and short-circuit to a new
--     'rate_limited' outcome on !allowed. NOT wired into link-binding.ts by
--     this migration — that is Next.js API route business logic
--     (backend-owned per CLAUDE.md); flagged here as a required follow-up.
--     Until backend wires the call, this function is inert (unused), so
--     merging this migration alone is a zero-behavior change.
--
-- ─── RLS (P8 — every new table gets RLS in the SAME migration) ─────────────
-- Uniform service-role-only posture, identical to every other whatsapp_*
-- table (20260801100000/20260801100100): RLS ENABLED, single service-role
-- ALL policy, REVOKE from PUBLIC/anon/authenticated. This table holds no
-- raw phone number (phone_hash only, P13) but is still service-role-only —
-- a student must never be able to read another phone's attempt/lockout
-- state.
--
-- ─── SECURITY DEFINER justification (house rule: no DEFINER without one) ───
-- Same shape as whatsapp_claim_inbound / whatsapp_record_send /
-- whatsapp_touch_window: operates exclusively on a service-role-only table,
-- SECURITY DEFINER + REVOKE/GRANT makes the function surface the privilege
-- boundary, pinned search_path, no SQL built from input.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS before CREATE POLICY; CREATE OR REPLACE for the
-- function. Additive only — no DROP TABLE / DROP COLUMN.
--
-- Owner: architect. Added: 2026-08-13 (WhatsApp DB-layer bug-audit pass,
-- pre-production hardening).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
-- Nothing calls this function yet (see above) — merging/reverting is a
-- zero-behavior change either way.
--   DROP FUNCTION IF EXISTS public.whatsapp_check_link_attempt(text);
--   DROP TABLE IF EXISTS public.whatsapp_link_attempt_throttle;

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_link_attempt_throttle (
  -- P13: hash only, never the raw phone.
  phone_hash        text PRIMARY KEY,
  attempt_count     integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_link_attempt_throttle IS
  'Per-sender-phone rate limit on LINK <otp> guesses (whatsapp_link_challenges '
  'brute-force backstop). Independent of whatsapp_link_challenges.attempt_count, '
  'which is per-CHALLENGE and cannot be attributed on a non-matching guess '
  '(the candidate scan is not phone-scoped). phone_hash only (P13). '
  'Service-role-only (P8).';

ALTER TABLE public.whatsapp_link_attempt_throttle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_link_attempt_throttle_service_all
  ON public.whatsapp_link_attempt_throttle;
CREATE POLICY whatsapp_link_attempt_throttle_service_all
  ON public.whatsapp_link_attempt_throttle
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.whatsapp_link_attempt_throttle FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_link_attempt_throttle TO service_role;

-- ─── RPC ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.whatsapp_check_link_attempt(
  p_phone_hash text
)
RETURNS TABLE (
  allowed            boolean,
  locked_until       timestamptz,
  attempts_remaining int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirrors packages/lib/src/link-code-otp.ts exactly (OTP_MAX_ATTEMPTS,
  -- OTP_LOCKOUT_MS) for consistency with the sibling link_code_otp_challenges
  -- flow's lockout shape.
  c_max_attempts   CONSTANT int      := 5;
  c_lockout        CONSTANT interval := interval '1 hour';
  -- Mirrors OTP_TTL_MS (10 minutes) — the attempt window matches how long a
  -- single OTP stays guessable.
  c_window         CONSTANT interval := interval '10 minutes';
  v_row            public.whatsapp_link_attempt_throttle%ROWTYPE;
  v_now            CONSTANT timestamptz := now();
  v_new_count      int;
BEGIN
  SELECT * INTO v_row
    FROM public.whatsapp_link_attempt_throttle t
   WHERE t.phone_hash = p_phone_hash
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.whatsapp_link_attempt_throttle (
      phone_hash, attempt_count, window_started_at, updated_at
    ) VALUES (
      p_phone_hash, 1, v_now, v_now
    );
    RETURN QUERY SELECT true, NULL::timestamptz, (c_max_attempts - 1);
    RETURN;
  END IF;

  -- Active lockout — read-only, does not consume an attempt.
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    RETURN QUERY SELECT false, v_row.locked_until, 0;
    RETURN;
  END IF;

  -- Window rollover: a lockout that has elapsed, or a stale window, both
  -- restart the count fresh.
  IF v_row.window_started_at < (v_now - c_window) THEN
    v_new_count := 1;
    UPDATE public.whatsapp_link_attempt_throttle
       SET attempt_count     = v_new_count,
           window_started_at = v_now,
           locked_until      = NULL,
           updated_at        = v_now
     WHERE phone_hash = p_phone_hash;
    RETURN QUERY SELECT true, NULL::timestamptz, (c_max_attempts - v_new_count);
    RETURN;
  END IF;

  v_new_count := v_row.attempt_count + 1;

  IF v_new_count > c_max_attempts THEN
    UPDATE public.whatsapp_link_attempt_throttle
       SET attempt_count = v_new_count,
           locked_until  = v_now + c_lockout,
           updated_at    = v_now
     WHERE phone_hash = p_phone_hash;
    RETURN QUERY SELECT false, (v_now + c_lockout), 0;
    RETURN;
  END IF;

  UPDATE public.whatsapp_link_attempt_throttle
     SET attempt_count = v_new_count,
         updated_at    = v_now
   WHERE phone_hash = p_phone_hash;

  RETURN QUERY SELECT true, NULL::timestamptz, (c_max_attempts - v_new_count);
END;
$$;

COMMENT ON FUNCTION public.whatsapp_check_link_attempt(text) IS
  'Atomic per-phone-hash rate limit for LINK <otp> guesses (SELECT ... FOR '
  'UPDATE, matching whatsapp_record_send''s locking discipline). Max 5 '
  'attempts per rolling 10-minute window (mirrors OTP_MAX_ATTEMPTS / '
  'OTP_TTL_MS in packages/lib/src/link-code-otp.ts), then a 1-hour lockout '
  '(mirrors OTP_LOCKOUT_MS). Caller (link-binding.ts) must invoke this '
  'BEFORE the candidate scan and short-circuit on allowed = false — NOT '
  'wired in yet; see this migration''s header. SECURITY DEFINER, '
  'service_role-execute-only.';

REVOKE ALL ON FUNCTION public.whatsapp_check_link_attempt(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.whatsapp_check_link_attempt(text)
  TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. First call for a new phone_hash:
--    SELECT * FROM whatsapp_check_link_attempt('<hash>');
--    -- expect: (true, NULL, 4).
-- 2. Call 4 more times immediately (same hash, total 5):
--    -- expect: allowed=true each time, attempts_remaining counting 3,2,1,0.
-- 3. Call a 6th time immediately:
--    -- expect: (false, <now + 1h>, 0).
-- 4. Call again while still locked:
--    -- expect: same (false, <locked_until>, 0), attempt_count NOT
--    --         incremented further (read-only under active lockout).
-- 5. As an authenticated (non-service-role) session:
--    SELECT whatsapp_check_link_attempt('x');
--    -- expect: permission denied for function.
