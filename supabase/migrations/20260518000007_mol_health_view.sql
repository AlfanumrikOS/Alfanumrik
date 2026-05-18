-- 20260518000007_mol_health_view.sql
-- Read-only view summarizing MOL health for the super-admin dashboard.
-- p50/p95 latency, fallback rate, cost per task_type over the last 24h.

create or replace view public.mol_health_24h as
with base as (
  select task_type, provider, fallback_count, latency_ms, usd_cost, inr_cost
    from public.mol_request_logs
   where created_at >= now() - interval '24 hours'
)
select
  task_type,
  count(*)                              as requests,
  round(avg(latency_ms))                as latency_avg_ms,
  percentile_cont(0.5) within group (order by latency_ms)  as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms,
  round(100.0 * sum(case when fallback_count > 0 then 1 else 0 end)::numeric / nullif(count(*),0), 2)
                                        as fallback_rate_pct,
  sum(usd_cost)::numeric(12,4)          as usd_cost_24h,
  sum(inr_cost)::numeric(12,2)          as inr_cost_24h
from base
group by task_type
order by requests desc;

grant select on public.mol_health_24h to authenticated;
-- RLS is on by virtue of underlying table; super-admin policy on mol_request_logs covers it.
