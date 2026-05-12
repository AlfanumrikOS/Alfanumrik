-- Migration: 20260510131735_document_foxy_response_cache_unused.sql
-- Purpose:    Reconcile a phantom prod migration. This version was
--             applied directly to prod's supabase_migrations.schema_migrations
--             on 2026-05-10 outside the repo, then later captured under
--             a different timestamp at
--             supabase/migrations/20260516080000_document_foxy_response_cache_unused.sql.
--             Committing this file with the exact phantom timestamp
--             unblocks `supabase db push --linked`.
--
-- SQL body sourced byte-for-byte from
-- supabase_migrations.schema_migrations.statements[0] on prod at the
-- time of reconciliation (verified 2026-05-12 via Supabase MCP).
--
-- Idempotency: ✅ single COMMENT ON TABLE — fully re-runnable.
--
-- DO NOT delete this file. See companion comment in
-- 20260510125019_grounded_traces_grounded_from_chunks.sql.

COMMENT ON TABLE foxy_response_cache IS
  'UNUSED as of 2026-05-10. Originally a DB-backed cache for AI responses; '
  'the live grounded-answer pipeline uses an in-memory per-Edge-Function-instance '
  'LRU (supabase/functions/grounded-answer/cache.ts) instead. Table has 0 rows '
  'in prod (verified 2026-05-10) and is not written by any current code path. '
  'Kept rather than dropped because docs/legal/lawyer-engagement-pack/06-readiness-status.md '
  'references it for the 12-month chat-retention scaffolding (E.2). Drop only '
  'after legal sign-off and removal of the helper functions in baseline_from_prod.sql '
  '(prune_foxy_cache, foxy_cache_stats, set_foxy_cache).';
