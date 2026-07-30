-- Migration: 20260801100200_whatsapp_bot_rpcs.sql
-- Purpose: WhatsApp study bot — Phase 2 RPCs. Two SECURITY DEFINER functions:
--            1. whatsapp_claim_inbound(p_id)  — atomic claim of a pending
--               inbound event; the race arbiter between the webhook's after()
--               path and the whatsapp-drain cron.
--            2. whatsapp_record_send(p_phone_hash, p_is_template) — atomic
--               send-gate check + counter increment on the per-phone window
--               ledger (whatsapp_conversation_windows).
--
-- Scope note: the plan's migration table (row 3) lists four RPCs for this
-- file. This migration deliberately ships the two Phase-2 ones (claim +
-- record-send); whatsapp_touch_window and whatsapp_resolve_identity land
-- additively alongside their consuming code (CREATE OR REPLACE makes that
-- safe), so nothing here blocks or presupposes them.
--
-- ─── SECURITY DEFINER justification (house rule: no DEFINER without one) ─────
-- Both functions operate exclusively on service-role-only tables
-- (whatsapp_inbound_events / whatsapp_conversation_windows, migration
-- 20260801100100: RLS service-role ALL, REVOKE from PUBLIC/anon/
-- authenticated). SECURITY DEFINER + the REVOKE/GRANT set below makes the
-- FUNCTION SURFACE the privilege boundary: the only principal that can
-- execute is service_role, the logic always runs with owner privileges and a
-- pinned search_path (no search-path hijack), and if a future caller is ever
-- wired through a narrower key, the atomic claim/gate semantics cannot be
-- silently broken by missing table grants. Neither function accepts SQL or
-- interpolates input — p_id / p_phone_hash / p_is_template are used only as
-- parameterized values.
--
-- Idempotent: CREATE OR REPLACE; REVOKE/GRANT are idempotent by nature.
-- Additive only — no DROP TABLE / DROP COLUMN. Depends on tables from
-- 20260801100100 (earlier in the chain, so ordering is guaranteed).
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, migration 3 of 7).
-- Plan: plan-alfanumrik-whatsapp-bot-mighty-frost.md (Migrations table, row 3;
-- "Outbound" + "Ack-fast / async split" sections for the semantics).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
-- Nothing calls these functions until the ff_whatsapp_* flags (seeded OFF in
-- 20260801100500) are flipped ON — merging this is a zero-behavior change.
-- Deliberate operator rollback:
--   DROP FUNCTION IF EXISTS public.whatsapp_claim_inbound(uuid);
--   DROP FUNCTION IF EXISTS public.whatsapp_record_send(text, boolean);

BEGIN;

-- ─── 1. whatsapp_claim_inbound ───────────────────────────────────────────────
-- Atomically claim a pending inbound event for processing. Two competing
-- claimants exist by design: the webhook's after() path (immediate) and the
-- whatsapp-drain cron (retry for rows stuck 'pending' > 45s). A single
-- conditional UPDATE is the arbiter — row locking gives FOR UPDATE semantics
-- without a separate SELECT: whichever claimant's UPDATE reaches the row
-- first flips status pending→processing; the loser matches zero rows
-- (status is no longer 'pending') and gets false. processed_at is cleared on
-- claim so a re-claimed retry row never carries a stale completion timestamp.

CREATE OR REPLACE FUNCTION public.whatsapp_claim_inbound(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_inbound_events
     SET status       = 'processing',
         attempts     = attempts + 1,
         processed_at = NULL
   WHERE id = p_id
     AND status = 'pending';

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.whatsapp_claim_inbound(uuid) IS
  'Atomically claims a pending whatsapp_inbound_events row for processing '
  '(pending -> processing, attempts+1). Returns true iff this caller won the '
  'claim. Race arbiter between the webhook after() path and the '
  'whatsapp-drain cron. SECURITY DEFINER, service_role-execute-only.';

-- ─── 2. whatsapp_record_send ─────────────────────────────────────────────────
-- Atomic send-gate check + increment on the per-phone window ledger. This is
-- the LAST link of the plan's send-gate chain (kill switch → verified & not
-- revoked → opted in → DPDP minor gate → quiet hours → per-recipient caps →
-- window check) — the earlier links are enforced upstream in whatsapp-send;
-- this RPC enforces the caps + window atomically so two concurrent sends can
-- never both pass under the cap (SELECT ... FOR UPDATE serializes per phone).
--
-- Cap constants (mirror the plan's send-gate chain; change requires an
-- architect-reviewed migration, they are deliberately NOT parameters):
--   DAILY_SEND_CAP     = 40  -- max total sends per recipient per IST day
--   DAILY_TEMPLATE_CAP = 1   -- max PAID template sends per recipient per IST
--                            -- day (the one daily alarm OR the Sunday note)
--
-- Decision table:
--   no window row            → (false, false, 0, 0). No row = never any
--                              inbound from this phone = no send, ever.
--                              Outbound never creates a window.
--   free-form (p_is_template = false):
--       allowed iff window_open AND sent_today < 40
--   template (p_is_template = true):
--       allowed iff sent_today < 40 AND templates_today < 1
--       (a template is exactly the send that does NOT need an open window —
--        that is what makes it billable)
--
-- Day rollover: counters belong to the IST calendar day (IST = fixed
-- UTC+05:30, no DST — computed inline as
-- ((now() AT TIME ZONE 'utc') + interval '5 hours 30 minutes')::date, same
-- expression as the day_ist column DEFAULT in 20260801100100). If the stored
-- day_ist is stale, counters are treated as 0 for the decision; the row's
-- day_ist + counters are rewritten only on an allowed send (the deny path
-- stays read-only). Returned counters reflect the POST-decision state
-- (i.e. after the increment when allowed = true).

CREATE OR REPLACE FUNCTION public.whatsapp_record_send(
  p_phone_hash  text,
  p_is_template boolean
)
RETURNS TABLE (
  allowed         boolean,
  window_open     boolean,
  sent_today      int,
  templates_today int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_daily_send_cap     CONSTANT int := 40;  -- plan: sent_today at most 40
  c_daily_template_cap CONSTANT int := 1;   -- plan: templates_today at most 1
  v_row         public.whatsapp_conversation_windows%ROWTYPE;
  v_today_ist   date;
  v_window_open boolean;
  v_sent        int;
  v_templates   int;
  v_allowed     boolean;
BEGIN
  -- Serialize concurrent send attempts for the same phone.
  SELECT * INTO v_row
    FROM public.whatsapp_conversation_windows w
   WHERE w.phone_hash = p_phone_hash
     FOR UPDATE;

  IF NOT FOUND THEN
    -- No window row = this phone has never sent us an inbound message.
    -- Nothing may be sent to it (free-form OR template): the ledger row is
    -- created exclusively by the inbound path (whatsapp_touch_window).
    RETURN QUERY SELECT false, false, 0, 0;
    RETURN;
  END IF;

  -- IST calendar-day rollover (fixed UTC+05:30, no DST — no tz library).
  v_today_ist := ((now() AT TIME ZONE 'utc') + interval '5 hours 30 minutes')::date;
  IF v_row.day_ist <> v_today_ist THEN
    v_sent      := 0;
    v_templates := 0;
  ELSE
    v_sent      := v_row.sent_today;
    v_templates := v_row.templates_today;
  END IF;

  v_window_open := v_row.expires_at > now();

  v_allowed := (v_sent < c_daily_send_cap)
    AND (CASE WHEN p_is_template
              THEN v_templates < c_daily_template_cap
              ELSE v_window_open   -- free-form REQUIRES an open window
         END);

  IF v_allowed THEN
    v_sent := v_sent + 1;
    IF p_is_template THEN
      v_templates := v_templates + 1;
    END IF;

    -- Increment in the same transaction that made the decision — the row is
    -- still locked, so no concurrent caller can have read the pre-increment
    -- counters. Also persists the IST day rollover.
    UPDATE public.whatsapp_conversation_windows w
       SET sent_today      = v_sent,
           templates_today = v_templates,
           day_ist         = v_today_ist
     WHERE w.phone_hash = p_phone_hash;
  END IF;

  RETURN QUERY SELECT v_allowed, v_window_open, v_sent, v_templates;
END;
$$;

COMMENT ON FUNCTION public.whatsapp_record_send(text, boolean) IS
  'Atomic per-recipient send gate + counter increment on '
  'whatsapp_conversation_windows (SELECT FOR UPDATE by phone_hash). Enforces '
  'the caps-and-window links of the send-gate chain: sent_today < 40, '
  'templates_today < 1 for templates, open window required for free-form; '
  'no window row = no send. Counters roll over on the IST calendar day. '
  'This DB-backed counter is THE cap (the in-memory per-isolate limiter in '
  'whatsapp-notify is explicitly not). SECURITY DEFINER, '
  'service_role-execute-only.';

-- ─── 3. Execute privileges ───────────────────────────────────────────────────
-- Function surface is the privilege boundary: service_role only.

REVOKE ALL ON FUNCTION public.whatsapp_claim_inbound(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_record_send(text, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.whatsapp_claim_inbound(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_send(text, boolean) TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. INSERT a pending whatsapp_inbound_events row, then in two concurrent
--    sessions: SELECT whatsapp_claim_inbound('<id>');
--    -- expect: exactly one true, one false; row is status='processing',
--    --         attempts=1, processed_at IS NULL.
-- 2. SELECT whatsapp_claim_inbound('<same id>');   -- expect: false (not pending).
-- 3. With a window row (expires_at > now(), sent_today=0):
--    SELECT * FROM whatsapp_record_send('<hash>', false);
--    -- expect: (true, true, 1, 0) and the row's sent_today = 1.
-- 4. SELECT * FROM whatsapp_record_send('<unknown hash>', true);
--    -- expect: (false, false, 0, 0) and no row created.
-- 5. With templates_today = 1:
--    SELECT * FROM whatsapp_record_send('<hash>', true);
--    -- expect: allowed = false, counters unchanged.
-- 6. As an authenticated (non-service-role) session:
--    SELECT whatsapp_claim_inbound(gen_random_uuid());
--    -- expect: permission denied for function.
