-- Parent Dashboard RCA fixes (2026-07-20)
--
-- Fixes three findings from the parent-dashboard RCA audit:
--
-- 1. FINDING A (critical): 11 RLS policies gate parent SELECT access on
--    guardian_student_links.status = 'approved' only. The live self-service
--    OTP linking flow (parent_redeem_link_code_otp ->
--    link_guardian_to_student_via_code) sets status = 'active'. Guardians
--    linked via that flow therefore see zero rows on score_history,
--    xp_transactions, coin_balances, coin_transactions, challenge_attempts,
--    challenge_streaks, quiz_session_shuffles, student_skill_state,
--    performance_scores, exam_configs, and monthly_reports even though the
--    link itself succeeded. This migration re-points all 11 policies at the
--    existing public.is_guardian_of(uuid) helper, which already treats
--    status IN ('active','approved') as linked (see baseline line ~9181),
--    matching the convention already used by newer guardian-facing tables
--    (foxy_chat_messages, learner_twin_snapshots, parent_cheers,
--    parent_weekly_reports).
--
-- 2. FINDING B (high): link_guardian_to_student_via_code only matches
--    students.invite_code. parent_request_link_code_otp (the OTP request
--    step) resolves codes against BOTH invite_code and link_code, so a
--    parent who requests/enters a correct OTP for a code that lives only in
--    link_code passes the OTP challenge and then fails at the final redeem
--    step with "Invalid invite code." This migration widens the match to
--    (invite_code OR link_code), matching parent_request_link_code_otp and
--    link_guardian_via_invite_code.
--
-- 3. FINDING E (medium): teacher_parent_threads has SELECT policies for
--    both roles but no INSERT policy at all -- thread creation currently
--    relies entirely on app-layer checks in the route that calls
--    supabaseAdmin. This migration adds an RLS-layer defense-in-depth INSERT
--    policy gated on public.is_guardian_of(student_id), so a guardian-owned
--    thread insert is enforced by RLS even if the app-layer check is ever
--    missed/regressed. Teacher-initiated inserts still go through
--    supabaseAdmin (service_role bypasses RLS) as before -- this policy only
--    adds a backstop for the non-service-role path.
--
-- All changes are additive/idempotent (DROP POLICY IF EXISTS + CREATE
-- POLICY, CREATE OR REPLACE FUNCTION). No data migration is required: rows
-- already have their final status value, only the read-time policy
-- evaluation changes.

-- =============================================================================
-- 1. Widen the 11 mismatched parent-select RLS policies onto is_guardian_of()
-- =============================================================================

DROP POLICY IF EXISTS "score_history_parent_select" ON "public"."score_history";
CREATE POLICY "score_history_parent_select" ON "public"."score_history"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "xp_txn_parent_select" ON "public"."xp_transactions";
CREATE POLICY "xp_txn_parent_select" ON "public"."xp_transactions"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "coin_bal_parent_select" ON "public"."coin_balances";
CREATE POLICY "coin_bal_parent_select" ON "public"."coin_balances"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "coin_txn_parent_select" ON "public"."coin_transactions";
CREATE POLICY "coin_txn_parent_select" ON "public"."coin_transactions"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "challenge_attempts_parent_select" ON "public"."challenge_attempts";
CREATE POLICY "challenge_attempts_parent_select" ON "public"."challenge_attempts"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "challenge_streaks_parent_select" ON "public"."challenge_streaks";
CREATE POLICY "challenge_streaks_parent_select" ON "public"."challenge_streaks"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "quiz_session_shuffles_parent_select" ON "public"."quiz_session_shuffles";
CREATE POLICY "quiz_session_shuffles_parent_select" ON "public"."quiz_session_shuffles"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "student_skill_state_parent_select" ON "public"."student_skill_state";
CREATE POLICY "student_skill_state_parent_select" ON "public"."student_skill_state"
  FOR SELECT TO "authenticated" USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "perf_scores_parent_select" ON "public"."performance_scores";
CREATE POLICY "perf_scores_parent_select" ON "public"."performance_scores"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "guardians_view_exam_configs" ON "public"."exam_configs";
CREATE POLICY "guardians_view_exam_configs" ON "public"."exam_configs"
  FOR SELECT USING (public.is_guardian_of(student_id));

DROP POLICY IF EXISTS "guardians_view_monthly_reports" ON "public"."monthly_reports";
CREATE POLICY "guardians_view_monthly_reports" ON "public"."monthly_reports"
  FOR SELECT USING (public.is_guardian_of(student_id));

-- =============================================================================
-- 2. Fix link_guardian_to_student_via_code to match invite_code OR link_code
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."link_guardian_to_student_via_code"("p_guardian_id" "uuid", "p_invite_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_student RECORD;
  v_code text := upper(trim(p_invite_code));
BEGIN
  SELECT id, name, grade INTO v_student
  FROM students
  WHERE (invite_code = v_code OR link_code = v_code)
    AND is_active = true;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid invite code. Check with your child.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM guardian_student_links
    WHERE guardian_id = p_guardian_id
      AND student_id = v_student.id
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('error', 'Already linked to ' || v_student.name);
  END IF;

  INSERT INTO guardian_student_links (guardian_id, student_id, status, is_verified, linked_at, initiated_by, permission_level)
  VALUES (p_guardian_id, v_student.id, 'active', true, now(), p_guardian_id, 'view');

  RETURN jsonb_build_object(
    'success', true,
    'student_name', v_student.name,
    'student_grade', v_student.grade,
    'message', 'Successfully linked to ' || v_student.name || ' (Grade ' || v_student.grade || ')'
  );
END;
$$;

COMMENT ON FUNCTION "public"."link_guardian_to_student_via_code"("uuid", "text")
  IS 'Parent-portal OTP-redeem link RPC. Matches students.invite_code OR students.link_code (fixed 2026-07-20 - previously matched invite_code only, causing a false Invalid invite code rejection for codes issued via link_code after the OTP challenge had already been verified). Sets status=active, matching public.is_guardian_of() which treats active/approved as linked.';

-- =============================================================================
-- 3. Add INSERT RLS policy on teacher_parent_threads (defense-in-depth)
-- =============================================================================

DROP POLICY IF EXISTS "tp_threads_guardian_insert" ON "public"."teacher_parent_threads";
CREATE POLICY "tp_threads_guardian_insert"
  ON "public"."teacher_parent_threads"
  FOR INSERT
  WITH CHECK (
    public.is_guardian_of(student_id)
    AND guardian_id = public.get_my_guardian_id()
  );

COMMENT ON POLICY "tp_threads_guardian_insert" ON "public"."teacher_parent_threads"
  IS 'RLS-layer defense-in-depth added 2026-07-20. Thread creation is still primarily performed by the app-layer route via supabaseAdmin (service_role bypasses RLS), but this policy ensures a guardian-owned insert is independently rejected by RLS if it is ever attempted outside that route or the app-layer ownership check regresses. Uses the SECURITY DEFINER helpers is_guardian_of()/get_my_guardian_id() rather than inlining a join to guardians, per the RLS recursion guard (src/__tests__/rls-no-cross-table-recursion.test.ts) -- an inline cross-table subquery here would re-enter the guardians table own RLS and risk the same class of recursion bug fixed by migration 20260702080000_fix_students_rls_infinite_recursion.sql.';
