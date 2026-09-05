-- Atomic hit-count bookkeeping for the Phase 2E semantic cache
-- (cache-semantic.ts's recordSemanticCacheHit). Observability only -- never
-- read by any request-path decision, so a failed/skipped increment can never
-- affect what a student sees.

create or replace function public.increment_foxy_response_cache_hit(p_row_id uuid)
returns void
language sql security definer
set search_path to 'public'
as $fn$
  update public.foxy_response_cache
  set hit_count = coalesce(hit_count, 0) + 1,
      last_hit_at = now()
  where id = p_row_id;
$fn$;

comment on function public.increment_foxy_response_cache_hit is
  'Atomic hit_count + last_hit_at bookkeeping for a foxy_response_cache row. service_role only, called from grounded-answer/cache-semantic.ts on a semantic-cache hit.';

revoke execute on function public.increment_foxy_response_cache_hit(uuid) from public;
revoke execute on function public.increment_foxy_response_cache_hit(uuid) from anon, authenticated;
grant execute on function public.increment_foxy_response_cache_hit(uuid) to service_role;
