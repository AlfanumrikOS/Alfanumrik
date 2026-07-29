-- Migration: 20260801100000_whatsapp_bot_identity.sql
-- Purpose: WhatsApp study bot — identity layer. Creates the three tables that
--          form the ENTIRE security boundary for the bot (per the approved
--          plan's "Security tradeoff" section: the bot's RPC calls run as
--          service role, so the verified `whatsapp_identities` binding is what
--          stands between a phone number and a student's mastery record):
--            1. whatsapp_identities     — phone ↔ student/guardian binding
--            2. whatsapp_consent_events — append-only DPDP consent ledger
--            3. whatsapp_link_challenges — web-originated OTP bind challenges
--
-- Provider-agnostic by design: nothing in this file references Twilio or Meta.
-- A later transport switch (Twilio WhatsApp API → Meta Cloud API direct)
-- requires NO migration against these tables.
--
-- ─── P13 phone-number posture ────────────────────────────────────────────────
-- `phone_e164` (plaintext) lives ONLY in whatsapp_identities — unavoidable:
-- the provider send API needs the real destination number. Every OTHER
-- WhatsApp table (migration 20260801100100) references `phone_hash`
-- (HMAC-SHA256 with the WHATSAPP_PHONE_PEPPER secret; peppered because the
-- Indian mobile E.164 space is ~10^10 and brute-forceable in seconds
-- unpeppered). This is why the RLS posture below is service-role-only with
-- zero authenticated readers: a row here holds a raw phone number.
--
-- ─── RLS (P8 — every new table gets RLS in the SAME migration) ───────────────
-- Uniform posture, copied from public.notification_log (20260722092000) and
-- public.link_code_otp_challenges (20260527000005): RLS ENABLED, the ONLY
-- policy is service-role ALL, and default privileges are REVOKEd from
-- PUBLIC/anon/authenticated. The usual four-pattern rubric (student own /
-- parent linked / teacher assigned / admin) deliberately does NOT apply:
-- every legitimate reader and writer is the bot itself running as service
-- role, and a student must never be able to enumerate other students' phone
-- numbers, hashes, or OTP material. A future "manage my WhatsApp" settings
-- page must read via a narrow SECURITY DEFINER RPC returning
-- {connected, phone_masked, opt_in_status} — do NOT widen these policies.
--
-- ─── DPDP (LOCKED decision #1, 2026-07-29) ───────────────────────────────────
-- A live public.parental_consent row is required before binding any student
-- whose DOB implies under-18. Enforced in application code (bind flow +
-- whatsapp-send gate); this migration provides the audit linkage
-- (whatsapp_consent_events.parental_consent_id → parental_consent.id,
-- verified present with uuid PK in 20260527000004_dpdp_parental_consent.sql).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE [UNIQUE] INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS before CREATE POLICY; CREATE OR REPLACE for the
-- updated_at trigger function; DROP TRIGGER IF EXISTS before CREATE TRIGGER.
-- Additive only — no DROP TABLE / DROP COLUMN.
--
-- Owner: architect. Added: 2026-08-01 (WhatsApp bot plan, migration 1 of 7).
-- Plan: plan-alfanumrik-whatsapp-bot-mighty-frost.md (Migrations table, row 1).
--
-- ─── Rollback (MANUAL ONLY — never auto-run) ─────────────────────────────────
-- No feature reads these tables until ff_whatsapp_bot_v1 (seeded OFF in
-- 20260801100500) is flipped ON, so merging this is a zero-behavior change.
-- If a rollback is ever required, it is a deliberate operator action:
--   DROP TABLE IF EXISTS public.whatsapp_consent_events;
--   DROP TABLE IF EXISTS public.whatsapp_link_challenges;
--   DROP TABLE IF EXISTS public.whatsapp_identities;  -- last (FK parent)
-- Note this destroys the DPDP consent ledger — export it first if any
-- opt-in/opt-out event was ever recorded.

BEGIN;

-- ─── 0. Shared updated_at trigger function ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_whatsapp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── 1. whatsapp_identities ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_identities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Raw E.164 phone. ONLY table allowed to hold it (P13) — the provider
  -- send API needs the real destination. Service-role-only access.
  phone_e164        text NOT NULL,
  -- HMAC-SHA256(phone_e164, WHATSAPP_PHONE_PEPPER). The join key every other
  -- whatsapp_* table uses instead of the raw phone.
  phone_hash        text NOT NULL,
  -- Exactly one of student_id / guardian_id (CHECK below). A shared family
  -- phone is modelled as MULTIPLE rows with the same phone_e164, one per
  -- student binding (sibling support is a hard requirement in this market).
  student_id        uuid REFERENCES public.students(id)  ON DELETE CASCADE,
  guardian_id       uuid REFERENCES public.guardians(id) ON DELETE CASCADE,
  auth_user_id      uuid,
  role              text NOT NULL
                      CHECK (role IN ('student','guardian')),
  -- NULL until the OTP bind completes. An unverified row must never be used
  -- to resolve an active student (R6 chokepoint invariant).
  verified_at       timestamptz,
  verified_via      text
                      CHECK (verified_via IN ('web_deeplink_otp','admin_manual')),
  -- Sole consent authority for this channel (the plan explicitly does NOT
  -- extend guardians.notification_preferences). 'blocked' is terminal and
  -- never auto-recovers.
  opt_in_status     text NOT NULL DEFAULT 'pending'
                      CHECK (opt_in_status IN ('pending','opted_in','opted_out','blocked')),
  opted_in_at       timestamptz,
  opted_out_at      timestamptz,
  locale            text NOT NULL DEFAULT 'en'
                      CHECK (locale IN ('en','hi')),
  -- IST wall-clock HHMM encoded as smallint (e.g. 2130 = 21:30, 700 = 07:00).
  -- IST is a fixed UTC+05:30 offset with no DST; no tz library needed.
  quiet_hours_start smallint NOT NULL DEFAULT 2130,
  quiet_hours_end   smallint NOT NULL DEFAULT 700,
  -- Daily alarm-template time, IST HHMM (default 18:30 IST).
  alarm_hhmm        smallint NOT NULL DEFAULT 1830,
  -- Soft revocation: a revoked row is dead for resolution but kept for audit.
  -- Re-binding the same phone+student creates a NEW row (partial unique
  -- indexes below only constrain live rows).
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Exactly one principal per row: student XOR guardian.
  CONSTRAINT whatsapp_identities_one_principal
    CHECK (num_nonnulls(student_id, guardian_id) = 1)
);

COMMENT ON TABLE public.whatsapp_identities IS
  'Phone <-> student/guardian binding for the WhatsApp study bot. THE security '
  'boundary for all bot-originated writes (the bot runs as service role, so '
  'p_student_id may only ever originate from a row here with verified_at IS NOT '
  'NULL AND revoked_at IS NULL — R6). Only table permitted to store a raw '
  'phone number (P13); everything else joins on phone_hash. Service-role-only '
  '(P8); a future settings page reads via a narrow SECURITY DEFINER RPC, never '
  'a widened policy. Provider-agnostic: no Twilio/Meta-specific columns.';

COMMENT ON COLUMN public.whatsapp_identities.phone_e164 IS
  'Raw E.164. P13: must never be copied to any other table, log, or Sentry '
  'event. Use phone_hash everywhere else; use redactPhone() in all log output.';

COMMENT ON COLUMN public.whatsapp_identities.quiet_hours_start IS
  'IST wall-clock HHMM as smallint (2130 = 21:30). Applies to alarm templates '
  'and parent notes only — session replies inside an open window are always '
  'allowed.';

-- One LIVE binding per (phone, student) and per (phone, guardian); revoked
-- rows are excluded so a phone can be re-bound after revocation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_identities_live_phone_student
  ON public.whatsapp_identities (phone_e164, student_id)
  WHERE revoked_at IS NULL AND student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_identities_live_phone_guardian
  ON public.whatsapp_identities (phone_e164, guardian_id)
  WHERE revoked_at IS NULL AND guardian_id IS NOT NULL;

-- Webhook hot path: resolve inbound phone_hash -> live identity rows.
CREATE INDEX IF NOT EXISTS idx_whatsapp_identities_live_phone_hash
  ON public.whatsapp_identities (phone_hash)
  WHERE revoked_at IS NULL;

-- FK-side indexes (CASCADE delete performance on students/guardians deletes).
CREATE INDEX IF NOT EXISTS idx_whatsapp_identities_student
  ON public.whatsapp_identities (student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_identities_guardian
  ON public.whatsapp_identities (guardian_id)
  WHERE guardian_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_whatsapp_identities_updated_at
  ON public.whatsapp_identities;
CREATE TRIGGER trg_whatsapp_identities_updated_at
  BEFORE UPDATE ON public.whatsapp_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_updated_at();

-- ─── 2. whatsapp_consent_events ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_consent_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id         uuid NOT NULL
                        REFERENCES public.whatsapp_identities(id) ON DELETE CASCADE,
  event               text NOT NULL
                        CHECK (event IN (
                          'opt_in',
                          'opt_out',
                          'stop_keyword',
                          'start_keyword',
                          'blocked_by_provider',
                          'admin_revoke',
                          'parental_consent_recorded',
                          'parental_consent_revoked'
                        )),
  -- Where the event originated (e.g. 'webhook', 'web_settings', 'admin').
  -- Free text so a new source does not need a migration.
  source              text NOT NULL,
  consent_version     text,
  -- DPDP linkage (LOCKED decision #1). ON DELETE SET NULL so a DPDP
  -- data-erasure of a parental_consent row is never blocked by this
  -- audit reference; the event row itself survives with the link cleared.
  parental_consent_id uuid REFERENCES public.parental_consent(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_consent_events IS
  'Append-only DPDP consent ledger for the WhatsApp channel. Every opt-in, '
  'opt-out, STOP/START keyword, provider block, admin revoke, and parental- '
  'consent grant/revoke lands here. whatsapp_identities.opt_in_status is the '
  'current-state authority; this table is the regulator-facing history. '
  'Never UPDATE or DELETE rows (append-only by convention). '
  'Service-role-only (P8).';

CREATE INDEX IF NOT EXISTS idx_whatsapp_consent_events_identity
  ON public.whatsapp_consent_events (identity_id, created_at DESC);

-- ─── 3. whatsapp_link_challenges ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_link_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The authenticated web session that started the bind (cookie-auth route
  -- /api/whatsapp/link/start). Proves possession of the web account; the
  -- inbound `LINK <otp>` message proves possession of the handset.
  auth_user_id  uuid NOT NULL,
  student_id    uuid REFERENCES public.students(id)  ON DELETE CASCADE,
  guardian_id   uuid REFERENCES public.guardians(id) ON DELETE CASCADE,
  role          text NOT NULL
                  CHECK (role IN ('student','guardian')),
  -- hashOtp(otp, rowId) from packages/lib/src/link-code-otp.ts — zero new
  -- crypto. Plaintext OTP is never stored.
  otp_hash      text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_link_challenges IS
  'Web-originated OTP challenges for binding a WhatsApp phone to a '
  'student/guardian. Deliberately a NEW table rather than reusing '
  'link_code_otp_challenges (whose prune trigger + guardian-redeem route own '
  'its lifecycle) and deliberately NOT students.link_code (a standing '
  'guardian-facing secret — anyone holding it could bind an arbitrary phone). '
  'The webhook LINK handler scans the unexpired, unlocked candidate set and '
  'verifies the OTP against each; two live matches = fail closed. '
  'Service-role-only (P8).';

-- Candidate-set scan: unexpired challenges, newest first.
CREATE INDEX IF NOT EXISTS idx_whatsapp_link_challenges_expires
  ON public.whatsapp_link_challenges (expires_at DESC);

-- FK-side indexes (CASCADE delete performance).
CREATE INDEX IF NOT EXISTS idx_whatsapp_link_challenges_student
  ON public.whatsapp_link_challenges (student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_link_challenges_guardian
  ON public.whatsapp_link_challenges (guardian_id)
  WHERE guardian_id IS NOT NULL;

-- ─── 4. Row Level Security (uniform service-role-only posture) ───────────────

ALTER TABLE public.whatsapp_identities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_consent_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_link_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_identities_service_all
  ON public.whatsapp_identities;
CREATE POLICY whatsapp_identities_service_all
  ON public.whatsapp_identities
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_consent_events_service_all
  ON public.whatsapp_consent_events;
CREATE POLICY whatsapp_consent_events_service_all
  ON public.whatsapp_consent_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS whatsapp_link_challenges_service_all
  ON public.whatsapp_link_challenges;
CREATE POLICY whatsapp_link_challenges_service_all
  ON public.whatsapp_link_challenges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defense in depth under the RLS layer: strip default privileges entirely.
-- No SELECT for authenticated/anon — these tables hold raw phone numbers
-- and OTP hashes. A future settings surface reads via a narrow SECURITY
-- DEFINER RPC, never a widened policy.
REVOKE ALL ON public.whatsapp_identities      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_consent_events  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_link_challenges FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.whatsapp_identities      TO service_role;
GRANT ALL ON public.whatsapp_consent_events  TO service_role;
GRANT ALL ON public.whatsapp_link_challenges TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname LIKE 'whatsapp_%' AND relkind = 'r';
--    -- expect: t for all three tables.
-- 2. SELECT tablename, polname FROM pg_policies
--      WHERE tablename IN ('whatsapp_identities','whatsapp_consent_events',
--                          'whatsapp_link_challenges');
--    -- expect: exactly one *_service_all policy per table.
-- 3. INSERT a test row with BOTH student_id and guardian_id set
--    -- expect: violates whatsapp_identities_one_principal.
-- 4. As an authenticated (non-service-role) session:
--    SELECT * FROM whatsapp_identities;  -- expect: permission denied / 0 rows.
