-- Migration: 20260512075619_ff_tutor_v1.sql
-- Purpose:    Seed feature flag for the Adaptive Tutor (ADR-004 Phase 0).
--
-- When ON for a student-role user:
--   • GET  /api/tutor/next returns the next concept (curated, sequential)
--   • POST /api/tutor/answer accepts MCQ outcomes and upserts concept_mastery
--   • /tutor page renders the concept + MCQ flow
--   • /learn/[subject]/[chapter] continues to render (legacy path; kept until
--     /tutor proves out across grades)
--
-- When OFF:
--   • Both routes return 404
--   • /tutor page renders a "coming soon" with a back link
--
-- Idempotent via ON CONFLICT (flag_name) DO NOTHING. Default is OFF so this
-- migration is safe to apply globally before any code or content is ready.
--
-- Rollback: UPDATE feature_flags SET is_enabled=false WHERE flag_name='ff_tutor_v1';
--
-- ADR: docs/architecture/ADR-004-adaptive-tutor.md

INSERT INTO public.feature_flags
  (flag_name, is_enabled, target_roles, target_environments,
   target_institutions, rollout_percentage, metadata)
VALUES
  ('ff_tutor_v1',
   false,
   ARRAY['student'],
   NULL, NULL,
   0,
   jsonb_build_object(
     'description', 'Adaptive Tutor v1 — concept-first OS, /tutor page, /api/tutor/* routes. Phase 0 = sequential picker, naive mastery write, no decay/prereq yet.',
     'adr',         'docs/architecture/ADR-004-adaptive-tutor.md',
     'target_user_ids', jsonb_build_array()
   ))
ON CONFLICT (flag_name) DO NOTHING;
