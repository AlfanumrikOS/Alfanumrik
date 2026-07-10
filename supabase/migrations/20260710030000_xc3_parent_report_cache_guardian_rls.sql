-- XC-3 RCA-01: parent report cache now uses an RLS-scoped request client.
-- Some linked targets carried older student-owned parent_weekly_reports policies
-- (`parent_weekly_reports_own_*`) that key on student auth_user_id and therefore
-- fail closed for guardian sessions. Replace them with the intended guardian
-- policies from 20260620000600 before removing route-level service-role access.

ALTER TABLE public.parent_weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_weekly_reports_own_select" ON public.parent_weekly_reports;
DROP POLICY IF EXISTS "parent_weekly_reports_own_insert" ON public.parent_weekly_reports;
DROP POLICY IF EXISTS "parent_weekly_reports_own_update" ON public.parent_weekly_reports;
DROP POLICY IF EXISTS "parent_weekly_reports_own_delete" ON public.parent_weekly_reports;

DROP POLICY IF EXISTS "parent_weekly_reports_guardian_select" ON public.parent_weekly_reports;
CREATE POLICY "parent_weekly_reports_guardian_select"
  ON public.parent_weekly_reports
  FOR SELECT TO authenticated
  USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "parent_weekly_reports_guardian_insert" ON public.parent_weekly_reports;
CREATE POLICY "parent_weekly_reports_guardian_insert"
  ON public.parent_weekly_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "parent_weekly_reports_guardian_update" ON public.parent_weekly_reports;
CREATE POLICY "parent_weekly_reports_guardian_update"
  ON public.parent_weekly_reports
  FOR UPDATE TO authenticated
  USING (public.is_guardian_of(student_id))
  WITH CHECK (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "parent_weekly_reports_service_role" ON public.parent_weekly_reports;
CREATE POLICY "parent_weekly_reports_service_role"
  ON public.parent_weekly_reports
  TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.parent_weekly_reports IS
  'Parent weekly report cache. Guardian RLS policies use public.is_guardian_of(student_id); route cache access is RLS-scoped, not service-role.';
