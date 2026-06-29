-- Migration: 20260702010000_teacher_assigned_students_rls.sql
-- Purpose: Defense-in-depth — add an explicit, self-contained teacher-assigned
--          SELECT RLS policy on public.students (engineering-audit Cycle 5,
--          Teacher/School-Admin B2B, gap TSB-2, P8).
--
-- ─── Context / TSB-2 ─────────────────────────────────────────────────────────
-- TSB-2 (HIGH) flagged that teacher reads of student PII flow only through
-- service-role app code (`canAccessStudent`), with no RLS backstop on
-- public.students for the teacher-assigned pattern — i.e. the four-pattern RLS
-- model (student-own / parent-linked / teacher-assigned / admin) appeared to be
-- only 3-of-4 on the central students table.
--
-- ─── Audit-premise correction (important — read before judging redundancy) ───
-- On full inspection of the reproducible baseline the teacher backstop ALREADY
-- EXISTS, but NOT under a `"Teachers can …"` name (which is what the audit
-- grepped for). It lives inside the consolidated SELECT policy:
--
--   00000000000000_baseline_from_prod.sql:22309
--     CREATE POLICY "students_select_merged" ON "public"."students" FOR SELECT
--       USING (
--         auth_user_id = auth.uid()           -- student-own
--         OR public.is_teacher_of(id)         -- teacher-assigned  ← TSB-2 net
--         OR public.is_guardian_of(id)        -- parent-linked
--       );
--
--   and the SECURITY DEFINER helper it calls:
--     00000000000000_baseline_from_prod.sql:9212  public.is_teacher_of(uuid)
--       EXISTS( SELECT 1
--               FROM class_students cs
--               JOIN class_teachers ct ON ct.class_id = cs.class_id
--               JOIN teachers       t  ON t.id        = ct.teacher_id
--               WHERE cs.student_id = p_student_id
--                 AND t.auth_user_id = auth.uid()
--                 AND cs.is_active = true
--                 AND ct.is_active = true );
--
-- So the teacher boundary on students is the SAME class_students ⋈ class_teachers
-- ⋈ teachers roster join used by `canAccessStudent` (rbac.ts:330) and the
-- teacher_remediation_assignments template (20260613000004:113-202), and is in
-- fact STRICTER (it additionally requires both link rows is_active = true).
--
-- ─── Why ship this migration anyway (genuine defense-in-depth) ───────────────
-- The existing net is entirely dependent on (a) the SECURITY DEFINER helper
-- `is_teacher_of` continuing to exist and behave, and (b) the `is_teacher_of(id)`
-- branch remaining inside `students_select_merged`. The audit itself was fooled
-- by this indirection — proving the discoverability risk is real. This migration
-- adds a SECOND, INDEPENDENT, self-contained policy that inlines the roster join
-- directly on public.students, so the teacher boundary survives even if the
-- helper or the merged policy is later altered. It is named in the discoverable
-- `"Teachers can …"` form the audit (and any future reviewer) expects.
--
-- ─── Why it is additive and cannot over-grant ───────────────────────────────
--   * PostgreSQL combines PERMISSIVE policies for the same command with OR. This
--     policy's predicate is IDENTICAL to the existing `is_teacher_of(id)` branch
--     (same roster join, same `cs.is_active`/`ct.is_active` guards), so the
--     effective set of rows a teacher may SELECT is UNCHANGED. No new row becomes
--     visible; no existing access is removed.
--   * It is strictly assigned-students-only: a teacher matches a student row IFF
--     that student shares an ACTIVE class enrollment with a class the teacher is
--     ACTIVELY assigned to, resolved from auth.uid() → teachers.auth_user_id.
--     A non-assigned / cross-school student cannot be selected via this policy
--     (no grade fallback, no school-wide grant — school-admin scope is the
--     separate "School admins can view school students" policy at baseline:19906
--     and is untouched here).
--   * The `is_active = true` guards are included deliberately so this inline
--     policy matches `is_teacher_of`'s strictness exactly. Omitting them would
--     have OR-broadened the effective boundary to students reachable via INACTIVE
--     (left-the-class) enrollments — that would be an over-grant, so it is not done.
--
-- ─── Scope ───────────────────────────────────────────────────────────────────
-- students-only. The audit also names learner_mastery / state_events as candidates
-- for the same backstop, but `learner_mastery` is not present under that name in
-- the reproducible baseline (the live mastery substrate is bkt_mastery_state /
-- concept_mastery), and applying the join cleanly there needs a separate
-- column/relationship verification pass. Per "tight and correct beats broad,"
-- those are intentionally deferred to a follow-up migration rather than guessed at.
--
-- ─── Safety properties ───────────────────────────────────────────────────────
--   * Additive: only DROP POLICY IF EXISTS (this policy's own name) + CREATE
--     POLICY. No existing policy is modified or dropped. RLS is already enabled on
--     public.students (baseline) — NOT toggled here (no destructive disable/enable).
--   * Idempotent: DROP POLICY IF EXISTS … ; CREATE POLICY … — safe to re-run.
--   * No RBAC role/permission added or altered. No table/column dropped. No data
--     touched. No SECURITY DEFINER introduced (plain PERMISSIVE policy expression).
--   * Rollback: DROP POLICY IF EXISTS "Teachers can view students in their classes"
--     ON public.students;  (the pre-existing is_teacher_of net remains in force).

BEGIN;

DROP POLICY IF EXISTS "Teachers can view students in their classes"
  ON public.students;

-- Teacher-assigned SELECT backstop. Predicate mirrors, verbatim, the roster join
-- of public.is_teacher_of (baseline:9212) and the baseline class_students teacher
-- policy "Teachers can view students in their classes" (baseline:20240) /
-- the teacher_remediation_assignments template (20260613000004:124-131), with the
-- is_active guards retained so it matches the existing effective boundary exactly.
CREATE POLICY "Teachers can view students in their classes"
  ON public.students
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers       t  ON t.id        = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
        AND cs.is_active = true
        AND ct.is_active = true
    )
  );

COMMENT ON POLICY "Teachers can view students in their classes" ON public.students IS
  'Engineering-audit Cycle 5 / TSB-2 (P8 defense-in-depth). Independent, '
  'self-contained teacher-assigned SELECT backstop: a teacher may read a student '
  'row IFF the student shares an active class enrollment with a class the teacher '
  'is actively assigned to (class_students join class_teachers join teachers, '
  'resolved from auth.uid()). Predicate is identical to the pre-existing '
  'is_teacher_of(id) branch of students_select_merged, so it is additive '
  '(PERMISSIVE OR) and cannot over-grant; it exists so the teacher boundary on '
  'students no longer depends solely on the is_teacher_of SECURITY DEFINER helper.';

COMMIT;

-- ─── Verify (manual, after applying) ─────────────────────────────────────────
-- As an assigned teacher (auth.uid() = teachers.auth_user_id with an active
-- class_teachers row whose class has the student via an active class_students row):
--   SELECT id, name FROM public.students WHERE id = '<assigned-student-uuid>';
--   -- expect: 1 row.
-- As a teacher with NO active assignment to that student (other school / left class):
--   SELECT id, name FROM public.students WHERE id = '<non-assigned-student-uuid>';
--   -- expect: 0 rows (RLS hides it).
