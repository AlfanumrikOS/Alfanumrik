-- Fix: students.preferred_subject default was 'Mathematics' but subjects.code
-- uses 'math'. The FK constraint students_preferred_subject_fkey was violated on
-- every new student INSERT that didn't explicitly set preferred_subject, blocking
-- ALL new signups (bootstrap_user_profile RPC failed with FK violation).
--
-- Root cause: the column default was set to the display name ('Mathematics')
-- instead of the code ('math') that the FK references.
--
-- Impact: every student signup since the FK was added hit this error. The P15
-- 3-layer failsafe (server bootstrap → API bootstrap → AuthContext fallback)
-- all called the same RPC, so all three layers failed identically.

ALTER TABLE public.students ALTER COLUMN preferred_subject SET DEFAULT 'math';
