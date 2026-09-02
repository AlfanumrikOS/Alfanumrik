-- P0-1 wave 3 (2026-09-02 launch audit, same-day follow-up to waves 1 and 2).
-- Closes the remaining 21 of the 58 live PUBLIC-grant SECURITY DEFINER
-- functions found in the full scan that followed the wave-1 correction.
-- Unlike waves 1/2 (zero-caller functions, safe to fully revoke), every one
-- of these 21 has real application callers via the RLS-respecting client
-- (packages/lib/src/supabase.ts) or a user-scoped API route — grepped
-- across apps/host/src, packages/lib/src, packages/ui/src, mobile/lib,
-- supabase/functions. The `authenticated` grant is therefore PRESERVED for
-- all 21; only PUBLIC (and, where present, an explicit `anon` grant) is
-- removed.
--
-- Three sub-groups, based on live pg_proc.proacl inspection:
--
-- (A) 17 functions: PUBLIC-only or PUBLIC+anon, with no legitimate reason
--     for unauthenticated reach. Includes assert_seat_capacity and
--     get_adaptive_questions, both of which additionally have NO internal
--     auth.uid() ownership check at all (see the follow-up note below) —
--     for these two, removing anon/PUBLIC is the only boundary that exists
--     today, so it is not optional.
--       check_formative_answer, get_board_exam_questions,
--       get_chapter_rag_content, get_competition_leaderboard,
--       get_competitions, get_curriculum_versions, get_due_reviews,
--       get_hall_of_fame, get_leaderboard, get_ncert_coverage_report,
--       get_school_classes, get_school_students, get_school_teachers,
--       track_ai_quality, update_chapter_progress, assert_seat_capacity,
--       get_adaptive_questions
--
-- (B) 3 functions: get_classes_at_risk, get_school_overview,
--     get_teacher_engagement. Each already RAISEs 'not authorized' via an
--     internal `school_admins.auth_user_id = auth.uid()` EXISTS check, which
--     is NULL-safe (auth.uid() IS NULL for anon -> the equality is NULL on
--     every row -> EXISTS is false -> the RAISE fires) — confirmed not the
--     OR-chain NULL-collapse pattern from wave 1's original bug. Anon access
--     is therefore NOT currently exploitable for these three; this is
--     defense-in-depth (closing an unnecessary grant), not a live-vuln fix.
--
-- (C) 1 function: compute_gst. A pure stateless tax calculator (reads only
--     public reference tables tax_config/supplier_gstins, no student/school
--     PII, no auth check needed by design — same class as
--     get_school_by_domain's pre-login exemption). Its `anon` grant is kept
--     deliberately (server-side callers in packages/lib/src/gst.ts and
--     supabase/functions/invoice-generator/ use the admin client regardless,
--     but there is no PII exposure risk in leaving anon able to call this
--     directly). Only the redundant PUBLIC grant is removed.
--
-- FOLLOW-UP FINDING (not fixed in this migration — flagged separately):
-- live inspection of these 21 function bodies found 11 with NO auth.uid()
-- check of any kind (get_board_exam_questions, get_chapter_rag_content,
-- get_competition_leaderboard, get_competitions, get_due_reviews,
-- get_hall_of_fame, get_leaderboard, get_ncert_coverage_report,
-- get_school_classes, get_school_students, get_school_teachers,
-- track_ai_quality, plus assert_seat_capacity and get_adaptive_questions
-- from group A above). Several take a raw p_school_id/p_student_id argument
-- with no ownership check, meaning ANY authenticated account can call them
-- directly via PostgREST with someone else's id and read their data,
-- independent of what the Next.js API route in front of them enforces.
-- This is a P8/P9 gap in the function bodies themselves, not a grant issue,
-- and needs a per-function correctness review (which callers are legitimate
-- non-self callers, e.g. a teacher reading their own school's roster) before
-- patching — tracked as a follow-up, not rushed into this grant-layer fix.

-- (A) revoke PUBLIC and anon; authenticated is untouched.
REVOKE EXECUTE ON FUNCTION public.check_formative_answer     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_board_exam_questions    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_chapter_rag_content     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_competition_leaderboard FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_competitions            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_curriculum_versions     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_due_reviews             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_hall_of_fame            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ncert_coverage_report   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_school_classes          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_school_students         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_school_teachers         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.track_ai_quality            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_chapter_progress     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_seat_capacity        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_adaptive_questions      FROM PUBLIC, anon;

-- (B) defense-in-depth: already internally guarded against anon, tighten anyway.
REVOKE EXECUTE ON FUNCTION public.get_classes_at_risk    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_school_overview    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_teacher_engagement FROM PUBLIC, anon;

-- (C) intentionally public-safe utility: drop only the redundant PUBLIC grant.
REVOKE EXECUTE ON FUNCTION public.compute_gst FROM PUBLIC;
