-- Migration: 20260814000015_content_reporter_readonly_role.sql
-- Purpose: Create the least-privilege, read-only reporting role that closes
--          OD-1 — the third and last restore condition for the content-quality
--          nightly (.github/workflows/content-quality-nightly.yml), which today
--          falls back to the RLS-bypassing SUPABASE_SERVICE_ROLE_KEY.
--
-- Owner: architect. Reviewers: ops (workflow + settings), assessment (the two
-- scripts' query shapes are content policy and were NOT changed here).
--
-- ============================================================================
-- 1. WHAT THIS ROLE MAY READ, AND HOW THAT SET WAS DERIVED
-- ============================================================================
-- The grant set below is derived from the ACTUAL query shapes of the only two
-- scripts the nightly runs. It was read out of the source, not assumed:
--
--   scripts/check-content-gaps.ts
--     QUERY_SHAPES.rag_content_chunks = select 'subject_code, grade_short'
--                                        .eq('is_active', true)
--                                        .order('id')            <- needs id
--     QUERY_SHAPES.question_bank      = select 'subject, grade'
--                                        .eq('is_active', true)
--                                        .order('id')            <- needs id
--     (2 statements per table: one count:'exact'/head, then the .range() pages.)
--
--   scripts/audit-question-quality.ts
--     QUERY_SHAPES.question_bank      = the 21-column select on line 74.
--
--   Zero INSERT / UPDATE / DELETE. Zero .rpc(). Verified 2026-08-11.
--
-- cbse_syllabus: **NOT GRANTED.** This was checked rather than assumed —
-- neither script references cbse_syllabus, ingestion_gaps,
-- cbse_syllabus_rag_diagnostic or subject_content_readiness_daily anywhere.
-- The runbook cross-checks the nightly's totals against
-- /api/super-admin/grounding/coverage, but that is a separate, already-
-- authorized surface. If a future revision of the detector reads cbse_syllabus,
-- it needs a new migration extending this grant — deliberately, not silently.
--
-- ---------------------------------------------------------------------------
-- COLUMN-LEVEL, NOT TABLE-LEVEL. This is the main least-privilege win and it is
-- worth the brittleness:
--
--   * rag_content_chunks is the PROPRIETARY NCERT CORPUS. Table-level SELECT
--     would expose `chunk_text` (the licensed body text) and `embedding` to a
--     CI credential that only ever needs to COUNT rows by taxonomy. The four
--     columns granted below make reading the corpus body physically impossible
--     for this role, not merely unintended.
--
--   * question_bank carries answer keys. 20260806000004 named
--     (correct_answer_index, correct_answer_text, solution_steps) as sensitive.
--     `correct_answer_index` IS genuinely required — audit-question-quality.ts
--     validates it is within 0..3 (check #6, 'invalid_answer_index'), so it is
--     granted. `correct_answer_text` and `solution_steps` are NOT read by
--     either script and are NOT granted. Neither are answer_text,
--     expected_answer, answer_rubric, hint_level_1..3, the embedding, or the
--     staff-identity columns created_by / updated_by / reviewed_by /
--     published_by.
--
-- The cost of column-level grants is that a future change to either script's
-- select list gets a hard 42501 "permission denied for column". That is the
-- correct failure mode for this job: loud and immediate, never a silent
-- under-count. A detector that cannot see the data must never look green.
--
-- P13 (no PII): neither table holds student-identifiable data. The only
-- identity-shaped columns on question_bank are the four staff-authorship uuids,
-- and those are excluded above. No `students`, no `guardians`, no
-- `quiz_responses`, no auth schema access of any kind is granted. No view was
-- needed, because the derived grant set already contains zero PII.
--
-- ============================================================================
-- 2. RLS RULING: THIS ROLE RESPECTS RLS. IT DOES **NOT** BYPASS IT.
-- ============================================================================
-- This is the load-bearing decision, so the reasoning is recorded in full.
--
-- THE TRAP. Both target tables are RLS-enabled and NEITHER is readable by a
-- plain custom role today:
--
--   * rag_content_chunks — bucket (d) of
--     20260728090000_lockdown_anon_readable_public_tables.sql. Its only policy
--     ("rag_chunks_read") was DROPPED and deliberately not replaced. The table
--     has RLS enabled and ZERO policies. Every non-BYPASSRLS role sees 0 rows.
--
--   * question_bank — bucket (b). Its single policy is
--     "question_bank_authenticated_read" ... FOR SELECT TO authenticated.
--     A custom role is not a member of `authenticated`, so it too sees 0 rows.
--
-- So the naive "just make it respect RLS" credential reads ZERO rows from BOTH
-- tables and the detector goes silently blind — which is precisely the
-- failure mode this whole work item exists to eliminate. Simply creating a
-- role and granting SELECT is NOT sufficient, and would have shipped a
-- credential that authenticates fine and reports an empty database.
--
-- THE CHOICE. Two ways out: give the role BYPASSRLS (a second service_role),
-- or keep it inside RLS and give it two explicit, narrowly-scoped policies.
-- This migration takes the second. Reasons, in order of weight:
--
--   (a) BYPASSRLS is a ROLE-LEVEL attribute with UNBOUNDED, PERMANENT scope.
--       It applies to every table that exists now and every table added later,
--       forever. Its blast radius cannot be reviewed, because it is not
--       expressed per-object anywhere. Creating a second BYPASSRLS role is
--       creating a second service_role, which is exactly the containment that
--       commit b66c25c3b's suspension note was trying to buy back.
--
--   (b) Policy-scoped access FAILS CLOSED. Two independent gates — the column
--       GRANT and a matching RLS policy — must BOTH be present for a single
--       row to be returned. A future accidental
--       `GRANT SELECT ON ALL TABLES IN SCHEMA public TO content_reporter`
--       would still yield zero rows on every table except the two named below,
--       because no policy names this role there. Under BYPASSRLS that same
--       accident is a full-database read.
--
--   (c) It is AUDITABLE IN THE CATALOG. `SELECT * FROM pg_policies WHERE
--       'content_reporter' = ANY(roles)` enumerates this credential's entire
--       reach in one query. BYPASSRLS shows nothing at all in pg_policies —
--       there is no object-level artifact to review.
--
--   (d) P8 states client/automation code never bypasses RLS and that
--       supabase-admin (service_role) is the single sanctioned exception.
--       Keeping the reporting credential inside the RLS system preserves the
--       invariant's shape instead of quietly minting a second exception.
--
-- THE BLINDNESS RISK IS CLOSED BY CONSTRUCTION: the two policies are created in
-- THIS SAME migration as the role and the grants. The credential cannot come
-- into existence without them, so there is no window in which it authenticates
-- successfully and reads nothing. The verification block at the end refuses to
-- let this migration commit unless all four pieces are present.
--
-- The policies are `TO content_reporter` and therefore CANNOT widen anything
-- for anon or authenticated. rag_content_chunks stays service-role-only for
-- every other caller; question_bank's authenticated posture is untouched.
--
-- ============================================================================
-- 3. WHY THERE IS NO PASSWORD IN THIS FILE (and no password anywhere)
-- ============================================================================
-- The repo convention is that schema lives in a migration, but a password
-- cannot be committed. That tension does not need resolving here, because this
-- role HAS NO PASSWORD AND CANNOT LOG IN AT ALL — NOLOGIN, and no password is
-- ever set, out-of-band or otherwise.
--
-- Both scripts talk to PostgREST via @supabase/supabase-js (createClient), NOT
-- to Postgres over libpq. A direct connection string is therefore useless to
-- them without rewriting both scripts. The credential is a JWT: PostgREST
-- authenticates as `authenticator` and issues SET LOCAL ROLE from the token's
-- `role` claim. That requires only `GRANT content_reporter TO authenticator`
-- (below) — never a LOGIN, never a password.
--
-- The single out-of-band step is therefore: mint a JWT with claim
-- role=content_reporter, signed with the project's JWT secret, and store it as
-- the GitHub environment secret SUPABASE_CONTENT_REPORT_KEY. Nothing secret is
-- committed, and this file creates no usable direct login.
-- Full operator procedure: docs/runbooks/content-gap-detection.md (OD-1).
--
-- ============================================================================
-- 4. RESIDUAL RISK, STATED RATHER THAN HIDDEN
-- ============================================================================
-- Supabase's baseline carries
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--     TO postgres, anon, authenticated, service_role;
-- so every function in `public` is born with EXECUTE granted to PUBLIC — see
-- the root-cause analysis in 20260814000004_revoke_anon_execute_secdef_batch.sql.
-- Every role is a member of PUBLIC, so `content_reporter` inherits EXECUTE on
-- whatever still carries that PUBLIC grant. A grant to PUBLIC CANNOT be revoked
-- from one individual role, so this migration cannot close it, and pretending
-- otherwise with a `REVOKE ... FROM content_reporter` would be the exact
-- no-op-that-looks-authoritative defect 20260814000004 was written to fix.
--
-- Bounding it honestly: content_reporter's RPC reach is bounded by PUBLIC —
-- the same reach the ANON KEY, which ships in every browser bundle, already
-- has. This credential is therefore not a privilege escalation over what is
-- already publicly distributed. It is strictly weaker in one respect: its token
-- carries no `sub` claim, so auth.uid() is NULL and every ownership-checked
-- SECURITY DEFINER helper returns nothing. The durable fix is the ongoing
-- PUBLIC-revoke programme (20260707020000 -> 20260813000007 -> 20260814000004),
-- not this file.
--
-- This migration itself creates NO function and uses NO SECURITY DEFINER.
--
-- ============================================================================
-- 5. WHAT SUPABASE'S `postgres` ROLE MAY ACTUALLY DO  (added 2026-08-11 after
--    this migration FAILED on staging — read this before editing anything below)
-- ============================================================================
-- FIRST REAL-SERVER CONTACT, 2026-08-11 staging push:
--
--   ERROR: permission denied to alter role (SQLSTATE 42501)
--   Only roles with the SUPERUSER attribute may alter roles with the SUPERUSER
--   attribute.
--   At statement: 2   -- i.e. the ALTER ROLE that used to live at line ~217
--
-- Migrations run as Supabase's `postgres`, which has CREATEROLE but is **NOT a
-- superuser**. The distinction that bit us is between CREATE ROLE and ALTER ROLE:
--
--   CREATE ROLE — the superuser gate fires only when an attribute is being
--     TURNED ON. Passing NOSUPERUSER / NOREPLICATION / NOBYPASSRLS is free,
--     because they are already the defaults for a new role. Statement 1 (the
--     guarded CREATE ROLE below) therefore SUCCEEDED on staging.
--
--   ALTER ROLE — the gate fires on the mere PRESENCE of the option, in either
--     polarity. `NOSUPERUSER`, `NOREPLICATION` and `NOBYPASSRLS` each require
--     superuser to *write*, even when writing the value the role already has.
--
--   ⚠ NOTE THE ERRDETAIL. It names SUPERUSER, not BYPASSRLS — the SUPERUSER
--     check is evaluated first, so `NOSUPERUSER` alone was already fatal.
--     Deleting only `NOBYPASSRLS` would have bought a SECOND failed push.
--
-- Permitted for this non-superuser (each justified where used):
--   * CREATE ROLE with all-negative attributes                  — proven on staging
--   * ALTER ROLE ... NOLOGIN/NOINHERIT/NOCREATEDB/NOCREATEROLE   — CREATEROLE + admin
--       option on a role it created; attempted best-effort, never fatal
--   * ALTER ROLE ... SET <PGC_USERSET guc>                       — precedent:
--       _legacy/timestamped/20260325130000_add_statement_timeout.sql ran
--       `ALTER ROLE authenticator/anon/authenticated SET statement_timeout`
--       unguarded against production. Superuser-only (PGC_SUSET) GUCs would be
--       refused; all three set below are PGC_USERSET. Still wrapped, because a
--       connection-hygiene nicety must never abort a migration batch.
--   * GRANT <role> TO authenticator                              — needs ADMIN
--       OPTION on the GRANTED role only, which the creator holds. Nothing is
--       required on the grantee. This is Supabase's documented PostgREST
--       custom-role pattern. Load-bearing -> stays fatal, with remediation text.
--   * GRANT USAGE ON SCHEMA public                               — precedent:
--       _legacy/005_welcome_email_triggers.sql line 195. Wrapped anyway: PUBLIC
--       already carries USAGE on `public`, so failure here is not load-bearing.
--   * GRANT SELECT (cols) / ALTER TABLE ... ENABLE RLS / CREATE POLICY on the
--       two target tables                                        — table owner.
--   * COMMENT ON ROLE                                            — shared catalog,
--       CREATEROLE-gated. Already wrapped; handler widened to WHEN OTHERS.
--
-- NOT permitted, and therefore NOT attempted anywhere in this file:
--   * ALTER ROLE ... [NO]SUPERUSER / [NO]REPLICATION / [NO]BYPASSRLS
--
-- ENFORCEMENT REPLACED BY VERIFICATION (the deliberate design change):
-- The deleted ALTER existed to converge a hand-created or drifted role onto the
-- reviewed posture — "BYPASSRLS in particular must never drift on". That intent
-- is NOT dropped. It is moved into the verification block in 5.6, which reads
-- pg_roles and RAISES on rolsuper / rolbypassrls / rolreplication / rolcanlogin
-- / rolcreatedb / rolcreaterole. On a security posture that is the stronger
-- behaviour, not the weaker one: the ALTER only corrected drift at the instant
-- the migration ran and then said nothing, whereas the assertion re-checks on
-- every replay and converts undetected drift into a loud, blocking failure. We
-- cannot silently fix a role that gained BYPASSRLS out of band; we can refuse to
-- ship a credential while it has it.
--
-- Blind spot, stated: `pg_authid.rolpassword` is superuser-only readable, so
-- this file CANNOT verify that no password was set out of band. NOLOGIN (which
-- IS verified, and which we can also attempt to re-assert) makes a password
-- unusable, so this is a defence-in-depth gap, not an open door.
--
-- ============================================================================
-- 5A. IDEMPOTENCY / SAFETY
-- ============================================================================
-- CREATE ROLE has no IF NOT EXISTS, so it is guarded on pg_roles. GRANT and
-- REVOKE are naturally replay-safe. Policies use DROP POLICY IF EXISTS +
-- CREATE POLICY. No table, column, function, policy or index belonging to any
-- other feature is dropped or altered. No DROP of any kind. Additive only.
-- Safe to re-run.
--
-- Re-run against the HALF-APPLIED STAGING state (12/13/14 committed, 15 failed,
-- 16 never ran): safe, and safe under either reading of what statement 1 left
-- behind. CREATE ROLE is fully transactional and this file opens its own
-- BEGIN (the failure was reported at "statement: 2", i.e. the CLI counted that
-- BEGIN), so the role was almost certainly rolled back and does not exist. If it
-- does exist — rolled forward, or hand-created by an operator — the pg_roles
-- guard skips creation, the best-effort ALTER converges what a non-superuser is
-- allowed to converge, the GRANTs and policies are replay-safe, and 5.6 asserts
-- the final state either way. Both paths converge on the same posture.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 5.1 The role.
--
-- NOLOGIN      — cannot connect directly; usable only via PostgREST SET ROLE.
-- NOBYPASSRLS  — explicit, not merely the default. See section 2.
-- NOINHERIT    — mirrors Supabase's own anon/authenticated/service_role shape.
-- ---------------------------------------------------------------------------
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'content_reporter') THEN
    CREATE ROLE content_reporter
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
    RAISE NOTICE 'created role content_reporter';
  ELSE
    RAISE NOTICE 'role content_reporter already exists - reconciling attributes';
  END IF;
END
$role$;

-- ---------------------------------------------------------------------------
-- 5.1a Attribute convergence, split by what a non-superuser may actually write.
--
-- WAS (removed 2026-08-11, this is the statement that failed on staging):
--   ALTER ROLE content_reporter
--     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
--
-- The intent — "a hand-created or drifted role converges to the reviewed
-- posture rather than silently keeping whatever it was given out-of-band" — is
-- preserved and split in two:
--   * the four attributes CREATEROLE may write are still enforced here,
--     best-effort (a failure to converge must not abort the batch); and
--   * the three that require superuser (SUPERUSER, REPLICATION, BYPASSRLS) are
--     asserted, fatally, in 5.6. See section 5 for the full reasoning.
-- ---------------------------------------------------------------------------
DO $attrs$
BEGIN
  ALTER ROLE content_reporter NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE;
  RAISE NOTICE
    'converged content_reporter to NOLOGIN/NOINHERIT/NOCREATEDB/NOCREATEROLE';
EXCEPTION
  -- Reachable if the role pre-existed and was created by another role (e.g. an
  -- operator running as supabase_admin), leaving `postgres` without ADMIN
  -- OPTION on it. Non-fatal here ON PURPOSE: 5.6 re-reads the catalog and fails
  -- the migration if the posture is actually wrong, so a failure to *write* the
  -- attributes cannot let a bad posture through unnoticed, and a failure to
  -- write attributes that were already correct cannot strand the batch.
  WHEN OTHERS THEN
    RAISE WARNING
      'Could not re-assert content_reporter attributes (SQLSTATE %). Not fatal: '
      'the verification block below asserts the resulting posture directly. If '
      'that block raises, remediate as supabase_admin.', SQLSTATE;
END
$attrs$;

-- ---------------------------------------------------------------------------
-- 5.1b Per-role GUCs. Belt and braces: a runaway report query must not pin a
--      production connection all night. The nightly's own job timeout is 20
--      minutes; these are far tighter.
--
-- All three are PGC_USERSET, so a non-superuser may set them per-role (a
-- PGC_SUSET parameter would be refused), and there is direct production
-- precedent — _legacy/timestamped/20260325130000_add_statement_timeout.sql ran
-- the same statement shape, unguarded, against authenticator/anon/authenticated.
-- Each is nevertheless wrapped in its OWN sub-block so that one refusal degrades
-- to a warning and still leaves the other two applied. None of the three is
-- load-bearing: `row_security` already defaults to on, and for a NOBYPASSRLS
-- role setting it off would raise an error rather than expose rows — it is
-- defence-in-depth only.
-- ---------------------------------------------------------------------------
DO $rolegucs$
BEGIN
  BEGIN
    ALTER ROLE content_reporter SET statement_timeout = '120s';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not set statement_timeout on content_reporter (SQLSTATE %). '
                  'Connection hygiene only - role, grants and policies unaffected.', SQLSTATE;
  END;

  BEGIN
    ALTER ROLE content_reporter SET idle_in_transaction_session_timeout = '60s';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not set idle_in_transaction_session_timeout on content_reporter '
                  '(SQLSTATE %). Connection hygiene only.', SQLSTATE;
  END;

  BEGIN
    ALTER ROLE content_reporter SET row_security = on;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not set row_security=on on content_reporter (SQLSTATE %). '
                  'Defence-in-depth only: on is already the cluster default, and this '
                  'role has no BYPASSRLS to fall back on.', SQLSTATE;
  END;
END
$rolegucs$;

-- COMMENT ON ROLE is documentation only, but it targets a SHARED catalog object
-- whose "ownership" check is CREATEROLE-gated (and superuser-gated if the target
-- is itself a superuser). Supabase's `postgres` role is NOT a superuser, so an
-- unguarded COMMENT here could abort this entire migration over a docstring.
-- Degraded to a warning deliberately: its failure is genuinely harmless.
--
-- HANDLER WIDENED 2026-08-11. The previous `WHEN insufficient_privilege` was
-- correct for the case it named (that IS the condition name for 42501, the code
-- COMMENT raises when the CREATEROLE check fails) — but naming one condition on
-- a statement whose whole point is "must never abort the batch" leaves every
-- other SQLSTATE fatal. Since nothing downstream depends on this comment
-- existing, WHEN OTHERS is strictly correct here; SQLSTATE is echoed so a
-- surprise is still diagnosable from the push log.
DO $rolecomment$
BEGIN
  COMMENT ON ROLE content_reporter IS
    'Read-only CI reporting credential for the content-quality nightly (OD-1). '
    'NOLOGIN + no password: reachable ONLY via PostgREST SET ROLE from a JWT whose '
    '"role" claim is content_reporter, signed with the project JWT secret and held '
    'as the GitHub environment secret SUPABASE_CONTENT_REPORT_KEY on production-ops. '
    'NOBYPASSRLS by design - reads are authorised by the two explicit policies '
    'content_reporter_read on rag_content_chunks and question_bank, nothing else. '
    'Column-level SELECT only; cannot read rag_content_chunks.chunk_text or '
    'question_bank.correct_answer_text/solution_steps. See migration '
    '20260814000015 for the full derivation.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING
      'Could not COMMENT ON ROLE content_reporter (SQLSTATE %). Documentation '
      'only - the role, grants and policies are unaffected.', SQLSTATE;
END
$rolecomment$;

-- ---------------------------------------------------------------------------
-- 5.2 Let PostgREST switch into the role.
--
-- PostgREST connects as `authenticator` and runs SET LOCAL ROLE <jwt.role>.
-- That requires authenticator to be a MEMBER of the target role. Without this
-- grant every request returns 42501 and the nightly fails at the first query.
-- Guarded because a non-Supabase Postgres (a bare CI live-DB fixture) has no
-- `authenticator` role; there, the grant is simply not applicable.
--
-- PRIVILEGE CHECK (2026-08-11): granting a role requires ADMIN OPTION on the
-- GRANTED role, and nothing at all on the grantee — so `postgres` needs no
-- rights over `authenticator` here. It holds admin option on content_reporter
-- because it created it (PG16+ grants the creator admin option automatically;
-- on PG15 CREATEROLE alone suffices for a non-superuser target). This is the
-- documented Supabase/PostgREST custom-role pattern.
--
-- This one stays FATAL. It is the single statement in the file whose absence
-- produces exactly the failure this work item exists to eliminate: a credential
-- that authenticates and reads nothing. The handler below only improves the
-- diagnosis before re-raising — it does not swallow.
-- ---------------------------------------------------------------------------
DO $member$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    BEGIN
      GRANT content_reporter TO authenticator;
      RAISE NOTICE 'granted content_reporter to authenticator';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'Could not GRANT content_reporter TO authenticator (SQLSTATE %). This is '
          'LOAD-BEARING: without it PostgREST cannot SET ROLE and every nightly '
          'request 42501s, so the migration refuses to ship a dead credential. '
          'Most likely cause: content_reporter pre-exists and was created by '
          'another role, leaving postgres without ADMIN OPTION on it. Remediate '
          'as supabase_admin with: GRANT content_reporter TO authenticator; '
          '(or DROP ROLE content_reporter and re-run this migration).', SQLSTATE;
    END;
  ELSE
    RAISE WARNING
      'role "authenticator" not found - skipping membership grant. This is '
      'expected on a non-Supabase Postgres. On a real Supabase project this '
      'means PostgREST CANNOT assume content_reporter and the nightly will 401/403.';
  END IF;
END
$member$;

-- PostgREST also needs the role to be able to see the schema at all.
--
-- Wrapped 2026-08-11: this needs GRANT OPTION on schema `public`, which
-- `postgres` has here (precedent: _legacy/005_welcome_email_triggers.sql line
-- 195 granted USAGE on this schema unguarded, against production). It is
-- nevertheless not worth aborting a batch for, because PUBLIC already carries
-- USAGE on `public` and every role is a member of PUBLIC — so the effective
-- privilege survives a refusal. 5.6 asserts the EFFECTIVE privilege with
-- has_schema_privilege(), which is the thing that actually matters, rather than
-- assuming this statement succeeded.
DO $schemausage$
BEGIN
  GRANT USAGE ON SCHEMA public TO content_reporter;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING
      'Could not GRANT USAGE ON SCHEMA public TO content_reporter (SQLSTATE %). '
      'PUBLIC already carries USAGE on this schema, so the effective privilege is '
      'verified below rather than assumed.', SQLSTATE;
END
$schemausage$;

-- ---------------------------------------------------------------------------
-- 5.3 Column-level SELECT grants. Nothing else. No INSERT/UPDATE/DELETE, no
--     TRUNCATE, no REFERENCES, no sequence usage, no other table.
-- ---------------------------------------------------------------------------

-- rag_content_chunks: exactly the 4 columns check-content-gaps.ts touches.
--   subject_code, grade_short -> the canonical pair match_rag_chunks_ncert
--                                filters on (the retrievable-taxonomy signal)
--   is_active                 -> the .eq() filter on both count and pages
--   id                        -> the .order('id') stable paging key
-- NOT granted (non-exhaustive, but the ones that matter): chunk_text, embedding,
-- answer_text, question_text, search_vector, media_url.
GRANT SELECT (id, is_active, subject_code, grade_short)
  ON public.rag_content_chunks
  TO content_reporter;

-- question_bank: the union of check-content-gaps.ts (subject, grade, is_active,
-- id) and audit-question-quality.ts's select list.
--
-- ⚠ `topic` IS DELIBERATELY ABSENT AND IS NOT AN OVERSIGHT.
--   audit-question-quality.ts's QUERY_SHAPES select list (line 74) asks for a
--   column `topic` that DOES NOT EXIST on question_bank — not in the baseline
--   CREATE TABLE, and no migration ever adds it. 20260806000004 states this
--   outright ("There is NO `topic`"), having itself failed on apply with
--   SQLSTATE 42703 for the same reason. Granting a non-existent column would
--   abort this migration with 42703. That script defect is real and pre-exists
--   this credential (the audit step is `continue-on-error: true`, so it has
--   been failing quietly); it is handed to ops/assessment to fix in the script,
--   and this grant list must be extended only if a `topic` column is ever added.
GRANT SELECT (
  id,
  subject,
  grade,
  chapter_number,
  chapter_title,
  question_text,
  question_hi,
  question_type,
  options,
  correct_answer_index,
  explanation,
  explanation_hi,
  hint,
  difficulty,
  bloom_level,
  is_active,
  source,
  board_year,
  topic_id,
  content_status
)
  ON public.question_bank
  TO content_reporter;

-- ---------------------------------------------------------------------------
-- 5.4 The two RLS policies that make the grants actually return rows.
--     Scoped TO content_reporter, so no other role's visibility changes.
--     SELECT-only: there is deliberately no INSERT/UPDATE/DELETE policy, so
--     even a future accidental write GRANT still cannot write a single row.
-- ---------------------------------------------------------------------------

-- rag_content_chunks stays RLS-enabled and policy-less for anon/authenticated
-- (bucket (d) of 20260728090000). This adds the FIRST and only policy on the
-- table, and it names a single non-interactive role.
ALTER TABLE public.rag_content_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rag_content_chunks_content_reporter_read" ON public.rag_content_chunks;
CREATE POLICY "rag_content_chunks_content_reporter_read"
  ON public.rag_content_chunks
  FOR SELECT
  TO content_reporter
  USING (true);

-- question_bank keeps question_bank_authenticated_read untouched. Permissive
-- policies OR together, but this one is TO content_reporter, so it can only
-- ever add visibility FOR THAT ROLE - it cannot widen `authenticated`.
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "question_bank_content_reporter_read" ON public.question_bank;
CREATE POLICY "question_bank_content_reporter_read"
  ON public.question_bank
  FOR SELECT
  TO content_reporter
  USING (true);

-- ---------------------------------------------------------------------------
-- 5.6 Verification. This migration REFUSES TO COMMIT half-provisioned.
--     (Renumbered from 5.5 on 2026-08-11; section 5 is now the privilege model.)
--
--     A credential that authenticates but reads nothing is the single failure
--     this work item exists to prevent, so every precondition is asserted here
--     rather than discovered at 04:00 UTC by an alert.
--
--     This block also now carries the POSTURE ENFORCEMENT that used to live in
--     the (superuser-only, staging-rejected) ALTER ROLE at 5.1a. The three
--     attributes a non-superuser cannot write — SUPERUSER, REPLICATION,
--     BYPASSRLS — are asserted here instead. We cannot silently correct a role
--     that drifted; we can refuse to ship a credential while it is wrong, and
--     re-check that on every replay, which the ALTER never did.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_exists       boolean;
  v_bypassrls    boolean;
  v_canlogin     boolean;
  v_super        boolean;
  v_replication  boolean;
  v_createdb     boolean;
  v_createrole   boolean;
  v_inherit      boolean;
  v_policies     integer;
  v_rag_cols     integer;
  v_qb_cols      integer;
  v_is_member    boolean;
  v_schema_usage boolean;
  v_leak         text;
BEGIN
  SELECT true, rolbypassrls, rolcanlogin, rolsuper, rolreplication,
         rolcreatedb, rolcreaterole, rolinherit
    INTO v_exists, v_bypassrls, v_canlogin, v_super, v_replication,
         v_createdb, v_createrole, v_inherit
    FROM pg_roles WHERE rolname = 'content_reporter';

  -- Guard the NULL path explicitly: without this, a missing role leaves every
  -- boolean NULL, every `IF v_x THEN` below is false, and the posture checks
  -- pass vacuously.
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION
      'role content_reporter does not exist at verification time. The guarded '
      'CREATE ROLE in 5.1 must have been skipped or rolled back.';
  END IF;

  -- --- Attributes a non-superuser CANNOT write, and therefore must assert. ---
  IF v_bypassrls THEN
    RAISE EXCEPTION
      'content_reporter has BYPASSRLS. That contradicts the documented ruling in '
      'section 2 of this migration and would make it a second service_role. This '
      'migration CANNOT clear the attribute (superuser-only), so it fails instead '
      'of shipping. Remediate as supabase_admin: ALTER ROLE content_reporter '
      'NOBYPASSRLS;';
  END IF;

  IF v_super THEN
    RAISE EXCEPTION
      'content_reporter has SUPERUSER. Remediate as supabase_admin: ALTER ROLE '
      'content_reporter NOSUPERUSER;';
  END IF;

  IF v_replication THEN
    RAISE EXCEPTION
      'content_reporter has REPLICATION - it could stream the entire WAL, which '
      'trivially defeats every column-level grant below. Remediate as '
      'supabase_admin: ALTER ROLE content_reporter NOREPLICATION;';
  END IF;

  -- --- Attributes 5.1a tries to converge; assert the outcome regardless. ---
  IF v_canlogin THEN
    RAISE EXCEPTION
      'content_reporter has LOGIN. This role must never be directly connectable; '
      'it is reachable only via PostgREST SET ROLE. No password is provisioned '
      '(and note pg_authid.rolpassword is not readable by a non-superuser, so '
      'NOLOGIN is the only password-related guarantee this file can verify).';
  END IF;

  IF v_createdb THEN
    RAISE EXCEPTION 'content_reporter has CREATEDB. A read-only reporting credential must not.';
  END IF;

  IF v_createrole THEN
    RAISE EXCEPTION
      'content_reporter has CREATEROLE - it could mint further roles and escalate '
      'out of this containment entirely.';
  END IF;

  -- INHERIT is posture, not privilege, for this role: content_reporter is a
  -- member of no role except PUBLIC, so there is nothing for it to inherit and
  -- no escalation path. Warned, not fatal - it must not block the batch.
  IF v_inherit THEN
    RAISE WARNING
      'content_reporter has INHERIT (expected NOINHERIT, mirroring anon/authenticated). '
      'Harmless today - the role holds no memberships - but it means 5.1a could not '
      'converge the attributes. Worth reconciling out of band.';
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('rag_content_chunks', 'question_bank')
     AND 'content_reporter' = ANY (roles);

  IF v_policies <> 2 THEN
    RAISE EXCEPTION
      'Expected exactly 2 content_reporter SELECT policies, found %. Without them '
      'the reporting credential authenticates successfully and reads ZERO rows - '
      'the detector would be silently blind, which is the exact defect OD-1 closes.',
      v_policies;
  END IF;

  SELECT count(*) INTO v_rag_cols
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'rag_content_chunks'
     AND grantee = 'content_reporter' AND privilege_type = 'SELECT';

  SELECT count(*) INTO v_qb_cols
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'question_bank'
     AND grantee = 'content_reporter' AND privilege_type = 'SELECT';

  IF v_rag_cols <> 4 THEN
    RAISE EXCEPTION 'Expected 4 granted columns on rag_content_chunks, found %.', v_rag_cols;
  END IF;

  IF v_qb_cols <> 20 THEN
    RAISE EXCEPTION 'Expected 20 granted columns on question_bank, found %.', v_qb_cols;
  END IF;

  -- EFFECTIVE schema visibility, asserted rather than assumed - the GRANT USAGE
  -- in 5.2 is now warning-degraded, and PUBLIC's own USAGE may be carrying this.
  -- Either source is fine; zero visibility is not, because PostgREST would 42501.
  SELECT has_schema_privilege('content_reporter', 'public', 'USAGE')
    INTO v_schema_usage;
  IF NOT v_schema_usage THEN
    RAISE EXCEPTION
      'content_reporter has no USAGE on schema public - every query would 42501. '
      'Remediate as supabase_admin: GRANT USAGE ON SCHEMA public TO content_reporter;';
  END IF;

  -- --- NEGATIVE assertion: the least-privilege claim, made machine-checkable. --
  -- The counts above prove "not too many columns"; these prove "not THE columns".
  -- This is the file's headline promise (section 1: reading the licensed corpus
  -- body must be physically impossible for this role, not merely unintended), so
  -- it is asserted rather than left to review. Safe from false positives: the
  -- baseline's ALTER DEFAULT PRIVILEGES grants tables to postgres/anon/
  -- authenticated/service_role and never to PUBLIC, and content_reporter is a
  -- member of none of those - so nothing else can be conferring these.
  SELECT string_agg(t.label, ', ') INTO v_leak
    FROM (
      SELECT 'rag_content_chunks.chunk_text' AS label
       WHERE has_column_privilege('content_reporter', 'public.rag_content_chunks', 'chunk_text', 'SELECT')
      UNION ALL
      SELECT 'rag_content_chunks.embedding'
       WHERE has_column_privilege('content_reporter', 'public.rag_content_chunks', 'embedding', 'SELECT')
      UNION ALL
      SELECT 'question_bank.correct_answer_text'
       WHERE has_column_privilege('content_reporter', 'public.question_bank', 'correct_answer_text', 'SELECT')
      UNION ALL
      SELECT 'question_bank.solution_steps'
       WHERE has_column_privilege('content_reporter', 'public.question_bank', 'solution_steps', 'SELECT')
      UNION ALL
      SELECT 'question_bank.expected_answer'
       WHERE has_column_privilege('content_reporter', 'public.question_bank', 'expected_answer', 'SELECT')
      UNION ALL
      SELECT 'question_bank.answer_text'
       WHERE has_column_privilege('content_reporter', 'public.question_bank', 'answer_text', 'SELECT')
    ) t;

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION
      'content_reporter can read columns it must never read: %. Either a broader '
      'GRANT was applied out of band or this migration was edited incorrectly - '
      'either way the licensed-corpus / answer-key containment described in '
      'section 1 is broken and this must not ship.', v_leak;
  END IF;

  -- Non-fatal on a non-Supabase Postgres, fatal-looking otherwise.
  -- 'MEMBER' not 'USAGE' is deliberate: NOINHERIT means authenticator holds the
  -- membership without inheriting it, which is exactly what SET ROLE needs.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    SELECT pg_has_role('authenticator', 'content_reporter', 'MEMBER')
      INTO v_is_member;
    IF NOT v_is_member THEN
      RAISE EXCEPTION
        'authenticator is not a member of content_reporter - PostgREST cannot '
        'SET ROLE into it and every request would 42501.';
    END IF;
  END IF;

  RAISE NOTICE
    'verified: content_reporter NOSUPERUSER/NOBYPASSRLS/NOREPLICATION/NOLOGIN/'
    'NOCREATEDB/NOCREATEROLE, schema USAGE present, 2 scoped SELECT policies, '
    '% rag columns, % question_bank columns, no answer-key or corpus-body column '
    'readable, authenticator membership OK. '
    'Next step is OUT OF BAND: mint the role=content_reporter JWT and store it '
    'as SUPABASE_CONTENT_REPORT_KEY on the production-ops GitHub environment.',
    v_rag_cols, v_qb_cols;
END
$verify$;

COMMIT;
