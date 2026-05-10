-- Document foxy_response_cache as currently-unused.
--
-- Audit 2026-05-10: this table was originally a DB-backed cache for Foxy AI
-- responses, but the live grounded-answer pipeline uses an in-memory
-- per-Edge-Function-instance LRU (supabase/functions/grounded-answer/cache.ts)
-- and never writes here. Verified empty in prod (0 rows, 30 days). Kept
-- rather than dropped because:
--   1. docs/legal/lawyer-engagement-pack/06-readiness-status.md references
--      this table for the 12-month chat-retention scaffolding (E.2). Drop
--      requires legal sign-off.
--   2. Helper functions in baseline_from_prod.sql (prune_foxy_cache,
--      foxy_cache_stats, set_foxy_cache) reference it; their cleanup is
--      coupled with the table drop.
--
-- This migration only sets the COMMENT — no schema change. Grep target so
-- future engineers can find it via `\d+ foxy_response_cache` or by
-- searching the migrations directory.

COMMENT ON TABLE foxy_response_cache IS
  'UNUSED as of 2026-05-10. Originally a DB-backed cache for AI responses; '
  'the live grounded-answer pipeline uses an in-memory per-Edge-Function-instance '
  'LRU (supabase/functions/grounded-answer/cache.ts) instead. Table has 0 rows '
  'in prod (verified 2026-05-10) and is not written by any current code path. '
  'Kept rather than dropped because docs/legal/lawyer-engagement-pack/06-readiness-status.md '
  'references it for the 12-month chat-retention scaffolding (E.2). Drop only '
  'after legal sign-off and removal of the helper functions in baseline_from_prod.sql '
  '(prune_foxy_cache, foxy_cache_stats, set_foxy_cache).';
