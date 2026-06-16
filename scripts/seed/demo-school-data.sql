-- ============================================================================
-- scripts/seed/demo-school-data.sql
-- ----------------------------------------------------------------------------
-- DEMO-ONLY seed data for the School Command Center dashboard.
--
-- WHAT THIS DOES
-- --------------
-- Populates EVERY demo school that has an ACTIVE school_admin with enough
-- roster data that the purple School Command Center widgets
-- (get_school_overview / get_classes_at_risk / get_teacher_engagement) and the
-- existing get_school_dashboard_stats RPC render real, non-zero numbers:
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
-- against the environment whose demo school(s) you want populated.
--
-- IDEMPOTENT & SAFE TO RE-RUN.
-- ----------------------------
-- Every INSERT is guarded (WHERE NOT EXISTS) and keyed on stable natural keys
-- (school_id + class name; school-scoped email for teachers/students; class_id +
-- student/teacher id for enrollment). Running it twice is a no-op — it never
-- duplicates a class, a teacher, a student, or an enrollment.
--
-- TARGETS ONLY DEMO SCHOOLS WITH AN ACTIVE ADMIN (no hardcoded UUID).
-- ------------------------------------------------------------------
-- BUG FIX (B), discovered live 2026-06-16: the previous version auto-discovered
-- the OLDEST school whose name matches ILIKE '%demo%'. On prod the oldest such
-- school is "Alfanumrik Demo School" — which has NO school_admin, so it can
-- never be demoed (the Command Center RPCs raise 42501 with no admin to hold
-- the JWT). FIX: this script now loops over ALL schools that BOTH match
-- ILIKE '%demo%' AND have at least one ACTIVE row in public.school_admins
-- (join sa.school_id = s.id AND sa.is_active). On prod this is exactly the two
-- demoable schools:
--   - 61d15e48-8214-425c-bc2f-9c2e2e584f09  "Demo School — Demo School"
--                                            admin demo-school@alfanumrik.com
--   - a2e40b65-4386-46b4-bf6d-2bb2c52ba161  "Demo School — School"
--                                            admin school-demo@alfanumrik.com
-- If NO qualifying school exists, the script RAISEs a NOTICE and no-ops cleanly
-- (it does not error, does not create a school, does not create an admin).
--
-- SCHOOL-SCOPED EMAILS (no cross-school collision / cross-wiring).
-- ---------------------------------------------------------------
-- BUG FIX (B), discovered live 2026-06-16: teachers.email and students.email
-- are GLOBALLY UNIQUE. The previous version used non-school-scoped emails
-- (demo.teacher.1@..., demo.student.1-1@...). With more than one qualifying
-- school that collides on the 2nd school (the WHERE NOT EXISTS short-circuits,
-- so the 2nd school silently gets the 1st school's people cross-wired — or a
-- unique-violation if the guard is bypassed). FIX: every demo email now embeds
-- an 8-char tag derived from the school id —
--   left(replace(school_id::text,'-',''),8)  e.g. '61d15e48' / 'a2e40b65'
-- so demo.teacher.<tag>.<i>@... and demo.student.<tag>.<i>-<j>@... are unique
-- per school. Running across multiple schools never collides or cross-wires.
--
-- preferred_subject MUST be a VALID subjects.code (NOT a name).
-- ------------------------------------------------------------
-- BUG FIX (A), discovered live 2026-06-16: students.preferred_subject has a
-- column DEFAULT of 'Mathematics' (a NAME) but FKs public.subjects.CODE, and
-- the codes are lowercase ('math','science','physics','english',...). Leaving
-- preferred_subject unset → the 'Mathematics' default fires → 23503 FK
-- violation against subjects.code. FIX: the students INSERT now EXPLICITLY sets
-- preferred_subject to a valid code, aligned per class:
--   Class 9A  → 'math'      (i = 1)
--   Class 10B → 'science'   (i = 2)
--   Class 11 Science → 'physics'  (i = 3)
-- These three codes are confirmed-present subjects.code values
-- (see 00000000000000_baseline_from_prod.sql code→name mapping).
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
--      (The SCHOOL ADMIN — the JWT holder who actually opens the dashboard —
--      is a real, pre-existing auth user in public.school_admins; this script
--      neither creates nor modifies admins.)
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
  v_school_tag text;
  v_teacher_id uuid;
  v_student_id uuid;
  -- (class_label, grade TEXT, section, subject_display, preferred_subject CODE)
  -- for the 3 demo classes. The 5th element is the VALID subjects.code that the
  -- per-class students get on preferred_subject (BUG FIX A) — NOT a name.
  v_classes CONSTANT text[][] := ARRAY[
    ARRAY['Class 9A',         '9',  'A',       'Mathematics', 'math'],
    ARRAY['Class 10B',        '10', 'B',       'Science',     'science'],
    ARRAY['Class 11 Science', '11', 'Science', 'Physics',     'physics']
  ];
  -- Demo teacher display names, one per class (index-aligned with v_classes).
  v_teacher_names CONSTANT text[] := ARRAY[
    'Demo Teacher Asha',
    'Demo Teacher Ravi',
    'Demo Teacher Meera'
  ];
  r_school      record;
  r_class       record;
  i             int;
  j             int;
  v_class_id    uuid;
  v_pref_code   text;
  v_teacher_email text;
  v_student_email text;
  v_seeded_any  boolean := false;
BEGIN
  -- ── 0. Resolve EVERY demo school that has an ACTIVE school_admin (BUG FIX B).
  --     We do NOT pick the oldest; we loop over ALL qualifying schools so the
  --     two demoable prod schools (61d15e48 + a2e40b65) both get populated, and
  --     so any future demo school with an admin is covered automatically.
  FOR r_school IN
    SELECT DISTINCT s.id
      FROM public.schools s
      JOIN public.school_admins sa
        ON sa.school_id = s.id
       AND sa.is_active
     WHERE s.name ILIKE '%demo%'
       AND s.deleted_at IS NULL
     ORDER BY s.id
  LOOP
    v_seeded_any := true;
    v_school_id  := r_school.id;
    -- 8-char school tag for globally-unique, school-scoped emails (BUG FIX B).
    v_school_tag := left(replace(v_school_id::text, '-', ''), 8);

    RAISE NOTICE 'demo-school-data: seeding demo school % (tag %)', v_school_id, v_school_tag;

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
        v_classes[i][4],         -- subject (display)
        '2025-26',
        true
      WHERE NOT EXISTS (
        SELECT 1 FROM public.classes c
         WHERE c.school_id = v_school_id
           AND c.name = v_classes[i][1]
           AND c.deleted_at IS NULL
      );
    END LOOP;

    -- ──────────────────────────────────────────────────────────────────────
    -- 2 & 3. Teachers + Students + enrollments.
    --        Schema-permitted WITHOUT auth.users (see AUTH COUPLING note):
    --        id is self-generated, auth_user_id left NULL, is_demo = true.
    --        Emails are SCHOOL-SCOPED via v_school_tag (BUG FIX B).
    -- ──────────────────────────────────────────────────────────────────────
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
      v_class_id  := r_class.id;
      -- Valid subjects.code for this class's students (BUG FIX A).
      v_pref_code := v_classes[i][5];
      v_teacher_email := 'demo.teacher.' || v_school_tag || '.' || i || '@demo.alfanumrik.invalid';

      -- ── 2a. One demo teacher per class. Idempotent on the school-scoped email.
      v_teacher_id := NULL;
      INSERT INTO public.teachers
        (name, email, school_id, is_active, is_demo, auth_user_id)
      SELECT
        v_teacher_names[i],
        v_teacher_email,
        v_school_id,
        true,
        true,
        NULL                     -- intentionally NULL: no auth.users row created
      WHERE NOT EXISTS (
        SELECT 1 FROM public.teachers t
         WHERE t.email = v_teacher_email
      );

      SELECT t.id INTO v_teacher_id
        FROM public.teachers t
       WHERE t.email = v_teacher_email
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
      --          Idempotent on the school-scoped email; enrollment idempotent
      --          on (class_id, student_id). preferred_subject = valid code.
      FOR j IN 1 .. 3 LOOP
        v_student_id := NULL;
        v_student_email := 'demo.student.' || v_school_tag || '.' || i || '-' || j || '@demo.alfanumrik.invalid';

        INSERT INTO public.students
          (name, email, grade, preferred_subject, school_id,
           is_active, is_demo, auth_user_id, onboarding_completed)
        SELECT
          'Demo Student ' || i || '-' || j,
          v_student_email,
          -- grade as TEXT, aligned to the class grade (P5).
          CASE i WHEN 1 THEN '9' WHEN 2 THEN '10' ELSE '11' END,
          -- preferred_subject as a VALID subjects.code, per class (BUG FIX A).
          v_pref_code,
          v_school_id,
          true,
          true,
          NULL,                  -- intentionally NULL: no auth.users row created
          true
        WHERE NOT EXISTS (
          SELECT 1 FROM public.students s
           WHERE s.email = v_student_email
        );

        SELECT s.id INTO v_student_id
          FROM public.students s
         WHERE s.email = v_student_email
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
  END LOOP;

  IF NOT v_seeded_any THEN
    RAISE NOTICE 'demo-school-data: no school matching ILIKE ''%%demo%%'' with an ACTIVE school_admin found — nothing seeded (no-op).';
  END IF;
END;
$seed$;

COMMIT;

-- ============================================================================
-- VERIFICATION (eyeball after running).
-- ----------------------------------------------------------------------------
-- 1) Per-school roster counts the widgets read (works on ANY connection — no
--    admin guard). Lists EVERY demo school that has an active admin (BUG FIX B),
--    not just the oldest.
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
WHERE s.name ILIKE '%demo%'
  AND s.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.school_admins sa
     WHERE sa.school_id = s.id AND sa.is_active
  )
ORDER BY s.id;
-- Expect per qualifying school: class_count >= 3, demo_teacher_count >= 3,
-- demo_student_count >= 9. On prod (2026-06-16): both 61d15e48 and a2e40b65
-- show classes=3, teachers=3, students=12 (3 pre-existing + 9 demo).

-- 2) The dashboard RPC (NOTE: SECURITY DEFINER + is_school_admin_of() guard —
--    it RAISES 'Forbidden'/42501 unless auth.uid() is an ACTIVE school_admin of
--    this school. On a plain psql / service_role connection auth.uid() is NULL,
--    so this WILL raise. To exercise it positively, simulate the admin JWT
--    (see the runbook's "simulated-admin JWT trick"):
--      BEGIN;
--      SELECT set_config('request.jwt.claims',
--        json_build_object('sub','<admin auth_user_id>')::text, true);
--      SELECT public.get_school_dashboard_stats('<school_id>');
--      COMMIT;
--    Or rely on query (1) above for connection-agnostic proof.
