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
-- 5. IDEMPOTENCY / SAFETY
-- ============================================================================
-- CREATE ROLE has no IF NOT EXISTS, so it is guarded on pg_roles. GRANT and
-- REVOKE are naturally replay-safe. Policies use DROP POLICY IF EXISTS +
-- CREATE POLICY. No table, column, function, policy or index belonging to any
-- other feature is dropped or altered. No DROP of any kind. Additive only.
-- Safe to re-run.
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

-- Reassert the attributes even when the role pre-existed, so a hand-created or
-- drifted role converges to the reviewed posture rather than silently keeping
-- whatever it was given out-of-band. BYPASSRLS in particular must never drift on.
ALTER ROLE content_reporter
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

-- Belt and braces: a runaway report query must not pin a production connection
-- all night. The nightly's own job timeout is 20 minutes; this is far tighter.
ALTER ROLE content_reporter SET statement_timeout = '120s';
ALTER ROLE content_reporter SET idle_in_transaction_session_timeout = '60s';
-- Defensive: RLS must be honoured even if a superuser-ish default ever changes.
ALTER ROLE content_reporter SET row_security = on;

-- COMMENT ON ROLE is documentation only, but it targets a SHARED catalog object
-- and on some PostgreSQL versions requires superuser. Supabase's `postgres`
-- role is NOT a superuser, so an unguarded COMMENT here could abort this entire
-- migration over a docstring. Degraded to a warning deliberately: this is the
-- ONE statement in the file whose failure is genuinely harmless. Every
-- functional statement stays fatal (see the verification block in 5.5).
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
  WHEN insufficient_privilege THEN
    RAISE WARNING
      'Could not COMMENT ON ROLE content_reporter (insufficient privilege). '
      'Documentation only - the role, grants and policies are unaffected.';
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
-- ---------------------------------------------------------------------------
DO $member$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT content_reporter TO authenticator;
    RAISE NOTICE 'granted content_reporter to authenticator';
  ELSE
    RAISE WARNING
      'role "authenticator" not found - skipping membership grant. This is '
      'expected on a non-Supabase Postgres. On a real Supabase project this '
      'means PostgREST CANNOT assume content_reporter and the nightly will 401/403.';
  END IF;
END
$member$;

-- PostgREST also needs the role to be able to see the schema at all.
GRANT USAGE ON SCHEMA public TO content_reporter;

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
-- 5.5 Verification. This migration REFUSES TO COMMIT half-provisioned.
--
--     A credential that authenticates but reads nothing is the single failure
--     this work item exists to prevent, so every precondition is asserted here
--     rather than discovered at 04:00 UTC by an alert.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_bypassrls  boolean;
  v_canlogin   boolean;
  v_policies   integer;
  v_rag_cols   integer;
  v_qb_cols    integer;
  v_is_member  boolean;
BEGIN
  SELECT rolbypassrls, rolcanlogin
    INTO v_bypassrls, v_canlogin
    FROM pg_roles WHERE rolname = 'content_reporter';

  IF v_bypassrls THEN
    RAISE EXCEPTION
      'content_reporter has BYPASSRLS. That contradicts the documented ruling in '
      'section 2 of this migration and would make it a second service_role.';
  END IF;

  IF v_canlogin THEN
    RAISE EXCEPTION
      'content_reporter has LOGIN. This role must never be directly connectable; '
      'it is reachable only via PostgREST SET ROLE. No password is provisioned.';
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

  -- Non-fatal on a non-Supabase Postgres, fatal-looking otherwise.
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
    'verified: content_reporter NOLOGIN/NOBYPASSRLS, 2 scoped SELECT policies, '
    '% rag columns, % question_bank columns, authenticator membership OK. '
    'Next step is OUT OF BAND: mint the role=content_reporter JWT and store it '
    'as SUPABASE_CONTENT_REPORT_KEY on the production-ops GitHub environment.',
    v_rag_cols, v_qb_cols;
END
$verify$;

COMMIT;
