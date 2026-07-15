-- Migration: 20260715000100_seed_ff_foxy_answer_continuation_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_answer_continuation_v1` (Foxy Phase
--          0.2 — generation side, bounded max_tokens continuation) so the row
--          EXISTS in public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_foxy_answer_continuation_v1
--     When ON: a Foxy structured turn that stops with stop_reason='max_tokens'
--     (the JSON answer was cut off by the token budget mid-generation) triggers
--     exactly ONE bounded continuation call in the grounded-answer pipeline
--     (supabase/functions/grounded-answer/pipeline.ts). The partial answer is
--     replayed as an assistant turn and the model is asked to emit ONLY the
--     remaining JSON; the two payloads are concatenated and re-validated. If the
--     merged payload round-trips validation it is served (recovering the tail
--     that rescueFromTruncatedJson would otherwise drop); if the continuation
--     itself truncates or fails, the pipeline falls back to the EXISTING
--     rescueFromTruncatedJson → wrapAsParagraph safety net — `structured` is
--     always defined (P12). Bounded to a SINGLE continuation round (no loops).
--     When OFF (the default): the grounded-answer pipeline is BYTE-IDENTICAL to
--     today — no continuation call is made and the existing rescue/wrap path is
--     the only recovery for a truncated structured answer.
--
-- Spec/task: Foxy "long answers get cut off" fix, Phase 0.2 (generation side).
--            Companion to ff_foxy_durable_thread_v1 (server/persistence side).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isAnswerContinuationEnabled in
-- supabase/functions/grounded-answer/_continuation-flag.ts) fail-CLOSED: only a
-- row with is_enabled = true enables the behavior, so the flag stays OFF until
-- an operator explicitly flips it. Seeding the row makes the flag visible/
-- auditable — it does NOT enable the behavior. Merging this migration is a
-- zero-behavior change (the pipeline reads this flag ONLY when a turn already
-- stopped at max_tokens and, finding it OFF, runs the existing rescue path).
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715000000_seed_ff_foxy_durable_thread_v1.sql,
-- 20260702000700_seed_ff_digital_twin_v1.sql, and
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql for the defensive to_regclass
-- guard + explicit column list + audit description). Scoping arrays are left
-- NULL (no role/env/institution narrowing) — the global is_enabled=false /
-- rollout=0 double gate is what holds the flag OFF. The explicit column list
-- (flag_name first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125
-- (canonical feature_flags shape: flag_name/is_enabled, NOT name/enabled; never
-- DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: ai-engineer (grounded-answer pipeline reads this exact flag name) +
--        assessment (AI-tutor correctness review, P14) + testing (P14).
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_answer_continuation_v1';
-- The pipeline resolves a missing flag to OFF (fail-closed), so deletion is
-- silent on the production experience (the existing rescue path is unchanged).

DO $foxy_answer_continuation$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_foxy_answer_continuation_v1',
      false,
      0,
      'Foxy Phase 0.2 bounded max_tokens continuation (generation side). When ON, a Foxy structured turn cut off at stop_reason=max_tokens triggers exactly ONE continuation call in the grounded-answer pipeline: the partial answer is replayed as an assistant turn, the model emits ONLY the remaining JSON, and the merged payload is re-validated. If it round-trips it is served (recovering the truncated tail); otherwise the pipeline falls back to the existing rescueFromTruncatedJson → wrapAsParagraph net (structured always defined, P12). Bounded to a single round. When OFF (default) the pipeline is byte-identical to today. Fail-CLOSED read (isAnswerContinuationEnabled). SEPARATE flag from ff_foxy_durable_thread_v1. Default off; staging-first. Task: Foxy long-answers-cut-off fix Phase 0.2 (generation).',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_answer_continuation_v1 seed (fresh DB).';
  END IF;
END $foxy_answer_continuation$;
