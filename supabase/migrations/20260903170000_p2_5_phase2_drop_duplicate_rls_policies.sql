-- 20260903170000_p2_5_phase2_drop_duplicate_rls_policies.sql
--
-- P2-5 phase 2, Category A (2026-09-03 launch audit) — the multiple_
-- permissive_policies advisor category (156 findings) splits into two very
-- different situations: (A) tables where two policies are BYTE-IDENTICAL
-- under different names — a naming-drift duplicate bug, same root cause as
-- phase 1's duplicate_index findings, just for RLS policies instead of
-- indexes; (B) tables with 3-6 genuinely DIFFERENT, intentionally-separate
-- per-role policies (student/guardian/teacher/admin), which is deliberate,
-- auditable design, not a bug — that category needs real OR-merge work with
-- test coverage and is tracked as separate follow-up work, NOT in this file.
--
-- This migration is Category A ONLY: 10 tables where two PERMISSIVE
-- policies for the same (table, command, role) were confirmed — via a live
-- pg_policies query, not the advisor's cached description — to have
-- IDENTICAL `roles`, `qual`, and `with_check`. Dropping one twin from each
-- pair is zero semantic risk: the surviving policy already grants exactly
-- what the dropped one granted, so no access changes for anyone.
--
-- 7 pairs are `service_role` / `ALL` / `USING (true)` / `WITH CHECK (true)`
-- — the exact same "old vs new migration re-created the grant instead of
-- checking one already existed" pattern found in phase 1's duplicate
-- indexes (idx_foxy_chat_messages_session_created /
-- idx_foxy_chat_messages_session_id, etc.).
--
-- 3 pairs are `authenticated` / `SELECT` / `USING (true or an identical
-- auth.uid() check)`:
--   - cbse_chapter_weights: kept the `_authenticated_read` name; dropped
--     `_public_select`, which was actively misleading — the role is
--     `{authenticated}` only, never `public`/anon, so that name implied
--     broader access than either policy ever granted.
--   - school_admins: kept "School admins can view own record" (accurately
--     describes the policy's actual USING clause, auth_user_id = auth.uid()
--     ); dropped "School admins can view co-admins", which is a
--     documentation bug independent of the duplicate-policy issue — despite
--     its name, its qual is byte-identical to the "own record" policy, so
--     it never actually implemented co-admin visibility at all.
--   - subjects: kept `subjects_authenticated_read`; dropped
--     `subjects_authenticated_select` (same qual, redundant name).
--
-- Naming convention: where one twin follows the table-prefixed snake_case
-- convention used elsewhere in this schema (`<table>_service_all`,
-- `<table>_authenticated_read`) and the other doesn't, kept the
-- convention-following name.

-- ── service_role / ALL / true / true (7) ──────────────────────────────────

DROP POLICY IF EXISTS "service_all_ai_interaction_logs" ON public.ai_interaction_logs;
DROP POLICY IF EXISTS "Service role full access on assignment_submissions" ON public.assignment_submissions;
DROP POLICY IF EXISTS "Service role full access on assignments" ON public.assignments;
DROP POLICY IF EXISTS "Service role full access on class_students" ON public.class_students;
DROP POLICY IF EXISTS "Service role full access on class_teachers" ON public.class_teachers;
DROP POLICY IF EXISTS "Service role manages classes" ON public.classes;
DROP POLICY IF EXISTS "engage_service" ON public.engagement_events;

-- ── authenticated / SELECT (3) ─────────────────────────────────────────────

DROP POLICY IF EXISTS "cbse_chapter_weights_public_select" ON public.cbse_chapter_weights;
DROP POLICY IF EXISTS "School admins can view co-admins" ON public.school_admins;
DROP POLICY IF EXISTS "subjects_authenticated_select" ON public.subjects;
