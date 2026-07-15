-- Migration: 20260716120000_seed_ff_foxy_math_format_v2.sql
-- Purpose: Seed the feature flag `ff_foxy_math_format_v2` (Wave B — Foxy
--          math-format house style) so the row EXISTS in public.feature_flags
--          and is auditable + flippable from the super-admin console.
--          Default OFF / 0%.
--
--   ff_foxy_math_format_v2
--     When ON: the ai-engineer's MATH_FORMAT_DIRECTIVE (built by
--     buildMathFormatDirective, band-aware '6-8' | '9-12' — both bands
--     IDENTICAL text today per CEO 2026-07-16) is appended to prose-teaching
--     Foxy turns via the mode_directive channel. It pins the CEO-approved
--     house style: worked examples/derivations = numbered "step" blocks (one
--     short action line each) alternating with display "math" blocks (one
--     transformation per step); multi-term math always in "math" blocks,
--     never inline; inline \( ... \) reserved for single symbols/values; no
--     undelimited LaTeX; no plain-parentheses pseudo-delimiters.
--     When OFF (default): the directive is not appended — the /api/foxy
--     mode_directive (and thus the full prompt) is BYTE-IDENTICAL to today.
--     Additive only; never touches the parity-locked
--     FOXY_STRUCTURED_OUTPUT_PROMPT, FOXY_SAFETY_RAILS, or the
--     RAG/grounding/abstain/structured-validation path (P12).
--
-- Plan: Foxy math-format, Wave B (#2 + #3). Ramps later in a staged canary
-- (staging-first), scored by the foxy-quality-sample rubric (v2).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so the math-format
-- directive stays OFF until an operator explicitly flips this flag via the
-- super-admin console. Seeding the row makes the flag visible/auditable — it
-- does NOT enable the behavior. Merging this migration is a zero-behavior
-- change.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715180000_seed_ff_foxy_diagrams_v1.sql,
-- 20260715150000_seed_ff_foxy_teaching_director_v1.sql,
-- 20260619000600_seed_ff_adaptive_loops_bc_v1.sql for the defensive to_regclass
-- guard + explicit column list + audit description). Scoping arrays are left NULL
-- (no role/env/institution narrowing) — the global is_enabled=false / rollout=0
-- double gate is what holds the flag OFF. The explicit column list (flag_name
-- first) + ON CONFLICT (flag_name) DO NOTHING conform to REG-125 (canonical
-- feature_flags shape: flag_name/is_enabled, NOT name/enabled; never DO UPDATE).
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by the
-- feature_flags flag_name unique constraint). The whole INSERT is additionally
-- guarded so it no-ops cleanly if the feature_flags table does not yet exist
-- (fresh DB / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables → RLS
-- N/A; the table keeps its existing baseline RLS posture.
--
-- Owner: ai-engineer (MATH_FORMAT_DIRECTIVE + band-aware builder + route
--        wiring). Reviewers (P14): assessment (curriculum scope +
--        age-appropriateness of the directive), testing (flag-gate
--        byte-identity + band-uniformity pins), quality (build gate).
-- Added: 2026-07-16
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_math_format_v2';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today).

DO $foxy_math_format$
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
      'ff_foxy_math_format_v2',
      false,
      0,
      'Foxy math-format house style (Wave B). When ON: the ai-engineer MATH_FORMAT_DIRECTIVE (band-aware builder, grades 6-8 / 9-12 — both bands identical text today per CEO 2026-07-16) is appended to prose-teaching turns via mode_directive: worked examples as numbered step blocks alternating with display math blocks (one transformation per step), multi-term math never inline, inline \( ... \) only for single symbols/values, no undelimited LaTeX, no plain-parentheses pseudo-delimiters. When OFF (default): no directive — mode_directive + full prompt byte-identical to today. Additive only; never touches the parity-locked FOXY_STRUCTURED_OUTPUT_PROMPT, FOXY_SAFETY_RAILS, or the RAG/grounding/abstain path (P12). Scored by the foxy-quality-sample rubric v2. Default OFF; staged canary. Plan: Foxy math-format, Wave B.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_math_format_v2 seed (fresh DB).';
  END IF;
END $foxy_math_format$;
