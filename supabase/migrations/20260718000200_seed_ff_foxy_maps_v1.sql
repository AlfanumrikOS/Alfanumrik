-- Seed: ff_foxy_maps_v1 (Foxy Enhancement Plan, Phase 3)
-- SST map block rendering for geography/political/historical maps.
-- Default OFF. REG-125 conformance.

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_foxy_maps_v1', false, 0,
      'Foxy SST map blocks — geographic/political/thematic/historical maps with markers, highlighted regions, and layer toggles. When ON, MAP_DIRECTIVE appended to SST prompts. When OFF, text-only SST (byte-identical to today).',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  END IF;
END $block$;
