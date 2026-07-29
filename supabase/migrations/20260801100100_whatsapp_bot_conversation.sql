-- Migration: 20260801100100_whatsapp_bot_conversation.sql
-- Purpose: WhatsApp study bot — conversation layer. Creates the six tables
--          behind the inbound webhook, the conversation state machine, the
--          24h-window cost ledger, and the per-send billing audit:
--            1. whatsapp_sessions             — one row per identity, upserted
--            2. whatsapp_inbound_events       — durable inbound queue + dedupe
--            3. whatsapp_seen_message_ids     — long-tail dedupe (90-day keep)
--            4. whatsapp_conversation_windows — THE cost ledger (24h/72h windows)
--            5. whatsapp_message_log          — per-send billing + delivery audit
--            6. whatsapp_pending_nudges       — "drop, do not pay" deferred sends
--
-- Provider-agnostic by design (transport today: Twilio WhatsApp API; later:
-- possibly Meta Cloud API direct — NO migration needed to switch):
--   - `provider` column CHECK ('twilio','meta') on inbound events; new
--     providers extend the CHECK additively.
--   - `provider_message_id` is the opaque provider dedupe key (Twilio
--     MessageSid / Meta wamid) — the schema never assumes either format.
--   - Window semantics (service 24h / free_entry 72h) are WhatsApp-platform
--     rules, identical across providers.
--
-- P13: NO raw phone number in any of these tables — everything joins on
-- `phone_hash` (raw E.164 lives only in whatsapp_identities, migration
-- 20260801100000). `payload` on inbound events stores sanitized text only;
-- media bytes are never persisted (plan R5); 30-day retention sweep is an
-- app-layer follow-up, with whatsapp_seen_message_ids carrying the dedupe key
-- alone for 90 days so late redeliveries still dedupe after the event row is
-- swept.
--
-- P5: whatsapp_sessions.grade is TEXT ("6".."12"), never integer.
--
-- ─── RLS (P8 — every new table gets RLS in the SAME migration) ───────────────
-- Uniform service-role-only posture, same as migration 20260801100000 and
-- notification_log (20260722092000): RLS ENABLED, single service-role ALL
-- policy, REVOKE from PUBLIC/anon/authenticated. Every reader/writer is the
-- bot running as service role; a student must never enumerate other students'
-- sessions, phone hashes, or message logs.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS before CREATE POLICY; CREATE OR REPLACE trigger fn;
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER. Additive only — no DROP
-- TABLE / DROP COLUMN.
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, migration 2 of 7).
-- Plan: plan-alfanumrik-whatsapp-bot-mighty-frost.md (Migrations table, row 2).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
-- Nothing reads these tables until ff_whatsapp_* flags (seeded OFF in
-- 20260801100500) are flipped ON — merging this is a zero-behavior change.
-- Deliberate operator rollback order (children first):
--   DROP TABLE IF EXISTS public.whatsapp_pending_nudges;
--   DROP TABLE IF EXISTS public.whatsapp_message_log;
--   DROP TABLE IF EXISTS public.whatsapp_conversation_windows;
--   DROP TABLE IF EXISTS public.whatsapp_seen_message_ids;
--   DROP TABLE IF EXISTS public.whatsapp_inbound_events;
--   DROP TABLE IF EXISTS public.whatsapp_sessions;
-- whatsapp_message_log is the cost-reconciliation record — export before
-- dropping if any billable send was ever recorded.

BEGIN;

-- Shared updated_at trigger function (CREATE OR REPLACE — also defined in
-- 20260801100000; repeated here for out-of-order/fresh-DB robustness).
CREATE OR REPLACE FUNCTION public.set_whatsapp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── 1. whatsapp_sessions ────────────────────────────────────────────────────
-- ONE row per identity, upserted — not append-per-conversation. Holds the
-- whole conversation state machine: Daily-6 position, doubt-ladder rung,
-- active sibling selection. expires_at is pinned to the provider service
-- window (last inbound + 24h): a session outliving its window is unusable.

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        uuid NOT NULL UNIQUE
                       REFERENCES public.whatsapp_identities(id) ON DELETE CASCADE,
  -- Sibling/shared-phone support: which of (up to 4) bound students this
  -- conversation currently acts as. R6: p_student_id for any quiz RPC may
  -- originate ONLY from this column, which may originate ONLY from a
  -- verified, unrevoked whatsapp_identities row.
  active_student_id  uuid REFERENCES public.students(id) ON DELETE CASCADE,
  state              text NOT NULL DEFAULT 'idle'
                       CHECK (state IN (
                         'idle',
                         'awaiting_link_otp',
                         'picking_student',
                         'picking_subject',
                         'daily6_active',
                         'awaiting_doubt',
                         'doubt_ladder',
                         'notebook_retest'
                       )),
  -- Daily-6 progress (IST day).
  d6_date            date,
  d6_quiz_session_id uuid,
  d6_question_ids    uuid[]  NOT NULL DEFAULT '{}',
  d6_index           smallint NOT NULL DEFAULT 0,
  d6_responses       jsonb   NOT NULL DEFAULT '[]',
  d6_served_at       timestamptz,
  -- Doubt-ladder progress (Socratic ladder: 0 = concept, 3 = full solution).
  doubt_id           uuid,
  doubt_step         smallint NOT NULL DEFAULT 0
                       CHECK (doubt_step BETWEEN 0 AND 3),
  subject            text,
  -- P5: grade is a STRING "6".."12" — never an integer.
  grade              text,
  locale             text NOT NULL DEFAULT 'en'
                       CHECK (locale IN ('en','hi')),
  context            jsonb NOT NULL DEFAULT '{}',
  -- Pinned to the provider service window (last inbound + 24h).
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_sessions IS
  'Conversation state machine for the WhatsApp bot: one row per identity, '
  'upserted. active_student_id is the ONLY legitimate source of p_student_id '
  'for bot-originated quiz RPC calls (R6 chokepoint). expires_at tracks the '
  'provider 24h service window. Service-role-only (P8).';

COMMENT ON COLUMN public.whatsapp_sessions.grade IS
  'P5: grade is a string "6".."12". Never an integer, in any layer.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_expires
  ON public.whatsapp_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_active_student
  ON public.whatsapp_sessions (active_student_id)
  WHERE active_student_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_sessions_updated_at
  ON public.whatsapp_sessions;
CREATE TRIGGER trg_whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_updated_at();

-- ─── 2. whatsapp_inbound_events ──────────────────────────────────────────────
-- Durable inbound queue. The webhook INSERTs ON CONFLICT DO NOTHING (dedupe
-- on provider_message_id), acks 200 immediately, then processes async via
-- after() with the whatsapp-drain cron as the retry mechanism (provider
-- redelivery is deliberately NOT the recovery path — sustained non-2xx
-- degrades the WhatsApp number's quality rating).

CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL DEFAULT 'twilio'
                        CHECK (provider IN ('twilio','meta')),
  -- Opaque provider dedupe key: Twilio MessageSid / Meta wamid. UNIQUE is
  -- the webhook's idempotency guarantee.
  provider_message_id text NOT NULL UNIQUE,
  -- P13: hash only — never the raw phone.
  phone_hash          text NOT NULL,
  -- SET NULL: an event row outlives an identity revocation/deletion for the
  -- 30-day retention window (audit), then the sweep removes it.
  identity_id         uuid REFERENCES public.whatsapp_identities(id) ON DELETE SET NULL,
  provider_timestamp  timestamptz,
  -- e.g. 'text','interactive','image','audio','document' — free text so a
  -- new provider message type needs no migration.
  message_type        text NOT NULL,
  -- Classified intent (private opcode space / keyword table). NULL until
  -- classification.
  intent              text,
  -- Sanitized payload ONLY (P13/R5): normalized text, interactive reply ids,
  -- media metadata. NEVER media bytes, never raw provider envelope with
  -- profile names.
  payload             jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','done','failed','ignored')),
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  processed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_inbound_events IS
  'Durable inbound message queue + idempotency ledger for the WhatsApp '
  'webhook. UNIQUE(provider_message_id) is the dedupe; the drain cron (not '
  'provider redelivery) is the retry mechanism. payload is sanitized text '
  'only — no media bytes, no raw phone (P13/R5). 30-day retention sweep; '
  'the bare message id survives 90 days in whatsapp_seen_message_ids. '
  'Service-role-only (P8).';

-- Drain-cron claim scan.
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_queue
  ON public.whatsapp_inbound_events (status, created_at)
  WHERE status IN ('pending','processing');

-- Per-sender history / debugging.
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_phone
  ON public.whatsapp_inbound_events (phone_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_identity
  ON public.whatsapp_inbound_events (identity_id)
  WHERE identity_id IS NOT NULL;

-- ─── 3. whatsapp_seen_message_ids ────────────────────────────────────────────
-- Long-tail dedupe: kept ~90 days so a late provider redelivery still
-- dedupes after the full event row is swept at 30 days.

CREATE TABLE IF NOT EXISTS public.whatsapp_seen_message_ids (
  provider_message_id text PRIMARY KEY,
  seen_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_seen_message_ids IS
  'Bare provider message ids (Twilio MessageSid / Meta wamid), kept ~90 days '
  'for late-redelivery dedupe after whatsapp_inbound_events rows are swept '
  'at 30 days. Service-role-only (P8).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_seen_message_ids_seen
  ON public.whatsapp_seen_message_ids (seen_at);

-- ─── 4. whatsapp_conversation_windows ────────────────────────────────────────
-- THE cost ledger — the single biggest cost decision in the plan. Updated on
-- every inbound; consulted before every send: window open => free-form send
-- (zero cost); window closed => drop to whatsapp_pending_nudges unless the
-- send is template-worthy (the one daily alarm / the Sunday note).

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_windows (
  -- P13: hash only. One window per phone (windows are per-conversation at
  -- the provider level, not per bound student).
  phone_hash           text PRIMARY KEY,
  identity_id          uuid REFERENCES public.whatsapp_identities(id) ON DELETE CASCADE,
  -- service = normal inbound (+24h) | free_entry = click-to-WhatsApp /
  -- wa.me deep link (+72h).
  window_kind          text NOT NULL
                         CHECK (window_kind IN ('service','free_entry')),
  opened_at            timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  last_inbound_at      timestamptz NOT NULL DEFAULT now(),
  -- Per-recipient daily caps (DB-backed — the real cap; the in-memory
  -- per-isolate limiter in whatsapp-notify is explicitly NOT a cap).
  sent_today           integer NOT NULL DEFAULT 0,
  templates_today      integer NOT NULL DEFAULT 0,
  -- IST calendar day the counters belong to (IST = fixed UTC+05:30, no DST).
  day_ist              date NOT NULL
                         DEFAULT ((now() AT TIME ZONE 'utc') + interval '5 hours 30 minutes')::date,
  -- Provider delivery-failure streak (e.g. user blocked / re-engagement
  -- errors flip the window closed and increment this).
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_conversation_windows IS
  'Per-phone 24h/72h messaging-window ledger + per-recipient daily send caps. '
  'The cost governor: never send a paid template when a free-form send is '
  'legal; default answer to "window closed" is WAIT (whatsapp_pending_nudges), '
  'not pay. day_ist anchors the daily counters to the IST calendar day. '
  'Service-role-only (P8).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_windows_identity
  ON public.whatsapp_conversation_windows (identity_id)
  WHERE identity_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_conversation_windows_updated_at
  ON public.whatsapp_conversation_windows;
CREATE TRIGGER trg_whatsapp_conversation_windows_updated_at
  BEFORE UPDATE ON public.whatsapp_conversation_windows
  FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_updated_at();

-- ─── 5. whatsapp_message_log ─────────────────────────────────────────────────
-- Per-message audit + billing record, both directions. This is what makes
-- "cost per student per month" a queryable number instead of a hope, and is
-- reconciled monthly against the provider invoice.

CREATE TABLE IF NOT EXISTS public.whatsapp_message_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- P13: hash only.
  phone_hash          text NOT NULL,
  -- SET NULL: billing/audit rows must survive identity revocation.
  identity_id         uuid REFERENCES public.whatsapp_identities(id) ON DELETE SET NULL,
  student_id          uuid REFERENCES public.students(id) ON DELETE SET NULL,
  direction           text NOT NULL
                        CHECK (direction IN ('out','in')),
  -- Provider id for outbound sends / status callbacks. UNIQUE (nullable —
  -- a failed send may never receive one).
  provider_message_id text UNIQUE,
  -- Product-level kind (e.g. 'daily6_question','doubt_rung','alarm',
  -- 'parent_note','menu') — free text.
  kind                text NOT NULL,
  -- Provider-level type (e.g. 'text','interactive','template','image').
  message_type        text NOT NULL,
  template_name       text,
  billable            boolean NOT NULL DEFAULT false,
  billing_category    text
                        CHECK (billing_category IN ('free','utility','service','marketing')),
  est_cost_inr        numeric(10,4) NOT NULL DEFAULT 0,
  -- Delivery lifecycle ('queued','sent','delivered','read','failed', ...) —
  -- free text: provider status vocabularies differ (Twilio vs Meta) and
  -- must not require a migration.
  status              text NOT NULL DEFAULT 'queued',
  error_code          integer,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_message_log IS
  'Per-message send/receive audit with billing attribution (billable, '
  'billing_category, est_cost_inr) — reconciled monthly against the provider '
  'invoice. The cost thesis (session messages are free) is verified '
  'empirically from this table in week one. phone_hash only, never raw phone '
  '(P13). Service-role-only (P8).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_student
  ON public.whatsapp_message_log (student_id, created_at DESC)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_billable
  ON public.whatsapp_message_log (created_at DESC)
  WHERE billable;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_phone
  ON public.whatsapp_message_log (phone_hash, created_at DESC);

-- ─── 6. whatsapp_pending_nudges ──────────────────────────────────────────────
-- The "drop, do not pay" branch: content we wanted to send while the window
-- was closed and the send was not template-worthy. Delivered free on the
-- recipient's next inbound.

CREATE TABLE IF NOT EXISTS public.whatsapp_pending_nudges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  uuid NOT NULL
                 REFERENCES public.whatsapp_identities(id) ON DELETE CASCADE,
  -- e.g. 'streak_nudge','notebook_summary' — free text.
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

COMMENT ON TABLE public.whatsapp_pending_nudges IS
  'Deferred sends parked while the recipient''s messaging window was closed '
  '(the "drop, do not pay" cost rule). Flushed free on the next inbound. '
  'Service-role-only (P8).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_nudges_undelivered
  ON public.whatsapp_pending_nudges (identity_id)
  WHERE delivered_at IS NULL;

-- ─── 7. Row Level Security (uniform service-role-only posture) ───────────────

ALTER TABLE public.whatsapp_sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbound_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_seen_message_ids     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_pending_nudges       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sessions_service_all
  ON public.whatsapp_sessions;
CREATE POLICY whatsapp_sessions_service_all
  ON public.whatsapp_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_inbound_events_service_all
  ON public.whatsapp_inbound_events;
CREATE POLICY whatsapp_inbound_events_service_all
  ON public.whatsapp_inbound_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_seen_message_ids_service_all
  ON public.whatsapp_seen_message_ids;
CREATE POLICY whatsapp_seen_message_ids_service_all
  ON public.whatsapp_seen_message_ids
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_conversation_windows_service_all
  ON public.whatsapp_conversation_windows;
CREATE POLICY whatsapp_conversation_windows_service_all
  ON public.whatsapp_conversation_windows
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_message_log_service_all
  ON public.whatsapp_message_log;
CREATE POLICY whatsapp_message_log_service_all
  ON public.whatsapp_message_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_pending_nudges_service_all
  ON public.whatsapp_pending_nudges;
CREATE POLICY whatsapp_pending_nudges_service_all
  ON public.whatsapp_pending_nudges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defense in depth under the RLS layer: strip default privileges entirely.
REVOKE ALL ON public.whatsapp_sessions             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_inbound_events       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_seen_message_ids     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_conversation_windows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_message_log          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_pending_nudges       FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.whatsapp_sessions             TO service_role;
GRANT ALL ON public.whatsapp_inbound_events       TO service_role;
GRANT ALL ON public.whatsapp_seen_message_ids     TO service_role;
GRANT ALL ON public.whatsapp_conversation_windows TO service_role;
GRANT ALL ON public.whatsapp_message_log          TO service_role;
GRANT ALL ON public.whatsapp_pending_nudges       TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname LIKE 'whatsapp_%' AND relkind = 'r';
--    -- expect: t for all nine whatsapp_* tables (3 from 20260801100000 + 6 here).
-- 2. SELECT tablename, count(*) FROM pg_policies
--      WHERE tablename LIKE 'whatsapp_%' GROUP BY tablename;
--    -- expect: exactly 1 (*_service_all) per table.
-- 3. INSERT the same provider_message_id twice into whatsapp_inbound_events
--    with ON CONFLICT DO NOTHING -- expect: second insert returns 0 rows.
-- 4. As an authenticated (non-service-role) session:
--    SELECT * FROM whatsapp_sessions;  -- expect: permission denied / 0 rows.
