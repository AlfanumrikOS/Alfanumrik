-- One Experience V3 launch safety backstop.
--
-- The earlier seed migration intentionally used ON CONFLICT DO NOTHING and
-- skipped when public.feature_flags was absent. That shape was additive, but
-- it could not guarantee an OFF/0 state when a row already existed or when the
-- earlier migration had been recorded against a drifted database. This
-- forward-only migration fails closed on schema drift and atomically enforces
-- the required launch posture for all five role flags.

BEGIN;

DO $one_experience_v3_feature_flags_precondition$
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE EXCEPTION
      'One Experience V3 flag enforcement requires public.feature_flags; refusing to continue';
  END IF;
END;
$one_experience_v3_feature_flags_precondition$;

INSERT INTO public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  description,
  created_at,
  updated_at
)
VALUES
  ('ff_ui_v3_student', false, 0, 'One Experience V3 Student UI. Auth, entitlement, adaptive and scoring contracts are unchanged.', now(), now()),
  ('ff_ui_v3_teacher', false, 0, 'One Experience V3 Teacher UI. Teacher RBAC and class-scoped APIs remain authoritative.', now(), now()),
  ('ff_ui_v3_parent', false, 0, 'One Experience V3 Parent UI. Guardian links and parent API authorization remain authoritative.', now(), now()),
  ('ff_ui_v3_school_admin', false, 0, 'One Experience V3 School Admin UI. Tenant modules, RBAC and school scope remain authoritative.', now(), now()),
  ('ff_ui_v3_super_admin', false, 0, 'One Experience V3 Super Admin UI. Operator permissions, audit and environment scope remain authoritative.', now(), now())
ON CONFLICT (flag_name) DO UPDATE
SET
  is_enabled = false,
  rollout_percentage = 0,
  updated_at = now();

DO $one_experience_v3_feature_flags_postcondition$
DECLARE
  compliant_flag_count integer;
BEGIN
  SELECT count(*)
    INTO compliant_flag_count
    FROM public.feature_flags
   WHERE flag_name = ANY (ARRAY[
     'ff_ui_v3_student',
     'ff_ui_v3_teacher',
     'ff_ui_v3_parent',
     'ff_ui_v3_school_admin',
     'ff_ui_v3_super_admin'
   ]::text[])
     AND is_enabled IS FALSE
     AND rollout_percentage = 0;

  IF compliant_flag_count <> 5 THEN
    RAISE EXCEPTION
      'One Experience V3 flag enforcement failed: expected 5 disabled flags at 0%%, found %',
      compliant_flag_count;
  END IF;
END;
$one_experience_v3_feature_flags_postcondition$;

COMMIT;
