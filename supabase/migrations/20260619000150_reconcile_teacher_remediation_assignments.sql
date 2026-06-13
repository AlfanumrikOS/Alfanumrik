-- Migration: 20260619000150_reconcile_teacher_remediation_assignments.sql
-- Purpose: RECONCILIATION migration for a CONFIRMED production deploy failure.
--          Re-issues the FULL object set of 20260613000004_teacher_remediation_assignments.sql
--          (table + indexes + RLS + all policies + the class.assign_remediation RBAC grant)
--          so the `public.teacher_remediation_assignments` table physically EXISTS before the
--          adaptive_interventions FK in 20260619000200 is evaluated.
--
-- ─── Root cause (ground truth — not re-litigated here) ───────────────────────
--   * `supabase migration list --linked` against PROD shows everything up to and
--     including 20260619000100 recorded APPLIED; 20260619000200..000600 are NOT
--     applied.
--   * Prod `db push` fails applying 20260619000200_adaptive_interventions.sql with
--       ERROR: relation "public.teacher_remediation_assignments" does not exist (42P01)
--     because that migration declares a HARD FK:
--       teacher_assignment_id uuid REFERENCES public.teacher_remediation_assignments(id) ...
--   * The referenced table is created by 20260613000004_teacher_remediation_assignments.sql,
--     which is recorded APPLIED on prod — but its CREATE TABLE body NEVER PHYSICALLY RAN.
--     During the schema-reproducibility cutover (docs/runbooks/schema-reproducibility-fix.md)
--     20260613000004 was pre-marked applied via `supabase migration repair` WITHOUT executing
--     its body. So on prod (and likely main-staging) the migration is "done" while the table
--     is physically ABSENT — a repair-skipped body. The same is true of any table created by a
--     2026061[3-9]* migration that was repair-marked rather than run.
--
-- ─── Why version 20260619000150 (the ordering is load-bearing) ───────────────
--   The version is deliberately BETWEEN prod's last-applied 20260619000100 and the
--   failing 20260619000200. `supabase db push` applies pending files in ascending
--   version order, so on prod this file runs FIRST (creating the table) and ONLY
--   THEN does 20260619000200 run and resolve its FK. One deploy fully unblocks prod.
--
-- ─── Idempotency / no-op-on-fresh-DB guarantee ───────────────────────────────
--   Every statement is idempotent. On a FRESH database (CI live-DB, new staging, DR
--   restore) where the migration chain runs in full, 20260613000004 has ALREADY
--   created the table by the time this file runs, so:
--     - CREATE TABLE IF NOT EXISTS  -> no-op (table present)
--     - CREATE INDEX IF NOT EXISTS  -> no-op (indexes present)
--     - ALTER TABLE ... ENABLE RLS  -> idempotent (already enabled)
--     - DROP POLICY IF EXISTS + CREATE POLICY -> re-creates identical policies (byte-for-byte
--       the same definitions as 20260613000004, so ZERO schema/RLS drift either way)
--     - the RBAC INSERTs are ON CONFLICT DO NOTHING
--   On a REPAIRED env (prod / main-staging) where the table is physically missing, this file
--   is the ONLY place that actually creates it. Either way the end state is identical to
--   running 20260613000004's body once. This migration exists PURELY to make the migration
--   chain self-consistent on repaired environments; it changes no behavior on any env where
--   the table already exists.
--
-- ─── Why only teacher_remediation_assignments is reconciled here ─────────────
--   Dependency scan of the five not-yet-applied migrations (000200..000600):
--     * 000200 FK -> public.students(id)                       — BASELINE present  -> safe
--     * 000200 FK -> public.teacher_remediation_assignments(id) — 20260613000004    -> AT-RISK, reconciled below
--     * 000200 RLS refs guardian_student_links/guardians/class_students/class_teachers/teachers — BASELINE -> safe
--     * 000300 / 000600 -> public.feature_flags                — BASELINE present + to_regclass-guarded -> safe
--     * 000400 -> public.teacher_remediation_assignments       — same table; unblocked by this reconciliation
--     * 000500 ALTERs public.adaptive_interventions            — created by 000200 earlier in the SAME push -> safe
--   teacher_remediation_assignments is the ONLY external object created by a 2026061[3-9]*
--   migration in the repaired range that 000200..000600 hard-depend on. Its OWN FK targets
--   (teachers, students, classes, curriculum_topics, at_risk_alerts) and the RBAC tables
--   (permissions, roles, role_permissions) are ALL present in 00000000000000_baseline_from_prod.sql,
--   so this reconciliation has no further repair-skipped dependency of its own.
--
-- ─── Fidelity ────────────────────────────────────────────────────────────────
--   The table/indexes/RLS/policies/RBAC below MIRROR 20260613000004 EXACTLY (same column
--   names, types, defaults, CHECK lists, ON DELETE actions, index names, policy names, policy
--   USING/WITH CHECK bodies, and RBAC rows). Do NOT diverge — drift between the two files would
--   defeat the purpose. P8 preserved (RLS enabled in this same migration with the identical
--   four-pattern policy set). P5 N/A (no grade column — mirrored from the original). P13 N/A
--   (uuid references only, no PII columns).
--
-- Owner: architect. Additive-only: no DROP TABLE / DROP COLUMN / destructive op.

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

-- ─── 3. RLS (same migration — P8) ────────────────────────────────────────────
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
-- Mirrors 20260613000004 verbatim. The `class` resource and the permission-grant
-- shape already exist in the baseline (class.manage, class.view_analytics). Both
-- INSERTs are idempotent (ON CONFLICT DO NOTHING), so on an env where
-- 20260613000004's RBAC rows already landed this is a clean no-op.
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
-- 1. Table now physically exists:
--    SELECT to_regclass('public.teacher_remediation_assignments');  -- expect: non-null
-- 2. RLS enabled with the four-pattern policy set:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'teacher_remediation_assignments'; -- expect t
--    SELECT polname, cmd FROM pg_policies
--     WHERE tablename = 'teacher_remediation_assignments' ORDER BY polname;
--      Expected: _service_all (ALL), _student_select (SELECT), _teacher_insert (INSERT),
--                _teacher_select (SELECT), _teacher_update (UPDATE).
-- 3. RBAC grant present (teacher only; admin/super_admin via wildcard):
--    SELECT r.name FROM role_permissions rp
--      JOIN roles r ON r.id = rp.role_id
--      JOIN permissions p ON p.id = rp.permission_id
--     WHERE p.code = 'class.assign_remediation' ORDER BY r.name;  -- expect: teacher
-- 4. The next pending file (20260619000200) now applies — its
--    teacher_assignment_id FK resolves against this table.
