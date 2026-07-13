-- Tech-debt register item "CI/CD + cron failure opacity" (2026-07-13).
-- Context: alert_rules -> evaluate_alert_rules() (pg_cron, */5) ->
-- alert_dispatches -> alert-deliverer (pg_cron, */2) has been running for
-- weeks with ZERO notification channels and empty channel_ids on every rule
-- — alerts evaluated and delivered NOWHERE. This is how the 17-day
-- synthetic-host-monitor outage went unseen.
-- Idempotent by design: safe on prod (already applied 2026-07-13 via ops)
-- and on fresh environments.

-- 1. Email channel to the CEO (delivery via alert-deliverer -> send-auth-email).
INSERT INTO public.notification_channels (name, type, config, enabled)
SELECT 'CEO email', 'email', jsonb_build_object('to', 'ceo@alfanumrik.com'), true
WHERE NOT EXISTS (SELECT 1 FROM public.notification_channels WHERE name = 'CEO email');

-- 2. Mirror internal-service cron auth denials from security_request_audit
--    into ops_events so the existing evaluator can see them (it only reads
--    ops_events). Category 'cron', severity 'error'. Trigger is narrow:
--    internal_service callers with deny_* decisions only.
CREATE OR REPLACE FUNCTION public.mirror_cron_deny_to_ops_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.caller_type = 'internal_service' AND NEW.quota_decision LIKE 'deny%' THEN
    INSERT INTO public.ops_events (category, source, severity, subject_type, subject_id, message, context, request_id, environment)
    VALUES (
      'cron', COALESCE(NEW.route, 'unknown'), 'error', 'cron_route', NEW.route,
      'internal cron caller denied: ' || NEW.quota_decision,
      jsonb_build_object('status_code', NEW.status_code, 'error_code', NEW.error_code),
      NEW.request_id::text, 'production'
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_mirror_cron_deny_to_ops_events ON public.security_request_audit;
CREATE TRIGGER trg_mirror_cron_deny_to_ops_events
  AFTER INSERT ON public.security_request_audit
  FOR EACH ROW EXECUTE FUNCTION public.mirror_cron_deny_to_ops_events();

-- 3. Rule: sustained cron auth failures (>=3 denials in 15 min => the
--    2026-07-09 failure mode). 60-min cooldown to avoid inbox flooding.
INSERT INTO public.alert_rules (name, description, enabled, category, min_severity, count_threshold, window_minutes, channel_ids, cooldown_minutes)
SELECT 'Cron auth failures',
       'Internal cron callers (pg_cron / Vercel cron) being rejected — the silent-outage failure mode of 2026-06-26..07-13. Investigate CRON_SECRET store desync first (docs/runbooks/secret-rotation.md).',
       true, 'cron', 'error', 3, 15,
       ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')],
       60
WHERE NOT EXISTS (SELECT 1 FROM public.alert_rules WHERE name = 'Cron auth failures');

-- 4. Attach the channel to every already-enabled rule that has none, and
--    enable the health rule (it was seeded disabled with no channel).
UPDATE public.alert_rules
   SET channel_ids = ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')]
 WHERE (channel_ids IS NULL OR channel_ids = '{}') AND enabled = true;
UPDATE public.alert_rules
   SET enabled = true,
       channel_ids = ARRAY[(SELECT id FROM public.notification_channels WHERE name = 'CEO email')]
 WHERE name = 'Health degraded' AND (channel_ids IS NULL OR channel_ids = '{}');
