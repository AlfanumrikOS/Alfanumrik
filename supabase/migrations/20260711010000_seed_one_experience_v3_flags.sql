-- One Experience V3 role controls. Applying this migration changes no UI:
-- every role is seeded disabled at a 0% deterministic cohort.
DO $seed_one_experience_v3_flags$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES
      ('ff_ui_v3_student', false, 0, 'One Experience V3 Student UI. Auth, entitlement, adaptive and scoring contracts are unchanged.', NULL, NULL, NULL, now(), now()),
      ('ff_ui_v3_teacher', false, 0, 'One Experience V3 Teacher UI. Teacher RBAC and class-scoped APIs remain authoritative.', NULL, NULL, NULL, now(), now()),
      ('ff_ui_v3_parent', false, 0, 'One Experience V3 Parent UI. Guardian links and parent API authorization remain authoritative.', NULL, NULL, NULL, now(), now()),
      ('ff_ui_v3_school_admin', false, 0, 'One Experience V3 School Admin UI. Tenant modules, RBAC and school scope remain authoritative.', NULL, NULL, NULL, now(), now()),
      ('ff_ui_v3_super_admin', false, 0, 'One Experience V3 Super Admin UI. Operator permissions, audit and environment scope remain authoritative.', NULL, NULL, NULL, now(), now())
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping One Experience V3 seed';
  END IF;
END $seed_one_experience_v3_flags$;
