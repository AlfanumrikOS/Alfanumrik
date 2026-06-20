-- Migration: 20260621000500_track_a_atomic_seat_enroll_rpcs.sql
-- Purpose: Track A.4 SECURITY FIX S1 (seat over-commit race). Make the
--          bulk-import seat check + roster write ATOMIC per school so two
--          concurrent same-school imports can never collectively exceed the
--          purchased seat ceiling.
--
-- ─── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
-- The Track A.4 bulk-import routes (students/teachers) probe assert_seat_capacity
-- (migration 20260621000100) ONCE per batch, read `remaining`, and decrement a
-- LOCAL in-process budget per row. Two concurrent bulk-imports for the SAME school
-- each read the same `remaining` snapshot and each enroll up to that budget — so
-- they can collectively add up to 2×remaining active members and exceed
-- seats_purchased. There is NO serialization (unlike the payment path, which uses
-- pg_advisory_xact_lock). assert_seat_capacity is a READ-ONLY pre-flight gate; the
-- check and the insert are in different statements / different requests, so the
-- gap is a classic check-then-act TOCTOU race across requests.
--
-- ─── WHY A NEW RPC (and NOT the existing enroll_students_with_seat_check) ─────
-- A per-student/per-teacher atomic enroll-with-seat-check RPC DID already exist
-- (enroll_students_with_seat_check / enroll_section_students_with_seat_check,
-- migration 20260614000001 Phase 3B). It IS race-safe (same advisory lock). BUT it
-- implements a DIFFERENT seat policy:
--   * Phase 3B HYBRID policy: ceiling = seats_purchased with a 14-day 10% grace
--     tier; counts STUDENTS ONLY (no teachers); gated by ff_school_provisioning;
--     and on overflow it RAISES a whole-batch P3B01 exception (no partial commit).
--   * Track A.4 assert_seat_capacity policy: ceiling = MAX(active/trial
--     seats_purchased, schools.max_students); HARD-BLOCK (no grace); counts active
--     students-in-classes PLUS active teachers; and the routes return a PER-ROW
--     {created|skipped|blocked|failed} contract (overflow rows are `blocked`, the
--     rest still commit).
-- Switching the Track A.4 loop to the Phase 3B RPC would SILENTLY change the
-- ceiling math (drop teachers, add a grace tier), the flag gate, and the all-or-
-- nothing block semantics — breaking the per-row contract + the dry-run preview's
-- numbers. So we ADD a thin atomic RPC pair that preserves assert_seat_capacity's
-- EXACT ceiling definition and the per-row contract, and only adds the missing
-- serialization. The ceiling math here is a verbatim mirror of
-- assert_seat_capacity (same COALESCE/MAX, same DISTINCT student count, same active
-- teacher count) so the locked recompute and the preview can never disagree.
--
-- ─── RACE-SAFETY DESIGN (mirrors the P11 payment + Phase 3B discipline) ──────
-- Each RPC, in ONE transaction:
--   1. pg_advisory_xact_lock(hashtextextended('school_seat:'||school_id, 0))
--      — the SAME key namespace as the Phase 3B enroll RPCs, so EVERY seat-
--      consuming path for a school serialises against every other (a Track A.4
--      import and a Phase 3B import for the same school block each other).
--   2. Recompute used + ceiling UNDER the lock (the assert_seat_capacity math).
--   3. If the row is ALREADY active (idempotent re-run) → granted, no seat math
--      (re-adding an already-counted member consumes no new seat).
--   4. Else if used >= ceiling → return {granted:false, status:'blocked'} WITHOUT
--      inserting.
--   5. Else INSERT/UPSERT the single roster row (reactivating a soft-removed row)
--      → return {granted:true, status:'created'|'reactivated'}.
-- Because the count is recomputed under the lock AFTER any prior committed insert,
-- the second concurrent import sees the first import's rows and stops at the
-- ceiling. Collective additions can never exceed seats_purchased.
--
-- ─── SCOPE / SAFETY ──────────────────────────────────────────────────────────
--   - ADDITIVE + IDEMPOTENT: CREATE OR REPLACE FUNCTION only; DO-guarded GRANTs.
--     No table/column/RLS change (RLS unaffected — these are RPCs). Safe to replay.
--   - SECURITY DEFINER (same justification as assert_seat_capacity): must read
--     school_subscriptions + count students/teachers ACROSS the tenant RLS boundary
--     to compute the ceiling. Keyed strictly by p_school_id (no auth.uid widening),
--     search_path pinned to public. service_role-only EXECUTE (the bulk-import path
--     runs behind authorizeSchoolAdmin, which already proved school membership).
--   - Cross-tenant guard: the target class_id MUST belong to p_school_id and be a
--     live class (mirrors the Phase 3B guard); a foreign/inactive class is rejected.
--   - P5: grades are strings — untouched (these RPCs are uuid-keyed; no grade I/O).
--   - P13: returns counts/ids + a status string only; never PII. No logging here.
--
-- Owner: backend. Track A.4 security fix S1 (architect-reviewed).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal: _assert_seat_used_ceiling(school) → (used, ceiling)
-- The EXACT assert_seat_capacity math, factored out so the public gate AND the
-- atomic enroll RPCs derive the ceiling from ONE definition (they cannot drift).
-- NOT scope-guarded (internal; callers are DEFINER + service-role-only). Read-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._seat_used_and_ceiling(p_school_id uuid)
RETURNS TABLE(v_used integer, v_ceiling integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      -- active students enrolled in any class of this school (DISTINCT: a student
      -- in two classes counts once) PLUS active teachers of this school.
      COALESCE((
        SELECT COUNT(DISTINCT cs.student_id)
          FROM public.class_students cs
          JOIN public.classes c ON c.id = cs.class_id
         WHERE c.school_id = p_school_id
           AND cs.is_active = true
      ), 0)
      +
      COALESCE((
        SELECT COUNT(*)
          FROM public.teachers t
         WHERE t.school_id = p_school_id
           AND t.is_active = true
      ), 0)
    )::int AS v_used,
    COALESCE(
      (SELECT ss.seats_purchased
         FROM public.school_subscriptions ss
        WHERE ss.school_id = p_school_id
          AND ss.status IN ('active', 'trial')
        ORDER BY ss.current_period_end DESC NULLS LAST
        LIMIT 1),
      (SELECT s.max_students FROM public.schools s WHERE s.id = p_school_id),
      0
    )::int AS v_ceiling;
$$;

COMMENT ON FUNCTION public._seat_used_and_ceiling(uuid) IS
  'Track A.4 internal helper: the EXACT assert_seat_capacity ceiling math factored '
  'out — used = DISTINCT active students-in-classes + active teachers; ceiling = '
  'COALESCE(active/trial school_subscriptions.seats_purchased, schools.max_students, '
  '0). Shared by assert_seat_capacity-equivalent gates and the atomic enroll RPCs so '
  'the locked recompute and the preview cannot drift. SECURITY DEFINER (counts across '
  'tenant boundary), search_path pinned, read-only, NOT scope-guarded (callers guard).';

-- ─────────────────────────────────────────────────────────────────────────────
-- enroll_student_with_seat_check(school, student, class) → jsonb
-- ATOMIC, race-safe single-student enrollment into one class_students row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enroll_student_with_seat_check(
  p_school_id  uuid,
  p_student_id uuid,
  p_class_id   uuid,
  p_roll_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used        integer;
  v_ceiling     integer;
  v_already     boolean;
  v_now         timestamptz := now();
  v_touched     integer := 0;
BEGIN
  IF p_school_id IS NULL OR p_student_id IS NULL OR p_class_id IS NULL THEN
    RAISE EXCEPTION 'school_id, student_id and class_id are required' USING ERRCODE = '22004';
  END IF;

  -- Cross-tenant guard: the class must belong to THIS school and be live.
  IF NOT EXISTS (
    SELECT 1 FROM public.classes c
     WHERE c.id = p_class_id
       AND c.school_id = p_school_id
       AND c.is_active
       AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'class % does not belong to school % (or is inactive/deleted)', p_class_id, p_school_id
      USING ERRCODE = '42501';
  END IF;

  -- ── SERIALISE: per-school advisory lock (same namespace as Phase 3B). ──────
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  -- Idempotent re-run: if this student is ALREADY active on THIS class roster,
  -- it consumes no new seat — grant immediately (refresh roll_number only).
  SELECT EXISTS (
    SELECT 1 FROM public.class_students cs
     WHERE cs.class_id = p_class_id
       AND cs.student_id = p_student_id
       AND cs.is_active = true
  ) INTO v_already;

  IF v_already THEN
    UPDATE public.class_students
       SET roll_number = COALESCE(p_roll_number, roll_number),
           updated_at  = v_now
     WHERE class_id = p_class_id AND student_id = p_student_id;
    RETURN jsonb_build_object('granted', true, 'status', 'already_active');
  END IF;

  -- ── Recompute used + ceiling UNDER the lock. ──────────────────────────────
  SELECT s.v_used, s.v_ceiling INTO v_used, v_ceiling
  FROM public._seat_used_and_ceiling(p_school_id) s;

  -- A brand-new active roster row consumes one seat. Block at the ceiling.
  IF v_used >= v_ceiling THEN
    RETURN jsonb_build_object(
      'granted', false, 'status', 'blocked',
      'used', v_used, 'ceiling', v_ceiling
    );
  END IF;

  -- ── ALLOW: UPSERT the single roster row (reactivates a soft-removed row). ──
  INSERT INTO public.class_students (class_id, student_id, roll_number, is_active)
  VALUES (p_class_id, p_student_id, p_roll_number, true)
  ON CONFLICT (class_id, student_id) DO UPDATE
    SET is_active   = true,
        roll_number = COALESCE(EXCLUDED.roll_number, public.class_students.roll_number),
        updated_at  = v_now
    WHERE public.class_students.is_active IS DISTINCT FROM true;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  RETURN jsonb_build_object(
    'granted', true,
    'status',  CASE WHEN v_touched > 0 THEN 'created' ELSE 'already_active' END,
    'used',    v_used + 1,
    'ceiling', v_ceiling
  );
END;
$$;

COMMENT ON FUNCTION public.enroll_student_with_seat_check(uuid, uuid, uuid, text) IS
  'Track A.4 ATOMIC seat-checked single-student enrollment (fix S1). One '
  'transaction: pg_advisory_xact_lock(''school_seat:''||school_id) → if already '
  'active on the class, grant (no seat) → else recompute used/ceiling UNDER the '
  'lock (assert_seat_capacity math via _seat_used_and_ceiling) → if used>=ceiling '
  'return {granted:false,status:''blocked''} WITHOUT inserting → else UPSERT the '
  'class_students row and return {granted:true,status:''created''}. Cross-tenant '
  'guard on class_id. SECURITY DEFINER, search_path pinned, service_role-only. '
  'Concurrent same-school imports serialise so they cannot over-commit seats.';

-- ─────────────────────────────────────────────────────────────────────────────
-- register_teacher_with_seat_check(school, name, email, subjects, grades) → jsonb
-- ATOMIC, race-safe single-teacher create. A brand-new ACTIVE teacher consumes a
-- seat (assert_seat_capacity counts active teachers). An existing teacher (by
-- school+email) is reused and consumes no new seat. Returns the teacher_id so the
-- route can proceed to class assignment (assignment itself consumes no seat).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_teacher_with_seat_check(
  p_school_id uuid,
  p_name      text,
  p_email     text,
  p_subjects  text[] DEFAULT '{}',
  p_grades    text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used      integer;
  v_ceiling   integer;
  v_existing  uuid;
  v_new_id    uuid;
BEGIN
  IF p_school_id IS NULL OR p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'school_id and email are required' USING ERRCODE = '22004';
  END IF;

  -- ── SERIALISE: per-school advisory lock (same namespace as Phase 3B). ──────
  PERFORM pg_advisory_xact_lock(
    hashtextextended('school_seat:' || p_school_id::text, 0)
  );

  -- Idempotent: an existing teacher with this email in THIS school is reused and
  -- consumes no new seat. (Re-activate if previously soft-deactivated.)
  SELECT t.id INTO v_existing
  FROM public.teachers t
  WHERE t.school_id = p_school_id
    AND t.email = p_email
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.teachers
       SET is_active = true,
           updated_at = now()
     WHERE id = v_existing
       AND is_active IS DISTINCT FROM true;
    RETURN jsonb_build_object('granted', true, 'status', 'already_exists', 'teacher_id', v_existing);
  END IF;

  -- ── Recompute used + ceiling UNDER the lock. ──────────────────────────────
  SELECT s.v_used, s.v_ceiling INTO v_used, v_ceiling
  FROM public._seat_used_and_ceiling(p_school_id) s;

  -- A brand-new active teacher consumes one seat. Block at the ceiling.
  IF v_used >= v_ceiling THEN
    RETURN jsonb_build_object(
      'granted', false, 'status', 'blocked',
      'used', v_used, 'ceiling', v_ceiling
    );
  END IF;

  INSERT INTO public.teachers (school_id, name, email, subjects_taught, grades_taught, is_active)
  VALUES (p_school_id, p_name, p_email, COALESCE(p_subjects, '{}'), COALESCE(p_grades, '{}'), true)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'granted', true, 'status', 'created', 'teacher_id', v_new_id,
    'used', v_used + 1, 'ceiling', v_ceiling
  );
END;
$$;

COMMENT ON FUNCTION public.register_teacher_with_seat_check(uuid, text, text, text[], text[]) IS
  'Track A.4 ATOMIC seat-checked single-teacher create (fix S1). One transaction: '
  'pg_advisory_xact_lock(''school_seat:''||school_id) → reuse an existing '
  '(school,email) teacher (no seat; reactivate if soft-removed) → else recompute '
  'used/ceiling UNDER the lock → if used>=ceiling return {granted:false,'
  'status:''blocked''} WITHOUT inserting → else INSERT the active teacher and return '
  '{granted:true,status:''created'',teacher_id}. SECURITY DEFINER, search_path '
  'pinned, service_role-only. Concurrent same-school imports serialise so active '
  'teachers cannot push the school past its seat ceiling.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants (idempotent, DO-block guarded). service_role ONLY (bulk-import path).
-- ─────────────────────────────────────────────────────────────────────────────
DO $grant$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._seat_used_and_ceiling(uuid) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._seat_used_and_ceiling(uuid) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public._seat_used_and_ceiling(uuid) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public._seat_used_and_ceiling(uuid) TO service_role';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_student_with_seat_check(uuid, uuid, uuid, text) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_student_with_seat_check(uuid, uuid, uuid, text) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.enroll_student_with_seat_check(uuid, uuid, uuid, text) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.enroll_student_with_seat_check(uuid, uuid, uuid, text) TO service_role';

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.register_teacher_with_seat_check(uuid, text, text, text[], text[]) FROM PUBLIC';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.register_teacher_with_seat_check(uuid, text, text, text[], text[]) FROM anon';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.register_teacher_with_seat_check(uuid, text, text, text[], text[]) FROM authenticated';
  EXECUTE 'GRANT  EXECUTE ON FUNCTION public.register_teacher_with_seat_check(uuid, text, text, text[], text[]) TO service_role';
END;
$grant$;

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- As service_role (backend):
--   SELECT public.enroll_student_with_seat_check('<school>','<student>','<class>', '42');
--     -- {granted:true,status:'created',...} below ceiling; {granted:false,status:'blocked'} at ceiling.
--   SELECT public.register_teacher_with_seat_check('<school>','Ms X','x@s.edu',ARRAY['Math'],ARRAY['7']);
--     -- {granted:true,status:'created',teacher_id} below ceiling; blocked at ceiling; already_exists on replay.
-- Race proof: run two concurrent loops of enroll_student_with_seat_check for the
--   SAME school filling the last seat — exactly ONE wins 'created', the other
--   'blocked'. used never exceeds ceiling. (assert_seat_capacity preview unchanged.)
