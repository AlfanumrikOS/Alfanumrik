-- Observability Console — Cut 1b
-- Adds alerting subsystem: notification_channels, alert_rules, alert_dispatches,
-- severity_rank() helper, evaluate_alert_rules() evaluator, trigger for critical
-- events, pg_cron schedules for periodic evaluation and delivery, and 3 seeded
-- disabled rules. Strictly additive: no existing table or function is modified.

BEGIN;

-- Required extensions (safe to run if already enabled).
-- pg_net is needed for the alert-deliverer cron job (net.http_post).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────────────────────────
-- notification_channels: stores delivery targets (Slack, email, etc.)
-- ────────────────────────────────────────────────────────────
CREATE TABLE notification_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  type            text NOT NULL,
  config          jsonb NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_channels_admin_only"
  ON notification_channels FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────
-- alert_rules: threshold-based alerting configuration
-- ────────────────────────────────────────────────────────────
CREATE TABLE alert_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  description        text,
  enabled            boolean NOT NULL DEFAULT true,
  category           text,
  source             text,
  min_severity       text NOT NULL
    CHECK (min_severity IN ('info','warning','error','critical')),
  count_threshold    int  NOT NULL CHECK (count_threshold >= 1),
  window_minutes     int  NOT NULL CHECK (window_minutes BETWEEN 1 AND 1440),
  channel_ids        uuid[] NOT NULL,
  cooldown_minutes   int  NOT NULL DEFAULT 15,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_rules_admin_only"
  ON alert_rules FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────
-- alert_dispatches: fired-alert history with delivery tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE alert_dispatches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id            uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id         uuid NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  fired_at           timestamptz NOT NULL DEFAULT now(),
  matched_count      int NOT NULL,
  status             text NOT NULL CHECK (status IN ('pending','sent','failed')),
  retry_count        int NOT NULL DEFAULT 0,
  delivery_error     text,
  delivery_response  jsonb
);
CREATE INDEX alert_dispatches_rule_fired_idx
  ON alert_dispatches (rule_id, fired_at DESC);
CREATE INDEX alert_dispatches_pending_idx
  ON alert_dispatches (status, fired_at)
  WHERE status = 'pending';
ALTER TABLE alert_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_dispatches_admin_only"
  ON alert_dispatches FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ────────────────────────────────────────────────────────────
-- severity_rank: maps severity text to ordinal int for comparisons
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION severity_rank(sev text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE sev
    WHEN 'info'     THEN 1
    WHEN 'warning'  THEN 2
    WHEN 'error'    THEN 3
    WHEN 'critical' THEN 4
    ELSE 0
  END;
$$;

-- ────────────────────────────────────────────────────────────
-- evaluate_alert_rules: checks thresholds, respects cooldown,
-- queues pending dispatches for matching rules.
-- ────────────────────────────────────────────────────────────

-- SECURITY DEFINER justification: evaluate_alert_rules must read ops_events
-- and write alert_dispatches, both of which have RLS denying all client access.
-- Only pg_cron (superuser) and the critical-event trigger invoke this function;
-- it is never exposed to end users.
CREATE OR REPLACE FUNCTION evaluate_alert_rules(p_rule_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r            alert_rules%ROWTYPE;
  v_match_cnt  int;
  v_last_fired timestamptz;
  v_fires_sent int := 0;
  v_channel_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM alert_rules
    WHERE enabled = true
      AND (p_rule_id IS NULL OR id = p_rule_id)
  LOOP
    SELECT COUNT(*) INTO v_match_cnt
      FROM ops_events
     WHERE occurred_at > now() - (r.window_minutes || ' minutes')::interval
       AND (r.category IS NULL OR category = r.category)
       AND (r.source   IS NULL OR source   = r.source)
       AND severity_rank(severity) >= severity_rank(r.min_severity);

    IF v_match_cnt < r.count_threshold THEN
      CONTINUE;
    END IF;

    SELECT MAX(fired_at) INTO v_last_fired
      FROM alert_dispatches
     WHERE rule_id = r.id
       AND status IN ('sent', 'pending');

    IF v_last_fired IS NOT NULL
       AND v_last_fired > now() - (r.cooldown_minutes || ' minutes')::interval THEN
      CONTINUE;
    END IF;

    FOREACH v_channel_id IN ARRAY r.channel_ids
    LOOP
      INSERT INTO alert_dispatches (rule_id, channel_id, fired_at, matched_count, status)
      VALUES (r.id, v_channel_id, now(), v_match_cnt, 'pending');
      v_fires_sent := v_fires_sent + 1;
    END LOOP;
  END LOOP;
  RETURN v_fires_sent;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- evaluate_alert_rules_for_event: trigger function that evaluates
-- matching alert rules when a critical event is inserted.
-- ────────────────────────────────────────────────────────────

-- SECURITY DEFINER justification: this trigger function runs in the context
-- of the inserting session (service role). It must read alert_rules and call
-- evaluate_alert_rules(), both on RLS-denied tables. The trigger fires only
-- on critical-severity inserts and is not callable by end users.
CREATE OR REPLACE FUNCTION evaluate_alert_rules_for_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r       alert_rules%ROWTYPE;
BEGIN
  FOR r IN
    SELECT * FROM alert_rules
    WHERE enabled = true
      AND severity_rank(min_severity) <= severity_rank('critical')
      AND (category IS NULL OR category = NEW.category)
      AND (source   IS NULL OR source   = NEW.source)
  LOOP
    PERFORM evaluate_alert_rules(r.id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ops_events_critical_alert_trigger
  AFTER INSERT ON ops_events
  FOR EACH ROW
  WHEN (NEW.severity = 'critical')
  EXECUTE FUNCTION evaluate_alert_rules_for_event();

-- ────────────────────────────────────────────────────────────
-- pg_cron schedules
-- ────────────────────────────────────────────────────────────

-- Evaluator: every 5 minutes
SELECT cron.schedule(
  'ops-alert-evaluator',
  '*/5 * * * *',
  $$ SELECT public.evaluate_alert_rules(); $$
);

-- Deliverer: every 1 minute (calls alert-deliverer Edge Function via pg_net)
-- NOTE: app.supabase_url and app.cron_secret must be set via:
--   ALTER DATABASE postgres SET app.supabase_url = 'https://YOUR_PROJECT.supabase.co';
--   ALTER DATABASE postgres SET app.cron_secret = 'YOUR_CRON_SECRET';
SELECT cron.schedule(
  'ops-alert-deliverer',
  '* * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/alert-deliverer',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  ); $$
);

-- ────────────────────────────────────────────────────────────
-- Seeded rules (all disabled, empty channel_ids)
-- ────────────────────────────────────────────────────────────
INSERT INTO alert_rules (name, description, enabled, category, min_severity, count_threshold, window_minutes, channel_ids, cooldown_minutes)
VALUES
  ('Payment webhook integrity',
   'Fires when a Razorpay webhook signature is invalid',
   false, 'payment', 'critical', 1, 1, '{}', 5),
  ('AI error spike',
   'Fires when Claude API failures exceed threshold',
   false, 'ai', 'error', 5, 10, '{}', 15),
  ('Health degraded',
   'Fires when a health check reports degraded or unhealthy',
   false, 'health', 'warning', 1, 5, '{}', 30);

COMMIT;