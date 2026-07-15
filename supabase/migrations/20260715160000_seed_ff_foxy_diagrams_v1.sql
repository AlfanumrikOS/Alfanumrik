-- Migration: 20260715160000_seed_ff_foxy_diagrams_v1.sql
-- Purpose: Seed the feature flag `ff_foxy_diagrams_v1` (Wave 2 — Foxy Mermaid
--          diagram capability) so the row EXISTS in public.feature_flags and is
--          auditable + flippable from the super-admin console. Default OFF / 0%.
--
--   ff_foxy_diagrams_v1
--     When ON: Foxy may emit Mermaid diagram blocks in teaching replies — the
--     ai-engineer's DIAGRAM_DIRECTIVE (which both permits Mermaid and BANS
--     ASCII-art diagrams) is appended to the request, and the frontend
--     lazy-loaded Mermaid renderer parses/renders those blocks. The mermaid
--     library (~500 kB+) is loaded as a DYNAMIC async chunk via import('mermaid')
--     so it never enters the shared bundle or the /foxy first-load (P10).
--     When OFF (default): the DIAGRAM_DIRECTIVE is not appended (Foxy does not
--     produce Mermaid blocks), and the renderer never mounts / never imports the
--     mermaid chunk — the /api/foxy flow and the /foxy first-load are
--     BYTE-IDENTICAL to today. Additive only; never touches the
--     RAG/grounding/abstain/structured-validation path (P12).
--
-- Plan: Foxy diagrams, Wave 2. Ramps later in a staged canary (staging-first).
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false for
-- both `is_enabled = false` AND `rollout_percentage <= 0`, so diagrams stay OFF
-- until an operator explicitly flips this flag via the super-admin console.
-- Seeding the row makes the flag visible/auditable — it does NOT enable the
-- behavior. Merging this migration is a zero-behavior change.
--
-- ─── Column shape (REG-125) ───────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent VERBATIM
-- (20260715150000_seed_ff_foxy_teaching_director_v1.sql,
-- 20260715130000_seed_ff_foxy_perception_v1.sql,
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
-- Owner: architect (this seed). Reviewers (P14): ai-engineer (DIAGRAM_DIRECTIVE
--        + ASCII-art ban), frontend (lazy-loaded Mermaid renderer; P10 dynamic
--        import), quality (build gate), testing.
-- Added: 2026-07-15
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_foxy_diagrams_v1';
-- The application resolves a missing flag to OFF, so deletion is silent on the
-- production experience (byte-identical to today).

DO $foxy_diagrams$
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
      'ff_foxy_diagrams_v1',
      false,
      0,
      'Foxy Mermaid diagram rendering + ASCII-art ban directive. When ON: the ai-engineer DIAGRAM_DIRECTIVE (permit Mermaid, ban ASCII-art diagrams) is appended to the Foxy request and the frontend lazy-loaded Mermaid renderer parses/renders diagram blocks; the mermaid library (~500 kB+) loads as a DYNAMIC async chunk via import(''mermaid'') so it never enters the shared bundle or the /foxy first-load (P10). When OFF (default): no DIAGRAM_DIRECTIVE, renderer never mounts / never imports mermaid — /api/foxy + /foxy first-load byte-identical to today. Additive only; never touches the RAG/grounding/abstain/structured-validation path (P12). Default OFF; staged canary. Plan: Foxy diagrams, Wave 2.',
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_foxy_diagrams_v1 seed (fresh DB).';
  END IF;
END $foxy_diagrams$;
