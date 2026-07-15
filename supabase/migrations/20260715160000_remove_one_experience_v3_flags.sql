-- Purpose: remove the retired One Experience V3 role rollout flags.
-- PR-2 of the v3 removal. PR-1 (v3 code + health-route decoupling) already
-- shipped and deployed, so nothing reads these rows anymore.
-- Forward-only. The seed (20260711010000) and enforce-off (20260712052203)
-- migrations remain untouched as historical record. Idempotent; fail-safe if
-- feature_flags is absent (fresh DBs that never seeded these rows).
DO $remove_ff_ui_v3$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    DELETE FROM public.feature_flags
     WHERE flag_name = ANY (ARRAY[
       'ff_ui_v3_student',
       'ff_ui_v3_teacher',
       'ff_ui_v3_parent',
       'ff_ui_v3_school_admin',
       'ff_ui_v3_super_admin'
     ]::text[]);
  END IF;
END
$remove_ff_ui_v3$;
