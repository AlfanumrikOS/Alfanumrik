-- Migration: 20260507000001_add_ff_learn_read_mode_v1.sql
-- Purpose: Seed the `ff_learn_read_mode_v1` feature flag that gates the
--          Read-mode toggle on /learn/[subject]/[chapter]. Phase 2-B of
--          the May 2026 upgrade.
--
-- Background. The /learn chapter page today walks students through a
-- list of concept titles + quick-check questions. It does NOT render
-- actual NCERT chapter prose. Phase 2-B adds a "Read" mode that pulls
-- chapter text from `rag_content_chunks` (the same table the RAG
-- retrieval pipeline uses) and renders it with react-markdown + KaTeX.
--
-- When OFF, the page behaves exactly as it does today (practice mode
-- only — no toggle visible). When ON, students see a "Practice / Read"
-- toggle in the header and can switch between the two surfaces.
--
-- Default state: OFF (is_enabled = false, rollout_percentage = 0).
-- Per-user determinism uses the user's auth UUID via hashForRollout.
--
-- Schema note: feature_flags.flag_name has no UNIQUE constraint; using
-- the established DO $$ IF NOT EXISTS pattern.
-- (Mirrors 20260426150000_add_ff_welcome_v2.sql.)
--
-- Rollout strategy:
-- ─────────────────
--   1. Smoke test in staging
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = ARRAY['staging']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_learn_read_mode_v1';
--
--   2. 10% canary in production
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 10,
--            target_environments = ARRAY['production']::text[],
--            updated_at         = now()
--        WHERE flag_name = 'ff_learn_read_mode_v1';
--
--   3. Full rollout
--        UPDATE feature_flags
--        SET is_enabled         = true,
--            rollout_percentage = 100,
--            target_environments = NULL,
--            target_roles        = NULL,
--            updated_at         = now()
--        WHERE flag_name = 'ff_learn_read_mode_v1';
--
--   4. Instant rollback
--        UPDATE feature_flags
--        SET is_enabled = false, updated_at = now()
--        WHERE flag_name = 'ff_learn_read_mode_v1';
--
-- DOWN (manual): DELETE FROM feature_flags WHERE flag_name = 'ff_learn_read_mode_v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_flags WHERE flag_name = 'ff_learn_read_mode_v1'
  ) THEN
    INSERT INTO feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description
    )
    VALUES (
      'ff_learn_read_mode_v1',
      false,                  -- OFF by default
      0,                      -- 0% rollout
      'Gates the Read-mode toggle on /learn/[subject]/[chapter]. When ON, '
      'students can switch between practice mode (concept walkthrough + '
      'quick-check questions, current behaviour) and a new Read mode that '
      'renders NCERT chapter prose from rag_content_chunks via '
      'react-markdown + KaTeX. When OFF, no toggle is visible and the page '
      'behaves exactly as it did before Phase 2-B. Owner: orchestrator.'
    );
  END IF;
END $$;
