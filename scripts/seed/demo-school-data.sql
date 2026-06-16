-- ============================================================================
-- scripts/seed/demo-school-data.sql
-- ----------------------------------------------------------------------------
-- DEMO-ONLY seed data for the School Command Center dashboard.
--
-- WHAT THIS DOES
-- --------------
-- Populates a self-discovered "demo" school with enough roster data that the
-- purple School Command Center widgets (get_school_overview /
-- get_classes_at_risk / get_teacher_engagement) and the existing
-- get_school_dashboard_stats RPC render real, non-zero numbers:
--   - 3 classes (Class 9A, Class 10B, Class 11 Science)
--   - 3 demo teachers (one assigned to each class)
--   - 9 demo students (3 per class) wired onto each class roster
--
-- THIS IS NOT A MIGRATION.
-- ------------------------
-- It lives under scripts/seed/, NOT supabase/migrations/. The Supabase CLI's
-- `db push` only applies *.sql files at the IMMEDIATE supabase/migrations/ root,
-- so this file will NEVER auto-run on prod via a deploy. It is run by hand,
-- on demand, against the chosen project (see the runbook below). Run it only
-- against the environment whose demo school you want populated.
--
-- IDEMPOTENT & SAFE TO RE-RUN.
-- ----------------------------
-- Every INSERT is guarded (WHERE NOT EXISTS / ON CONFLICT DO NOTHING) and keyed
-- on stable natural keys (school_id + class name; class_id + student/teacher
-- identity). Running it twice is a no-op — it never duplicates a class, a
-- teacher, a student, or an enrollment.
--
-- SELF-DISCOVERING DEMO SCHOOL (no hardcoded UUID).
-- -------------------------------------------------
-- The target school is resolved at runtime as the oldest school whose name
-- matches ILIKE '%demo%'. If NO demo school exists, the script RAISEs a NOTICE
-- and no-ops cleanly (it does not error, does not create a school).
--
-- P5 COMPLIANCE: grade is seeded as TEXT ('9','10','11') — never an integer.
-- P13: no real PII — demo names + @demo.alfanumrik.invalid emails only.
--
-- AUTH COUPLING (verified against 00000000000000_baseline_from_prod.sql):
--   - students.id  : self-generated uuid PK (uuid_generate_v4()), NO FK to
--                    auth.users. students.auth_user_id is a SEPARATE, NULLABLE
--                    column that FKs auth.users (ON DELETE SET NULL) and is
--                    UNIQUE (NULLs are allowed and do not collide).
--   - teachers.id  : self-generated uuid PK (gen_random_uuid()), NO FK to
--                    auth.users. teachers.auth_user_id is SEPARATE, NULLABLE,
--                    UNIQUE. teachers.email is NOT NULL + UNIQUE.
--   => Therefore demo students/teachers can be inserted WITHOUT creating any
--      auth.users row: we leave auth_user_id NULL. These are roster-only demo
--      rows (no one logs in as them) and are marked is_demo = true so they are
--      trivially identifiable and removable. We never touch the auth schema.
--
-- HOW TO RUN
-- ----------
-- See docs/runbooks/school-admin-portal-db-apply.md. In short, against the
-- project you want seeded (NOT necessarily prod):
--     supabase db execute --file scripts/seed/demo-school-data.sql --linked
--   or
--     psql "$DB_URL" -f scripts/seed/demo-school-data.sql
-- ============================================================================

BEGIN;

DO $seed$
DECLARE
  v_school_id  uuid;
  v_class_9a   uuid;
  v_class_10b  uuid;
  v_class_11s  uuid;
  v_teacher_id uuid;
  v_student_id uuid;
  -- (class_label, grade TEXT, section, subject) for the 3 demo classes.
  v_classes CONSTANT text[][] := ARRAY[
    ARRAY['Class 9A',         '9',  'A',       'Mathematics'],
    ARRAY['Class 10B',        '10', 'B',       'Science'],
    ARRAY['Class 11 Science', '11', 'Science', 'Physics']
  ];
  -- Demo teacher display names, one per class (index-aligned with v_classes).
  v_teacher_names CONSTANT text[] := ARRAY[
    'Demo Teacher Asha',
    'Demo Teacher Ravi',
    'Demo Teacher Meera'
  ];
  r_class       record;
  i             int;
  j             int;
  v_class_id    uuid;
BEGIN
  -- ── 0. Resolve the demo school (oldest name ILIKE '%demo%'). No-op if none.
  SELECT s.id
    INTO v_school_id
    FROM public.schools s
   WHERE s.name ILIKE '%demo%'
     AND s.deleted_at IS NULL
   ORDER BY s.created_at ASC NULLS LAST
   LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE NOTICE 'demo-school-data: no school matching ILIKE ''%%demo%%'' found — nothing seeded (no-op).';
    RETURN;
  END IF;

  RAISE NOTICE 'demo-school-data: seeding demo school %', v_school_id;

  -- ── 1. Classes (always safe: classes.school_id is the only FK -> schools).
  --     Idempotent on (school_id, name). grade stored as TEXT (P5).
  FOR i IN 1 .. array_length(v_classes, 1) LOOP
    INSERT INTO public.classes
      (school_id, name, grade, section, subject, academic_year, is_active)
    SELECT
      v_school_id,
      v_classes[i][1],         -- name
      v_classes[i][2],         -- grade (TEXT)
      v_classes[i][3],         -- section
      v_classes[i][4],         -- subject
      '2025-26',
      true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.classes c
       WHERE c.school_id = v_school_id
         AND c.name = v_classes[i][1]
         AND c.deleted_at IS NULL
    );
  END LOOP;

  -- ────────────────────────────────────────────────────────────────────────
  -- 2 & 3. Teachers + Students + enrollments.
  --        Schema-permitted WITHOUT auth.users (see AUTH COUPLING note above):
  --        id is self-generated, auth_user_id left NULL, is_demo = true.
  --        These are roster-only demo rows so the widgets show real counts.
  -- ────────────────────────────────────────────────────────────────────────
  i := 0;
  FOR r_class IN
    SELECT c.id, c.name
      FROM public.classes c
     WHERE c.school_id = v_school_id
       AND c.name = ANY (ARRAY['Class 9A','Class 10B','Class 11 Science'])
       AND c.deleted_at IS NULL
     ORDER BY c.name
  LOOP
    i := i + 1;
    v_class_id := r_class.id;

    -- ── 2a. One demo teacher per class. Idempotent on the demo email.
    v_teacher_id := NULL;
    INSERT INTO public.teachers
      (name, email, school_id, is_active, is_demo, auth_user_id)
    SELECT
      v_teacher_names[i],
      'demo.teacher.' || i || '@demo.alfanumrik.invalid',
      v_school_id,
      true,
      true,
      NULL                     -- intentionally NULL: no auth.users row created
    WHERE NOT EXISTS (
      SELECT 1 FROM public.teachers t
       WHERE t.email = 'demo.teacher.' || i || '@demo.alfanumrik.invalid'
    );

    SELECT t.id INTO v_teacher_id
      FROM public.teachers t
     WHERE t.email = 'demo.teacher.' || i || '@demo.alfanumrik.invalid'
     LIMIT 1;

    -- ── 2b. Assign the teacher to the class (idempotent on class+teacher).
    IF v_teacher_id IS NOT NULL THEN
      INSERT INTO public.class_teachers (class_id, teacher_id, role, is_active)
      SELECT v_class_id, v_teacher_id, 'teacher', true
      WHERE NOT EXISTS (
        SELECT 1 FROM public.class_teachers ct
         WHERE ct.class_id = v_class_id
           AND ct.teacher_id = v_teacher_id
      );
    END IF;

    -- ── 3a/3b. Three demo students per class + their enrollment.
    --          Idempotent on the demo email; enrollment idempotent on
    --          (class_id, student_id).
    FOR j IN 1 .. 3 LOOP
      v_student_id := NULL;
      INSERT INTO public.students
        (name, email, grade, school_id, is_active, is_demo, auth_user_id, onboarding_completed)
      SELECT
        'Demo Student ' || i || '-' || j,
        'demo.student.' || i || '-' || j || '@demo.alfanumrik.invalid',
        -- grade as TEXT, aligned to the class grade (P5).
        CASE i WHEN 1 THEN '9' WHEN 2 THEN '10' ELSE '11' END,
        v_school_id,
        true,
        true,
        NULL,                  -- intentionally NULL: no auth.users row created
        true
      WHERE NOT EXISTS (
        SELECT 1 FROM public.students s
         WHERE s.email = 'demo.student.' || i || '-' || j || '@demo.alfanumrik.invalid'
      );

      SELECT s.id INTO v_student_id
        FROM public.students s
       WHERE s.email = 'demo.student.' || i || '-' || j || '@demo.alfanumrik.invalid'
       LIMIT 1;

      IF v_student_id IS NOT NULL THEN
        INSERT INTO public.class_students (class_id, student_id, roll_number, is_active)
        SELECT v_class_id, v_student_id, (j)::text, true
        WHERE NOT EXISTS (
          SELECT 1 FROM public.class_students cs
           WHERE cs.class_id = v_class_id
             AND cs.student_id = v_student_id
        );
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'demo-school-data: seed complete for school %', v_school_id;
END;
$seed$;

COMMIT;

-- ============================================================================
-- VERIFICATION (eyeball after running).
-- ----------------------------------------------------------------------------
-- 1) Roster counts the widgets read (works on ANY connection — no admin guard):
SELECT
  s.id   AS demo_school_id,
  s.name AS demo_school_name,
  (SELECT count(*) FROM public.classes c
     WHERE c.school_id = s.id AND c.is_active AND c.deleted_at IS NULL) AS class_count,
  (SELECT count(*) FROM public.teachers t
     WHERE t.school_id = s.id AND t.is_active AND t.is_demo)            AS demo_teacher_count,
  (SELECT count(*) FROM public.students st
     WHERE st.school_id = s.id AND st.is_active AND st.is_demo)         AS demo_student_count
FROM public.schools s
WHERE s.name ILIKE '%demo%' AND s.deleted_at IS NULL
ORDER BY s.created_at ASC NULLS LAST
LIMIT 1;
-- Expect: class_count >= 3, demo_teacher_count >= 3, demo_student_count >= 9.

-- 2) The dashboard RPC (NOTE: SECURITY DEFINER + is_school_admin_of() guard —
--    it RAISES 'Forbidden' unless auth.uid() is an ACTIVE school_admin of this
--    school. On a plain psql / service_role connection auth.uid() is NULL, so
--    this WILL raise. Run it as the school admin (e.g. via the app / a JWT'd
--    PostgREST call), OR rely on query (1) above for connection-agnostic proof.
-- SELECT public.get_school_dashboard_stats(
--   (SELECT id FROM public.schools
--      WHERE name ILIKE '%demo%' AND deleted_at IS NULL
--      ORDER BY created_at ASC NULLS LAST LIMIT 1)
-- );
