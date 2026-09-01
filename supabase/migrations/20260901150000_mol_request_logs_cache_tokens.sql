-- Migration: 20260901150000_mol_request_logs_cache_tokens.sql
-- Purpose: record Anthropic prompt-caching token counters on mol_request_logs
--          so AI spend stops being under-reported.
--
-- ─── The defect this closes ──────────────────────────────────────────────────
--
--   supabase/functions/_shared/mol/providers/anthropic.ts read ONLY
--   usage.input_tokens from the Anthropic response. Anthropic reports a cached
--   request as a small input_tokens PLUS a large cache_read_input_tokens /
--   cache_creation_input_tokens. Those two were dropped on the floor, so:
--
--     * telemetry logged 15-35 prompt tokens for a Foxy doubt_solving call
--       whose identical twin on OpenAI logged 9,000-12,500 (measured
--       2026-09-01 in this table) — a ~400x under-count;
--     * calcCost() priced the dropped tokens at ZERO, so usd_cost understated
--       every cached Anthropic call;
--     * consequently no prompt-caching optimisation could be VERIFIED from
--       telemetry — the metric that should prove a saving was the same metric
--       that was blind to the cost.
--
--   Cost multipliers now applied in calcCost (published Anthropic rates,
--   relative to the model's base input price): cache read 0.1x, cache write
--   1.25x. A cache read is cheap, not free; a cache write costs MORE than an
--   uncached token, so omitting writes biased the estimate low in exactly the
--   direction that hides a regression.
--
-- ─── Shape ───────────────────────────────────────────────────────────────────
--
--   Both columns NOT NULL DEFAULT 0. Zero (not NULL) so that
--   sum(cache_read_tokens) never silently drops rows, and so historical rows
--   read as "no caching recorded" rather than "unknown". Backfill is
--   deliberately NOT attempted: the true pre-2026-09-01 values were never
--   received from the API and cannot be reconstructed. Rows before this
--   migration therefore under-report Anthropic cost and must not be compared
--   like-for-like against rows after it.
--
-- Additive and idempotent: two ADD COLUMN IF NOT EXISTS on an existing table.
-- No RLS change (mol_request_logs' existing policies are untouched, and no new
-- table is created, so P8 does not apply).

DO $mol_request_logs_cache_tokens$
BEGIN
  IF to_regclass('public.mol_request_logs') IS NOT NULL THEN

    ALTER TABLE public.mol_request_logs
      ADD COLUMN IF NOT EXISTS cache_read_tokens integer NOT NULL DEFAULT 0;

    ALTER TABLE public.mol_request_logs
      ADD COLUMN IF NOT EXISTS cache_write_tokens integer NOT NULL DEFAULT 0;

    COMMENT ON COLUMN public.mol_request_logs.cache_read_tokens IS
      'Anthropic cache_read_input_tokens — prompt tokens served from an existing cache entry, billed at 0.1x the model input rate. 0 for OpenAI and for any call where caching did not engage. Rows written before migration 20260901150000 are 0 because the value was never captured, NOT because caching was absent.';

    COMMENT ON COLUMN public.mol_request_logs.cache_write_tokens IS
      'Anthropic cache_creation_input_tokens — prompt tokens written into the cache by this call, billed at 1.25x the model input rate. 0 for OpenAI and for any call where caching did not engage. Same pre-20260901150000 caveat as cache_read_tokens.';

  END IF;
END
$mol_request_logs_cache_tokens$;
