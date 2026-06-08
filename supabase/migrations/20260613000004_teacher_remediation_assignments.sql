-- Migration: 20260613000004_teacher_remediation_assignments.sql
-- Purpose: Phase 3A (Teacher Command Center) Wave A / A1 foundation.
--          Ships the data layer for teacher-assigned remediation:
--            1. CREATE TABLE teacher_remediation_assignments — a teacher
--               flags a specific student × concept (heatmap cell / at-risk
--               alert) for follow-up; the Today-resolver (Wave A / A3) joins
--               this so the student sees the assigned remediation.
--            2. RLS — teacher can read/write only rows for students genuinely
--               on their roster; student reads only their own rows; service
--               role full access (for the Today-resolver join).
--            3. RBAC — new `class.assign_remediation` permission granted to
--               the `teacher` role.
--
-- Spec: docs/superpowers/specs/2026-06-08-phase-3a-teacher-command-center-design.md
-- Plan: Wave A / A1.
--
-- ─── RBAC approval note ──────────────────────────────────────────────────────
-- Per `.claude/CLAUDE.md` ("User Approval Required For → RBAC role or
-- permission additions"), new permission codes normally require explicit user
-- approval before seeding. The active /goal authorizes proceeding with the
-- `class.assign_remediation` permission for Phase 3A Wave A; this will be
-- flagged in the PR for the CEO's sign-off at merge time.
--
-- ─── Identity / FK conventions confirmed against the baseline ────────────────
--   - teacher_id  → public.teachers(id)  (internal teacher id, NOT auth.uid()).
--                   The teacher's Supabase user is teachers.auth_user_id.
--   - student_id  → public.students(id)  (internal student id, NOT auth.uid()).
--                   The student's Supabase user is students.auth_user_id.
--   - class_id    → public.classes(id).
--   - chapter_id  → public.curriculum_topics(id). This is the concept/topic the
--                   teacher heatmap renders per column (bkt_mastery_state.topic_id
--                   keys off the same id) and is therefore the unit a teacher
--                   assigns remediation against. Nullable: a teacher may assign
--                   "general" remediation off an at-risk alert that has no single
--                   topic. ON DELETE SET NULL so retiring a topic never deletes
--                   the assignment row (we keep the audit trail).
--   - source_alert_id → public.at_risk_alerts(id), nullable. Set when the
--                   assignment originated from an at-risk alert; ON DELETE SET
--                   NULL so the assignment survives alert cleanup.
--
-- ─── Roster join used by RLS (defense in depth) ──────────────────────────────
-- A teacher "owns" a student iff the student shares a class with the teacher
-- via class_students × class_teachers. This is the canonical baseline join,
-- mirrored verbatim from the prod policy
-- "Teachers can view links for their students" on public.guardian_student_links:
--     student_id IN (
--       SELECT cs.student_id
--       FROM class_students cs
--       JOIN class_teachers ct ON ct.class_id = cs.class_id
--       JOIN teachers t        ON t.id = ct.teacher_id
--       WHERE t.auth_user_id = auth.uid()
--     )
-- We use this on both the teacher INSERT WITH CHECK and the teacher
-- SELECT/UPDATE USING clauses so a teacher cannot assign remediation to a
-- student who is not actually on their roster, even by forging student_id.
-- NOTE: teacher_class_assignments (queried defensively by the teacher-dashboard
-- Edge Function) is NOT present in the reproducible baseline, so RLS keys off
-- the baseline-present class_teachers link only. If a future env wires
-- teacher_class_assignments, extend this join in a follow-up migration.
--
-- P5/P13: no PII columns added; rows reference internal uuids only. Grade stays
-- a string everywhere it appears upstream (no grade column here).
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS; DROP POLICY IF EXISTS before
-- each CREATE POLICY; INSERT ... ON CONFLICT DO NOTHING for RBAC rows.

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teacher_remediation_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  chapter_id      uuid REFERENCES public.curriculum_topics(id) ON DELETE SET NULL,
  source_alert_id uuid REFERENCES public.at_risk_alerts(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'assigned'
                    CHECK (status IN ('assigned', 'in_progress', 'resolved', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

COMMENT ON TABLE public.teacher_remediation_assignments IS
  'Phase 3A Wave A: a teacher flags a student × concept (heatmap cell / at-risk '
  'alert) for remediation. The Today-resolver (Wave A / A3) joins this so the '
  'student sees the assigned remediation. teacher_id/student_id are internal '
  'teachers.id/students.id (NOT auth.uid()); chapter_id is curriculum_topics.id.';

COMMENT ON COLUMN public.teacher_remediation_assignments.chapter_id IS
  'curriculum_topics.id — the concept/topic the teacher heatmap renders per '
  'column. Nullable for general (alert-driven) remediation.';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────
-- Teacher dashboard: "my open remediations" / status board.
CREATE INDEX IF NOT EXISTS idx_teacher_remediation_assignments_teacher_status
  ON public.teacher_remediation_assignments (teacher_id, status);

-- Today-resolver: "this student's open remediations".
CREATE INDEX IF NOT EXISTS idx_teacher_remediation_assignments_student_status
  ON public.teacher_remediation_assignments (student_id, status);

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.teacher_remediation_assignments ENABLE ROW LEVEL SECURITY;

-- Service role: full access (Today-resolver join in A3, server-side writes).
DROP POLICY IF EXISTS teacher_remediation_assignments_service_all
  ON public.teacher_remediation_assignments;
CREATE POLICY teacher_remediation_assignments_service_all
  ON public.teacher_remediation_assignments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Teacher SELECT: only rows the teacher assigned AND where the student is on
-- the teacher's roster (defense in depth — both conditions must hold).
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments;
CREATE POLICY teacher_remediation_assignments_teacher_select
  ON public.teacher_remediation_assignments
  FOR SELECT TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Teacher INSERT: the row's teacher_id must be the caller AND the student must
-- be on the caller's roster AND the class must be one the caller teaches.
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments;
CREATE POLICY teacher_remediation_assignments_teacher_insert
  ON public.teacher_remediation_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
    AND class_id IN (
      SELECT ct.class_id
      FROM public.class_teachers ct
      JOIN public.teachers t ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Teacher UPDATE: same ownership + roster gate on both the existing row (USING)
-- and the post-update row (WITH CHECK) so a teacher cannot re-point a row at a
-- student outside their roster.
DROP POLICY IF EXISTS teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments;
CREATE POLICY teacher_remediation_assignments_teacher_update
  ON public.teacher_remediation_assignments
  FOR UPDATE TO authenticated
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid()
    )
    AND student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Student SELECT: a student reads only their own remediation rows.
DROP POLICY IF EXISTS teacher_remediation_assignments_student_select
  ON public.teacher_remediation_assignments;
CREATE POLICY teacher_remediation_assignments_student_select
  ON public.teacher_remediation_assignments
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

-- ─── 4. RBAC: class.assign_remediation → teacher role ────────────────────────
-- Mirrors the applied-to-prod permission-grant pattern from
-- 20260613000000_child_encourage_permission.sql and
-- _legacy/timestamped/20260324070000_production_rbac_system.sql (the `class`
-- resource already exists: class.manage, class.view_analytics).
-- See the RBAC approval note in the header — flagged for CEO sign-off in the PR.

INSERT INTO permissions (code, resource, action, description) VALUES
  ('class.assign_remediation',
   'class',
   'assign_remediation',
   'Assign targeted remediation to a student on a weak concept (Teacher Command Center)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r, permissions p
 WHERE r.name = 'teacher'
   AND p.code = 'class.assign_remediation'
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT r.name AS role, p.code AS permission
--   FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id
--   JOIN permissions p ON p.id = rp.permission_id
--  WHERE p.code = 'class.assign_remediation'
--  ORDER BY r.name;
-- Expected: 1 row — teacher. (admin/super_admin hold it via the wildcard grant.)
