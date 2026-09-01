-- Per-attempt cost visibility (2026-09-01): every Anthropic/OpenAI attempt in
-- claude.ts's modelOrder fallback loop now writes its own mol_request_logs
-- row, not just the final successful one. Before this, a request that failed
-- on Haiku, failed on Sonnet, then succeeded on OpenAI produced exactly ONE
-- row (the OpenAI success) — the two failed Anthropic attempts were only
-- visible as a 'anthropic:unknown|anthropic:unknown' string on that row's
-- failure_chain, with no cost/token accounting of their own. Every dollar
-- and call-count figure computed from this table before this migration is a
-- floor, not a total.
--
-- Widens the existing 'baseline' | 'shadow' shadow_role CHECK (added
-- 20260519000001_mol_shadow_routing.sql) to also allow 'failed_attempt'.
-- Deliberately additive: existing rows and the mol_shadow_pairs_v1 view
-- (which explicitly filters shadow_role IN ('baseline','shadow')) are
-- untouched — a 'failed_attempt' row is correctly excluded from that
-- baseline/shadow pairing, since it was never a served answer.

ALTER TABLE public.mol_request_logs
  DROP CONSTRAINT IF EXISTS mol_request_logs_shadow_role_check;

ALTER TABLE public.mol_request_logs
  ADD CONSTRAINT mol_request_logs_shadow_role_check
  CHECK (shadow_role IS NULL OR shadow_role IN ('baseline', 'shadow', 'failed_attempt'));

COMMENT ON COLUMN public.mol_request_logs.shadow_role IS
  '''baseline'' = the answer actually served to the student (or shadow-only baseline). ''shadow'' = a shadow-mode comparison call, never served. ''failed_attempt'' = one non-final rung of the modelOrder fallback loop that errored before the caller moved to the next model — usd_cost/prompt_tokens/completion_tokens are 0 unless the provider''s response carried usage data despite the error. NULL = legacy pre-C4 row.';
