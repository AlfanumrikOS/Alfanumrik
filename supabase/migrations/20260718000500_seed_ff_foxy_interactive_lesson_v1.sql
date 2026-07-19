-- Seed: ff_foxy_interactive_lesson_v1 (Foxy Enhancement Plan, Phase 6)
-- Interactive lesson mode with step-by-step voice narration.
-- Depends on voice playback (Phase 2). Default OFF. REG-125 conformance.

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_foxy_interactive_lesson_v1', false, 0,
      'Foxy interactive lesson mode — structured step-by-step lesson flow (hook → explanation → worked_example → guided_practice → independent_practice → reflection) with auto-triggered voice playback, check questions gating progression, and voice synchronization. Depends on Python voice TTS (usePythonVoiceEnabled).',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  END IF;
END $block$;
