-- 20260904110000_p2_5_phase2j_split_merge_for_all_policies_batch9.sql
--
-- P2-5 phase 2, batch 9 of Category B (2026-09-03 launch audit, CEO-approved
-- "full consolidation, small batches with tests" — follow-up to batch 7's
-- discovery of the FOR ALL/per-command policy overlap category, migration
-- 20260904090000). This is Tier 3, the highest-risk tier from that
-- discovery: the FOR ALL policy and a per-command policy for the same
-- table+role genuinely protect DIFFERENT, non-overlapping populations —
-- unlike batch 8 (Tier 2), where the existing per-command policy already
-- provably covered everything the FOR ALL policy implied.
--
-- ---------------------------------------------------------------------------
-- THE FIX PATTERN (different from both batch 7's pure drops and batch 8's
-- pure splits — this batch needs BOTH)
-- ---------------------------------------------------------------------------
-- For each table with FOR ALL policy P_A and a narrower per-command policy
-- P_B (same role, genuinely different predicate):
--   1. DROP both P_A and P_B.
--   2. CREATE ONE merged policy for P_B's command, USING (P_A OR P_B) —
--      this is the only way to eliminate the double-evaluation Postgres was
--      already doing for that command while preserving EXACTLY the access
--      each policy used to grant (whoever satisfied EITHER predicate before
--      still satisfies the OR now; nobody who satisfied neither gains
--      access).
--   3. CREATE separate policies for every OTHER action P_A covered (that
--      P_B did not) carrying P_A alone, verbatim — preserving that access
--      completely unchanged.
-- Every USING/WITH CHECK expression below is copied verbatim from the exact
-- live pg_policies text pulled immediately before writing this migration —
-- the OR-combination is mechanical, not a rewritten/simplified predicate.
--
-- 7 of the 8 tables follow the simple two-policy shape (FOR ALL + one
-- SELECT-only policy → merged SELECT + 3 write-only splits):
-- assignments, cbse_syllabus, class_teachers, classroom_polls, cms_assets,
-- ff_grounded_ai_enforced_pairs, school_invite_codes.
--
-- mock_test_responses is the complex case: mock_test_responses_admin_all
-- (FOR ALL) overlaps THREE separate per-command policies simultaneously
-- (insert_own, select_own, update_own — all with the identical
-- attempt-ownership predicate). Each of those three gets its own OR-merge
-- with the admin predicate; DELETE (which nothing else covered) gets a new
-- policy carrying the admin predicate alone.
--
-- assignments_select_merged (this table's own batch-3 merge,
-- 20260903200000) is being further extended here — the teacher-owns-
-- assignment branch (from "Teachers can manage own assignments") is ORed in
-- as a 4th branch alongside its existing 3 (school-admin, student,
-- teacher-of-class). Kept under the SAME name for continuity since it is
-- still fundamentally "the merged SELECT policy for assignments."
--
-- ---------------------------------------------------------------------------
-- RECURSION-GUARD LEDGER AND THE rls-inventory.test.ts DENY-ALL LEDGER
-- ---------------------------------------------------------------------------
-- See the companion updates to
-- apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts (most of the
-- 32 new policies here inline a cross-table subquery and need grandfather
-- entries) and apps/host/src/__tests__/rls-inventory.test.ts (this
-- migration's mock_test_responses statements are the first the migration
-- chain has ever seen for that table — same migration-chain-vs-production
-- drift class already fixed for exam_papers in batch 8 — so
-- "mock_test_responses" is pruned from SERVICE_ROLE_ONLY_TABLES too).

-- -- public.assignments --
DROP POLICY IF EXISTS "Teachers can manage own assignments" ON public.assignments;
DROP POLICY IF EXISTS "assignments_select_merged" ON public.assignments;
CREATE POLICY "assignments_select_merged" ON public.assignments
  FOR SELECT TO authenticated
  USING (
  (teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid))))
  OR (class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true))))
  OR (class_id IN ( SELECT cs.class_id
   FROM (class_students cs
     JOIN students s ON ((s.id = cs.student_id)))
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid))))
  OR (class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid))))
  );
CREATE POLICY "Teachers can insert own assignments" ON public.assignments
  FOR INSERT TO authenticated
  WITH CHECK (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can update own assignments" ON public.assignments
  FOR UPDATE TO authenticated
  USING (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  )
  WITH CHECK (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can delete own assignments" ON public.assignments
  FOR DELETE TO authenticated
  USING (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );

-- -- public.cbse_syllabus --
DROP POLICY IF EXISTS "cbse_syllabus_write_admin" ON public.cbse_syllabus;
DROP POLICY IF EXISTS "cbse_syllabus_read_authenticated" ON public.cbse_syllabus;
CREATE POLICY "cbse_syllabus_select_merged" ON public.cbse_syllabus
  FOR SELECT TO public
  USING (
  ((( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))))
  OR (( SELECT auth.role() AS role) = 'authenticated'::text)
  );
CREATE POLICY "cbse_syllabus_admin_insert" ON public.cbse_syllabus
  FOR INSERT TO public
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );
CREATE POLICY "cbse_syllabus_admin_update" ON public.cbse_syllabus
  FOR UPDATE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  )
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );
CREATE POLICY "cbse_syllabus_admin_delete" ON public.cbse_syllabus
  FOR DELETE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );

-- -- public.class_teachers --
DROP POLICY IF EXISTS "School admins can manage school class_teachers" ON public.class_teachers;
DROP POLICY IF EXISTS "Teachers can view own class assignments" ON public.class_teachers;
CREATE POLICY "class_teachers_select_merged" ON public.class_teachers
  FOR SELECT TO authenticated
  USING (
  (class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true))))
  OR (teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid))))
  );
CREATE POLICY "School admins can insert school class_teachers" ON public.class_teachers
  FOR INSERT TO authenticated
  WITH CHECK (
  class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );
CREATE POLICY "School admins can update school class_teachers" ON public.class_teachers
  FOR UPDATE TO authenticated
  USING (
  class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  )
  WITH CHECK (
  class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );
CREATE POLICY "School admins can delete school class_teachers" ON public.class_teachers
  FOR DELETE TO authenticated
  USING (
  class_id IN ( SELECT c.id
   FROM (classes c
     JOIN school_admins sa ON ((sa.school_id = c.school_id)))
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );

-- -- public.classroom_polls --
DROP POLICY IF EXISTS "Teachers see own class polls" ON public.classroom_polls;
DROP POLICY IF EXISTS "Students see live polls for their class" ON public.classroom_polls;
CREATE POLICY "classroom_polls_select_merged" ON public.classroom_polls
  FOR SELECT TO public
  USING (
  (teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid))))
  OR ((status = 'live'::text) AND (class_id IN ( SELECT cs.class_id
   FROM (class_students cs
     JOIN students s ON ((s.id = cs.student_id)))
  WHERE (s.auth_user_id = ( SELECT auth.uid() AS uid)))))
  );
CREATE POLICY "Teachers can insert own class polls" ON public.classroom_polls
  FOR INSERT TO public
  WITH CHECK (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can update own class polls" ON public.classroom_polls
  FOR UPDATE TO public
  USING (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  )
  WITH CHECK (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can delete own class polls" ON public.classroom_polls
  FOR DELETE TO public
  USING (
  teacher_id IN ( SELECT teachers.id
   FROM teachers
  WHERE (teachers.auth_user_id = ( SELECT auth.uid() AS uid)))
  );

-- -- public.cms_assets --
DROP POLICY IF EXISTS "cms_assets_admin" ON public.cms_assets;
DROP POLICY IF EXISTS "cms_assets_read_published" ON public.cms_assets;
CREATE POLICY "cms_assets_select_merged" ON public.cms_assets
  FOR SELECT TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true))))
  OR (is_active = true)
  );
CREATE POLICY "cms_assets_admin_insert" ON public.cms_assets
  FOR INSERT TO authenticated
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true)))
  );
CREATE POLICY "cms_assets_admin_update" ON public.cms_assets
  FOR UPDATE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true)))
  )
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true)))
  );
CREATE POLICY "cms_assets_admin_delete" ON public.cms_assets
  FOR DELETE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM admin_users
  WHERE ((admin_users.auth_user_id = ( SELECT auth.uid() AS uid)) AND (admin_users.is_active = true)))
  );

-- -- public.ff_grounded_ai_enforced_pairs --
DROP POLICY IF EXISTS "ff_pairs_write_admin" ON public.ff_grounded_ai_enforced_pairs;
DROP POLICY IF EXISTS "ff_pairs_read_all" ON public.ff_grounded_ai_enforced_pairs;
CREATE POLICY "ff_grounded_ai_enforced_pairs_select_merged" ON public.ff_grounded_ai_enforced_pairs
  FOR SELECT TO public
  USING (
  ((( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))))
  OR (( SELECT auth.role() AS role) = 'authenticated'::text)
  );
CREATE POLICY "ff_pairs_admin_insert" ON public.ff_grounded_ai_enforced_pairs
  FOR INSERT TO public
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );
CREATE POLICY "ff_pairs_admin_update" ON public.ff_grounded_ai_enforced_pairs
  FOR UPDATE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  )
  WITH CHECK (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );
CREATE POLICY "ff_pairs_admin_delete" ON public.ff_grounded_ai_enforced_pairs
  FOR DELETE TO public
  USING (
  (( SELECT auth.role() AS role) = 'service_role'::text) OR (( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true)))
  );

-- -- public.school_invite_codes --
DROP POLICY IF EXISTS "School admins can manage their school codes" ON public.school_invite_codes;
DROP POLICY IF EXISTS "Teachers can view codes for their school" ON public.school_invite_codes;
CREATE POLICY "school_invite_codes_select_merged" ON public.school_invite_codes
  FOR SELECT TO authenticated
  USING (
  (school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true))))
  OR (school_id IN ( SELECT t.school_id
   FROM teachers t
  WHERE ((t.auth_user_id = ( SELECT auth.uid() AS uid)) AND (t.school_id IS NOT NULL))))
  );
CREATE POLICY "School admins can insert their school codes" ON public.school_invite_codes
  FOR INSERT TO authenticated
  WITH CHECK (
  school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );
CREATE POLICY "School admins can update their school codes" ON public.school_invite_codes
  FOR UPDATE TO authenticated
  USING (
  school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  )
  WITH CHECK (
  school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );
CREATE POLICY "School admins can delete their school codes" ON public.school_invite_codes
  FOR DELETE TO authenticated
  USING (
  school_id IN ( SELECT sa.school_id
   FROM school_admins sa
  WHERE ((sa.auth_user_id = ( SELECT auth.uid() AS uid)) AND (sa.is_active = true)))
  );

-- -- public.mock_test_responses (complex case: FOR ALL overlaps 3 policies) --
DROP POLICY IF EXISTS "mock_test_responses_admin_all" ON public.mock_test_responses;
DROP POLICY IF EXISTS "mock_test_responses_insert_own" ON public.mock_test_responses;
DROP POLICY IF EXISTS "mock_test_responses_select_own" ON public.mock_test_responses;
DROP POLICY IF EXISTS "mock_test_responses_update_own" ON public.mock_test_responses;
CREATE POLICY "mock_test_responses_select_merged" ON public.mock_test_responses
  FOR SELECT TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
  OR (attempt_id IN ( SELECT mock_test_attempts.id
   FROM mock_test_attempts
  WHERE (mock_test_attempts.student_id = ( SELECT auth.uid() AS uid))))
  );
CREATE POLICY "mock_test_responses_insert_merged" ON public.mock_test_responses
  FOR INSERT TO authenticated
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
  OR (attempt_id IN ( SELECT mock_test_attempts.id
   FROM mock_test_attempts
  WHERE (mock_test_attempts.student_id = ( SELECT auth.uid() AS uid))))
  );
CREATE POLICY "mock_test_responses_update_merged" ON public.mock_test_responses
  FOR UPDATE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
  OR (attempt_id IN ( SELECT mock_test_attempts.id
   FROM mock_test_attempts
  WHERE (mock_test_attempts.student_id = ( SELECT auth.uid() AS uid))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
  OR (attempt_id IN ( SELECT mock_test_attempts.id
   FROM mock_test_attempts
  WHERE (mock_test_attempts.student_id = ( SELECT auth.uid() AS uid))))
  );
CREATE POLICY "mock_test_responses_admin_delete" ON public.mock_test_responses
  FOR DELETE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
  );
