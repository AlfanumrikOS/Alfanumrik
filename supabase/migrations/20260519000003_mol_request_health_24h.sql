-- 20260519000003_mol_request_health_24h.sql
-- C4.2b-i (2026-05-19): hourly health rollup view for the MOL request log.
--
-- Background:
--   C4.2a wired shadow routing into grounded-answer; C4.2b-i now needs an
--   operator surface that summarises mol_request_logs by hour, sliced by
--   provider × task_type × shadow_role. The C4 ramp runbook
--   (docs/MOL_C4_SHADOW_RUNBOOK.md) queries this view at every ramp gate to
--   confirm shadow row volume tracks baseline, p95 latency stays inside
--   the SLO, and shadow cost ≈ baseline cost per call.
--
--   The existing mol_health_24h view (20260518000007_mol_health_view.sql)
--   pre-dates C4 and is NOT sliced by shadow_role, so a shadow-row spike
--   would be invisible there. This view is additive — both views can
--   coexist; the new shape carries the shadow_role discriminator the
--   runbook needs.
--
-- Shape:
--   hour                   timestamptz   (1-hour bucket, descending)
--   provider               text          (anthropic | openai | hybrid)
--   task_type              text          (MOL TaskType literal)
--   shadow_role            text          (baseline | shadow | NULL legacy)
--   n_requests             bigint        (row count in the bucket)
--   n_failures             bigint        (rows where failure_chain IS NOT NULL)
--   p50_latency_ms         float8        (percentile_cont 0.5)
--   p95_latency_ms         float8        (percentile_cont 0.95)
--   inr_cost_sum           numeric       (sum of inr_cost)
--   prompt_tokens_sum      bigint        (sum of prompt_tokens)
--   completion_tokens_sum  bigint        (sum of completion_tokens)
--
-- Idempotency: CREATE OR REPLACE VIEW. Re-runnable safely. No schema
-- changes — pure read-side rollup.
--
-- RLS: view defaults to SECURITY INVOKER (Postgres view default), so it
-- inherits mol_request_logs' admin-read policy. Plain `authenticated`
-- callers reading this view see only what RLS lets them see on the base
-- table — which is nothing in prod (mol_request_logs is service-role-only
-- per the C3 telemetry migration). The `authenticated` GRANT is for the
-- super-admin dashboard request which runs through the service role
-- bridge in the API route.

CREATE OR REPLACE VIEW public.mol_request_health_24h AS
SELECT
  date_trunc('hour', created_at) AS hour,
  provider,
  task_type,
  shadow_role,
  count(*)                                                          AS n_requests,
  count(*) FILTER (WHERE failure_chain IS NOT NULL)                 AS n_failures,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms)          AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)          AS p95_latency_ms,
  sum(inr_cost)                                                     AS inr_cost_sum,
  sum(prompt_tokens)                                                AS prompt_tokens_sum,
  sum(completion_tokens)                                            AS completion_tokens_sum
FROM public.mol_request_logs
WHERE created_at > now() - interval '24 hours'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;

GRANT SELECT ON public.mol_request_health_24h TO authenticated;

COMMENT ON VIEW public.mol_request_health_24h IS
  'C4.2b-i: hourly rollup of MOL request health. Count, failure rate, p50/p95 latency, INR cost, token volume. Sliced by provider × task_type × shadow_role for the shadow-routing ramp runbook (docs/MOL_C4_SHADOW_RUNBOOK.md).';

-- Sanity probe — emit a NOTICE with the row count so the migration runbook
-- can confirm the view materialises against current data on the target env.
DO $verify$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.mol_request_health_24h;
  RAISE NOTICE 'C4.2b-i: mol_request_health_24h has % rows over last 24h', v_rows;
END $verify$;
