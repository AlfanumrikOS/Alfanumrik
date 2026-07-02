-- Migration: 20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql
-- Purpose: Phase 3 Wave 1 #5 follow-up ("#5b"). Close the ONE sibling defect
--          explicitly left unfixed by 20260702150000_p3w1_5_quiz_rpc_ownership_check.sql
--          (see that migration's header, "Also flagged (NOT fixed here...)"
--          section, second bullet):
--
--   public.atomic_quiz_profile_update(p_student_id uuid, p_xp integer,
--     p_correct integer, p_total integer, p_subject text DEFAULT NULL)  [5-arg, RETURNS void]
--     (baseline 00000000000000_baseline_from_prod.sql:663-714)
--
-- shares the SAME defect as the three functions fixed by #5 (SECURITY
-- DEFINER, caller-supplied p_student_id, NO internal ownership check, EXECUTE
-- never revoked from `authenticated` — only `anon` was revoked, by
-- 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql:172).
--
-- ─── Why REVOKE instead of adding an ownership check (contrast with #5) ─────
-- #5 added an `auth.uid()`-scoped ownership check to its three functions
-- because each one has real, currently-working callers whose behavior had to
-- be preserved. This 5-arg overload is different: independent re-confirmation
-- (2026-07-02, this migration) repeats #5's exhaustive-grep finding and still
-- finds ZERO callers anywhere in the codebase:
--   * No `.rpc('atomic_quiz_profile_update', ...)` call site in src/ passes
--     this overload's exact argument shape. All three live call sites
--     (src/lib/supabase.ts:566, src/lib/domains/quiz.ts:371,
--     src/lib/domains/profile.ts:117) pass named args including p_subject
--     AND p_time_seconds (resolving to the 6-arg or 7-arg overload), never
--     the 5-arg shape (p_student_id, p_xp, p_correct, p_total, p_subject —
--     no p_time_seconds).
--   * No `supabase/functions/**` Edge Function references
--     `atomic_quiz_profile_update` at all.
--   * No SQL function in supabase/migrations/ (including _legacy/) calls this
--     overload via PERFORM/SELECT. Every PERFORM atomic_quiz_profile_update(...)
--     call site resolves by arity to either the 4-arg overload
--     (p_student_id, p_xp, p_correct, p_total — which itself PERFORMs the
--     7-arg overload, per baseline:647-655) or the 6/7-arg overload
--     (p_student_id, p_subject, v_xp, v_total, v_correct, p_time[, session_id]).
--     None match this overload's (p_student_id, p_xp, p_correct, p_total,
--     p_subject) shape.
--   * No test in src/__tests__/ exercises this overload's call shape
--     (checked reg-226-quiz-rpc-ownership-check.test.ts and
--     quiz-rpc-signature-parity.test.ts, the two most relevant suites).
--
-- With zero legitimate callers, there is no behavior to preserve, so
-- `REVOKE EXECUTE ... FROM authenticated` is the safer fix (per this repo's
-- Migration Rules / Rejection Conditions: prefer the minimal-risk change).
-- It permanently closes the cross-student-write attack surface without
-- touching the function body at all — lower risk than a body edit, and
-- strictly safer than #5's own "add a check" approach for a function with no
-- callers to protect.
--
-- ─── Safety ───────────────────────────────────────────────────────────────
-- * REVOKE EXECUTE is naturally idempotent — safe to re-run even if EXECUTE
--   is already revoked (Postgres does not error on a no-op REVOKE).
-- * No DROP of any kind. No CREATE OR REPLACE — the function body is
--   untouched, exactly as instructed.
-- * `anon` was already revoked by 20260515000002 (line 172); re-asserted here
--   for defense in depth / completeness, matching #5's own convention of
--   re-asserting anon REVOKEs on every touched function.
-- * `service_role` is irrelevant to this REVOKE (bypasses GRANT/REVOKE
--   entirely), consistent with #5's rationale for its own REVOKEs.
-- * If a future PR ever needs to actually call this overload from client code,
--   the correct fix is a NEW migration that (a) re-GRANTs EXECUTE to
--   `authenticated` and (b) adds the identical `auth.uid()`-scoped ownership
--   check used by #5 — not a revert of this migration in isolation.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(
  p_student_id uuid,
  p_xp integer,
  p_correct integer,
  p_total integer,
  p_subject text
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.atomic_quiz_profile_update(
  p_student_id uuid,
  p_xp integer,
  p_correct integer,
  p_total integer,
  p_subject text
) FROM anon;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(uuid, integer, integer, integer, text) IS
  'Orphaned 5-arg overload (RETURNS void): does NOT delegate to another '
  'overload (separate body, baseline 663-714), has NO ownership check, and '
  'has NO daily-XP-cap enforcement. EXECUTE REVOKED from both `authenticated` '
  'and `anon` 2026-07-02 (Phase 3 Wave 1 #5 follow-up / "#5b") after '
  'confirming ZERO live callers in src/, supabase/functions/, or '
  'supabase/migrations/ (including PERFORM call sites). Function body '
  'intentionally left unmodified. Contrast: the 6-arg and 7-arg overloads '
  '(and submit_quiz_results v1) share this defect but DO have live callers, '
  'so they were fixed via an added ownership check instead '
  '(20260702150000_p3w1_5_quiz_rpc_ownership_check.sql).';

COMMIT;

-- End of migration: 20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql
