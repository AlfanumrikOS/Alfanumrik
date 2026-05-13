-- 20260525130000_students_preferred_subject_fk.sql
--
-- Make the kind of drift PR #757 fixed impossible at the column level.
-- Before this migration:
--   - students.preferred_subject was text with no constraint.
--   - Onboarding writes the canonical `subjects.code` (verified by reading
--     src/components/onboarding/SubjectStep.tsx — uses `s.code` everywhere).
--   - But super-admin manual edits, demo-seed scripts, and any future
--     tooling could silently land display-name values like 'Mathematics'
--     instead of 'math'. Then getNextTopics' subject lookup fails, the
--     subject filter is dropped, and Today's Mission renders a random
--     cross-subject jumble — exactly the symptom PR #757 fixed in data.
--
-- After this migration:
--   - Adding `preferred_subject` row that doesn't exist in `subjects.code`
--     fails at the DB layer (FK violation, SQLSTATE 23503).
--   - Onboarding-flow validation becomes defense in depth rather than
--     the only check.
--   - NULL is still allowed (students may opt out of having a preferred
--     subject; the dashboard falls back to 'math' default in that case).
--   - subjects.code is the FK target — confirmed UNIQUE on prod (Supabase
--     MCP verified pre-migration: F1.code_unique.has_unique=true).
--
-- Cascading semantics (intentional):
--   - ON UPDATE CASCADE: if a subject's `code` is ever renamed (e.g. the
--     team standardises a code), the change propagates to students who
--     prefer it. Better than orphaning preferences.
--   - ON DELETE SET NULL: if a subject is decommissioned (e.g. a niche
--     elective is removed), students who preferred it get NULL rather
--     than blocking the delete OR cascading to delete the student row.
--     NULL is a fine outcome — the dashboard falls back to default.
--
-- Preconditions verified on prod 2026-05-13 via Supabase MCP:
--   - subjects.code has UNIQUE constraint            ✓
--   - 0 unresolved preferred_subject values          ✓ (after PR #757)
--   - Constraint students_preferred_subject_fkey
--     does not already exist                         ✓
--
-- Idempotent guard: only adds the FK if it doesn't already exist. Lets
-- the migration re-apply cleanly on environments where it's already in.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'students_preferred_subject_fkey'
       AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_preferred_subject_fkey
        FOREIGN KEY (preferred_subject)
        REFERENCES public.subjects(code)
        ON UPDATE CASCADE
        ON DELETE SET NULL;
  END IF;
END $do$;

COMMENT ON CONSTRAINT students_preferred_subject_fkey
  ON public.students IS
  'Locks public.students.preferred_subject to public.subjects.code values. '
  'Prevents drift like the Mathematics-vs-math incident fixed by PR #757. '
  'NULL allowed (no preference); ON DELETE SET NULL preserves student '
  'rows when a subject is decommissioned; ON UPDATE CASCADE follows '
  'subjects.code renames.';
