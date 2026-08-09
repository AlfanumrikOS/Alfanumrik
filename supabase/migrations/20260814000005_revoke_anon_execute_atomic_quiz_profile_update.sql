-- Migration: 20260814000005_revoke_anon_execute_atomic_quiz_profile_update.sql
-- Purpose: Close an UNAUTHENTICATED cross-student write vector on the three
--          client-reachable overloads of public.atomic_quiz_profile_update by
--          removing the PUBLIC/anon EXECUTE grant, matching the posture the
--          5-arg overload already received in 20260814000004 (part B1).
--          Companion to 20260814000004; same defect class, different targets.
--
-- ─── THE DEFECT ────────────────────────────────────────────────────────────
-- public.atomic_quiz_profile_update has FOUR overloads. All four are
-- SECURITY DEFINER owned by `postgres` (rolbypassrls = true), so every one of
-- them executes with RLS bypassed regardless of who called it. Live catalog
-- state at the time this migration was authored (2026-08-14):
--
--   oid     signature                                  proacl                                                    anon can EXECUTE
--   ------  -----------------------------------------  --------------------------------------------------------  ----------------
--   133249  (uuid, int, int, int)              [4-arg]  {=X/postgres, postgres=X, authenticated=X, service_role=X}  TRUE
--   139476  (uuid, int, int, int, text)        [5-arg]  {postgres=X, service_role=X}                                false
--   215314  (uuid, text, int, int, int, int)   [6-arg]  {=X/postgres, …, authenticated=X, …}                        TRUE
--   215449  (uuid, text, int, int, int, int,
--            uuid)                             [7-arg]  {=X/postgres, …, authenticated=X, …}                        TRUE
--
-- The 5-arg row is what a CORRECT posture looks like — 20260814000004 (B1)
-- already revoked PUBLIC/anon/authenticated on it. The other three still carry
-- the leading `=X/postgres` PUBLIC entry that Supabase's baseline
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--       TO postgres, anon, authenticated, service_role;
-- materializes on every function born in `public`. Note the shape of the ACL:
-- there is NO explicit `anon=X` entry on any of the three. anon's EXECUTE
-- privilege comes ENTIRELY from that PUBLIC `=X` entry. That is exactly why
-- 20260515000002:169-171 and 20260702150000:563/819, which issued
-- `REVOKE EXECUTE … FROM anon`, were SILENT NO-OPS: they deleted an explicit
-- anon entry (or nothing at all) and left PUBLIC — and PUBLIC includes anon —
-- fully intact. The REVOKEs ran without error and have looked authoritative in
-- the migration chain ever since while changing nothing about reachability.
--
-- ─── WHY THE IN-BODY GUARD DOES NOT COVER THIS ─────────────────────────────
-- The 6-arg and 7-arg overloads carry a byte-identical ownership guard
-- (added by 20260702150000, preserved verbatim through 20260729120001 /
-- 20260729130000):
--
--   IF auth.uid() IS NOT NULL AND NOT EXISTS (
--     SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
--   ) THEN
--     RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
--   END IF;
--
-- The 4-arg overload has NO guard of its own; it PERFORMs the 7-arg
-- (baseline:642-655), so it inherits the 7-arg's guard transitively — and
-- inherits the hole below along with it.
--
-- ─── EMPIRICAL PROOF (not inference — the guard expression was executed) ────
-- The verbatim guard predicate was evaluated against the REAL `students` table
-- under a SIMULATED anon JWT, and separately under an authenticated non-owner
-- JWT, on the live database (2026-08-14):
--
--   auth_uid_under_anon_jwt                = NULL
--   guard_expr_evaluated_verbatim_for_anon = f     <-- guard SKIPPED for anon
--   guard_A_fires_for_authed_nonowner      = t     <-- guard WORKS when signed in
--
-- Read those three rows together and the conclusion is unambiguous:
--
--   ⚠ DE-AUTHENTICATING IS A PRIVILEGE ESCALATION.
--
-- An AUTHENTICATED attacker who calls these RPCs with a victim's
-- p_student_id is correctly blocked by the guard. The SAME attacker who simply
-- DROPS the `Authorization` header and re-sends the request with nothing but
-- the public anon key is NOT blocked: `auth.uid()` returns NULL, the
-- `auth.uid() IS NOT NULL` conjunct short-circuits, the guard never runs, and
-- the SECURITY DEFINER body proceeds with RLS bypassed. Throwing away
-- credentials makes the attack succeed. The anon key is embedded in the
-- shipped web and mobile clients, so this requires no account and no secret.
--
-- ─── BLAST RADIUS (what an unauthenticated caller can write today) ─────────
-- Every write below lands on a CALLER-SUPPLIED p_student_id, i.e. any student
-- whose UUID the attacker can learn or guess:
--   * XP — bounded, but only incidentally: the P2 200/day quiz cap clamps the
--     award. Cap-poisoning is still possible (burn a victim's daily cap so
--     their real quiz earns 0).
--   * student_learning_profiles counters — UNCLAMPED. total_questions_asked,
--     total_questions_answered_correctly, total_time_minutes and
--     total_sessions are raw `+ p_total` / `+ p_correct` increments with no
--     ceiling and no relation to any real quiz_session row. Mastery, analytics,
--     parent/teacher dashboards and Pulse all read these.
--   * ARBITRARY p_subject rows — the upsert key is (student_id, subject) with
--     no membership check against the student's enrolled subjects, so a caller
--     can materialize profile rows for subjects the student does not take.
--   * students.streak_days + students.last_active — streak fabrication, and
--     last_active drives inactivity detection (adaptive Loop B), so writing it
--     also suppresses a real disengagement signal.
--   * state_events 'learner.quiz_completed' — inserted (7-arg, Step 6) with an
--     UNVALIDATED p_session_id: the row is written whenever the student
--     resolves to a non-null auth_user_id, with idempotency_key
--     'quiz-completed:'||p_session_id. Attacker-chosen event ids poison the
--     event stream and can pre-burn a legitimate session's idempotency key.
--
-- ─── WHY THE FIX IS THE GRANT AND NOT THE BOOLEAN ──────────────────────────
-- The obvious-looking alternative is to "repair" the guard by deleting the
-- `auth.uid() IS NOT NULL AND` conjunct so it also fires for anon. DO NOT.
--
-- 1. The conjunct is INTENTIONAL and DOCUMENTED, not an oversight. The 7-arg's
--    own inline comment (20260702150000:595-602) states it outright: the check
--    is "purely an app-level ownership assertion, NOT a privilege boundary",
--    skipped "so service-role callers (bypass RLS, carry no JWT) are
--    unaffected". Treating a deliberately-scoped app assertion as if it were
--    the access-control layer is the actual root cause here.
-- 2. Removing the conjunct BREAKS EVERY SERVICE-ROLE CALLER, because
--    `auth.uid() IS NULL` cannot distinguish service_role from anon — NEITHER
--    presents a `sub` claim. There is no information in that expression to
--    separate "trusted backend" from "no credentials at all". Any boolean-level
--    repair therefore either keeps the anon hole open or takes down the
--    server-side quiz-submission path (submit_quiz_results v1/v2 PERFORM into
--    the 7-arg; the integration lane calls it directly with the service key).
-- 3. The EXECUTE grant is the layer that CAN tell them apart, because
--    PostgREST maps an unauthenticated request to the `anon` Postgres role and
--    a service-key request to `service_role`. Removing anon's reachability is
--    therefore a real privilege boundary, unlike the guard.
-- The correct division of labour: the GRANT decides WHO may call; the guard
-- decides WHICH student an already-authenticated caller may write to. This
-- migration fixes only the first. The guard is left exactly as it is.
--
-- ─── `authenticated` IS DELIBERATELY RETAINED ─────────────────────────────
-- ⚠ CRITICAL CARVE-OUT — DO NOT REVOKE `authenticated` ON THESE THREE.
-- Same reasoning 20260814000004 used for check_quiz_answer (B2), and the same
-- reasoning 20260702150000 gave for choosing "add a guard" over "revoke":
--   * There is LIVE authenticated PostgREST traffic on these overloads. The
--     browser anon-key client is bound to the student's own session and
--     resolves to the Postgres role `authenticated`; the live call sites
--     (packages/lib/src/supabase.ts submitQuizResults -> 7-arg;
--     packages/lib/src/domains/quiz.ts + profile.ts -> 6-arg) are the real
--     quiz-XP write path. Revoking `authenticated` would break quiz XP for
--     every student — a P2/P4 outage, not a hardening.
--   * For those callers the guard DEMONSTRABLY WORKS: `guard_A_fires_for_
--     authed_nonowner = t` above is the direct measurement. A signed-in
--     attacker targeting someone else's student_id is already blocked today.
-- So `authenticated` keeps EXECUTE and is re-granted EXPLICITLY below rather
-- than merely left alone, so the intended posture is self-evident in source
-- and reproduces on a fresh database instead of depending on ACL history.
-- `service_role` is likewise re-granted explicitly (it holds a separate,
-- non-PUBLIC-derived entry that REVOKE … FROM PUBLIC, anon cannot touch, but
-- stating it keeps the end state readable).
--
-- ─── WHAT IS *NOT* AFFECTED ────────────────────────────────────────────────
-- * The SQL-internal `PERFORM atomic_quiz_profile_update(...)` from
--   submit_quiz_results, submit_quiz_results_v2 and the 4-arg overload runs
--   inside a SECURITY DEFINER context and executes with the DEFINER's
--   privileges. Internal calls are immune to EXECUTE grants entirely, so no
--   internal path changes.
-- * service_role callers: unchanged (explicit grant retained + re-asserted).
-- * `postgres` (the owner): unchanged; owner privileges are not PUBLIC-derived.
-- * The 5-arg overload: OUT OF SCOPE. Already fully locked by 20260814000004
--   (B1), which revoked PUBLIC, anon AND authenticated and issued no grant.
--   It is deliberately not named anywhere in this migration's DDL.
--
-- ─── IDEMPOTENCY / SAFETY ─────────────────────────────────────────────────
-- REVOKE and GRANT are naturally replay-safe: Postgres does not error on a
-- no-op REVOKE or on a duplicate GRANT. NO function body is modified, no
-- CREATE OR REPLACE, no DROP of any kind, no schema change, no RLS change, no
-- change to the ownership guard. Wrapped in BEGIN/COMMIT so the three overloads
-- move as one unit.
--
-- All three signatures were verified to exist before this file was written:
--   4-arg — baseline 00000000000000_baseline_from_prod.sql:642
--           (p_student_id uuid, p_xp integer, p_correct integer, p_total integer)
--           RETURNS void; also the exact identity list used by
--           20260515000002:171.
--   6-arg — baseline:717; last redefined 20260729130000:182
--           (p_student_id UUID, p_subject TEXT, p_xp INT, p_total INT,
--            p_correct INT, p_time_seconds INT) RETURNS jsonb; identity list
--           also used by 20260515000002:169 and 20260702150000:563.
--   7-arg — baseline:794; last redefined 20260729120001:714
--           (…, p_session_id UUID DEFAULT NULL) RETURNS void; identity list
--           also used by 20260515000002:170 and 20260702150000:819.
-- `int`/`integer` are the same type to the parser; `integer` is spelled out
-- below to match pg_get_function_identity_arguments output exactly. GRANT and
-- REVOKE resolve by EXACT identity-argument match and do NOT fall through via
-- DEFAULT parameters, so a wrong signature raises 42883 and would roll back
-- this whole transaction on CI live-DB, fresh staging and DR restores.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. atomic_quiz_profile_update — 4-arg (uuid, integer, integer, integer)
--    RETURNS void. No guard of its own; PERFORMs the 7-arg (baseline:642-655),
--    so it is a second, equally anon-reachable door onto the same writes.
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL     ON FUNCTION public.atomic_quiz_profile_update(uuid, integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atomic_quiz_profile_update(uuid, integer, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(uuid, integer, integer, integer) IS
  'Backward-compatible 4-param overload (RETURNS void, baseline:642-655). Delegates '
  'via PERFORM to the canonical 7-param overload with p_subject=''unknown'', '
  'p_time_seconds=0, p_session_id=NULL. SECURITY DEFINER; carries no ownership guard '
  'of its own and inherits the 7-arg''s. ACL POSTURE as of 20260814000005: PUBLIC and '
  'anon EXECUTE REVOKED; authenticated and service_role RETAINED. Rationale: the '
  'inherited guard is skipped whenever auth.uid() IS NULL, so an UNAUTHENTICATED '
  'PostgREST caller (bare anon key, no Authorization header) could write XP, '
  'student_learning_profiles counters, streaks and state_events onto an ARBITRARY '
  'p_student_id — de-authenticating was a privilege escalation. The guard is an '
  'app-level ownership assertion, NOT a privilege boundary, and is intentionally '
  'unchanged; the EXECUTE grant is the layer that can distinguish anon from '
  'service_role. authenticated is KEPT because the guard demonstrably fires for '
  'signed-in non-owners and there is live authenticated quiz-XP traffic. Internal '
  'PERFORM call sites are unaffected by EXECUTE grants.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. atomic_quiz_profile_update — 6-arg
--    (uuid, text, integer, integer, integer, integer) RETURNS jsonb.
--    Live browser caller: packages/lib/src/domains/quiz.ts + profile.ts.
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL     ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer) IS
  'Atomic quiz profile + student XP update with the P2 daily XP cap (200) enforced; '
  'RETURNS jsonb. Carries the auth.uid()-scoped ownership guard added by '
  '20260702150000 (body unchanged here). ACL POSTURE as of 20260814000005: PUBLIC and '
  'anon EXECUTE REVOKED; authenticated and service_role RETAINED. Rationale: the guard '
  'short-circuits when auth.uid() IS NULL, so it was skipped entirely for '
  'unauthenticated anon-key callers while correctly blocking signed-in non-owners '
  '(measured on the live DB 2026-08-14: guard=f under an anon JWT, t for an '
  'authenticated non-owner). Dropping the Authorization header was therefore a '
  'privilege escalation onto a caller-supplied p_student_id. Prior '
  '`REVOKE ... FROM anon` statements (20260515000002:169, 20260702150000:563) were '
  'no-ops because anon''s privilege derived from the baseline PUBLIC grant, which they '
  'never touched. The guard is an app-level ownership assertion, not a privilege '
  'boundary, and is left as-is deliberately: auth.uid() IS NULL cannot separate '
  'service_role from anon (neither presents a sub claim), so only the EXECUTE grant '
  'can. authenticated is KEPT — revoking it would break the live browser quiz-XP path.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. atomic_quiz_profile_update — 7-arg
--    (uuid, text, integer, integer, integer, integer, uuid) RETURNS void.
--    Canonical overload. Live browser caller: packages/lib/src/supabase.ts
--    (submitQuizResults). Also the PERFORM target of the 4-arg overload and of
--    submit_quiz_results v1/v2 — those internal calls are unaffected.
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL     ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atomic_quiz_profile_update(uuid, text, integer, integer, integer, integer, uuid) IS
  'Canonical quiz-submission RPC: P2 daily 200 XP quiz cap, xp_transactions ledger row, '
  'students.xp_total, student_learning_profiles upsert, streak, and the '
  'learner.quiz_completed state_event. Carries the auth.uid()-scoped ownership guard '
  'added by 20260702150000 (body unchanged here). ACL POSTURE as of 20260814000005: '
  'PUBLIC and anon EXECUTE REVOKED; authenticated and service_role RETAINED. Rationale: '
  'the guard is skipped when auth.uid() IS NULL, so an unauthenticated anon-key caller '
  'could write XP, UNCLAMPED student_learning_profiles counters, arbitrary-subject '
  'profile rows, streak_days/last_active, and a learner.quiz_completed state_event with '
  'an UNVALIDATED attacker-chosen p_session_id (poisoning the '
  '''quiz-completed:''||p_session_id idempotency key) onto any p_student_id. '
  'De-authenticating was a privilege escalation. The guard is deliberately unchanged — '
  'it is an app-level ownership assertion, not a privilege boundary, and auth.uid() IS '
  'NULL cannot distinguish service_role from anon. Internal PERFORM call sites (4-arg '
  'overload, submit_quiz_results v1/v2) run in a SECURITY DEFINER context and are '
  'unaffected by EXECUTE grants. authenticated is KEPT — it is the live browser '
  'quiz-submission path and the guard demonstrably blocks signed-in non-owners.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — NOT IMPLEMENTED HERE. DO NOT FOLD INTO THIS MIGRATION.
-- ═══════════════════════════════════════════════════════════════════════════
-- This migration removes the UNAUTHENTICATED reach. It does NOT make the
-- in-body guard sound, and it is not a full fix for the pattern.
--
-- The durable fix is to gate the service-role escape hatch on something that
-- actually IDENTIFIES service_role — e.g. auth.role() / current_setting(
-- 'request.jwt.claims')->>'role' / current_user — rather than on the ABSENCE of
-- a `sub` claim. `auth.uid() IS NULL` is true for the trusted backend and for a
-- credential-less stranger alike, which is precisely why the hole existed. A
-- guard shaped roughly as
--     IF <caller is not service_role> AND NOT EXISTS (…ownership…) THEN RAISE
-- would fail CLOSED for anon instead of open.
--
-- Deliberately deferred, because it is a materially higher-blast-radius change
-- than an ACL edit:
--   * it is a BODY edit to the hottest write path in the product (P1/P2/P4),
--     replayed across at least the 6-arg and 7-arg overloads and the same
--     copy-pasted guard in submit_quiz_results v1 and submit_quiz_results_v2;
--   * the correct role predicate differs between PostgREST, direct Postgres
--     sessions, pg_cron (`postgres`) and SECURITY DEFINER nesting, so it needs
--     its own empirical matrix per caller class before it can be trusted;
--   * getting it wrong fails closed on the quiz-submission path — a full
--     student-facing outage — whereas getting THIS migration wrong at worst
--     leaves the pre-existing posture.
-- Track it separately, with the same "evaluate the predicate against the live
-- DB under each caller class" evidence standard used to prove the defect above.

-- End of migration: 20260814000005_revoke_anon_execute_atomic_quiz_profile_update.sql
-- Locked (PUBLIC + anon EXECUTE removed, authenticated + service_role retained):
--   atomic_quiz_profile_update 4-arg, 6-arg, 7-arg
-- Untouched on purpose: the 5-arg overload (already fully locked by
--   20260814000004 B1) and every function BODY, including the ownership guard.
