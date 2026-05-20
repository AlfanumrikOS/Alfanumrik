-- Study Menu v2 — feature flag for the consolidated Study sidebar group.
-- See docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md
--
-- Adds the ff_study_menu_v2 flag (default OFF). When ON, the BottomNav
-- renders the renamed "Study" group with /refresh + /exam-prep + /learn
-- and the old /review, /revise, /study-plan routes 301 to their new
-- homes. Old routes remain functional while the flag is OFF.
--
-- Also widens the spaced_repetition_cards.source check constraint to
-- accept 'student_created' — required by /api/learner/cards/create.

BEGIN;

-- 1. Flag row.
INSERT INTO public.feature_flags (
  flag_name,
  description,
  is_enabled,
  target_roles,
  target_environments,
  target_institutions,
  rollout_percentage
) VALUES (
  'ff_study_menu_v2',
  'Consolidates the student sidebar Review group into Study (Library + Refresh + Exam Sprint). Spec: 2026-05-20-study-section-consolidation-design.md',
  false,
  ARRAY['student']::text[],
  NULL,
  NULL,
  NULL
)
ON CONFLICT (flag_name) DO NOTHING;

-- 2. Widen the spaced_repetition_cards.source check constraint to allow
-- 'student_created'. The existing constraint enumerates the legal source
-- values; we add one and re-create the constraint.
-- (No-op if the constraint already includes 'student_created'.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.check_constraints
    WHERE constraint_name = 'spaced_repetition_cards_source_check'
  ) THEN
    ALTER TABLE public.spaced_repetition_cards
      DROP CONSTRAINT spaced_repetition_cards_source_check;
  END IF;

  ALTER TABLE public.spaced_repetition_cards
    ADD CONSTRAINT spaced_repetition_cards_source_check
    CHECK (source IS NULL OR source IN (
      'quiz_wrong_answer',
      'foxy_chat',
      'study_plan',
      'student_created'
    ));
END $$;

COMMIT;
