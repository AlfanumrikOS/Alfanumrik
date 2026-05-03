-- Migration: 20260425140400_e5_e6_notification_events.sql
-- Phase 0h wiring (Wave 2) — emits E5 notification.dispatched.email
-- and E6 notification.dispatched.in_app per the event catalog.
--
-- Per docs/architecture/EVENT_CATALOG.md:
--   E5 notification.dispatched.email   → email-channel notifications
--   E6 notification.dispatched.in_app  → in-app channel notifications
--
-- Anchor: AFTER INSERT on public.notifications. The `type` column carries
-- the notification kind; we route to E5 when the type is an email-class
-- notification, otherwise E6 (default in-app).
--
-- Note: WhatsApp / SMS dispatch happens via separate Edge Functions
-- (whatsapp-notify, send-*-email) and writes to whatsapp_messages /
-- email_logs respectively. This trigger only covers the in-app
-- `notifications` table — the canonical record for the bell icon.
-- Email dispatch logging may be added later via the email_logs table
-- if/when consumers need that signal.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_emit_notification_dispatched()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  -- Heuristic: if the notification type starts with 'email_' OR contains
  -- '_email', treat as E5; otherwise default to E6 (in-app).
  -- Today the catalog only enumerates a handful of types; a future
  -- enumeration migration could replace this heuristic with a join to
  -- a notification_types table.
  IF NEW.type LIKE 'email\_%' ESCAPE '\' OR NEW.type LIKE '%\_email\_%' ESCAPE '\' OR NEW.type LIKE '%\_email' ESCAPE '\' THEN
    v_event_type := 'notification.dispatched.email';
  ELSE
    v_event_type := 'notification.dispatched.in_app';
  END IF;

  PERFORM public.enqueue_event(
    v_event_type,
    'notification',
    NEW.id,
    jsonb_build_object(
      'notification_id', NEW.id,
      'recipient_type', NEW.recipient_type,
      'recipient_id', NEW.recipient_id,
      'type', NEW.type,
      'title', NEW.title,
      'created_at', NEW.created_at,
      'expires_at', NEW.expires_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Notification INSERTs must NOT be blocked.
  RAISE WARNING 'enqueue_event failed for notifications %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_dispatched ON public.notifications;
CREATE TRIGGER trg_notification_dispatched
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.tg_emit_notification_dispatched();

REVOKE EXECUTE ON FUNCTION public.tg_emit_notification_dispatched() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_emit_notification_dispatched() TO service_role;

COMMENT ON FUNCTION public.tg_emit_notification_dispatched() IS
  'Emits E5 notification.dispatched.email (when type matches email pattern) or E6 notification.dispatched.in_app (default) when a notifications row is inserted. Non-blocking: outbox failure cannot roll back the notification INSERT.';

COMMIT;
