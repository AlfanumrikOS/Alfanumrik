-- 20260518000003_model_pricing.sql
-- Per-(provider, model) pricing rates. Used for cost reporting/audit.
-- Edge Functions keep an inline mirror in telemetry.ts for hot-path performance;
-- when you change a row here, change PRICING in telemetry.ts too.

create table if not exists public.model_pricing (
  provider           text not null,
  model              text not null,
  input_usd_per_1m   numeric(10,4) not null,
  output_usd_per_1m  numeric(10,4) not null,
  effective_from     timestamptz not null default now(),
  primary key (provider, model)
);

insert into public.model_pricing (provider, model, input_usd_per_1m, output_usd_per_1m) values
  ('openai',    'gpt-4o-mini',                    0.15,  0.60),
  ('openai',    'gpt-4o',                         2.50, 10.00),
  ('anthropic', 'claude-haiku-4-5-20251001',      1.00,  5.00),
  ('anthropic', 'claude-sonnet-4-6-20251022',     3.00, 15.00)
on conflict (provider, model) do update
  set input_usd_per_1m  = excluded.input_usd_per_1m,
      output_usd_per_1m = excluded.output_usd_per_1m,
      effective_from    = now();

alter table public.model_pricing enable row level security;
create policy model_pricing_read_all on public.model_pricing for select using (true);
