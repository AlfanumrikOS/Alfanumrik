-- Migration: 20260815000005_whatsapp_touch_window_atomic_rpc.sql
-- Purpose: WhatsApp study bot DB-layer bug-audit pass (pre-production hardening,
--          fe6658f72 follow-up). Ships the `whatsapp_touch_window` RPC that
--          20260801100200's header predicted would "land additively alongside
--          consuming code" — and fixes a real TOCTOU race that was found
--          instead of it landing.
--
-- ─── THE BUG ──────────────────────────────────────────────────────────────
-- apps/host/src/app/api/whatsapp/webhook/route.ts's touchConversationWindow()
-- implements the whatsapp_conversation_windows upsert as TWO separate
-- unlocked round trips: SELECT (read current row) then INSERT-if-absent /
-- UPDATE-if-present (write, using fields computed from the stale read). This
-- is NOT the same locking discipline as whatsapp_record_send (20260801100200),
-- which takes `SELECT ... FOR UPDATE` on the same table/row before deciding.
--
-- Concretely, this is a lost-update race on the IST day-rollover branch:
--   1. T1 (webhook inbound, day already rolled over) reads the row: stale
--      day_ist = yesterday, sent_today = 5.
--   2. T2 (whatsapp_record_send, a legitimate template send) takes
--      SELECT...FOR UPDATE on the same row, sees the same stale day_ist,
--      rolls it over itself, and commits sent_today = 1, templates_today = 1,
--      day_ist = today.
--   3. T1's UPDATE now runs (unconditional, no row version / WHERE guard on
--      the fields it read), computed from the pre-T2 read: it sets
--      day_ist = today (already correct) but ALSO sent_today = 0,
--      templates_today = 0 — silently erasing T2's just-recorded send.
-- Net effect: the per-recipient daily send/template caps enforced by
-- whatsapp_record_send (DAILY_SEND_CAP = 40, DAILY_TEMPLATE_CAP = 1) can be
-- reset mid-day by a concurrent inbound-triggered window touch, allowing more
-- sends/paid templates than the cap permits on any day with a rollover race.
-- This is a real cost-governance and anti-abuse control bypass, not a style
-- nit — whatsapp_conversation_windows is documented (20260801100100) as
-- "THE cost ledger" and whatsapp_record_send's own header calls its counters
-- "THE cap" specifically because the in-memory limiter is not one.
--
-- Lower-severity/secondary finding from the same review, NOT fixed here
-- (no DB-side lever): touchConversationWindow's first-insert object never
-- sets identity_id (route.ts does not have it resolved at that call site),
-- so idx_whatsapp_conversation_windows_identity is currently always empty
-- for webhook-created rows. This RPC accepts p_identity_id and backfills it
-- via COALESCE (never clobbers an already-set value) so a future call site
-- that DOES have the identity resolved fixes it for free; the existing
-- call site can keep passing NULL with no worse behavior than today.
-- Flagged for backend follow-up when route.ts is switched to call this RPC.
--
-- ─── THE FIX ──────────────────────────────────────────────────────────────
-- Single `INSERT ... ON CONFLICT (phone_hash) DO UPDATE` statement. Postgres
-- makes ON CONFLICT DO UPDATE atomic per row: the conflict check and the
-- update happen under the same row lock, so a concurrent
-- `whatsapp_record_send` (SELECT ... FOR UPDATE on the same phone_hash) and
-- this function serialize against each other instead of interleaving. The
-- SET clause reads pre-update values via the target-table alias (`w.*`,
-- standard ON CONFLICT DO UPDATE semantics — ONLY visible to the DO UPDATE
-- clause of the SAME statement, referring to the row as it existed
-- immediately before this statement's update, i.e. after this statement
-- has already acquired the row lock) so the day-rollover reset and the
-- extend-only expiry rule are evaluated against a value nothing else could
-- have changed out from under them mid-decision.
--
-- Business rules replicated 1:1 from touchConversationWindow (route.ts) —
-- this migration does not change product behavior, only its atomicity:
--   - window_kind/expires_at: EXTEND-ONLY. A later plain message must never
--     shorten a live free_entry (72h) window down to a nearer service (24h)
--     expiry — same rule route.ts already enforced (`if newExpiry > existing`).
--   - day_ist rollover (IST civil day, fixed UTC+05:30, no DST — same inline
--     expression as 20260801100100's column DEFAULT and 20260801100200's
--     whatsapp_record_send) resets sent_today/templates_today to 0.
--   - last_inbound_at advances on every touch, unconditionally.
--   - First-ever touch for a phone_hash inserts a fresh row (opened_at = now(),
--     counters = 0), matching the "no row = never any inbound" contract that
--     whatsapp_record_send's header depends on.
--
-- ─── SECURITY DEFINER justification (house rule: no DEFINER without one) ───
-- Same justification as whatsapp_claim_inbound / whatsapp_record_send
-- (20260801100200): operates exclusively on a service-role-only table
-- (whatsapp_conversation_windows: RLS service-role ALL, REVOKE from
-- PUBLIC/anon/authenticated, migration 20260801100100). SECURITY DEFINER +
-- the REVOKE/GRANT below makes the FUNCTION SURFACE the privilege boundary,
-- with a pinned search_path (no search-path hijack). No SQL is built from
-- input; p_phone_hash/p_identity_id/p_window_kind are used only as
-- parameterized values. p_window_kind is additionally constrained by an
-- explicit allow-list check (RAISE EXCEPTION on anything else) rather than
-- relying solely on the table's CHECK constraint, so a caller bug fails
-- loud inside the function instead of surfacing as an opaque constraint
-- violation.
--
-- Idempotent: CREATE OR REPLACE; REVOKE/GRANT are idempotent by nature.
-- Additive only — no DROP TABLE / DROP COLUMN. Depends on the table from
-- 20260801100100 (earlier in the chain, so ordering is guaranteed).
--
-- No behavior change while ff_whatsapp_bot_v1 / ff_whatsapp_inbound_webhook
-- remain OFF (seeded OFF in 20260801100500) AND while route.ts still calls
-- its own inline touchConversationWindow — this function is inert (unused)
-- until backend wires the webhook route to call it instead. That call-site
-- swap is Next.js API route business logic (backend-owned per CLAUDE.md);
-- flagged here as a required follow-up, not made in this migration.
--
-- Owner: architect. Added: 2026-08-13 (WhatsApp DB-layer bug-audit pass,
-- pre-production hardening).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ────────────────────────────────
--   DROP FUNCTION IF EXISTS public.whatsapp_touch_window(text, uuid, text);
-- Safe to drop at any time before a caller is wired to it (currently none).

BEGIN;

CREATE OR REPLACE FUNCTION public.whatsapp_touch_window(
  p_phone_hash  text,
  p_identity_id uuid,
  p_window_kind text
)
RETURNS TABLE (
  window_kind     text,
  expires_at      timestamptz,
  day_ist         date,
  sent_today      int,
  templates_today int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_service_hours    CONSTANT int := 24;
  c_free_entry_hours CONSTANT int := 72;
  v_hours       int;
  v_new_expiry  timestamptz;
  v_today_ist   date;
BEGIN
  IF p_window_kind NOT IN ('service', 'free_entry') THEN
    RAISE EXCEPTION 'whatsapp_touch_window: invalid p_window_kind %', p_window_kind;
  END IF;

  v_hours      := CASE WHEN p_window_kind = 'free_entry'
                        THEN c_free_entry_hours ELSE c_service_hours END;
  v_new_expiry := now() + make_interval(hours => v_hours);
  -- IST calendar-day rollover (fixed UTC+05:30, no DST — no tz library),
  -- identical expression to 20260801100100's day_ist DEFAULT and
  -- 20260801100200's whatsapp_record_send.
  v_today_ist  := ((now() AT TIME ZONE 'utc') + interval '5 hours 30 minutes')::date;

  INSERT INTO public.whatsapp_conversation_windows AS w (
    phone_hash, identity_id, window_kind, opened_at, expires_at,
    last_inbound_at, day_ist, sent_today, templates_today,
    consecutive_failures, updated_at
  ) VALUES (
    p_phone_hash, p_identity_id, p_window_kind, now(), v_new_expiry,
    now(), v_today_ist, 0, 0, 0, now()
  )
  ON CONFLICT (phone_hash) DO UPDATE SET
    last_inbound_at = now(),
    updated_at      = now(),
    -- Never overwrite an already-populated identity_id (e.g. a future
    -- resolved-identity call site should not be clobbered by a later touch
    -- from a path that does not have it resolved).
    identity_id     = COALESCE(w.identity_id, EXCLUDED.identity_id),
    -- Extend-only: never shorten a live window (e.g. free_entry 72h) just
    -- because a later touch computed a nearer expiry.
    expires_at      = CASE WHEN v_new_expiry > w.expires_at
                            THEN v_new_expiry ELSE w.expires_at END,
    window_kind     = CASE WHEN v_new_expiry > w.expires_at
                            THEN p_window_kind ELSE w.window_kind END,
    day_ist         = CASE WHEN w.day_ist <> v_today_ist
                            THEN v_today_ist ELSE w.day_ist END,
    sent_today      = CASE WHEN w.day_ist <> v_today_ist
                            THEN 0 ELSE w.sent_today END,
    templates_today = CASE WHEN w.day_ist <> v_today_ist
                            THEN 0 ELSE w.templates_today END;

  RETURN QUERY
    SELECT w2.window_kind, w2.expires_at, w2.day_ist, w2.sent_today, w2.templates_today
      FROM public.whatsapp_conversation_windows w2
     WHERE w2.phone_hash = p_phone_hash;
END;
$$;

COMMENT ON FUNCTION public.whatsapp_touch_window(text, uuid, text) IS
  'Atomic upsert of the per-phone 24h/72h window ledger (single INSERT ... '
  'ON CONFLICT DO UPDATE — no separate read-then-write round trip). Replaces '
  'the unlocked read-then-write pattern that let a day-rollover reset race '
  'with a concurrent whatsapp_record_send and silently erase a just-recorded '
  'send/template count. Extend-only expiry; day_ist rollover zeroes the daily '
  'counters; last_inbound_at always advances. SECURITY DEFINER, '
  'service_role-execute-only.';

-- ─── Execute privileges — function surface is the privilege boundary ────────
REVOKE ALL ON FUNCTION public.whatsapp_touch_window(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.whatsapp_touch_window(text, uuid, text)
  TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. First touch for a brand-new phone_hash:
--    SELECT * FROM whatsapp_touch_window('<new hash>', NULL, 'service');
--    -- expect: one row, window_kind='service', sent_today=0, templates_today=0.
-- 2. Re-touch the same phone_hash with 'free_entry' immediately after:
--    SELECT * FROM whatsapp_touch_window('<hash>', NULL, 'free_entry');
--    -- expect: expires_at extended to the LATER (free_entry 72h) value,
--    --         window_kind = 'free_entry' (72h > 24h so it wins).
-- 3. Re-touch again with 'service' right after step 2:
--    SELECT * FROM whatsapp_touch_window('<hash>', NULL, 'service');
--    -- expect: expires_at UNCHANGED from step 2 (24h from now is earlier
--    --         than the still-live 72h free_entry expiry) — extend-only holds.
-- 4. Race check: open two concurrent sessions on the same phone_hash with a
--    stale day_ist (yesterday) and sent_today > 0; in session A run
--    whatsapp_record_send('<hash>', true) and in session B run
--    whatsapp_touch_window('<hash>', NULL, 'service') without committing A
--    first -- expect: B blocks until A commits/rolls back (row lock), then
--    B's day-rollover reset is computed from A's POST-commit counters, never
--    erasing A's increment.
-- 5. As an authenticated (non-service-role) session:
--    SELECT whatsapp_touch_window('x', NULL, 'service');
--    -- expect: permission denied for function.
