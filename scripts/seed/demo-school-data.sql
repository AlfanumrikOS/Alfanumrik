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
--   - concept_mastery rows for every demo student (see CONCEPT_MASTERY below)
--     so the "Classes at risk" widget shows a realistic mastery spread instead
--     of an empty/zero column.
--
-- CONCEPT_MASTERY SEEDING ("Classes at risk" now shows real mastery).
-- -------------------------------------------------------------------
-- ADDED live 2026-06-16. get_classes_at_risk averages concept_mastery.p_know
-- per student and flags a CLASS as at-risk when its students' avg p_know < 0.4
-- (the AT-RISK THRESHOLD = 0.4 on p_know). Freshly-seeded students have NO
-- concept_mastery rows, so the column was empty/zero. This step gives each demo
-- student a small set of concept_mastery rows with a per-CLASS p_know band so
-- the widget shows a realistic spread:
--   - Class 9A          → at-risk band  (0.20 / 0.28 / 0.34 across its 3 students)
--   - Class 10B         → mid band      (0.45 / 0.55 / 0.62)
--   - Class 11 Science  → high band     (0.72 / 0.80 / 0.88)
-- so on a typical run Class 9A is the only class flagged at-risk.
--
-- TOPIC IDS ARE DISCOVERED AT RUNTIME (NOT hardcoded).
-- ---------------------------------------------------
-- concept_mastery.topic_id FKs public.curriculum_topics(id) (NOT 'topics') and
-- (student_id, topic_id) is UNIQUE. The topic UUIDs are ENVIRONMENT-SPECIFIC, so
-- this script discovers them at run time with
--   SELECT id FROM public.curriculum_topics ORDER BY id LIMIT 3
-- and seeds ONE row per (student, discovered topic). It degrades gracefully: it
-- uses however many topics exist (1..3); if ZERO curriculum_topics exist it
-- RAISEs a NOTICE and SKIPS concept_mastery only — classes/teachers/students
-- still seed. Idempotent via ON CONFLICT (student_id, topic_id) DO NOTHING.
--
-- concept_mastery SCHEMA FACTS (verified live 2026-06-16):
--   - NOT NULL: student_id (FK students.id), topic_id (FK curriculum_topics.id).
--     UNIQUE (student_id, topic_id). concept_id is NULLABLE (left NULL). No CHECK
--     constraints. p_know double precision (DEFAULT 0.1) is the column
--     get_classes_at_risk reads; mastery_probability / mastery_mean are kept in
--     lockstep with p_know by convention.
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
--   BUG FIX (C), discovered live 2026-06-16: each demo student's grade now comes
--   from its ENROLLED CLASS's grade column (selected at loop time), NOT from the
--   alphabetical class-loop index. The prior `CASE i WHEN 1 THEN '9' …` index
--   hack assigned grade by class iteration order, so e.g. 'Class 10B' students
--   could be stamped grade '9'. Deriving grade from c.grade keeps the student's
--   grade aligned to the class it is enrolled in (still TEXT, P5).
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
  -- Per-class concept_mastery p_know bands (index-aligned with v_classes), one
  -- value per student j=1..3. Class 9A lands in the at-risk band (avg < 0.4);
  -- 10B mid; 11 Science high. AT-RISK THRESHOLD = 0.4 on p_know.
  v_pknow_bands CONSTANT double precision[][] := ARRAY[
    ARRAY[0.20, 0.28, 0.34],   -- Class 9A         (avg 0.2733 → at-risk)
    ARRAY[0.45, 0.55, 0.62],   -- Class 10B        (avg 0.5400 → ok)
    ARRAY[0.72, 0.80, 0.88]    -- Class 11 Science (avg 0.8000 → ok)
  ];
  r_school      record;
  r_class       record;
  i             int;
  j             int;
  k             int;
  v_class_id    uuid;
  v_class_grade text;
  v_pref_code   text;
  v_teacher_email text;
  v_student_email text;
  v_seeded_any  boolean := false;
  v_topic_ids   uuid[];
  v_topic_count int;
  v_pknow       double precision;
  v_mastery_level text;
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

    -- ── 1b. Discover up to 3 curriculum_topics at RUNTIME for concept_mastery.
    --        topic_id FKs public.curriculum_topics(id); the UUIDs are
    --        environment-specific, so NEVER hardcode them. Degrade gracefully:
    --        use however many exist (0..3). If zero, concept_mastery is skipped
    --        for this school (classes/teachers/students still seed).
    SELECT array_agg(t.id ORDER BY t.id)
      INTO v_topic_ids
      FROM (
        SELECT ct.id
          FROM public.curriculum_topics ct
         ORDER BY ct.id
         LIMIT 3
      ) t;
    v_topic_count := COALESCE(array_length(v_topic_ids, 1), 0);
    IF v_topic_count = 0 THEN
      RAISE NOTICE 'demo-school-data: no curriculum_topics found — skipping concept_mastery for school % (roster still seeded).', v_school_id;
    END IF;

    -- ──────────────────────────────────────────────────────────────────────
    -- 2 & 3. Teachers + Students + enrollments + concept_mastery.
    --        Schema-permitted WITHOUT auth.users (see AUTH COUPLING note):
    --        id is self-generated, auth_user_id left NULL, is_demo = true.
    --        Emails are SCHOOL-SCOPED via v_school_tag (BUG FIX B).
    -- ──────────────────────────────────────────────────────────────────────
    i := 0;
    FOR r_class IN
      SELECT c.id, c.name, c.grade
        FROM public.classes c
       WHERE c.school_id = v_school_id
         AND c.name = ANY (ARRAY['Class 9A','Class 10B','Class 11 Science'])
         AND c.deleted_at IS NULL
       ORDER BY c.name
    LOOP
      i := i + 1;
      v_class_id  := r_class.id;
      -- Grade comes from the CLASS row (BUG FIX C) — NOT the loop index. Kept
      -- as TEXT (P5). Every student enrolled in this class inherits c.grade.
      v_class_grade := r_class.grade;
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
          -- grade as TEXT, taken from the ENROLLED CLASS's grade (BUG FIX C, P5)
          -- — never the alphabetical loop index.
          v_class_grade,
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

          -- ── 3c. concept_mastery: one row per discovered topic for this
          --        student, p_know set by the student's ENROLLED CLASS band so
          --        "Classes at risk" shows a realistic spread. Idempotent via
          --        ON CONFLICT (student_id, topic_id) DO NOTHING. Skipped when
          --        no curriculum_topics exist (v_topic_count = 0).
          IF v_topic_count > 0 THEN
            -- Per-student p_know from the per-class band (j = 1..3).
            v_pknow := v_pknow_bands[i][j];
            v_mastery_level := CASE
              WHEN v_pknow < 0.4 THEN 'building'
              WHEN v_pknow < 0.7 THEN 'developing'
              ELSE 'proficient'
            END;

            FOR k IN 1 .. v_topic_count LOOP
              INSERT INTO public.concept_mastery (
                student_id, topic_id, concept_id,
                p_know, mastery_probability, mastery_mean, mastery_level,
                attempts, correct_attempts, total_attempts, total_correct,
                last_attempted_at, last_practiced_at, updated_at
              )
              VALUES (
                v_student_id,
                v_topic_ids[k],
                NULL,                       -- concept_id nullable: left NULL
                v_pknow,                    -- the column get_classes_at_risk reads
                v_pknow,                    -- mastery_probability in lockstep
                v_pknow,                    -- mastery_mean in lockstep
                v_mastery_level,
                5,                          -- attempts
                GREATEST(0, round(v_pknow * 5))::int,   -- correct_attempts
                5,                          -- total_attempts
                GREATEST(0, round(v_pknow * 5))::int,   -- total_correct
                now(), now(), now()
              )
              ON CONFLICT (student_id, topic_id) DO NOTHING;
            END LOOP;
          END IF;
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

-- 1b) concept_mastery footprint (connection-agnostic; no admin guard). Confirms
--     each demo student now has up to 3 concept_mastery rows so the at-risk
--     widget has data to average.
SELECT
  st.school_id            AS demo_school_id,
  count(DISTINCT cm.student_id) AS students_with_mastery,
  count(*)                AS concept_mastery_rows,
  round(avg(cm.p_know)::numeric, 4) AS avg_p_know
FROM public.concept_mastery cm
JOIN public.students st ON st.id = cm.student_id AND st.is_demo
GROUP BY st.school_id
ORDER BY st.school_id;

-- 1c) "Classes at risk" — the actual widget RPC. get_classes_at_risk averages
--     concept_mastery.p_know per student and flags a CLASS at-risk when its
--     students' avg p_know < 0.4 (AT-RISK THRESHOLD). It is SECURITY DEFINER +
--     school_admin-guarded, so simulate the admin JWT for one transaction (see
--     the runbook's "simulated-admin JWT trick"):
--       BEGIN;
--       SELECT set_config('request.jwt.claims',
--         json_build_object('sub','<admin auth_user_id>')::text, true);
--       SELECT * FROM public.get_classes_at_risk('<school_id>', 20, 0);
--       COMMIT;
--     VERIFIED live 2026-06-16 (one demo school): Class 9A → 3 students, 3
--     at-risk, avg_mastery 0.2733; Class 10B → 3, 0 at-risk, 0.5400; Class 11
--     Science → 3, 0 at-risk, 0.8000. (Only Class 9A falls below the 0.4
--     threshold.)

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
