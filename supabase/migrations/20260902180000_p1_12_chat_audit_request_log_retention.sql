-- P1-12 fix (2026-09-02 launch audit, CEO-approved retention windows).
-- foxy_chat_messages (minors' Foxy transcripts), security_request_audit
-- (127,764 rows as of this writing and growing — the largest table with no
-- retention), and api_request_logs had no age-out policy at all, unlike
-- product_events/engagement_events/analytics_events (90d,
-- 20260829164403_analytics_cron_jobs.sql) and synthetic_monitor_results
-- (30d, 20260528000008_synthetic_host_monitor_cron.sql). Windows below
-- match that existing precedent exactly (CEO-approved 2026-09-02, same
-- session as this migration): 90 days for chat transcripts and the
-- security audit trail, 30 days for request logs.
--
-- foxy_chat_messages has 6 incoming FK references (verified live via
-- pg_constraint before writing this): foxy_message_feedback,
-- foxy_quality_scores, and foxy_message_dimension_feedback are ON DELETE
-- CASCADE (their rows about a deleted message are deleted with it, which is
-- correct — there is no reason to keep feedback/quality-scoring for a
-- transcript that no longer exists); foxy_pending_expectations and
-- ai_issue_reports are ON DELETE SET NULL (their own rows survive, only the
-- now-dangling message reference is cleared). Neither is RESTRICT/NO ACTION,
-- so the DELETE below cannot fail on a live FK violation.
--
-- security_request_audit carries both `timestamp` and `created_at` columns;
-- verified live they are identical on all 127,764 existing rows, so
-- `created_at` is used for consistency with every other retention job in
-- this codebase.
--
-- Same bounded-batch DELETE pattern as the analytics retention job
-- (ctid IN (SELECT ctid ... LIMIT 10000)) so a large backlog on first run
-- does not take a long-held lock or blow the cron job's statement timeout —
-- it drains over several nightly runs instead.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'p1_12_chat_audit_request_log_retention: pg_cron extension not installed - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  IF to_regclass('public.foxy_chat_messages') IS NULL
     OR to_regclass('public.security_request_audit') IS NULL
     OR to_regclass('public.api_request_logs') IS NULL THEN
    RAISE NOTICE 'p1_12_chat_audit_request_log_retention: one or more target tables absent - skipping (fresh-DB guard)';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p1-12-chat-audit-request-log-retention') THEN
    PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'p1-12-chat-audit-request-log-retention'));
  END IF;

  -- 22:10 UTC = 03:40 IST — inside the same overnight retention/analytics
  -- window as the existing 21:30/22:30/22:50/23:10 UTC jobs, staggered to
  -- avoid overlapping the analytics refreshes.
  PERFORM cron.schedule(
    job_name := 'p1-12-chat-audit-request-log-retention',
    schedule := '10 22 * * *',
    command  := $cron_cmd$
      DELETE FROM public.foxy_chat_messages
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND ctid IN (
          SELECT ctid FROM public.foxy_chat_messages
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 10000
        );
      DELETE FROM public.security_request_audit
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND ctid IN (
          SELECT ctid FROM public.security_request_audit
          WHERE created_at < NOW() - INTERVAL '90 days'
          LIMIT 10000
        );
      DELETE FROM public.api_request_logs
        WHERE occurred_at < NOW() - INTERVAL '30 days'
        AND ctid IN (
          SELECT ctid FROM public.api_request_logs
          WHERE occurred_at < NOW() - INTERVAL '30 days'
          LIMIT 10000
        );
    $cron_cmd$
  );
END $$;
