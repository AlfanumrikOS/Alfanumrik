-- Migration: 20260809000400_quiz_responses_hint_level_widen_0_5.sql
-- Purpose: Foxy North-Star Phase 3 — widen the quiz_responses.hint_level
--   CHECK from 0..3 to 0..5 (Phase-3 hint ladder adds tiers 4-5).
--
-- ─── SCOPE DECISION (documented per the Phase-3 task instruction) ─────────
-- This migration is COLUMN-CHECK-ONLY. The companion regex widen inside
-- submit_quiz_results_v2 ('^[0-3]$' -> '^[0-5]$') is deliberately NOT here:
-- it lands together with the unhinted-mastery bonus in 20260809000500, which
-- carries ONE copy of the newest RPC body (20260807000500) with both deltas.
-- Rationale: the alternative (regex here + bonus there) requires copying the
-- 500-line v2 body TWICE in back-to-back migrations — two chances for a
-- byte-level divergence, zero benefit. Ordering is safe: between 000400 and
-- 000500 the RPC still regex-guards to 0..3, which the widened 0..5 CHECK
-- accepts; at no point can the RPC produce a value the CHECK rejects.
--
-- Existing data: all rows are NULL or 0..3, a strict subset of 0..5 — the
-- recreated constraint validates without a scan failure. NULL contract from
-- 20260805100100 unchanged (NULL = not reported).
--
-- Idempotent: DO-block drop-if-exists + recreate (constraint swap; NOT a
-- table/column DROP). Additive semantics only. RLS: quiz_responses policies
-- are row-scoped; no change needed.
-- Owner: architect. Reviewers (P14): assessment (hint-ladder semantics),
--   frontend (hint UI tiers), testing. Added: 2026-08-05.

DO $hint_level_widen$
BEGIN
  ALTER TABLE public.quiz_responses
    DROP CONSTRAINT IF EXISTS quiz_responses_hint_level_check;
  ALTER TABLE public.quiz_responses
    ADD CONSTRAINT quiz_responses_hint_level_check
    CHECK (hint_level >= 0 AND hint_level <= 5);
    -- NULL rows pass a CHECK automatically (unknown ≠ false), preserving the
    -- nullable no-backfill contract from 20260805100100.
END $hint_level_widen$;

COMMENT ON COLUMN public.quiz_responses.hint_level IS
  'Highest hint tier the student used on this question (0 = none; 1-5 = '
  'progressive hints — widened from 1-3 by 20260809000400 for the Phase-3 '
  'hint ladder). NULL = not reported (legacy clients / v1 path). Written by '
  'submit_quiz_results_v2 from the optional "hint_level" key on each '
  'responses[] element. Since 20260809000500, hint_level = 0 on a correct '
  'answer additionally feeds the capped unhinted_mastery bonus lane '
  '(award_xp_capped); the P2 quiz XP formula itself remains untouched.';
