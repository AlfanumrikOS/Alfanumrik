-- 20260520000003_mol_pricing_date_aliases.sql
-- C4 followup: add date-pinned pricing entries.
--
-- OpenAI's response 'model' field is the date-pinned variant (e.g.
-- 'gpt-4o-2024-08-06'), not the alias we send in the request ('gpt-4o').
-- mol_request_logs.model stores what OpenAI returned. Without these rows,
-- the SQL-side cost backfill via JOIN to model_pricing finds NULL.
--
-- The application-side calcCost() in telemetry.ts now also does alias-prefix
-- matching to handle this — but having the rows here too means SQL queries
-- and analytics don't need to know about the alias-stripping rule.
--
-- Primary key on public.model_pricing is (provider, model) — see
-- 20260518000003_model_pricing.sql. ON CONFLICT must target the same
-- columns; effective_from is NOT part of the unique constraint.

insert into public.model_pricing (provider, model, input_usd_per_1m, output_usd_per_1m)
values
  ('openai', 'gpt-4o-2024-08-06',      2.50, 10.00),
  ('openai', 'gpt-4o-mini-2024-07-18', 0.15,  0.60)
on conflict (provider, model) do nothing;
