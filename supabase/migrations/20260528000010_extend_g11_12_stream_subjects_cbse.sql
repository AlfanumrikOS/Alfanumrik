-- Extend grade 11/12 stream electives to match CBSE's standard offerings.
--
-- Background (2026-05-18):
--   CEO audit found that the dashboard stream picker locked students into
--   a narrow set of subjects per stream that didn't cover what CBSE
--   actually offers. The set_stream gate works, but a Science student who
--   wants Informatics Practices, a Commerce student who wants Psychology,
--   or an Arts (humanities) student who wants Sociology had no way in.
--
-- Scope: ADDITIVE only. Existing (grade, stream, subject) rows are kept
-- as-is (no core ↔ elective flips). Demo personas + the 5 prod students
-- already on these streams continue to see everything they did before,
-- plus the new electives.
--
-- Idempotent: grade_subject_map has no UNIQUE on (grade, stream,
-- subject_code) — guard each row with NOT EXISTS so re-running this is
-- a no-op.
--
-- Subjects added are all already present + active in public.subjects:
--   informatics_practices, health_fitness, psychology, economics,
--   fine_arts, sanskrit, sociology, home_science, math, computer_science.

BEGIN;

INSERT INTO public.grade_subject_map (grade, stream, subject_code, is_core)
SELECT g, s, c, false
FROM (VALUES
  -- ── Science 11/12 — add IT, Phys. Ed., Psychology, Economics, Fine Arts
  ('11','science','informatics_practices'),
  ('11','science','health_fitness'),
  ('11','science','psychology'),
  ('11','science','economics'),
  ('11','science','fine_arts'),
  ('12','science','informatics_practices'),
  ('12','science','health_fitness'),
  ('12','science','psychology'),
  ('12','science','economics'),
  ('12','science','fine_arts'),

  -- ── Commerce 11/12 — add IT, Psychology, Phys. Ed., Fine Arts, Sanskrit
  ('11','commerce','informatics_practices'),
  ('11','commerce','psychology'),
  ('11','commerce','health_fitness'),
  ('11','commerce','fine_arts'),
  ('11','commerce','sanskrit'),
  ('12','commerce','informatics_practices'),
  ('12','commerce','psychology'),
  ('12','commerce','health_fitness'),
  ('12','commerce','fine_arts'),
  ('12','commerce','sanskrit'),

  -- ── Humanities ("Arts") 11/12 — add Sociology, Psychology, Math, Fine
  --    Arts, Home Science, Phys. Ed., Computer Science
  ('11','humanities','sociology'),
  ('11','humanities','psychology'),
  ('11','humanities','math'),
  ('11','humanities','fine_arts'),
  ('11','humanities','home_science'),
  ('11','humanities','health_fitness'),
  ('11','humanities','computer_science'),
  ('12','humanities','sociology'),
  ('12','humanities','psychology'),
  ('12','humanities','math'),
  ('12','humanities','fine_arts'),
  ('12','humanities','home_science'),
  ('12','humanities','health_fitness'),
  ('12','humanities','computer_science')
) AS v(g, s, c)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.grade_subject_map gsm
  WHERE gsm.grade = v.g
    AND gsm.stream = v.s
    AND gsm.subject_code = v.c
);

COMMIT;
