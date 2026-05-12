-- Migration: 20260510125019_grounded_traces_grounded_from_chunks.sql
-- Purpose:    Reconcile a phantom prod migration. This version was
--             applied directly to prod's supabase_migrations.schema_migrations
--             on 2026-05-10 outside the repo, then later captured under
--             a different timestamp at
--             supabase/migrations/20260516070000_grounded_traces_grounded_from_chunks.sql.
--             Supabase CLI's `db push --linked` refuses to push when a
--             remote version isn't present locally, so the entire
--             Apply Database Migrations job has been failing for weeks.
--             Committing this file with the exact phantom timestamp
--             unblocks the push.
--
-- SQL body sourced byte-for-byte from
-- supabase_migrations.schema_migrations.statements[0] on prod at the
-- time of reconciliation (verified 2026-05-12 via Supabase MCP).
--
-- Idempotency: ✅ ADD COLUMN IF NOT EXISTS, COMMENT ON (re-runnable),
-- UPDATE ... WHERE ... IS NULL (no-op once backfilled).
--
-- DO NOT delete this file. Supabase CLI compares prod's
-- schema_migrations versions against local files by exact timestamp;
-- removing this file resurfaces the "Remote migration versions not
-- found in local migrations directory" error.

ALTER TABLE grounded_ai_traces
  ADD COLUMN IF NOT EXISTS grounded_from_chunks BOOLEAN;

COMMENT ON COLUMN grounded_ai_traces.grounded_from_chunks IS
  'True when the answer was actually produced from retrieved NCERT chunks '
  'in either strict mode (grounding-check passed) or soft mode (chunks '
  'present and no general-knowledge escape prefix). False when soft mode '
  'fell back to general knowledge OR no chunks were retrieved. NULL on '
  'rows from before this column was added (2026-05-16) and on abstain '
  'rows (no answer to evaluate). Prefer this over `grounded` for true '
  'citation-backed answer rate metrics.';

UPDATE grounded_ai_traces
SET grounded_from_chunks = FALSE
WHERE chunk_count = 0
  AND grounded = TRUE
  AND grounded_from_chunks IS NULL;
