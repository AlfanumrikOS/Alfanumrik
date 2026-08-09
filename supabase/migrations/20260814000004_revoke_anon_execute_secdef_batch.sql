-- Migration: 20260814000004_revoke_anon_execute_secdef_batch.sql
-- Purpose: Complete a batch of function-EXECUTE revocations that prior
--          migrations left silently incomplete, and lock one unguarded
--          service-role-only RPC. Verified by live-DB ACL forensics +
--          exhaustive repo caller analysis (2026-08-14).
--
-- ─── ROOT CAUSE (why the earlier REVOKEs were no-ops) ──────────────────────
-- Supabase's baseline carries
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--       TO postgres, anon, authenticated, service_role;
-- so EVERY function created in `public` is born with EXECUTE granted to
-- PUBLIC (and, in several cases, an additional EXPLICIT grant to anon).
-- A statement of the form
--     REVOKE EXECUTE ON FUNCTION f() FROM anon;          -- or FROM authenticated
-- removes only the named role's grant. The PUBLIC grant survives, and PUBLIC
-- includes anon and authenticated — so the function remains fully reachable
-- through PostgREST by any caller, signed in or not. The REVOKE runs without
-- error and looks authoritative in the migration chain while changing nothing.
--
-- This is the SAME defect class as the #676/#678 saga and
-- 20260515000002_security_hardening_secdef_anon_searchpath_rls_view.sql, which
-- issued `FROM anon` revocations across a wide set of SECURITY DEFINER
-- functions without ever touching PUBLIC. The correct shape — the one used by
-- 20260813000007_reconcile_acl_drift_and_ownership_guards.sql and by
-- 20260707020000_rca18_db_function_execute_grants.sql — is:
--     REVOKE ALL ON FUNCTION f(...) FROM PUBLIC, anon, authenticated;
--     GRANT  EXECUTE ON FUNCTION f(...) TO <only the roles that actually call it>;
-- i.e. revoke PUBLIC first, then re-grant the intended posture EXPLICITLY so
-- the end state is self-evident in source and reproducible on a fresh database.
--
-- This migration applies that shape to a VERIFIED-SAFE subset only. Every
-- function below was checked against all live call sites in apps/, packages/,
-- supabase/functions/, mobile/, and supabase/migrations/ (including SQL-internal
-- PERFORM/SELECT call sites). Functions with live authenticated browser callers
-- KEEP their authenticated grant (see B2 — the deliberate carve-out).
--
-- NOT IN SCOPE: public.security_reserve_quota — already correctly locked to
-- service_role by 20260618000001. Left untouched on purpose.
--
-- ─── IDEMPOTENCY / SAFETY ─────────────────────────────────────────────────
-- REVOKE and GRANT are naturally replay-safe (Postgres does not error on a
-- no-op REVOKE or a duplicate GRANT). No function body is modified, no schema
-- change, no RLS change, no DROP of any kind. Part B3 and Part C are wrapped in
-- DO blocks that look the target routines up in pg_proc first, because a bare
-- REVOKE naming a signature that does not exist in the current environment
-- raises 42883 and aborts the WHOLE transaction. Both blocks issue
-- `REVOKE ALL ON ROUTINE` (never `ON FUNCTION`): ROUTINE covers functions,
-- aggregates AND procedures, whereas `ON FUNCTION` raises 42809
-- ("… is a procedure") for any prokind='p' object. Since a DO block only fires
-- where the object actually exists, an `ON FUNCTION` failure there would land
-- on PRODUCTION ONLY and never on CI — hence ROUTINE unconditionally.
-- Each block ends with a RAISE NOTICE reporting how many routines it processed,
-- so an operator can distinguish "correctly skipped on a fresh DB" (0) from
-- "the loop silently never ran".

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART A — LOCK AN UNGUARDED, SERVICE-ROLE-ONLY RPC
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. check_and_record_usage(uuid, text, date, integer)
--     (baseline 00000000000000_baseline_from_prod.sql:1893-1930,
--      RETURNS TABLE(allowed boolean, used_count integer))
--
--     DEFECT: the body performs NO authorization check of any kind. It
--     increments student_daily_usage for a CALLER-SUPPLIED p_student_id, so any
--     caller reachable through PostgREST can burn another student's daily AI
--     quota (denial of service) or probe their remaining usage (information
--     disclosure). 20260515000002:175 revoked it `FROM anon` only — a no-op
--     against the baseline PUBLIC grant described in the header.
--
--     VERIFIED CALLERS — ALL service-role:
--       * apps/host/src/app/api/foxy/_lib/quota.ts:55        (supabaseAdmin)
--       * supabase/functions/ncert-solver/index.ts:395       (service-role client)
--       * supabase/functions/scan-ocr/index.ts:230           (service-role client)
--     Plus the SQL-internal `PERFORM` from public.check_plan_limits
--     (baseline:2027), which is unaffected by EXECUTE grants: an internal call
--     inside a SECURITY DEFINER function runs with the definer's privileges.
--
--     The ONLY anon/authenticated-session path is recordUsage() at
--     packages/lib/src/usage.ts:258, which has ZERO callers anywhere (dead code).
--     Revoking is therefore behavior-preserving for all live traffic.
REVOKE ALL     ON FUNCTION public.check_and_record_usage(uuid, text, date, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_and_record_usage(uuid, text, date, integer) TO service_role;

COMMENT ON FUNCTION public.check_and_record_usage(uuid, text, date, integer) IS
  'Daily AI-feature quota check + increment against student_daily_usage. '
  'service_role ONLY as of 20260814000004: the body has no authorization check '
  'and takes a caller-supplied p_student_id, so any client-reachable grant is a '
  'cross-student quota-burn / quota-probe vector. All live callers are '
  'service-role (foxy quota.ts, ncert-solver, scan-ocr) plus the SQL-internal '
  'PERFORM from check_plan_limits, which is unaffected by EXECUTE grants. '
  '20260515000002 revoked anon only, which was a no-op against the baseline '
  'PUBLIC grant. If a client-session caller is ever needed, add the house '
  'auth.uid() ownership guard FIRST, then re-grant.';

-- ═════════════════════════════════════════════════════════════════════════════
-- PART B — COMPLETE PREVIOUSLY-INCOMPLETE REVOCATIONS
-- Each item below already had a partial REVOKE in the chain. This part adds the
-- missing PUBLIC leg (and, for B2, the missing explicit-anon leg) and then
-- re-asserts the intended grant so the posture is explicit in source.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── B1. atomic_quiz_profile_update — orphan 5-arg overload ─────────────────
--     Signature reused VERBATIM from
--     20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql:68-74
--     (p_student_id uuid, p_xp integer, p_correct integer, p_total integer,
--      p_subject text) — RETURNS void, baseline:663-714.
--
--     That migration revoked EXECUTE from `authenticated` and from `anon`, but
--     NEVER from PUBLIC — so this overload has remained reachable by every
--     signed-in JWT holder the entire time. It has no ownership guard and no
--     daily-XP-cap enforcement, so a direct PostgREST call writes ARBITRARY XP
--     onto ANY student's profile (P2 XP-economy integrity).
--
--     Zero callers re-confirmed (2026-08-14) across apps/, packages/, mobile/,
--     supabase/functions/, and supabase/migrations/ — every live call site
--     resolves by arity/name to the 4-, 6-, or 7-arg overload. With no caller to
--     preserve, no grant is re-issued here: the function keeps its body and is
--     simply unreachable from PostgREST.
REVOKE ALL ON FUNCTION public.atomic_quiz_profile_update(
  p_student_id uuid,
  p_xp integer,
  p_correct integer,
  p_total integer,
  p_subject text
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(uuid, integer, integer, integer, text) IS
  'Orphaned 5-arg overload (RETURNS void, baseline:663-714): no ownership check, '
  'no daily-XP-cap enforcement, ZERO callers. 20260702170000 revoked '
  'authenticated + anon but not PUBLIC, leaving it reachable via the baseline '
  'default-privileges PUBLIC grant; 20260814000004 completes the revocation '
  '(PUBLIC, anon, authenticated) and issues no grant. Body intentionally '
  'unmodified. Live traffic uses the 4-/6-/7-arg overloads.';

-- ─── B2. check_quiz_answer(uuid, uuid, int, int) — anon ONLY ────────────────
--     Signature from 20260802130000_check_quiz_answer_rpc.sql:188-193 / 330-342.
--
--     That migration already did the right thing (REVOKE ... FROM PUBLIC, then
--     GRANT TO authenticated, service_role), BUT the live ACL still shows an
--     EXPLICIT `anon=X` entry: the function was created while the baseline
--     ALTER DEFAULT PRIVILEGES was in force, which materializes a per-role grant
--     to anon that a `FROM PUBLIC` revoke does not touch.
--
--     ⚠ CRITICAL CARVE-OUT — DO NOT REVOKE `authenticated` HERE. This RPC has a
--     LIVE browser caller: packages/lib/src/supabase.ts:426 (checkQuizAnswer) →
--     apps/host/src/app/(student)/quiz/page.tsx:1176. Revoking authenticated
--     would break per-question immediate feedback on the /quiz screen. The RPC
--     is safe for authenticated callers: it carries its own inline
--     students.auth_user_id ownership guard (20260802130000:238-243) and reveals
--     exactly ONE question's verdict from the server-owned
--     quiz_session_shuffles snapshot — never from live question_bank.
--
--     Only the unauthenticated `anon` role is removed. The intended posture is
--     then re-GRANTed explicitly so it is self-evident in source and survives a
--     fresh-database restore.
REVOKE EXECUTE ON FUNCTION public.check_quiz_answer(uuid, uuid, int, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_quiz_answer(uuid, uuid, int, int) TO authenticated, service_role;

-- ─── B3. submit_mock_test_attempt — WHATEVER OVERLOADS ACTUALLY EXIST ───────
--     Chain history (corrected 2026-08-14 — an earlier draft of this migration
--     asserted that BOTH a 5-arg and a 6-arg overload were live and hardcoded
--     both signatures; that premise was FALSE and would have aborted this
--     migration everywhere):
--       * 20260520000008 (…:522 GRANT) created + granted the 5-arg overload
--         (uuid, uuid, jsonb, integer, jsonb).
--       * 20260722097100:113 then executed
--             DROP FUNCTION IF EXISTS
--               public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb);
--         immediately before CREATEing the 6-arg version
--         (uuid, uuid, jsonb, integer, jsonb, uuid), and its own verification
--         block asserts pronargs = 6 — i.e. exactly ONE function object is
--         expected to remain. The 5-arg overload therefore DOES NOT EXIST on any
--         DB built from this chain.
--     GRANT/REVOKE resolve by EXACT identity-argument match and do NOT fall
--     through via DEFAULT parameters, so a hardcoded 5-arg statement raises
--     42883 and rolls back the entire migration on CI live-DB, fresh staging and
--     DR restores.
--
--     Overloads are therefore resolved DYNAMICALLY from pg_proc: whatever shapes
--     exist in the target environment get locked. That is correct on a
--     6-arg-only chain-built DB and equally correct on any hand-patched
--     environment that still carries an older shape.
--
--     What is still unchanged: 20260520000008 and 20260722097100 both granted
--     EXECUTE to `authenticated, service_role` and NEITHER ever revoked PUBLIC,
--     so every surviving overload is reachable by every role including anon.
--     The ONLY caller is apps/host/src/app/api/exams/papers/[id]/submit/route.ts:296
--     via supabaseAdmin (SERVICE ROLE). That route is auth-gated and derives
--     studentId from the authenticated session, never from the request body — so
--     the client-session grants protect nothing and only widen the attack surface
--     on a SECURITY DEFINER RPC that writes attempts, responses, XP, and
--     question_bank IRT counters.
DO $revoke_submit_mock_test_attempt$
DECLARE
  p       RECORD;
  v_count integer := 0;
BEGIN
  FOR p IN
    SELECT pr.proname, pg_get_function_identity_arguments(pr.oid) AS args
      FROM pg_proc pr
      JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public'
       AND pr.proname = 'submit_mock_test_attempt'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON ROUTINE public.%I(%s) FROM PUBLIC, anon, authenticated',
      p.proname, p.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON ROUTINE public.%I(%s) TO service_role',
      p.proname, p.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '20260814000004: locked public.%(%) to service_role', p.proname, p.args;
  END LOOP;

  RAISE NOTICE '20260814000004 [B3]: processed % submit_mock_test_attempt overload(s)', v_count;
END;
$revoke_submit_mock_test_attempt$;

-- ─── B4. reset_demo_student(uuid) ───────────────────────────────────────────
--     Signature from 20260615142552_restore_missing_quiz_functions.sql:348-350
--     (DROP FUNCTION IF EXISTS public.reset_demo_student(UUID) / CREATE OR
--      REPLACE FUNCTION reset_demo_student(p_student_id UUID) RETURNS JSONB).
--
--     Destructive RPC: deletes quiz sessions, question responses, chat sessions,
--     daily usage, and mastery rows for a student. It DOES carry a strict guard
--     (admin_users + auth.uid() + is_active, 20260615142552:359-361), so it is
--     not currently exploitable — but it has NO grant or revoke statement in ANY
--     migration, so its ACL is pure default-privileges drift (PUBLIC).
--     Defense-in-depth: remove the drift so a future body edit that weakens the
--     guard cannot silently become a PUBLIC-reachable data-destruction endpoint.
--
--     Zero TypeScript/Dart callers. The only call site is a SQL-internal PERFORM
--     from public.reset_demo_account (20260528000001:152 and :179), which is
--     unaffected: an internal call inside a SECURITY DEFINER function executes
--     with the definer's privileges, not the invoker's EXECUTE grant. No grant is
--     re-issued for that reason.
REVOKE ALL ON FUNCTION public.reset_demo_student(uuid) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART C — ZERO-CALLER FUNCTIONS THAT EXIST ONLY IN THE LIVE DATABASE
--
-- The seven functions below were observed in the live database's pg_proc during
-- the 2026-08-14 ACL forensics, but they are NOT defined by any migration in
-- this repository — they were created out-of-band (hand-applied SQL) and their
-- source has never been reconciled into supabase/migrations/. They also have
-- ZERO references anywhere in the repo: no .ts, .tsx, .dart, or .sql call site,
-- and no entry in the generated database.types.ts `Functions` block.
--
-- Because they do not exist on a fresh database built from this migration chain,
-- a bare `REVOKE ALL ON FUNCTION public.agent_claim_step(...)` would raise
-- `42883 function does not exist` and abort the whole transaction in CI, new
-- staging, and DR restores. The DO block below therefore looks them up in
-- pg_proc first and builds each REVOKE dynamically — a clean no-op where the
-- function is absent, and correct for every overload where it is present
-- (pg_get_function_identity_arguments renders the exact identity signature).
--
-- The revoke is `ON ROUTINE`, NOT `ON FUNCTION`. Several of these out-of-band
-- objects (agent_worker_tick, agent_timeout_sweep, …) are plausibly PROCEDUREs,
-- and `REVOKE ... ON FUNCTION` raises 42809 against a procedure. Because the
-- loop only fires where the object exists, that failure would occur on
-- PRODUCTION ONLY and never reproduce in CI. ROUTINE covers functions,
-- aggregates and procedures alike, so the statement is prokind-agnostic.
--
-- FOLLOW-UP (not closed here): these objects still need source reconciliation —
-- either a migration that defines them, or a migration that drops them after
-- user approval. Locking their ACL is the safe interim step.
-- ═════════════════════════════════════════════════════════════════════════════

DO $revoke_live_only_functions$
DECLARE
  p       RECORD;
  v_count integer := 0;
BEGIN
  FOR p IN
    SELECT pr.proname, pg_get_function_identity_arguments(pr.oid) AS args
      FROM pg_proc pr
      JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public'
       AND pr.proname IN (
         'run_adaptive_intervention_pipeline',
         'agent_claim_step',
         'agent_complete_step',
         'agent_enqueue_step',
         'agent_heartbeat',
         'agent_timeout_sweep',
         'agent_worker_tick'
       )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON ROUTINE public.%I(%s) FROM PUBLIC, anon, authenticated',
      p.proname, p.args
    );
    v_count := v_count + 1;
    RAISE NOTICE '20260814000004: revoked PUBLIC/anon/authenticated EXECUTE on public.%(%)',
      p.proname, p.args;
  END LOOP;

  RAISE NOTICE '20260814000004 [C]: processed % live-DB-only routine(s) (0 = correctly skipped on a fresh DB)',
    v_count;
END;
$revoke_live_only_functions$;

COMMIT;

-- End of migration: 20260814000004_revoke_anon_execute_secdef_batch.sql
-- Functions locked to service_role: check_and_record_usage,
--   submit_mock_test_attempt (every overload found in pg_proc at apply time —
--   on a chain-built DB that is the single 6-arg version, the 5-arg having been
--   dropped by 20260722097100:113)
-- Functions fully unreachable from PostgREST: atomic_quiz_profile_update 5-arg,
--   reset_demo_student, plus the 7 live-DB-only functions in PART C
-- Functions deliberately left callable by `authenticated`: check_quiz_answer
--   (live /quiz per-question feedback path — see B2)
-- Untouched on purpose: security_reserve_quota (already service_role-only,
--   20260618000001)
