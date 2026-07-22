-- Migration: 20260722092000_notification_log_audit_table.sql
-- Purpose: Master Action Plan Phase 3, item 3.7. Creates the missing
--          `public.notification_log` table that
--          supabase/functions/whatsapp-notify/index.ts has been trying (and
--          silently failing) to insert into since it shipped.
--
-- ─── Context (confirmed in-source, whatsapp-notify/index.ts:227-244) ─────────
-- logNotification() carries this inline comment:
--   "KNOWN GAP (needs migration — architect): the `notification_log` table
--    does not exist on prod (confirmed against the live DB 2026-06-16). Every
--    insert here fails and is swallowed, so WhatsApp delivery audit rows are
--    silently dropped. Delivery itself is unaffected (this is logging only).
--    Until the table is created, this is a best-effort no-op by design."
-- The insert is wrapped in try/catch, so the missing table has never caused a
-- user-facing failure -- WhatsApp delivery (or the email fallback via
-- task_queue) proceeds regardless -- but it means Monthly Synthesis /
-- WhatsApp notification delivery currently has ZERO audit trail. This
-- migration closes that gap by creating the table with the EXACT column
-- shape the existing insert call already writes (no Edge Function rewrite
-- needed beyond the follow-up comment cleanup in the same PR).
--
-- ─── Column provenance (matched 1:1 against the actual insert, not guessed) ──
-- whatsapp-notify/index.ts:233-241:
--   await supabase.from('notification_log').insert({
--     user_id: userId ?? null,
--     channel,
--     template_type: templateType,
--     recipient: redactPhone(recipient), // P13: redact in storage too
--     status,
--     whatsapp_message_id: messageId ?? null,
--     error_message: errorMessage ?? null,
--   })
-- Every column below exists because the Edge Function already writes it;
-- nothing is speculative.
--   - user_id          uuid, NULLABLE, NO FK. Traced through all 3 callers of
--                       whatsapp-notify (notifications-whatsapp-route,
--                       school-admin-parents-route,
--                       synthesis-parent-share-route): the value is an
--                       optional, caller-supplied opaque reference (in the
--                       synthesis-parent-share case it is the requesting
--                       student's auth.uid(); in notifications/whatsapp it is
--                       an optional admin-supplied string; in
--                       school-admin/parents it is never sent at all, i.e.
--                       NULL). There is no single table it always points at,
--                       so it is intentionally NOT foreign-keyed to students,
--                       guardians, or auth.users -- constraining it would
--                       risk insert failures on legitimate calls. This is an
--                       audit trail column, not a relational join key.
--   - channel           text NOT NULL. Always 'whatsapp' today (the only
--                       caller of logNotification passes channel='whatsapp'),
--                       left as free text (not a CHECK-constrained enum) so a
--                       future 'email'/'sms' channel doesn't need a migration
--                       to be logged.
--   - template_type     text NOT NULL. One of the TemplateType union
--                       ('daily_reminder' | 'score_notification' |
--                       'streak_warning' | 'weekly_summary' |
--                       'monthly_synthesis') -- left free text for the same
--                       forward-compat reason as channel.
--   - recipient         text NOT NULL. **Already redacted before this table
--                       ever sees it** -- the Edge Function calls
--                       redactPhone(recipient) before the insert (P13: no raw
--                       phone/email in storage, matching the existing
--                       redaction already applied to log output). This
--                       migration does not change that call; it only gives
--                       the already-redacted value somewhere to land.
--   - status            text NOT NULL. One of 'sent' | 'failed' |
--                       'rate_limited' as observed at the 3 call sites
--                       (index.ts:360, :394, :408) -- free text for the same
--                       forward-compat reason.
--   - whatsapp_message_id text NULLABLE. Meta's message id on success, NULL
--                       on failure/rate-limit.
--   - error_message     text NULLABLE. WhatsApp API error string on failure,
--                       NULL on success.
--   - created_at        timestamptz NOT NULL DEFAULT now(). Not written
--                       explicitly by the Edge Function; the column default
--                       supplies it (standard convention in this migration
--                       set).
--   - id                uuid PRIMARY KEY DEFAULT gen_random_uuid(). Not
--                       written by the Edge Function either; standard PK
--                       convention.
--
-- ─── RLS (P8 -- every new table gets RLS in the SAME migration) ──────────────
-- Same posture as public.protected_feature_flags (migration 20260722090000):
-- this does NOT fit the usual four-pattern rubric (student own / parent
-- linked / teacher assigned / admin service-role) because user_id is an
-- unconstrained, cross-role, sometimes-absent opaque reference -- there is no
-- reliable "this row belongs to auth.uid()" join, and per the security
-- posture doc for whatsapp-notify (20260620001500:5-7) this is an
-- internal-service-only surface: only the Edge Function's own service-role
-- client ever writes it, and there is no legitimate student/parent/teacher
-- direct reader (a parent should not be able to enumerate every WhatsApp
-- send attempt across the platform just because one row's user_id happens to
-- match them). Accordingly:
--   - RLS is ENABLED (P8 requires this on every new table, no exceptions).
--   - The ONLY policy is service-role ALL.
--   - `authenticated`/`anon` get ZERO policies and default privileges are
--     explicitly REVOKEd (defense in depth under the RLS layer, matching
--     protected_feature_flags's convention). If a future super-admin
--     "notification delivery" dashboard needs to list these rows, add a
--     narrow SECURITY DEFINER RPC (authorizeAdmin-gated) rather than opening
--     a SELECT policy -- do not loosen this without a documented reason.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE
-- POLICY. No DROP TABLE / DROP COLUMN. Additive only.
--
-- Review chain (P14): this table is written from a backend-owned Edge
-- Function (whatsapp-notify) -- notify backend. It also underpins the
-- Monthly Synthesis parent-share audit trail (Pedagogy v2 Wave 3) -- no
-- schema change to synthesis tables here, so ai-engineer/assessment are not
-- required reviewers for this specific migration, but backend should confirm
-- the Edge Function insert now succeeds end-to-end.
--
-- Owner: architect. Added: 2026-07-22 (backend completion Phase 3, item 3.7).

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid,
  channel              text NOT NULL,
  template_type        text NOT NULL,
  recipient            text NOT NULL,
  status               text NOT NULL,
  whatsapp_message_id  text,
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_log IS
  'Audit trail for outbound notification-channel sends (currently WhatsApp via '
  'supabase/functions/whatsapp-notify/index.ts). Created 2026-07-22 to close the '
  'documented gap where every insert into this (previously nonexistent) table was '
  'silently swallowed by a try/catch, leaving zero audit trail for Monthly Synthesis '
  '/ WhatsApp delivery. Column shape matches the existing Edge Function insert call '
  '1:1 -- see migration header for full provenance. Service-role-only (P8): no '
  'reliable per-user ownership join exists on user_id (see header), so there is no '
  'student/parent/teacher reader by design.';

COMMENT ON COLUMN public.notification_log.user_id IS
  'Optional, caller-supplied opaque reference (NOT foreign-keyed -- traced through '
  'all 3 whatsapp-notify callers, it points at different things or is absent '
  'depending on the caller). Audit-trail column, not a relational join key.';

COMMENT ON COLUMN public.notification_log.recipient IS
  'P13: already redacted by the caller (redactPhone()) before this column ever sees '
  'it. Never store a raw phone number or email here.';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_notification_log_created
  ON public.notification_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_log_user
  ON public.notification_log (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_log_status
  ON public.notification_log (status);

-- ─── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Service role: full access. This is the ONLY policy -- see the migration
-- header for why the usual student/parent/teacher patterns do not apply to
-- this internal-service audit table.
DROP POLICY IF EXISTS notification_log_service_all
  ON public.notification_log;
CREATE POLICY notification_log_service_all
  ON public.notification_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defense in depth under the RLS layer: strip default privileges entirely.
-- No SELECT for authenticated/anon -- see header ("no legitimate non-admin
-- reader"). A future admin dashboard should read this via a narrow SECURITY
-- DEFINER RPC, not a widened policy.
REVOKE ALL ON public.notification_log FROM PUBLIC;
REVOKE ALL ON public.notification_log FROM anon;
REVOKE ALL ON public.notification_log FROM authenticated;
GRANT ALL ON public.notification_log TO service_role;

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- 1. SELECT relrowsecurity FROM pg_class WHERE relname = 'notification_log';
--    -- expect: t
-- 2. SELECT polname, cmd FROM pg_policies WHERE tablename = 'notification_log';
--    -- expect: notification_log_service_all (ALL) -- the only row.
-- 3. Trigger a WhatsApp send (e.g. via /api/notifications/whatsapp with a
--    valid admin session) and confirm a row lands in notification_log with
--    status='sent' or 'failed' and a redacted (never raw) `recipient` value.
-- 4. As an authenticated (non-service-role) session, confirm
--    `SELECT * FROM notification_log` returns 0 rows / permission denied.
