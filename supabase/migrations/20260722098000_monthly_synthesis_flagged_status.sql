-- Migration: 20260722098000_monthly_synthesis_flagged_status.sql
-- Purpose: Item 4.5 (Monthly Synthesis pre-send fabrication gate).
--
-- Widens monthly_synthesis_runs.parent_share_status to accept a new
-- 'flagged' value. Written by /api/synthesis/parent-share's pre-send
-- oracle re-check (packages/lib/src/ai/validation/synthesis-oracle.ts)
-- when a summary fails a defense-in-depth fabrication check immediately
-- before the WhatsApp send call — e.g. a row persisted before the item 4.2
-- oracle existed, or a future write path that bypasses
-- /api/synthesis/state. 'flagged' rows are NEVER auto-sent and NEVER
-- silently dropped; a human reviews them later via ops tooling.
--
-- Additive only (widens an existing CHECK constraint) — no data migration,
-- no RLS change, no new table. Idempotent: drops-then-recreates the CHECK
-- so re-running this file is safe.
--
-- Owner: ai-engineer. This is the SAME (student, teacher, admin) surface as
-- the existing monthly_synthesis_runs table from migration
-- 20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql — no RLS policy
-- change is needed because 'flagged' is just another value of an existing
-- TEXT column already covered by the table's existing SELECT/ALL policies.

BEGIN;

ALTER TABLE monthly_synthesis_runs
  DROP CONSTRAINT IF EXISTS monthly_synthesis_runs_parent_share_status_check;

ALTER TABLE monthly_synthesis_runs
  ADD CONSTRAINT monthly_synthesis_runs_parent_share_status_check
  CHECK (parent_share_status IN ('pending', 'sent', 'opted_out', 'failed', 'suppressed', 'flagged'));

COMMENT ON COLUMN monthly_synthesis_runs.parent_share_status IS
  'WhatsApp delivery state. pending = not yet attempted; sent = delivered; opted_out = guardian opt-out; failed = WhatsApp send error; suppressed = governance suppression; flagged = held for human review after failing the pre-send fabrication re-check (item 4.5) — never auto-sent, never silently dropped.';

COMMIT;
