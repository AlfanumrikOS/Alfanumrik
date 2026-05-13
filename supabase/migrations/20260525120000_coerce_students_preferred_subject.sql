-- 20260525120000_coerce_students_preferred_subject.sql
--
-- Bug fix: dashboard "Today's Mission" appearing identical for ~40% of
-- production students.
--
-- Root cause: `public.students.preferred_subject` is consumed by
-- `src/lib/supabase.ts::getNextTopics` which calls
-- `subjects.select('id').eq('code', subject).single()`. Production has the
-- canonical subjects.code='math' (display name 'Mathematics'). Onboarding
-- has been writing two flavors of preferred_subject into the students
-- table:
--   • 'math'        — matches subjects.code, resolves correctly (10 rows)
--   • 'Mathematics' — does NOT match any subjects.code, returns no row,
--                     and getNextTopics silently drops the subject filter,
--                     returning a jumbled cross-subject feed ordered by
--                     curriculum_topics.display_order (7 rows).
--
-- The 7 students with 'Mathematics' see a Today's-Mission card that
-- claims to be their next chapter but is actually whichever subject
-- happens to have display_order=1 in their grade — typically Social
-- Studies or English, which looks broken / random / identical across them.
--
-- Fix: one-shot UPDATE coercing the wrong-case value to the canonical
-- subjects.code. Idempotent (no rows updated on re-run).
--
-- Follow-ups (separate PR / ticket):
--   1. Foreign key on students.preferred_subject → subjects(code). Out
--      of scope here because it's a schema-shape change; need to confirm
--      onboarding never legitimately writes a non-subject value (e.g.
--      'general', NULL) before adding the FK.
--   2. Warn-log in getNextTopics when the subject lookup fails — landed
--      in the same PR as this migration (src/lib/supabase.ts).
--   3. Onboarding validation: pick from `subjects.code` directly so the
--      form can never produce an unresolved value again.
--
-- Diagnostic queries this migration was derived from (run via Supabase MCP
-- against prod 2026-05-12):
--   SELECT preferred_subject, COUNT(*) FROM students GROUP BY 1;
--     -> {"math": 10, "Mathematics": 7}
--   SELECT id FROM subjects WHERE code = 'Mathematics';
--     -> NULL  (canonical code is 'math', display name 'Mathematics')

UPDATE public.students
   SET preferred_subject = 'math'
 WHERE preferred_subject = 'Mathematics';

-- Verification (commented; uncomment when applying manually for sanity):
-- SELECT preferred_subject, COUNT(*) FROM public.students GROUP BY 1;
-- Expected after this migration: only canonical subjects.code values.
