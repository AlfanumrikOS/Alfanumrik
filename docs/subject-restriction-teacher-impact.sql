-- docs/subject-restriction-teacher-impact.sql
-- READ-ONLY DIAGNOSTIC — Phase 3 (math + science restriction), teacher blast radius.
--
-- Status: teachers.subjects_taught is NOT trimmed by any Phase 3 migration.
--         Migration 20260814000009 (M4) repairs STUDENT subject state only.
--         Trimming teachers is gated on a pending CEO decision, because a
--         teacher trimmed to zero subjects has no defined product state (their
--         class assignments, assignment drafts and dashboard filters all key
--         off subjects_taught).
--
-- Purpose: size that decision before it is made. Run against prod with the
--          service role. Nothing here writes — no INSERT/UPDATE/DELETE/DDL.
--          Safe to run at any time, before or after the Phase 3 migrations.
--
-- NOTE: run this BEFORE 20260814000007 (M1) to get the pre-restriction picture
--       using the modelled keep-set, or AFTER M1 to reconcile against the real
--       subjects.is_active state. Both queries below key off the keep-set
--       directly, so they return the same answer either way.

-- ─── Q1: headline — how many teachers would be left with ZERO subjects ──────
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
),
t AS (
  SELECT
    tt.id,
    COALESCE(tt.subjects_taught, ARRAY[]::TEXT[])                        AS before_codes,
    ARRAY(
      SELECT c FROM UNNEST(COALESCE(tt.subjects_taught, ARRAY[]::TEXT[])) AS c
       WHERE c IN (SELECT k.code FROM keep k)
    )                                                                     AS after_codes
  FROM public.teachers tt
)
SELECT
  count(*)                                                                AS teachers_total,
  count(*) FILTER (WHERE array_length(before_codes, 1) IS NULL)           AS already_empty_before,
  count(*) FILTER (WHERE array_length(before_codes, 1) IS NOT NULL
                     AND array_length(after_codes,  1) IS NULL)           AS would_be_left_with_zero,
  count(*) FILTER (WHERE array_length(after_codes, 1) IS NOT NULL
                     AND array_length(after_codes, 1)
                         < array_length(before_codes, 1))                 AS would_be_partially_trimmed,
  count(*) FILTER (WHERE before_codes = after_codes)                      AS unaffected
FROM t;

-- ─── Q2: which subjects are doing the stranding (aggregate, no PII) ─────────
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
)
SELECT
  c                                        AS subject_code,
  count(*)                                 AS teachers_teaching_it,
  count(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM UNNEST(tt.subjects_taught) AS other
       WHERE other IN (SELECT k.code FROM keep k)
    )
  )                                        AS teachers_for_whom_it_is_their_only_hope
FROM public.teachers tt
CROSS JOIN LATERAL UNNEST(COALESCE(tt.subjects_taught, ARRAY[]::TEXT[])) AS c
WHERE c NOT IN (SELECT k.code FROM keep k)
GROUP BY c
ORDER BY teachers_teaching_it DESC;

-- ─── Q3: downstream reach — do the zero-subject teachers own live classes? ──
-- Counts only. Adjust the class/assignment table names if the schema has
-- moved; this is a diagnostic, not a migration, so it is safe to edit in place.
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
),
stranded AS (
  SELECT tt.id
    FROM public.teachers tt
   WHERE COALESCE(array_length(tt.subjects_taught, 1), 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM UNNEST(tt.subjects_taught) AS c
        WHERE c IN (SELECT k.code FROM keep k)
     )
)
SELECT
  (SELECT count(*) FROM stranded)                                          AS stranded_teachers,
  (SELECT count(*) FROM public.classes cl
    WHERE cl.teacher_id IN (SELECT id FROM stranded))                      AS classes_owned_by_stranded,
  (SELECT count(*) FROM public.class_enrollments ce
    WHERE ce.class_id IN (
      SELECT cl.id FROM public.classes cl
       WHERE cl.teacher_id IN (SELECT id FROM stranded)
    ))                                                                     AS student_enrollments_in_those_classes;
