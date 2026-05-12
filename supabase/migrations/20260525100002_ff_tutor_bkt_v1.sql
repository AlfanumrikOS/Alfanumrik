-- 20260525100002_ff_tutor_bkt_v1.sql
-- ADR-004 Phase 2 — the third-of-three flag gating the BKT path.
--
-- Route gating requires ALL THREE flags ON simultaneously:
--   ff_event_bus_v1        — gates publishEvent + state_events writes
--   ff_projector_runner_v1 — kill-switch for the projector runtime
--   ff_tutor_bkt_v1        — this flag; the per-feature switch
--
-- Default OFF in production+staging so this PR ships dark. Flip ON
-- for CEO account first, monitor tutor_answer_path_c_fallback, then
-- canary at 10% on student role.

INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_tutor_bkt_v1',
  'ADR-004 Phase 2 / ADR-005 Path C v2: /api/tutor/next returns attemptId; '
  '/api/tutor/answer calls atomic tutor_commit_attempt RPC; '
  'concept-mastery-projector writes canonical concept_mastery.mastery_mean. '
  'Requires ff_event_bus_v1 AND ff_projector_runner_v1 also ON. '
  'See docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md.',
  false,
  0,
  ARRAY['production','staging']::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
