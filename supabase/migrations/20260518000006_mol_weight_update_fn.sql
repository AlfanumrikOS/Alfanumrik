-- 20260518000006_mol_weight_update_fn.sql
-- Nightly job: derive openai_weight per task_type from the last 7 days of feedback.
--
-- Logic: for each task_type, compute mean rating per provider.
-- openai_weight = openai_mean / (openai_mean + anthropic_mean), bounded to [0.1, 0.9]
-- so the router can never fully freeze out a provider — fallbacks must still flow.

create or replace function public.update_mol_routing_weights()
returns void
language plpgsql
security definer
as $$
declare
  rec record;
  oa numeric;
  an numeric;
  new_w numeric;
  total_samples integer;
begin
  for rec in select distinct task_type from public.mol_request_logs
            where created_at >= now() - interval '7 days'
  loop
    select coalesce(avg(f.rating)::numeric, 0), count(*)
      into oa, total_samples
      from public.mol_feedback f
      join public.mol_request_logs l on l.request_id = f.request_id
     where l.task_type = rec.task_type
       and l.provider in ('openai', 'hybrid')
       and f.created_at >= now() - interval '7 days';

    select coalesce(avg(f.rating)::numeric, 0)
      into an
      from public.mol_feedback f
      join public.mol_request_logs l on l.request_id = f.request_id
     where l.task_type = rec.task_type
       and l.provider = 'anthropic'
       and f.created_at >= now() - interval '7 days';

    if (oa + an) = 0 then
      new_w := 0.5;
    else
      new_w := oa / (oa + an);
      if new_w < 0.1 then new_w := 0.1; end if;
      if new_w > 0.9 then new_w := 0.9; end if;
    end if;

    insert into public.mol_routing_weights (task_type, openai_weight, sample_size, updated_at)
      values (rec.task_type, new_w, coalesce(total_samples, 0), now())
    on conflict (task_type) do update
      set openai_weight = excluded.openai_weight,
          sample_size   = excluded.sample_size,
          updated_at    = now();
  end loop;
end;
$$;

revoke all on function public.update_mol_routing_weights() from public;
grant execute on function public.update_mol_routing_weights() to service_role;
