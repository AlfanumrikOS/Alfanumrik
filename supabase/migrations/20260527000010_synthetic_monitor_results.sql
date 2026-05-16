-- 20260527000010_synthetic_monitor_results.sql
-- Phase E.5 — synthetic monitor for white-label host resolution.
--
-- Pairs with supabase/functions/synthetic-host-monitor/index.ts. Each
-- function tick INSERTs one row per probed school (5-minute cadence via
-- pg_cron — see scheduling note at the bottom of this file).
--
-- Why this table exists:
-- White-label tenant resolution depends on a chain: DNS CNAME → Vercel
-- routing → src/proxy.ts resolveTenantFromHost (lines ~233-484) →
-- /api/school-config returns the right tenant. If any link breaks (e.g.
-- the known request-vs-response headers bug at src/proxy.ts:759-767, a
-- DNS regression, or a tenant-cache TTL bug), schools silently show the
-- generic Alfanumrik page or a 404. This table is the durable trace of
-- "does every active school still resolve correctly right now". Operator
-- dashboards and PagerDuty alerts read from here.
--
-- Failure-reason taxonomy (mirrors classify.ts:FailureReason):
--   timeout            - probe exceeded 10s (origin slow / unresponsive)
--   dns_error          - hostname did not resolve / TCP connect failed
--   http_4xx           - origin returned 400-499
--   http_5xx           - origin returned 500-599
--   tenant_mismatch    - origin returned a school id different from expected
--   invalid_response   - origin returned a 2xx but body could not be parsed
--                        as JSON / had no recognisable id field
--   fetch_error        - catch-all for fetch errors not in the above
--
-- Retention: 30 days. Backlog (NOT in this PR): add a separate cron job
-- that runs `DELETE FROM synthetic_monitor_results WHERE checked_at <
-- now() - interval '30 days'` daily. See the scheduling note below.

BEGIN;

CREATE TABLE IF NOT EXISTS public.synthetic_monitor_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to schools so a school's monitor history disappears with the
  -- school. The Edge Function only probes active schools but historical
  -- rows for a deactivated school should not pollute current dashboards.
  school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  checked_at          timestamptz NOT NULL DEFAULT now(),
  -- The host actually probed (custom_domain when set, <slug>.alfanumrik.com
  -- otherwise — see classify.ts:resolveHostForSchool). Lowercased.
  host                text NOT NULL CHECK (length(host) <= 253),
  -- HTTP status code from the response. NULL when no response was received
  -- (timeout / DNS error / fetch error).
  http_status         int  NULL CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  -- Wall-clock duration of the probe attempt, in milliseconds. Capped at
  -- 60s to defang a hostile or buggy origin that hangs longer than the
  -- 10s fetch timeout (shouldn't happen but the check keeps the column
  -- well-behaved for percentile dashboards).
  response_time_ms    int  NOT NULL CHECK (response_time_ms >= 0 AND response_time_ms <= 60000),
  ok                  boolean NOT NULL,
  -- One of the failure-reason enum strings; NULL when ok = true. Stored
  -- as text instead of a PG ENUM so we can add new reasons in the
  -- function without a coordinated schema migration (we already need to
  -- ship the function first; the table-side enum would force a deploy
  -- ordering we don't want).
  failure_reason      text NULL CHECK (
    failure_reason IS NULL
    OR failure_reason IN (
      'timeout',
      'dns_error',
      'http_4xx',
      'http_5xx',
      'tenant_mismatch',
      'invalid_response',
      'fetch_error'
    )
  ),
  -- Compact snapshot of the parsed response body (see compactBody() in
  -- the Edge Function). Lets an operator inspect what the tenant returned
  -- without re-probing. Bounded by the function's 32KB body read cap, so
  -- jsonb size is practically tiny.
  raw_response        jsonb NULL,
  -- The school id we OBSERVED in the response (for tenant_mismatch
  -- forensics). Stored as text because the wrong-tenant case may return
  -- a non-uuid string and we don't want a CHECK to drop the evidence row.
  CONSTRAINT synthetic_monitor_results_failure_consistency CHECK (
    -- ok=true implies failure_reason IS NULL; ok=false implies failure_reason IS NOT NULL.
    (ok = true AND failure_reason IS NULL)
    OR (ok = false AND failure_reason IS NOT NULL)
  )
);

COMMENT ON TABLE  public.synthetic_monitor_results IS
  'Phase E.5: durable trace of white-label host-resolution probes. One row per school per tick.';
COMMENT ON COLUMN public.synthetic_monitor_results.host IS
  'Lowercased host actually probed; custom_domain preferred, <slug>.alfanumrik.com fallback.';
COMMENT ON COLUMN public.synthetic_monitor_results.failure_reason IS
  'Enum of: timeout, dns_error, http_4xx, http_5xx, tenant_mismatch, invalid_response, fetch_error.';

-- ──────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────

-- Per-school history queries: "show me the last 100 probes for school X".
-- Composite (school_id, checked_at DESC) keeps the index aligned with the
-- common `ORDER BY checked_at DESC LIMIT N WHERE school_id = ?` pattern.
CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_school_checked
  ON public.synthetic_monitor_results (school_id, checked_at DESC);

-- "Recent failures across the fleet" query: the PagerDuty / alert layer
-- reads `WHERE ok = false AND checked_at > now() - '15 min'`. A partial
-- index keyed on checked_at and filtered to ok=false keeps the alert
-- query O(failures) regardless of how many passing rows live in the table.
CREATE INDEX IF NOT EXISTS idx_synthetic_monitor_results_recent_failures
  ON public.synthetic_monitor_results (checked_at DESC)
  WHERE ok = false;

-- ──────────────────────────────────────────────────────────────────────
-- RLS — operator-only data.
-- ──────────────────────────────────────────────────────────────────────
-- This table is host-health telemetry, not application data. Even
-- institution_admins shouldn't see it directly (they'd misinterpret
-- transient timeouts as outages); ops dashboards read via service_role.
-- If we later need a "show this school's uptime in the admin panel"
-- feature, we'll add a narrow SELECT policy for that surface — but NOT
-- a blanket `authenticated` SELECT here.

ALTER TABLE public.synthetic_monitor_results ENABLE ROW LEVEL SECURITY;

-- Deny-by-default for everyone. service_role bypasses RLS so the Edge
-- Function still writes; everything else (anon, authenticated) sees no
-- rows.
DROP POLICY IF EXISTS "synthetic_monitor_results_deny_all"
  ON public.synthetic_monitor_results;
CREATE POLICY "synthetic_monitor_results_deny_all"
  ON public.synthetic_monitor_results
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────
-- Scheduling (operator-run, NOT in this migration).
-- ──────────────────────────────────────────────────────────────────────
-- After deploying the Edge Function, the operator runs the following in
-- the Supabase SQL editor (with appropriate Vault secrets set). We do
-- NOT execute these in the migration body for three reasons:
--   1. The function URL depends on the project ref (different per env);
--      pinning a URL in a migration leaks env coupling into the schema.
--   2. pg_cron is not installed on every environment (notably staging);
--      hard-coding the schedule here forces an "if extension exists"
--      DO-block that adds noise without operational value at this stage.
--   3. Operator review of cadence + auth happens BEFORE the cron starts
--      writing rows — easier to audit when it's an explicit step.
--
-- Required Vault secrets (one-time setup):
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/synthetic-host-monitor',
--     'synthetic_host_monitor_url',
--     'URL of the synthetic-host-monitor Edge Function called by pg_cron'
--   );
--   -- The service-role JWT is reused from the projector-runner secret
--   -- (see 20260524110002_projector_runner_cron.sql).
--
-- Schedule the 5-minute probe:
--   SELECT cron.schedule(
--     'synthetic-host-monitor',
--     '*/5 * * * *',
--     $$
--       SELECT net.http_post(
--         url := (SELECT decrypted_secret FROM vault.decrypted_secrets
--                 WHERE name = 'synthetic_host_monitor_url' LIMIT 1),
--         headers := jsonb_build_object(
--           'Authorization', 'Bearer ' || (
--             SELECT decrypted_secret FROM vault.decrypted_secrets
--             WHERE name = 'projector_runner_service_role_key' LIMIT 1
--           ),
--           'Content-Type', 'application/json'
--         ),
--         body := jsonb_build_object('source', 'pg_cron'),
--         timeout_milliseconds := 30000
--       );
--     $$
--   );
--
-- Retention purge (BACKLOG — separate PR):
--   SELECT cron.schedule(
--     'synthetic-host-monitor-retention',
--     '0 3 * * *',  -- daily at 03:00 UTC
--     $$ DELETE FROM public.synthetic_monitor_results
--        WHERE checked_at < now() - interval '30 days' $$
--   );
