-- ─── Harden subject-governance SECURITY DEFINER RPCs with auth.uid() guard ──
--
-- Background:
--
-- 20260415000012 (`subject_rpcs_accept_auth_user_id`) added the auth.uid()
-- check to `set_student_subjects` but left `get_available_subjects` and the
-- v2 chapter/subject RPCs without one. All three are SECURITY DEFINER and
-- granted to `authenticated`.
--
-- The functions all accept a `p_student_id UUID` and resolve it against
-- either students.id or students.auth_user_id (legacy + v2 callers diverge).
-- A logged-in student can call:
--
--   SELECT * FROM get_available_subjects('<other-student-uuid>')
--
-- and learn:
--   • the other student's grade (via grade_subject_map joins)
--   • the other student's stream (11/12 only, but still cross-tenant)
--   • their effective subscription plan (via the is_locked column —
--     a free-plan student can see which subjects a pro student has unlocked,
--     which leaks tier info)
--
-- Threat tier: P2. No critical PII or financial data, but a clear
-- cross-tenant read that violates P13 and the "students cannot enumerate
-- other students' tier" property.
--
-- Fix: embed an auth.uid() guard in each function's student-resolution
-- WHERE clause. When auth.uid() is set (any logged-in caller), the
-- resolution only matches if the row's auth_user_id equals auth.uid().
-- Service-role callers (auth.uid() IS NULL) skip the guard, which is
-- correct: those calls are server-to-server and have already vetted the
-- caller (e.g. /api/student/subjects has authorizeRequest above the RPC).
--
-- Behaviour change: a cross-tenant call now returns an empty resultset
-- (NULL student → fall-through) instead of leaking another student's
-- subjects/chapters. Legitimate same-student calls are unchanged.

BEGIN;

-- ─── 1. get_available_subjects(p_student_id UUID) ───────────────────────
-- Latest definition lives in 20260415000012 (auth_user_id-accepting). We
-- re-CREATE with the embedded guard.

CREATE OR REPLACE FUNCTION public.get_available_subjects(p_student_id UUID)
RETURNS TABLE (
  code TEXT, name TEXT, name_hi TEXT, icon TEXT, color TEXT,
  subject_kind TEXT, is_core BOOLEAN, is_locked BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  WITH s AS (
    SELECT id, grade, stream FROM public.students
     WHERE (id = p_student_id OR auth_user_id = p_student_id)
       AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
     LIMIT 1
  ),
  p AS (
    SELECT plan_code FROM public.student_subscriptions
     WHERE student_id = (SELECT id FROM s)
       AND status IN ('active','trialing','grace')
     ORDER BY current_period_end DESC NULLS LAST LIMIT 1
  ),
  effective_plan AS (
    SELECT COALESCE((SELECT plan_code FROM p), 'free') AS plan_code
  ),
  grade_valid AS (
    SELECT gsm.subject_code, BOOL_OR(gsm.is_core) AS is_core
      FROM public.grade_subject_map gsm, s
     WHERE gsm.grade = s.grade
       AND (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
     GROUP BY gsm.subject_code
  ),
  plan_valid AS (
    SELECT psa.subject_code FROM public.plan_subject_access psa, effective_plan ep
     WHERE psa.plan_code = ep.plan_code
  )
  SELECT sub.code, sub.name, COALESCE(sub.name_hi, sub.name), sub.icon, sub.color,
         sub.subject_kind, gv.is_core,
         (gv.subject_code NOT IN (SELECT subject_code FROM plan_valid)) AS is_locked
    FROM public.subjects sub
    JOIN grade_valid gv ON gv.subject_code = sub.code
   WHERE sub.is_active;
$$;

REVOKE ALL ON FUNCTION public.get_available_subjects(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_subjects(UUID) TO authenticated, service_role;

-- ─── 2. get_available_subjects_v2(p_student_id UUID) ───────────────────
-- Latest definition lives in 20260418101000.

CREATE OR REPLACE FUNCTION public.get_available_subjects_v2(p_student_id UUID)
RETURNS TABLE (
  subject_code          TEXT,
  subject_display       TEXT,
  subject_display_hi    TEXT,
  ready_chapter_count   INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
BEGIN
  -- Resolve student. Accept either students.id or auth_user_id (matches
  -- existing v1 RPC behavior). Missing or cross-tenant student → empty
  -- result, not error (legitimate-cross-product usage falls through).
  SELECT id, grade INTO v_student_id, v_grade
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sub.code,
    sub.name,
    COALESCE(sub.name_hi, sub.name),
    COALESCE((
      SELECT COUNT(DISTINCT cs.chapter_number)::INTEGER
        FROM public.cbse_syllabus cs
       WHERE cs.subject_code = sub.code
         AND cs.grade = v_grade
         AND cs.rag_status = 'ready'
    ), 0) AS ready_chapter_count
  FROM public.subjects sub
  JOIN public.grade_subject_map gsm ON gsm.subject_code = sub.code
  WHERE gsm.grade = v_grade
    AND sub.is_active
  GROUP BY sub.code, sub.name, sub.name_hi
  ORDER BY sub.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_subjects_v2(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_subjects_v2(UUID) TO authenticated, service_role;

-- ─── 3. available_chapters_for_student_subject_v2(p_student_id, p_subject_code) ─

CREATE OR REPLACE FUNCTION public.available_chapters_for_student_subject_v2(
  p_student_id   UUID,
  p_subject_code TEXT
)
RETURNS TABLE (
  chapter_number          INTEGER,
  chapter_title           TEXT,
  chapter_title_hi        TEXT,
  verified_question_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_student_id UUID;
  v_grade      TEXT;
BEGIN
  IF p_subject_code IS NULL OR LENGTH(p_subject_code) = 0 THEN
    RETURN;
  END IF;

  SELECT id, grade INTO v_student_id, v_grade
    FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id)
     AND (auth.uid() IS NULL OR auth_user_id = auth.uid())
   LIMIT 1;

  IF v_student_id IS NULL OR v_grade IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cs.chapter_number,
    cs.chapter_title,
    cs.chapter_title_hi,
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM public.question_bank qb
       WHERE qb.subject = p_subject_code
         AND qb.grade = v_grade
         AND qb.chapter_number = cs.chapter_number
         AND qb.is_active
         AND qb.deleted_at IS NULL
         AND qb.verification_state = 'verified'
    ), 0) AS verified_question_count
  FROM public.cbse_syllabus cs
  WHERE cs.subject_code = p_subject_code
    AND cs.grade = v_grade
    AND cs.rag_status = 'ready'
  ORDER BY cs.chapter_number;
END;
$$;

REVOKE ALL ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.available_chapters_for_student_subject_v2(UUID, TEXT) TO authenticated, service_role;

COMMIT;
