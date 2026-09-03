-- 20260904100000_p2_5_phase2i_split_for_all_policies_batch8.sql
--
-- P2-5 phase 2, batch 8 of Category B (2026-09-03 launch audit, CEO-approved
-- "full consolidation, small batches with tests" — follow-up to batch 7's
-- discovery of the FOR ALL / per-command policy overlap category, migration
-- 20260904090000).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS BATCH DOES (Tier 2 of the batch-7 risk sort)
-- ---------------------------------------------------------------------------
-- 8 tables each have an admin-or-service FOR ALL policy sitting alongside a
-- SELECT-only policy for the same role. Unlike batch 7's pure drops, these
-- can't just be dropped: the FOR ALL policy also grants INSERT/UPDATE/DELETE,
-- which nothing else on these tables provides. But each table's SELECT
-- access is PROVABLY unaffected by removing the FOR ALL policy's *implicit*
-- SELECT coverage, because the existing SELECT-only policy already grants at
-- least as much read access on its own (verified per-table against the exact
-- live qual/with_check text before writing this migration):
--   - exam_papers, permissions, question_misconceptions, role_permissions,
--     roles: the SELECT-only policy's predicate is unconditionally `true`
--     (already covers every authenticated caller, admin or not).
--   - foxy_message_dimension_feedback, synthesis_quality_scores: the
--     SELECT-only policy's predicate contains the FOR ALL policy's entire
--     predicate as one of its own OR-branches verbatim.
--   - classroom_lesson_plans: classroom_lesson_plans_select_merged (this
--     table's own batch-1 merge, migration 20260903180000) already contains
--     the FOR ALL policy's teacher-roster-membership predicate as one of its
--     own OR-branches verbatim.
--
-- The fix: DROP each FOR ALL policy and CREATE three replacements — FOR
-- INSERT, FOR UPDATE, FOR DELETE, same role, same USING/WITH CHECK text as
-- the original (copied verbatim from the live policy, never rewritten or
-- reinterpreted) — so write access is completely unchanged, and SELECT no
-- longer redundantly re-evaluates a predicate the existing SELECT policy
-- already subsumes. This is NOT an OR-merge (batches 1-6's pattern) and NOT
-- a pure drop (batch 7's pattern) — it restructures one policy's SHAPE while
-- preserving its exact semantics for every action it still covers.
--
-- Where a FOR ALL policy had no explicit WITH CHECK (Postgres implicitly
-- reuses USING for WITH CHECK in that case), the new INSERT/UPDATE policies
-- are given an EXPLICIT WITH CHECK with that same USING text, so the
-- replacement's behavior does not depend on an implicit fallback.
--
-- Optional future cleanup (NOT done here, staying in scope): several of
-- these predicates (permissions_admin, role_permissions_admin, roles_admin)
-- inline the identical `auth.uid() IN (SELECT admin_users.auth_user_id FROM
-- admin_users WHERE is_active = true)` subquery that an `is_admin()`
-- SECURITY DEFINER helper appears to express elsewhere in this schema. This
-- migration does not substitute in that helper — verifying its exact
-- definition is equivalent is a separate task, and this batch only ever
-- copies existing predicate text verbatim, never reinterprets it.
--
-- ---------------------------------------------------------------------------
-- RECURSION-GUARD LEDGER
-- ---------------------------------------------------------------------------
-- 5 of the 8 original FOR ALL policies were already grandfathered (each
-- inlines a cross-table subquery): classroom_lesson_plans, permissions,
-- question_misconceptions, role_permissions, roles. Dropping them prunes
-- those 5 stale entries. Their replacement INSERT/UPDATE/DELETE policies
-- carry the SAME inline subquery text, so the detector correctly re-flags
-- each of the 3 new policies per table = 18 new entries for those same 6
-- tables (exam_papers' original was NEVER grandfathered despite inlining
-- admin_users — a pre-existing ledger gap, same class already documented in
-- batches 1-4 — so its 3 splits are also newly added here, not a stale
-- prune). foxy_message_dimension_feedback and synthesis_quality_scores's
-- predicate (`auth.role() = 'service_role'`) has no inline FROM/JOIN at
-- all, so their splits need no grandfather entry. See the companion update
-- to apps/host/src/__tests__/rls-no-cross-table-recursion.test.ts.

-- -- public.exam_papers: split "exam_papers_admin_write" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "exam_papers_admin_write" ON public.exam_papers;
CREATE POLICY "exam_papers_admin_insert" ON public.exam_papers
  FOR INSERT TO authenticated
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
  );
CREATE POLICY "exam_papers_admin_update" ON public.exam_papers
  FOR UPDATE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
  )
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
  );
CREATE POLICY "exam_papers_admin_delete" ON public.exam_papers
  FOR DELETE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.auth_user_id = ( SELECT auth.uid() AS uid)) AND (au.is_active = true) AND (au.admin_level = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
  );

-- -- public.permissions: split "permissions_admin" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "permissions_admin" ON public.permissions;
CREATE POLICY "permissions_admin_insert" ON public.permissions
  FOR INSERT TO authenticated
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "permissions_admin_update" ON public.permissions
  FOR UPDATE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  )
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "permissions_admin_delete" ON public.permissions
  FOR DELETE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );

-- -- public.question_misconceptions: split "qm_super_admin_write" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "qm_super_admin_write" ON public.question_misconceptions;
CREATE POLICY "qm_super_admin_insert" ON public.question_misconceptions
  FOR INSERT TO authenticated
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.auth_user_id = ( SELECT auth.uid() AS uid)) AND (ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())) AND (r.name = ANY (ARRAY['super_admin'::text, 'admin'::text]))))
  );
CREATE POLICY "qm_super_admin_update" ON public.question_misconceptions
  FOR UPDATE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.auth_user_id = ( SELECT auth.uid() AS uid)) AND (ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())) AND (r.name = ANY (ARRAY['super_admin'::text, 'admin'::text]))))
  )
  WITH CHECK (
  EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.auth_user_id = ( SELECT auth.uid() AS uid)) AND (ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())) AND (r.name = ANY (ARRAY['super_admin'::text, 'admin'::text]))))
  );
CREATE POLICY "qm_super_admin_delete" ON public.question_misconceptions
  FOR DELETE TO authenticated
  USING (
  EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.auth_user_id = ( SELECT auth.uid() AS uid)) AND (ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())) AND (r.name = ANY (ARRAY['super_admin'::text, 'admin'::text]))))
  );

-- -- public.role_permissions: split "role_permissions_admin" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "role_permissions_admin" ON public.role_permissions;
CREATE POLICY "role_permissions_admin_insert" ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "role_permissions_admin_update" ON public.role_permissions
  FOR UPDATE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  )
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "role_permissions_admin_delete" ON public.role_permissions
  FOR DELETE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );

-- -- public.roles: split "roles_admin" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "roles_admin" ON public.roles;
CREATE POLICY "roles_admin_insert" ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "roles_admin_update" ON public.roles
  FOR UPDATE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  )
  WITH CHECK (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );
CREATE POLICY "roles_admin_delete" ON public.roles
  FOR DELETE TO authenticated
  USING (
  ( SELECT auth.uid() AS uid) IN ( SELECT admin_users.auth_user_id
   FROM admin_users
  WHERE (admin_users.is_active = true))
  );

-- -- public.foxy_message_dimension_feedback: split "foxy_dim_feedback_write_service" (FOR ALL, public) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "foxy_dim_feedback_write_service" ON public.foxy_message_dimension_feedback;
CREATE POLICY "foxy_dim_feedback_service_insert" ON public.foxy_message_dimension_feedback
  FOR INSERT TO public
  WITH CHECK (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );
CREATE POLICY "foxy_dim_feedback_service_update" ON public.foxy_message_dimension_feedback
  FOR UPDATE TO public
  USING (
  ( SELECT auth.role() AS role) = 'service_role'::text
  )
  WITH CHECK (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );
CREATE POLICY "foxy_dim_feedback_service_delete" ON public.foxy_message_dimension_feedback
  FOR DELETE TO public
  USING (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );

-- -- public.synthesis_quality_scores: split "synthesis_quality_scores_write_service" (FOR ALL, public) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "synthesis_quality_scores_write_service" ON public.synthesis_quality_scores;
CREATE POLICY "synthesis_quality_scores_service_insert" ON public.synthesis_quality_scores
  FOR INSERT TO public
  WITH CHECK (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );
CREATE POLICY "synthesis_quality_scores_service_update" ON public.synthesis_quality_scores
  FOR UPDATE TO public
  USING (
  ( SELECT auth.role() AS role) = 'service_role'::text
  )
  WITH CHECK (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );
CREATE POLICY "synthesis_quality_scores_service_delete" ON public.synthesis_quality_scores
  FOR DELETE TO public
  USING (
  ( SELECT auth.role() AS role) = 'service_role'::text
  );

-- -- public.classroom_lesson_plans: split "Teachers can manage classroom lesson plans" (FOR ALL, authenticated) into INSERT/UPDATE/DELETE --
DROP POLICY IF EXISTS "Teachers can manage classroom lesson plans" ON public.classroom_lesson_plans;
CREATE POLICY "Teachers can insert classroom lesson plans" ON public.classroom_lesson_plans
  FOR INSERT TO authenticated
  WITH CHECK (
  class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can update classroom lesson plans" ON public.classroom_lesson_plans
  FOR UPDATE TO authenticated
  USING (
  class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))
  )
  WITH CHECK (
  class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
CREATE POLICY "Teachers can delete classroom lesson plans" ON public.classroom_lesson_plans
  FOR DELETE TO authenticated
  USING (
  class_id IN ( SELECT ct.class_id
   FROM (class_teachers ct
     JOIN teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.auth_user_id = ( SELECT auth.uid() AS uid)))
  );
