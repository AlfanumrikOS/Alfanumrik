-- Migration: 20260528000014_foxy_long_memory_flag.sql
-- Phase 4 of Foxy conversation continuity (2026-05-18).
--
-- Purpose: cross-session pedagogical memory. When this flag is ON, the
-- /api/foxy route loads the student's most recent monthly_synthesis_runs
-- row (Pedagogy v2 Wave 3) + a high/low mastery summary + top
-- misconceptions, scrubs the synthesis text for PII (student name), and
-- injects them into Foxy's system prompt as a LEARNER MEMORY block. This
-- lets Foxy reference what the student has already covered, mastered, or
-- struggled with — addressing the "asks a question and when they answer,
-- it doesn't relate" production bug at the cross-session timescale.
--
-- Phases 1-3 cover within-session continuity (idle reactivation, native
-- multi-turn history, pending-expectations). Phase 4 adds the longer-term
-- pedagogical anchor.
--
-- Default OFF. Slow A/B rollout planned: 1% × 2 weeks, then ramp to 100%
-- per plan in docs/superpowers/plans/2026-05-18-foxy-conversation-continuity-fix.md.
--
-- PII discipline (P13): source data passes through scrubStudentName() in
-- src/lib/learn/foxy-long-memory.ts before injection. Concept names,
-- Bloom levels, and curated misconception labels are content-only by
-- construction (editor-curated, never include student data).
--
-- Backward-compat: when the flag is OFF, the route short-circuits before
-- the DB read and the {{learner_memory_section}} template variable
-- substitutes to the empty string, leaving the prompt byte-identical to
-- the pre-Phase-4 shape.
--
-- DOWN (manual): DELETE FROM public.feature_flags WHERE flag_name = 'ff_foxy_long_memory_v1';

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  target_roles,
  target_environments,
  created_at,
  updated_at
)
VALUES (
  'ff_foxy_long_memory_v1',
  false,
  0,
  'Phase 4 Foxy continuity: load monthly_synthesis_runs + mastery + misconception snapshot in loadLongMemorySnapshot, inject as LEARNER MEMORY block in grounded-answer prompt. OFF = prompt has no cross-session pedagogical context (byte-identical to pre-Phase-4). Slow A/B rollout planned (1% × 2 weeks).',
  ARRAY['student']::TEXT[],
  ARRAY['staging', 'production']::TEXT[],
  now(),
  now()
)
ON CONFLICT (flag_name) DO NOTHING;
