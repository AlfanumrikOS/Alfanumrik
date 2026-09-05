-- Foxy semantic response cache (Phase 2E, cost optimization).
--
-- Extends `foxy_response_cache` (previously built, 0 rows, unwired) with a
-- `payload jsonb` column that mirrors the exact { tuple, response } envelope
-- already used by grounded-answer's L3 durable cache
-- (supabase/functions/grounded-answer/cache-durable.ts) -- same
-- defense-in-depth re-validation (tuple match + model_order match) on read,
-- same "grounded:true only" write contract. The existing response_text /
-- question_pattern / model_used / hit_count / quality_score columns are left
-- as-is for the human-readable/debug view of a cached row; `payload` is the
-- lossless round-trip source of truth.
--
-- match_foxy_response_cache: cosine-similarity lookup, scoped to a single
-- grade + subject (+ optional chapter_number), gated by is_active and a
-- caller-supplied similarity floor (Phase 2E spec: >= 0.95). SECURITY
-- DEFINER because foxy_response_cache is RLS-protected as a service-role-only
-- table -- there is no per-student data in it (no student_id column, by
-- original design: this table only ever holds non-personalized, shareable
-- answers), but the calling Edge Function still needs definer rights to read
-- across all rows rather than being scoped by its own RLS grant. Execute is
-- granted to service_role only -- this is an internal cache-tier lookup used
-- exclusively by supabase/functions/grounded-answer/, never called directly
-- by an authenticated browser client.

alter table public.foxy_response_cache
  add column if not exists payload jsonb;

comment on column public.foxy_response_cache.payload is
  'Lossless { tuple, response } envelope, same shape as the L3 durable cache in grounded-answer/cache-durable.ts. Source of truth for a semantic-cache hit; response_text/model_used remain a denormalized human-readable view.';

create or replace function public.match_foxy_response_cache(
  query_embedding public.vector(1024),
  p_grade text,
  p_subject_code text,
  p_chapter_number integer default null,
  p_min_similarity double precision default 0.95,
  p_match_count integer default 1
)
returns table (
  id uuid,
  payload jsonb,
  similarity double precision
)
language plpgsql stable security definer
set search_path to 'public'
as $fn$
begin
  return query
  select
    c.id,
    c.payload,
    1 - (c.question_embedding <=> query_embedding) as similarity
  from public.foxy_response_cache c
  where c.is_active = true
    and c.question_embedding is not null
    and c.payload is not null
    and c.grade = p_grade
    and c.subject = p_subject_code
    and (p_chapter_number is null or c.chapter_number = p_chapter_number)
    and (c.expires_at is null or c.expires_at > now())
    and 1 - (c.question_embedding <=> query_embedding) >= p_min_similarity
  order by c.question_embedding <=> query_embedding
  limit greatest(p_match_count, 1);
end;
$fn$;

comment on function public.match_foxy_response_cache is
  'Cosine-similarity lookup over foxy_response_cache.question_embedding, scoped to grade+subject(+chapter_number). Phase 2E semantic answer cache -- service_role only, called from supabase/functions/grounded-answer/cache-semantic.ts.';

revoke execute on function public.match_foxy_response_cache(
  public.vector, text, text, integer, double precision, integer
) from public;

revoke execute on function public.match_foxy_response_cache(
  public.vector, text, text, integer, double precision, integer
) from anon, authenticated;

grant execute on function public.match_foxy_response_cache(
  public.vector, text, text, integer, double precision, integer
) to service_role;
