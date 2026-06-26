-- Migration: 20260626120000_enable_ff_grounded_ai_enabled.sql
-- Purpose: Enable ff_grounded_ai_enabled (the grounded-answer pipeline master toggle).
--
-- Background:
--   The flag was seeded with is_enabled = false in the legacy bootstrap
--   (20260418100800_feature_flags.sql). The streaming pipeline in
--   grounded-answer/pipeline-stream.ts bypassed this flag before the Foxy RCA
--   merge of 2026-06-26. After the RCA, pipeline-stream.ts added an
--   isGroundedAiEnabled() check (CRITICAL-4 fix) that is fail-closed — when
--   the flag is false (or the DB query fails), the streaming pipeline abstains
--   with upstream_error, which surfaces to students as "Foxy is catching its
--   breath."
--
--   The non-streaming pipeline (pipeline.ts) has always had this check.
--   Since ALL Foxy chat requests use the streaming path, the flag being false
--   was previously harmless. It is no longer harmless after the RCA.
--
-- Fix: enable the flag globally. Idempotent.
--
-- Risk: LOW — this re-enables the grounded-answer AI pipeline on streaming
-- requests. The pipeline itself has separate safety gates: circuit breaker,
-- Voyage retrieval, Claude API key requirement, and per-caller quotas.
-- The flag is a kill switch only — it was never intended to remain OFF.

UPDATE public.feature_flags
SET
  is_enabled        = true,
  rollout_percentage = 100,
  updated_at        = now()
WHERE flag_name = 'ff_grounded_ai_enabled';
