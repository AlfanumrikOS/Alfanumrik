-- Removes 20 confirmed-dead feature_flags rows, found during a super-admin
-- console audit (2026-08-31). Each is:
--   (a) NOT in the protected_feature_flags/PROTECTED_FLAGS governance
--       registry (packages/lib/src/flags/protected-flags.ts), and
--   (b) zero references anywhere in application runtime source
--       (apps/host/src, packages/*/src, mobile/lib, supabase/functions),
--       confirmed via a repo-wide ripgrep pass on the exact flag_name, cross-
--       checked for camelCase-conversion or Python-service consumers (none
--       exist -- isFeatureEnabled() is always called with a literal string).
--
-- 3 are fully orphaned: zero trace anywhere in the repo, not even a
-- migration that seeded them (adaptive_learning_path, guardian_dashboard,
-- premium_badges) -- likely created directly via the super-admin console
-- UI at some point and never wired to anything.
--
-- The other 17 exist only in seed migrations, planning docs, or trackers --
-- features that were flagged ON but whose gating code was never written, or
-- was later removed without deleting the flag (e.g. ff_foxy_close_stage_v1 /
-- ff_foxy_director_prompt_v1, seeded 2026-08-11, referenced only in
-- docs/trackers/foxy-north-star/tracker.json and their own seed migrations).
--
-- All 20 were is_enabled=true / rollout_percentage=100 at the time of this
-- migration -- but since nothing reads them, that state had zero live
-- behavioral effect. Deleting them changes nothing about running behavior;
-- it only removes console clutter and false "this is live" signal.
--
-- Full row snapshot preserved in a backup table first (this repo's
-- established convention for destructive cleanups, e.g.
-- _rls_policy_backup_20260818) -- restorable if any of these turns out to
-- have a consumer this audit missed.

CREATE TABLE IF NOT EXISTS public._feature_flags_dead_flags_backup_20260831 AS
SELECT * FROM public.feature_flags WHERE 1=0;

-- CI's "Migration Safety: RLS Coverage" check (CLAUDE.md P8) requires every
-- CREATE TABLE to enable RLS in the same migration file. Matches the
-- existing repo convention for backup tables (_ao10b_grade_backfill_backup,
-- 20260702070000_ao10b_backfill_student_grade_p5.sql): service_role bypasses
-- RLS regardless, but an explicit ALL-for-service_role policy makes the
-- intent unambiguous and leaves the table fully closed to anon/authenticated
-- (no policy for them => deny-by-default).
ALTER TABLE public._feature_flags_dead_flags_backup_20260831 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "_feature_flags_dead_flags_backup_service_role_all" ON public._feature_flags_dead_flags_backup_20260831;
CREATE POLICY "_feature_flags_dead_flags_backup_service_role_all"
  ON public._feature_flags_dead_flags_backup_20260831
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public._feature_flags_dead_flags_backup_20260831
SELECT * FROM public.feature_flags
WHERE flag_name IN (
  'adaptive_learning_path', 'adaptive_post_quiz', 'devops_agent',
  'ff_agent_mesh_v1', 'ff_foxy_close_stage_v1', 'ff_foxy_director_prompt_v1',
  'ff_goal_admin_profiles', 'ff_level_up_celebration_v1', 'ff_mol_cost_cap_inr',
  'foxy_cognitive_engine', 'foxy_diagram_rendering', 'guardian_dashboard',
  'premium_badges', 'quiz_assembler_v2', 'wave1_affective_coaching',
  'wave1_foxy_tutor', 'wave1_irt_personalization', 'wave1_launch',
  'wave1_parent_digest', 'wave1_spaced_repetition'
);

DELETE FROM public.feature_flags
WHERE flag_name IN (
  'adaptive_learning_path', 'adaptive_post_quiz', 'devops_agent',
  'ff_agent_mesh_v1', 'ff_foxy_close_stage_v1', 'ff_foxy_director_prompt_v1',
  'ff_goal_admin_profiles', 'ff_level_up_celebration_v1', 'ff_mol_cost_cap_inr',
  'foxy_cognitive_engine', 'foxy_diagram_rendering', 'guardian_dashboard',
  'premium_badges', 'quiz_assembler_v2', 'wave1_affective_coaching',
  'wave1_foxy_tutor', 'wave1_irt_personalization', 'wave1_launch',
  'wave1_parent_digest', 'wave1_spaced_repetition'
);

-- Self-verifying post-conditions.
DO $$
DECLARE
  v_backup_count int;
  v_remaining_count int;
BEGIN
  SELECT count(*) INTO v_backup_count FROM public._feature_flags_dead_flags_backup_20260831;
  IF v_backup_count <> 20 THEN
    RAISE EXCEPTION 'Expected 20 rows backed up, got %', v_backup_count;
  END IF;

  SELECT count(*) INTO v_remaining_count FROM public.feature_flags
  WHERE flag_name IN (
    'adaptive_learning_path', 'adaptive_post_quiz', 'devops_agent',
    'ff_agent_mesh_v1', 'ff_foxy_close_stage_v1', 'ff_foxy_director_prompt_v1',
    'ff_goal_admin_profiles', 'ff_level_up_celebration_v1', 'ff_mol_cost_cap_inr',
    'foxy_cognitive_engine', 'foxy_diagram_rendering', 'guardian_dashboard',
    'premium_badges', 'quiz_assembler_v2', 'wave1_affective_coaching',
    'wave1_foxy_tutor', 'wave1_irt_personalization', 'wave1_launch',
    'wave1_parent_digest', 'wave1_spaced_repetition'
  );
  IF v_remaining_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 of the 20 dead flags to remain, got %', v_remaining_count;
  END IF;
END
$$;

COMMENT ON TABLE public._feature_flags_dead_flags_backup_20260831 IS
  'Full-row backup of 20 feature_flags rows deleted 2026-08-31 (console audit: confirmed zero code references, not in protected_feature_flags). Restorable via INSERT INTO feature_flags SELECT * FROM this table if any turns out to have a consumer this audit missed.';
