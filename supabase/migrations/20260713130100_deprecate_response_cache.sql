-- ADR-007 action item 6 (revised): deprecate public.response_cache instead of
-- wiring a TTL sweep for it.
--
-- Evidence (2026-07-13):
--   * 0 rows in prod (verified count(*), not statistics).
--   * Zero readers/writers in app or Edge Function code — the only repo
--     reference is the generated database.types.ts.
--   * Its keying scheme had the REG-237 punctuation-stripping bug (collapses
--     "5+3" and "5-3" — see supabase/functions/grounded-answer/cache.ts
--     normalizeQuery comment), which is why it was never revived.
--   * The live response-cache stack is L1 in-memory LRU + L2 Upstash Redis
--     (grounded-answer/cache.ts + cache-redis.ts, flags ON since 2026-07-05).
--
-- Following the foxy_response_cache precedent: comment now, drop in a later
-- migration once a full audit cycle confirms nothing regressed.

COMMENT ON TABLE public.response_cache IS
  'DEPRECATED 2026-07-13 (ADR-007). Dormant SQL-side AI response cache: 0 rows in prod, zero code readers/writers, and a known punctuation-stripping cache-key bug (REG-237). Superseded by the L1 in-memory LRU + L2 Upstash Redis tiers in supabase/functions/grounded-answer/ (cache.ts / cache-redis.ts). Do not write new code against this table. Drop after one clean audit cycle.';
