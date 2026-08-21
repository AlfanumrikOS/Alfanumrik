-- DOWN migration for:
--   supabase/migrations/20260821121232_converge_money_table_client_write_policies.sql
--
-- Recreates the three staging-only RLS policies that the UP migration dropped from
-- `public.subscription_events` and `public.student_daily_usage`, from their definitions captured
-- read-only from staging `gzpxqklxwzishrkiaatd` on 2026-08-21.
--
-- FILENAME / LEDGER NOTE (RESOLVED 2026-08-21): `apply_migration` stamps its own wall-clock
-- ledger version at apply time rather than honouring a file's version prefix. This pair was
-- AUTHORED as 20260821140100; when the UP was applied to production `shktyoxqhundlvkiwguu` on
-- 2026-08-21 the ledger stamped 20260821121232 (name
-- `converge_money_table_client_write_policies`). BOTH files were RENAMED TO MATCH THE LEDGER —
-- the ledger was never repaired to match the files — so the filenames and
-- `supabase_migrations.schema_migrations` now AGREE and the pair stays discoverable under one
-- version. The ledger records what actually happened; the authored filename did not.
--
-- NOTE THE SORT DIRECTION: the stamped 20260821121232 sorts BEFORE the authored 20260821140100,
-- so an unreconciled UP file would have read as still unapplied to `supabase db push` and been
-- re-run — harmless, because the UP is three `DROP POLICY IF EXISTS` statements and was a
-- verified no-op on production, but a standing false signal. Same reconciliation as
-- 20260821121122_create_v_xp_ledger_drift_and_reassert_view_revokes.sql and
-- 20260821082059_restrict_secdef_views_to_service_role.sql.
--
-- ============================================================================
-- *** RUNNING THIS FILE RESTORES LIVE EXPLOIT #6 ***
-- ============================================================================
-- Two of the three policies below — `student_usage_insert` and `student_usage_update` — are
-- PERMISSIVE and granted `TO public`. In PostgreSQL `public` is the implicit role that every
-- other role is a member of: IT INCLUDES `anon` AND `authenticated`. PostgREST exposes every
-- table in schema `public` to any caller holding the anon key plus their own JWT, so recreating
-- them makes the table writable from a browser console with nothing but a normal student login.
--
--   *** EXPLOIT #6: a logged-in student INSERTs or UPDATEs their own
--       `student_daily_usage` row, resets their AI quota counters, and consumes
--       UNMETERED CLAUDE API SPEND. Uncapped cost of goods. ***
--
-- This was verified behaviourally before the UP migration, not inferred from the catalogue:
--
--     has_table_privilege('authenticated', 'public.student_daily_usage', 'INSERT')  -> true
--     has_table_privilege('authenticated', 'public.student_daily_usage', 'UPDATE')  -> true
--
-- Note the interaction that makes even ONE of these sufficient: all policies on these tables are
-- PERMISSIVE, none is RESTRICTIVE, and permissive policies are OR-ed together. Recreating a
-- SINGLE one of the two re-opens the write path completely. There is no partial rollback here
-- that is meaningfully safer — if you must run this, run the `subscription_events` statement
-- alone (statement 1) and leave the two `student_daily_usage` statements out.
--
-- The third policy, `subscription_events_student_select`, is read-only and redundant
-- (`sub_events_own_read` already covers own-row reads on staging). Recreating it restores
-- clutter, not exposure.
--
-- ============================================================================
-- WHY THIS FILE IS NOT IN supabase/migrations/
-- ============================================================================
-- `supabase db push` applies EVERY file in `supabase/migrations/` in version order. A
-- down-migration living there would be applied AUTOMATICALLY on the next deploy and would
-- SILENTLY RE-OPEN exploit #6 — with no operator decision, no incident, and no signal that
-- anything had changed. The quota-reset path would simply be live again.
--
-- It therefore lives in `docs/runbooks/` and is NEVER auto-applied. Rolling back is a conscious,
-- hand-run act:
--
--     psql "$DATABASE_URL" -f docs/runbooks/20260821121232_converge_money_table_client_write_policies.DOWN.sql
--
-- Do not move this file into `supabase/migrations/`.
--
-- ============================================================================
-- WHICH ENVIRONMENT THIS APPLIES TO
-- ============================================================================
-- All three policies existed ONLY ON STAGING. On production `shktyoxqhundlvkiwguu` all three
-- were already absent, so the UP migration was a verified no-op there.
--
--   *** THEREFORE THIS FILE SHOULD NEVER BE RUN AGAINST PRODUCTION. ***
--
-- Doing so would not "roll back" anything — it would CREATE THREE POLICIES THAT HAVE NEVER
-- EXISTED ON PRODUCTION, introducing exploit #6 to an environment with 68 live students that
-- was never vulnerable to it. That is not a rollback; it is a new vulnerability with a
-- rollback's filename.
--
-- Confirm which database you are connected to before running:
--
--     SELECT current_database(), inet_server_addr();
--
-- ============================================================================
-- VERIFY BY RESULTING STATE, NOT BY EXIT CODE
-- ============================================================================
-- The same lesson recorded in the UP migration's header applies in reverse. `CREATE POLICY` (no
-- `IF NOT EXISTS` form in PostgreSQL) WILL raise 42710 if the policy already exists, so this
-- file is NOT idempotent by design — a duplicate run aborts the transaction rather than
-- silently doing nothing. That is deliberate: a rollback that cannot tell you whether it applied
-- is worse than one that fails loudly.
--
-- After running, assert the END STATE — count AND names per table:
--
--     SELECT tablename, policyname, cmd, roles, permissive
--       FROM pg_policies
--      WHERE schemaname = 'public'
--        AND tablename IN ('subscription_events','student_daily_usage')
--      ORDER BY tablename, policyname;
--
-- ============================================================================
-- LIMITS OF THIS ROLLBACK
-- ============================================================================
-- 1. IT RESTORES ACCESS RULES, NOT DATA. If a student reset their quota counters through these
--    policies while they existed, dropping and recreating the policy neither restores the
--    consumed counts nor reverses any row written. Rows written stay written.
-- 2. IT MAKES NO PRIVILEGE CHANGE. The UP touched no GRANTs, so neither does this. `anon` and
--    `authenticated` still hold `arwdDxtm` on all four money tables in BOTH environments either
--    way — that is DB-12, out of scope for this pair.
-- 3. IT IS BREAK-GLASS ONLY. Use it only if the UP is found to break a legitimate caller. The
--    legitimate writer of `student_daily_usage` is the SERVICE-ROLE client at
--    `apps/host/src/app/api/foxy/_lib/quota.ts:145`, which bypasses RLS and CANNOT be affected
--    by the UP — so a quota write failing is almost certainly NOT a policy problem. Diagnose
--    before running. The legitimate client path is SELECT-only
--    (`packages/lib/src/usage.ts:217,283`) and its own-row read policy was never dropped.
-- 4. IT ASSUMES BOTH TABLES STILL EXIST AND STILL HAVE RLS ENABLED. It issues no `ALTER TABLE
--    ... ENABLE ROW LEVEL SECURITY`, because the UP disabled nothing.
--
-- Predicates below are the verbatim captured definitions. All three share one predicate:
--
--     student_id IN ( SELECT students.id
--                       FROM students
--                      WHERE (students.auth_user_id = auth.uid()) )
--
-- Note this is an OWN-ROW predicate — and that is exactly why it is NOT a defence. It evaluates
-- TRUE for any logged-in student acting on their own row, which IS the attack: resetting YOUR
-- OWN quota is the exploit. An own-row check only helps when the row is not the thing being
-- abused.
--
-- UP migration:
--   supabase/migrations/20260821121232_converge_money_table_client_write_policies.sql
-- Ledger: docs/audits/FIX-LEDGER.md
-- Related: docs/runbooks/20260820143726_drop_client_write_policies_money_tables.DOWN.sql
--          (the production-side equivalent, 13 policies)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. public.subscription_events — redundant third SELECT policy.
--    READ-ONLY. This is the one statement here that restores no exposure.
--    If you need a partial rollback, run THIS ONE ALONE.
-- ---------------------------------------------------------------------------
CREATE POLICY subscription_events_student_select ON public.subscription_events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (student_id IN ( SELECT students.id
   FROM students
  WHERE (students.auth_user_id = auth.uid())));

-- ---------------------------------------------------------------------------
-- 2. public.student_daily_usage — INSERT.
--    *** RESTORES EXPLOIT #6. *** Permissive, TO public (includes anon and
--    authenticated). Lets a logged-in student create their own quota row.
-- ---------------------------------------------------------------------------
CREATE POLICY student_usage_insert ON public.student_daily_usage
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (student_id IN ( SELECT students.id
   FROM students
  WHERE (students.auth_user_id = auth.uid())));

-- ---------------------------------------------------------------------------
-- 3. public.student_daily_usage — UPDATE.
--    *** RESTORES EXPLOIT #6. *** This is the quota-RESET path specifically.
--
--    Captured with USING and NO WITH CHECK, reproduced exactly as captured.
--    Do not "helpfully" add a WITH CHECK clause: that would be a different
--    policy from the one that existed, and a rollback must restore the state
--    that was, not an improved one. (With no WITH CHECK, PostgreSQL applies the
--    USING expression to the new row as well — the restored behaviour is the
--    captured behaviour.)
-- ---------------------------------------------------------------------------
CREATE POLICY student_usage_update ON public.student_daily_usage
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (student_id IN ( SELECT students.id
   FROM students
  WHERE (students.auth_user_id = auth.uid())));

COMMIT;
