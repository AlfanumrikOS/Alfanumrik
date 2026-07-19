-- Seed: ff_foxy_olympiad_mode_v1 (Foxy Enhancement Plan, Phase 5)
-- Olympiad teaching mode with competition-level problems.
-- Default OFF. REG-125 conformance.

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_foxy_olympiad_mode_v1', false, 0,
      'Foxy olympiad teaching mode — competition-level problems, Bloom analyze/evaluate/create only, no hints on first attempt, strategy tips, Indian olympiad context (RMO, INMO, NSEP). Requires engagement dashboard for auto-escalation tracking.',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  END IF;
END $block$;
