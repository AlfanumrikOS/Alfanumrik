-- Seed: ff_foxy_vertical_math_v1 (Foxy Enhancement Plan, Phase 1)
-- Vertical math block rendering for arithmetic operations (grades 6-8).
-- Default OFF. REG-125 conformance: defensive to_regclass guard + explicit
-- column list + ON CONFLICT (flag_name) DO NOTHING.

DO $block$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    ) VALUES (
      'ff_foxy_vertical_math_v1', false, 0,
      'Foxy vertical math block rendering — columnar arithmetic (addition, subtraction, multiplication, long division) for math subjects grades 6-8. When ON, the VERTICAL_MATH_DIRECTIVE is appended to prompts. When OFF, flat LaTeX (byte-identical to today).',
      NULL, NULL, NULL, now(), now()
    ) ON CONFLICT (flag_name) DO NOTHING;
  END IF;
END $block$;
