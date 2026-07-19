-- Seed: ff_engagement_dashboard_v1 (Foxy Enhancement Plan, Phase 4)
-- Student-facing engagement/progress dashboard.
-- Default OFF. REG-125 conformance.

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_engagement_dashboard_v1', false, 0,
      'Student-facing engagement dashboard at /progress/dashboard — XP/level ring, streak flame, cross-subject mastery radar, per-subject mastery bands, recent quiz history. No new tables; aggregates from existing students/concept_mastery/quiz_responses.',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  END IF;
END $block$;
