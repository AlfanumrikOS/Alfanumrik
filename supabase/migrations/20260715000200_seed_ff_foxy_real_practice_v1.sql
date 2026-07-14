-- Migration: 20260715000200_seed_ff_foxy_real_practice_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_real_practice_v1` (Foxy Phase 0.3 —
--          make practice-mode actions REAL) so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0%.
--
--   ff_foxy_real_practice_v1
--     When ON: a Foxy PRACTICE turn (UI-selected practice OR quiz-intent
--     auto-promotion, but NOT the single-MCQ "Quiz me" action) emits INTERACTIVE
--     `mcq` blocks instead of the legacy 5 markdown pseudo-MCQs that render as
--     NON-interactive text you cannot answer. The route (apps/host/src/app/api/
--     foxy/route.ts) then, before showing ANY of them:
--       (1) oracle-gates EVERY mcq through the SAME P6 + REG-54 oracle that gates
--           the single "Quiz me" mcq (deterministic checks + LLM grader; fails
--           CLOSED per mcq) — a failing mcq is DROPPED, never shown (P12);
--       (2) rebuilds the turn to contain ONLY oracle-passed mcq blocks
--           (buildGatedPracticeResponse) — the anti-fake guardrail, so a turn can
--           never CLAIM questions it did not actually emit as gated mcqs;
--       (3) if NO mcq survives, serves a graceful bilingual fallback (never a
--           garbage mcq, never a false "I made a quiz" claim);
--       (4) serves the FIRST surviving mcq as ONE evidential foxy_served_items row
--           on the lead concept — identical to "Quiz me" — so answering it moves
--           mastery through the sanctioned /api/foxy/quiz-answer pipeline (3s
--           anti-cheat floor + idempotency + XP-free). The remaining mcqs are
--           real, answerable self-check (NON-evidential; mastery can never be
--           double-counted on one turn — P1/P2/P3).
--     A real-practice turn is forced OFF the streaming path (the mcqs must be
--     oracle-gated on the FULL structured payload before display).
--     When OFF (the default): a practice turn is BYTE-IDENTICAL to today — the
--     legacy MODE_DIRECTIVES.practice (5 markdown pseudo-MCQs) shape is used, no
--     multi-MCQ gate runs, and the flag is not even read on non-practice turns.
--
-- Spec/task: Foxy "make actions REAL" fix, Phase 0.3. Eliminates the fake-action
--            bug ("it says 'Generated 5 quiz questions' but they're just text you
--            can't answer"). Reuses the "Quiz me" evidential machinery.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts) returns
-- false for both `is_enabled = false` AND `rollout_percentage <= 0`, so the flag
-- stays OFF until an operator explicitly flips it via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change (the route reads
-- this flag ONLY on a practice turn and, finding it OFF, runs the existing
-- MODE_DIRECTIVES.practice path verbatim).
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715000100_seed_ff_foxy_answer_continuation_v1.sql,
-- 20260715000000_seed_ff_foxy_durable_thread_v1.sql, and
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
-- Owner: ai-engineer (the Foxy route reads this exact flag name) +
--        assessment (AI-tutor correctness / P6 review, P14) + testing (P14).
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_real_practice_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (practice reverts to the existing legacy directive).

DO $foxy_real_practice$
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
      'ff_foxy_real_practice_v1',
      false,
      0,
      'Foxy Phase 0.3 real practice actions. When ON, a Foxy practice turn (UI practice OR quiz-intent auto-promotion, not the single "Quiz me" action) emits INTERACTIVE mcq blocks instead of the legacy 5 markdown pseudo-MCQs that render as non-interactive text. Every mcq is oracle-gated (P6 + REG-54, deterministic + LLM grader, fails CLOSED per mcq) before display; failing mcqs are dropped; the turn is rebuilt to contain ONLY oracle-passed mcq blocks (anti-fake guardrail — no prose can claim a quiz it did not emit); if none survive a graceful bilingual fallback is served. The FIRST surviving mcq is served as ONE evidential foxy_served_items row on the lead concept (identical to Quiz me) so answering it moves mastery through /api/foxy/quiz-answer (3s floor + idempotency + XP-free); the remaining mcqs are real, answerable self-check (non-evidential; mastery never double-counted — P1/P2/P3). Real practice is forced off the streaming path (mcqs gated on the full payload before display). When OFF (default) a practice turn is byte-identical to today (legacy MODE_DIRECTIVES.practice) and the flag is not read on non-practice turns. Default off; staging-first. Task: Foxy make-actions-real Phase 0.3.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_real_practice_v1 seed (fresh DB).';
  END IF;
END $foxy_real_practice$;
