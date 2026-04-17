-- =============================================================================
-- RBAC B2B Relationship Sync
-- Migration: 20260417600000_rbac_b2b_relationship_sync.sql
--
-- Fixes 4 critical RBAC relationship gaps in the B2B system:
--   1. Auto-sync school_memberships when students/teachers get a school_id
--   2. Backfill existing students/teachers into school_memberships
--   3. Auto-create school-scoped user_roles on school enrollment
--   4. Auto-create parent school_memberships when guardian link is approved
--
-- Depends on:
--   - 20260417200000_rbac_phase2a_tenant_scoped_schema.sql (school_memberships table)
--   - _legacy/000_core_schema.sql (students, teachers, guardians, guardian_student_links)
--   - 20260324070000_production_rbac_system.sql (roles, user_roles, sync_user_roles)
-- =============================================================================


-- ===========================================================================
-- SECTION 0: Ensure school_memberships.role column exists
-- ===========================================================================
-- The school_memberships table was created in phase2a with a role TEXT column,
-- but verify it exists in case a partial migration occurred.

ALTER TABLE school_memberships ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member';


-- ===========================================================================
-- SECTION 1: Auto-sync school_memberships when students.school_id is set
-- ===========================================================================
-- RBAC gap: When a student gets a school_id (via onboarding, admin assignment,
-- or school enrollment API), they need a school_memberships row for RLS
-- policies that check membership.  Without this trigger, all school-scoped
-- RLS policies silently deny access.
--
-- SECURITY DEFINER -- This trigger fires on INSERT/UPDATE to the students
-- table and must insert into school_memberships and user_roles regardless
-- of the caller's RLS context.  The caller may be a student completing
-- onboarding or an admin assigning a school_id via service role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_school_membership_on_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_role_id UUID;
BEGIN
  -- Only act if school_id is being set or changed
  IF NEW.school_id IS NOT NULL AND (OLD IS NULL OR OLD.school_id IS DISTINCT FROM NEW.school_id) THEN

    -- Deactivate old membership if school changed
    IF OLD IS NOT NULL AND OLD.school_id IS NOT NULL AND OLD.school_id <> NEW.school_id THEN
      UPDATE school_memberships SET is_active = false, updated_at = now()
      WHERE auth_user_id = NEW.auth_user_id AND school_id = OLD.school_id;
    END IF;

    -- Create or reactivate school_memberships row
    IF NEW.auth_user_id IS NOT NULL THEN
      INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
      VALUES (NEW.auth_user_id, NEW.school_id, 'student', true)
      ON CONFLICT (auth_user_id, school_id)
      DO UPDATE SET is_active = true, role = 'student', updated_at = now();

      -- Also create school-scoped user_role for RBAC
      -- First, try the school-specific student role
      SELECT r.id INTO v_school_role_id
      FROM roles r
      WHERE r.name = 'student'
        AND r.school_id = NEW.school_id
        AND r.is_active = true;

      IF v_school_role_id IS NOT NULL THEN
        INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
        VALUES (NEW.auth_user_id, v_school_role_id, NEW.school_id, true)
        ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
        DO NOTHING;
      ELSE
        -- If no school-scoped role exists yet (school hasn't been fully onboarded),
        -- assign the platform student role with school_id context
        INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
        SELECT NEW.auth_user_id, r.id, NEW.school_id, true
        FROM roles r
        WHERE r.name = 'student' AND r.school_id IS NULL AND r.is_active = true
        LIMIT 1
        ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- Handle school_id being removed (student leaves school)
  IF NEW.school_id IS NULL AND OLD IS NOT NULL AND OLD.school_id IS NOT NULL THEN
    UPDATE school_memberships SET is_active = false, updated_at = now()
    WHERE auth_user_id = NEW.auth_user_id AND school_id = OLD.school_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on students: INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_sync_school_membership_student ON students;
CREATE TRIGGER trg_sync_school_membership_student
  AFTER INSERT OR UPDATE OF school_id ON students
  FOR EACH ROW
  EXECUTE FUNCTION sync_school_membership_on_student();


-- ===========================================================================
-- SECTION 2: Auto-sync school_memberships when teachers.school_id is set
-- ===========================================================================
-- Same RBAC gap as Section 1, but for teachers.
--
-- SECURITY DEFINER -- Same justification: trigger fires on INSERT/UPDATE to
-- teachers and must write to school_memberships and user_roles across RLS
-- boundaries.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_school_membership_on_teacher()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_role_id UUID;
BEGIN
  -- Only act if school_id is being set or changed
  IF NEW.school_id IS NOT NULL AND (OLD IS NULL OR OLD.school_id IS DISTINCT FROM NEW.school_id) THEN

    -- Deactivate old membership if school changed
    IF OLD IS NOT NULL AND OLD.school_id IS NOT NULL AND OLD.school_id <> NEW.school_id THEN
      UPDATE school_memberships SET is_active = false, updated_at = now()
      WHERE auth_user_id = NEW.auth_user_id AND school_id = OLD.school_id;
    END IF;

    -- Create or reactivate school_memberships row
    IF NEW.auth_user_id IS NOT NULL THEN
      INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
      VALUES (NEW.auth_user_id, NEW.school_id, 'teacher', true)
      ON CONFLICT (auth_user_id, school_id)
      DO UPDATE SET is_active = true, role = 'teacher', updated_at = now();

      -- Also create school-scoped user_role for RBAC
      -- First, try the school-specific teacher role
      SELECT r.id INTO v_school_role_id
      FROM roles r
      WHERE r.name = 'teacher'
        AND r.school_id = NEW.school_id
        AND r.is_active = true;

      IF v_school_role_id IS NOT NULL THEN
        INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
        VALUES (NEW.auth_user_id, v_school_role_id, NEW.school_id, true)
        ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
        DO NOTHING;
      ELSE
        -- If no school-scoped role exists yet, assign the platform teacher role
        -- with school_id context
        INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
        SELECT NEW.auth_user_id, r.id, NEW.school_id, true
        FROM roles r
        WHERE r.name = 'teacher' AND r.school_id IS NULL AND r.is_active = true
        LIMIT 1
        ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- Handle school_id being removed (teacher leaves school)
  IF NEW.school_id IS NULL AND OLD IS NOT NULL AND OLD.school_id IS NOT NULL THEN
    UPDATE school_memberships SET is_active = false, updated_at = now()
    WHERE auth_user_id = NEW.auth_user_id AND school_id = OLD.school_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on teachers: INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_sync_school_membership_teacher ON teachers;
CREATE TRIGGER trg_sync_school_membership_teacher
  AFTER INSERT OR UPDATE OF school_id ON teachers
  FOR EACH ROW
  EXECUTE FUNCTION sync_school_membership_on_teacher();


-- ===========================================================================
-- SECTION 3: Auto-create parent school_membership on guardian link approval
-- ===========================================================================
-- RBAC gap: When a parent's guardian_student_links row becomes 'active' or
-- 'approved', and the linked student is enrolled in a school, the parent
-- needs a read-only school_memberships entry so they can access school-scoped
-- data about their child (report cards, attendance, etc.).
--
-- SECURITY DEFINER -- This trigger fires on INSERT/UPDATE to
-- guardian_student_links and must read from students, guardians and write
-- to school_memberships regardless of the caller's RLS context.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_parent_school_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_school_id UUID;
  v_guardian_auth_user_id UUID;
BEGIN
  -- Only act when link becomes active/approved
  IF NEW.status IN ('active', 'approved') AND (OLD IS NULL OR OLD.status NOT IN ('active', 'approved')) THEN

    -- Get student's school_id
    SELECT school_id INTO v_student_school_id
    FROM students WHERE id = NEW.student_id;

    -- Get guardian's auth_user_id
    SELECT auth_user_id INTO v_guardian_auth_user_id
    FROM guardians WHERE id = NEW.guardian_id;

    -- If student is school-enrolled, add parent to school_memberships
    IF v_student_school_id IS NOT NULL AND v_guardian_auth_user_id IS NOT NULL THEN
      INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
      VALUES (v_guardian_auth_user_id, v_student_school_id, 'parent', true)
      ON CONFLICT (auth_user_id, school_id)
      DO UPDATE SET is_active = true, updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on guardian_student_links: INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_sync_parent_school_membership ON guardian_student_links;
CREATE TRIGGER trg_sync_parent_school_membership
  AFTER INSERT OR UPDATE OF status ON guardian_student_links
  FOR EACH ROW
  EXECUTE FUNCTION sync_parent_school_membership();


-- ===========================================================================
-- SECTION 4: Backfill existing students into school_memberships
-- ===========================================================================
-- Students with school_id set but no school_memberships row.  ON CONFLICT
-- DO NOTHING ensures idempotency if this migration is replayed.

INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
SELECT s.auth_user_id, s.school_id, 'student', true
FROM students s
WHERE s.school_id IS NOT NULL
  AND s.auth_user_id IS NOT NULL
  AND s.is_active = true
ON CONFLICT (auth_user_id, school_id) DO NOTHING;


-- ===========================================================================
-- SECTION 5: Backfill existing teachers into school_memberships
-- ===========================================================================

INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
SELECT t.auth_user_id, t.school_id, 'teacher', true
FROM teachers t
WHERE t.school_id IS NOT NULL
  AND t.auth_user_id IS NOT NULL
  AND t.is_active = true
ON CONFLICT (auth_user_id, school_id) DO NOTHING;


-- ===========================================================================
-- SECTION 6: Backfill existing active guardian links into school_memberships
-- ===========================================================================

INSERT INTO school_memberships (auth_user_id, school_id, role, is_active)
SELECT g.auth_user_id, s.school_id, 'parent', true
FROM guardian_student_links gsl
JOIN guardians g ON g.id = gsl.guardian_id
JOIN students s ON s.id = gsl.student_id
WHERE gsl.status IN ('active', 'approved')
  AND s.school_id IS NOT NULL
  AND g.auth_user_id IS NOT NULL
ON CONFLICT (auth_user_id, school_id) DO NOTHING;


-- ===========================================================================
-- SECTION 7: Backfill school-scoped user_roles for existing memberships
-- ===========================================================================
-- Students and teachers with school_id who are already in school_memberships
-- (from Sections 4-6 or pre-existing) but missing school-scoped user_roles.
-- Tries school-specific roles first; falls back to platform roles with
-- school_id context.

-- 7a: School-scoped student roles (school has been onboarded with cloned roles)
INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
SELECT DISTINCT sm.auth_user_id, r.id, sm.school_id, true
FROM school_memberships sm
JOIN roles r ON r.name = 'student' AND r.school_id = sm.school_id AND r.is_active = true
WHERE sm.role = 'student' AND sm.is_active = true
ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
DO NOTHING;

-- 7b: Fallback — platform student role with school_id for schools without cloned roles
INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
SELECT DISTINCT sm.auth_user_id, r.id, sm.school_id, true
FROM school_memberships sm
CROSS JOIN (
  SELECT id FROM roles
  WHERE name = 'student' AND school_id IS NULL AND is_active = true
  LIMIT 1
) r
WHERE sm.role = 'student'
  AND sm.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.auth_user_id = sm.auth_user_id AND ur.school_id = sm.school_id
  )
ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
DO NOTHING;

-- 7c: School-scoped teacher roles (school has been onboarded with cloned roles)
INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
SELECT DISTINCT sm.auth_user_id, r.id, sm.school_id, true
FROM school_memberships sm
JOIN roles r ON r.name = 'teacher' AND r.school_id = sm.school_id AND r.is_active = true
WHERE sm.role = 'teacher' AND sm.is_active = true
ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
DO NOTHING;

-- 7d: Fallback — platform teacher role with school_id for schools without cloned roles
INSERT INTO user_roles (auth_user_id, role_id, school_id, is_active)
SELECT DISTINCT sm.auth_user_id, r.id, sm.school_id, true
FROM school_memberships sm
CROSS JOIN (
  SELECT id FROM roles
  WHERE name = 'teacher' AND school_id IS NULL AND is_active = true
  LIMIT 1
) r
WHERE sm.role = 'teacher'
  AND sm.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.auth_user_id = sm.auth_user_id AND ur.school_id = sm.school_id
  )
ON CONFLICT (auth_user_id, role_id, school_id) WHERE school_id IS NOT NULL
DO NOTHING;


-- ===========================================================================
-- SECTION 8: Helpful index for trigger performance
-- ===========================================================================
-- The triggers look up students/teachers by id to get school_id.
-- These PKs are already indexed, but add a covering index for the
-- common pattern: students WHERE school_id IS NOT NULL AND is_active.

CREATE INDEX IF NOT EXISTS idx_students_school_active
  ON students (school_id) WHERE school_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_teachers_school_active
  ON teachers (school_id) WHERE school_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_school_memberships_role
  ON school_memberships (school_id, role) WHERE is_active = true;
