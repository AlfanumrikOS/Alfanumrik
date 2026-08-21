-- Migration: 20260821121122_create_v_xp_ledger_drift_and_reassert_view_revokes.sql
-- Purpose: Give `public.v_xp_ledger_drift` — a view that exists on PRODUCTION with NO migration
--          provenance whatsoever — a real definition in the migration chain, then re-issue all
--          seven view revocations from 20260821082059 so that STAGING converges to production's
--          hardened ACL state. On production every statement here is a verified no-op.
--
-- FILENAME / LEDGER NOTE (RESOLVED 2026-08-21): `apply_migration` stamps its own wall-clock
-- ledger version at apply time rather than honouring a file's version prefix. This file was
-- AUTHORED as 20260821140000; when applied to production `shktyoxqhundlvkiwguu` on 2026-08-21 the
-- ledger stamped 20260821121122 (name `create_v_xp_ledger_drift_and_reassert_view_revokes`). BOTH
-- this file and its DOWN partner in docs/runbooks/ were RENAMED TO MATCH THE LEDGER — the ledger
-- was never repaired to match the file — so the filename and
-- `supabase_migrations.schema_migrations` now AGREE and the pair stays discoverable under one
-- version. The ledger records what actually happened; the authored filename did not.
--
-- NOTE THE SORT DIRECTION: the stamped 20260821121122 sorts BEFORE the authored 20260821140000.
-- Left unreconciled, `supabase db push` would have read the higher-numbered file as still
-- unapplied and re-run it — harmless, because every statement below is idempotent and was a
-- verified no-op on production, but a standing false signal. Renaming DOWN to the stamped version
-- is what closes it. Same reconciliation as
-- 20260821082059_restrict_secdef_views_to_service_role.sql and
-- 20260821061915_revoke_public_execute_quiz_serving_rpcs.sql.
--
-- ============================================================================
-- THE DEFECT — A MIGRATION THAT CANNOT RUN ON STAGING
-- ============================================================================
-- 20260821082059_restrict_secdef_views_to_service_role.sql revokes `anon`/`authenticated` from
-- seven views inside a single BEGIN/COMMIT. Its line 263 is:
--
--     REVOKE ALL ON public.v_xp_ledger_drift FROM PUBLIC, anon, authenticated;
--
-- State captured read-only from BOTH projects on 2026-08-21:
--
--   PRODUCTION `shktyoxqhundlvkiwguu` — `v_xp_ledger_drift` EXISTS (14 rows at capture).
--   STAGING    `gzpxqklxwzishrkiaatd` — `to_regclass('public.v_xp_ledger_drift')` IS NULL.
--                                       THE VIEW DOES NOT EXIST.
--
-- `REVOKE` HAS NO `IF EXISTS` FORM. So on staging that statement raises 42P01
-- (undefined_table). Because all eight statements share one transaction, the 42P01 ROLLS BACK
-- THE OTHER SIX REVOKES TOO.
--
--   *** THEREFORE NONE OF DB-1 HAS LANDED ON STAGING. NOT PARTIALLY — NOT AT ALL. ***
--
-- This is confirmed by the ACLs. The other six views exist on staging and still carry:
--
--     {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--      authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- while on production the same six now read `{postgres,service_role}`. The view BODIES are
-- byte-identical across the two projects (md5 of `pg_get_viewdef` verified on all six). ONLY THE
-- ACLs DIVERGE — which is exactly the fingerprint of a transaction that aborted before any
-- revoke committed, not of a schema that drifted.
--
-- ============================================================================
-- WHY A PRODUCTION VIEW HAS NO CREATING MIGRATION
-- ============================================================================
-- The other six views each have a creating migration in the 2026-08-06 batch:
--
--     20260806000004_question_bank_answer_key_protection.sql   question_bank_student_safe
--     20260806000007_backup_verification_automation.sql        v_backup_health_summary
--     20260806000009_consent_scope_expansion.sql               v_my_consent_status
--     20260806000010_event_reconciliation_queue_slo.sql        v_queue_health
--     20260806000011_analytics_freshness_monitoring.sql        v_analytics_freshness_status
--     20260806000012_secret_rotation_continuous_ops.sql        v_secret_rotation_health
--
-- `v_xp_ledger_drift` has NONE. `git log --all -S 'v_xp_ledger_drift'` finds the string ONLY in
-- the 2026-08-20/21 remediation commits — i.e. only in the REVOKE that assumes it exists and in
-- FIX-LEDGER.md's DB-3 detection query. It HAS NEVER APPEARED IN A MIGRATION ON ANY BRANCH.
-- A `grep -rn 'VIEW public.v_xp_ledger_drift'` across every `.sql` in the repo returns zero rows.
--
-- It was therefore created by hand, directly against production, outside the migration chain.
-- That is the actual root finding here: a live production object that no environment can
-- reproduce, that no code review ever saw, and that a fresh CI project or DR restore would
-- silently lack.
--
-- ============================================================================
-- WHY WE DID *NOT* JUST GUARD THE REVOKE — READ THIS BEFORE "SIMPLIFYING" IT
-- ============================================================================
-- The obvious one-line fix is to wrap 20260821082059's line 263 in a
-- `DO $$ BEGIN IF to_regclass('public.v_xp_ledger_drift') IS NOT NULL THEN ... END IF; END $$;`
-- guard, so the statement skips on staging and the other six commit.
--
-- WE DELIBERATELY DID NOT DO THAT, and 20260821082059 is left byte-for-byte unmodified.
--
-- A `to_regclass` guard would make the migration PASS on staging while leaving staging's
-- `v_xp_ledger_drift` still absent — and it would do so SILENTLY, with a green exit code. The
-- environments would remain divergent and the audit would read as closed. Worse, it would erase
-- the only signal that a production object has no migration provenance: the 42P01 IS the
-- finding. Suppressing the error suppresses the discovery.
--
-- CREATING THE VIEW IS THE HONEST FIX. It converges the two environments on a real object,
-- puts the definition under version control where review and DR can see it, and makes DB-3's
-- detection query (`SELECT count(*) FROM v_xp_ledger_drift`, FIX-LEDGER.md:48) runnable on
-- staging for the first time.
--
-- ============================================================================
-- WHY `CREATE OR REPLACE VIEW`, AND WHY THE ORDER OF THE TWO PARTS MATTERS
-- ============================================================================
-- *** ORDER IS LOAD-BEARING: CREATE MUST COME BEFORE REVOKE. ***
-- Reversing them reproduces the exact 42P01 this migration exists to fix.
--
-- ON PRODUCTION (view exists, ACL already `{postgres,service_role}`):
--   `CREATE OR REPLACE VIEW` REPLACES A VIEW IN PLACE — it does NOT drop and recreate. An
--   in-place replace PRESERVES THE EXISTING ACL. Production's hardened ACL therefore survives
--   untouched, and because the definition below is the verbatim `pg_get_viewdef` output of the
--   live production view, the body does not change either. All eight grant statements that
--   follow are then no-ops re-asserting a state that already holds. NET EFFECT ON PRODUCTION:
--   NOTHING CHANGES.
--
-- ON STAGING (view absent):
--   The same statement CREATES the view. And here is the trap it walks into on purpose —
--   `supabase/migrations/00000000000000_baseline_from_prod.sql:22640-22643` still carries:
--
--       ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
--         GRANT ALL ON TABLES TO "anon";            <-- :22641
--         GRANT ALL ON TABLES TO "authenticated";   <-- :22642
--
--   `ON TABLES` covers views. So the view is BORN with `anon` and `authenticated` holding
--   `arwdDxtm` — all eight privileges — the instant it is created. That is precisely the
--   exposure 20260821082059 was written to close, re-manufactured by the act of fixing.
--
--   THE SEVEN REVOKES IN PART 2 ARE WHAT CLOSE IT AGAIN, IN THE SAME TRANSACTION. This is the
--   "ANY FUTURE MIGRATION THAT RECREATES ONE OF THESE SEVEN MUST RE-ASSERT THE REVOCATIONS IN
--   THE SAME FILE" rule from 20260821082059:125-127 being honoured, not an optional extra.
--   Dropping Part 2 as "redundant, production already has it" would ship the vulnerability to
--   staging.
--
-- All seven views are re-revoked, not just `v_xp_ledger_drift`, because the aborted transaction
-- means staging needs all seven. Re-issuing them here is what makes this migration
-- SELF-SUFFICIENT on any environment — fresh CI project, new staging, DR restore — rather than
-- dependent on whether 20260821082059 happened to commit there.
--
-- The seven names and their ORDER below are identical to 20260821082059:244-263. Keep them in
-- sync: if that file's set ever changes, this file must change with it.
--
-- ============================================================================
-- THE VIEW DEFINITION — PROVENANCE AND PORTABILITY
-- ============================================================================
-- Transcribed verbatim from `pg_get_viewdef('public.v_xp_ledger_drift'::regclass, true)` against
-- production on 2026-08-21. Reformatted ONLY for leading whitespace and statement termination;
-- SEMANTICS ARE UNCHANGED — same projection, same LEFT JOIN, same GROUP BY, same COALESCE
-- defaults, same `<>` filter, same column names and order.
--
-- It is creatable on staging as-is: every dependency was confirmed present with IDENTICAL types
-- on BOTH projects — `students.id`, `students.xp_total`, `xp_transactions.student_id`,
-- `xp_transactions.amount`. Note `0::bigint` on the ledger side: `sum(integer)` returns bigint,
-- so the COALESCE arms must match types. Do not "tidy" that cast away.
--
-- WHAT THIS VIEW IS FOR: it reports students whose denormalised `students.xp_total` disagrees
-- with the sum of their `xp_transactions` ledger. It is the detection query behind DB-3 (14 of
-- 68 students drifting at capture). It DETECTS drift; it does not repair it, and this migration
-- repairs no data.
--
-- ============================================================================
-- DELIBERATELY NOT DONE HERE
-- ============================================================================
--   * NO `security_invoker = true`. Like 20260821082059, this file sets no `reloptions`. The
--     view is created owner-resolved (`postgres`, `rolbypassrls = true`) to MATCH PRODUCTION
--     EXACTLY. Setting `security_invoker` here would make staging diverge from production in a
--     new way while claiming to converge it, and it is a behaviour change needing its own review
--     chain.
--   * NO XP DATA REPAIR. DB-3's 14 drifting students are untouched. This makes the drift
--     VISIBLE on staging; fixing it is separate work.
--   * NO CHANGE TO `ALTER DEFAULT PRIVILEGES`. The root cause at baseline:22640-22643 — which is
--     why the new view is born world-writable — is schema-wide and is DB-12. Not attempted here.
--   * NO EDIT TO 20260821082059. See the "why we did not guard the revoke" section.
--
-- ============================================================================
-- HOW TO VERIFY — ASSERT RESULTING STATE, NOT EXIT CODE
-- ============================================================================
-- A green exit code proves nothing here (see the sibling migration 20260821121232's header for
-- the case where a migration reported success and changed nothing). Verify by asserting the
-- END STATE in BOTH environments:
--
--   1. `SELECT to_regclass('public.v_xp_ledger_drift');`  -> non-NULL on BOTH.
--   2. Compare `md5(pg_get_viewdef('public.v_xp_ledger_drift'::regclass, true))` across the two
--      projects -> must be EQUAL.
--   3. For each of the seven views, `relacl` must list ONLY `postgres` and `service_role` on
--      BOTH — no `anon`, no `authenticated`.
--   4. BEHAVIOURALLY, not from the catalogue: under `SET LOCAL ROLE anon`, `has_table_privilege`
--      must return false for all eight privilege types on all seven views.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DOWN migration:
--     docs/runbooks/20260821121122_create_v_xp_ledger_drift_and_reassert_view_revokes.DOWN.sql
--
-- Deliberately NOT in `supabase/migrations/`: `supabase db push` applies every file in that
-- directory in version order, so a down-migration parked there would re-open this exposure —
-- including the anon WRITE grants on the two auto-updatable views — on the very next deploy,
-- with no operator decision. Its `DROP VIEW` line is additionally commented out by default,
-- because on production that would delete a live object DB-3 depends on. Read it before running.
--
-- Ledger: docs/audits/FIX-LEDGER.md  (DB-1 convergence; DB-3 owns the drift this view reports;
--         DB-12 owns the default-privileges root cause)

BEGIN;

-- ---------------------------------------------------------------------------
-- PART 1 of 2 — CREATE THE VIEW.
--
-- MUST RUN BEFORE THE REVOKES BELOW. On staging the view does not exist yet,
-- and `REVOKE` has no `IF EXISTS` — reversing these two parts reproduces the
-- 42P01 that this migration exists to fix.
--
-- `CREATE OR REPLACE` (not DROP + CREATE) is deliberate: an in-place replace
-- PRESERVES the existing ACL, so production's already-hardened
-- `{postgres,service_role}` grant set survives this statement untouched.
-- A DROP-then-CREATE would discard it and silently re-inherit `GRANT ALL TO
-- anon` from baseline:22640-22643.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_xp_ledger_drift AS
SELECT
    s.id AS student_id,
    COALESCE(s.xp_total, 0) AS xp_total,
    COALESCE(l.ledger_sum, 0::bigint) AS ledger_sum,
    COALESCE(s.xp_total, 0) - COALESCE(l.ledger_sum, 0::bigint) AS drift
   FROM students s
     LEFT JOIN ( SELECT xp_transactions.student_id,
            sum(xp_transactions.amount) AS ledger_sum
           FROM xp_transactions
          GROUP BY xp_transactions.student_id) l ON l.student_id = s.id
  WHERE COALESCE(s.xp_total, 0) <> COALESCE(l.ledger_sum, 0::bigint);

-- ---------------------------------------------------------------------------
-- PART 2 of 2 — RE-ASSERT ALL SEVEN REVOCATIONS FROM 20260821082059.
--
-- On PRODUCTION these are no-ops: `anon`/`authenticated` already hold nothing
-- on all seven.
--
-- On STAGING they are the entire point. The aborted 42P01 transaction means
-- staging still has `anon=arwdDxtm` on the six pre-existing views, and Part 1
-- just minted a seventh with the same inherited default. These seven
-- statements are what converge staging to production.
--
-- REVOKE ALL, not REVOKE SELECT: `arwdDxtm` is all eight privileges, and
-- `question_bank_student_safe` and `v_my_consent_status` are auto-updatable —
-- a REVOKE SELECT would close the read leak, leave the write path open, and
-- read in review as closed.
--
-- `PUBLIC` is named for defence in depth only; no PUBLIC entry existed at
-- capture on either project. `postgres` (owner) and `service_role` untouched.
--
-- Same names, same order as 20260821082059:244-263.
-- ---------------------------------------------------------------------------

-- 1. question_bank_student_safe — auto-updatable; RLS-bypassing write path into the whole bank.
REVOKE ALL ON public.question_bank_student_safe   FROM PUBLIC, anon, authenticated;

-- 2. v_analytics_freshness_status — read only by detect_stale_analytics() (service_role).
REVOKE ALL ON public.v_analytics_freshness_status FROM PUBLIC, anon, authenticated;

-- 3. v_backup_health_summary — the ONLY view with an application reader; service-role
--    (re-granted at the foot of this file).
REVOKE ALL ON public.v_backup_health_summary      FROM PUBLIC, anon, authenticated;

-- 4. v_my_consent_status — auto-updatable; carries an auth.uid() owner filter on the read side.
REVOKE ALL ON public.v_my_consent_status          FROM PUBLIC, anon, authenticated;

-- 5. v_queue_health — read only by check_queue_slos() (service_role).
REVOKE ALL ON public.v_queue_health               FROM PUBLIC, anon, authenticated;

-- 6. v_secret_rotation_health — disclosed total_secrets = 7 to anon.
REVOKE ALL ON public.v_secret_rotation_health     FROM PUBLIC, anon, authenticated;

-- 7. v_xp_ledger_drift — the view created in Part 1. On staging this closes the `GRANT ALL TO
--    anon` it was born with milliseconds earlier; on production it re-asserts an existing state.
--    Leaked 14 live student UUIDs with real XP balances to anon before 20260821082059.
REVOKE ALL ON public.v_xp_ledger_drift            FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Re-assert SELECT for the one real application reader.
--
--    `packages/lib/src/data-platform.ts:94` (`supabaseAdmin.from(
--    'v_backup_health_summary')`), reached only from
--    `apps/host/src/app/api/super-admin/governance/health/route.ts:17`, which
--    uses the SERVICE-ROLE client and is gated by
--    `authorizeAdmin(request, 'support')`.
--
--    A no-op wherever `service_role=arwdDxtm` already exists — which is both
--    projects today. It is included so this file is SELF-SUFFICIENT on an
--    environment whose grant chain differs, where a bare revoke could
--    otherwise leave that route unable to read the view.
--
--    SELECT only, deliberately: the reader is read-only (`.select('*')
--    .single()`), so nothing needs write privileges on a health-summary view.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.v_backup_health_summary TO service_role;

COMMIT;
