-- DOWN migration for: supabase/migrations/20260821082059_restrict_secdef_views_to_service_role.sql
--
-- Restores the table-level privileges on the seven SECURITY DEFINER-behaving views in schema
-- `public` to the exact state captured read-only from production `shktyoxqhundlvkiwguu` on
-- 2026-08-21, before the UP migration removed the `anon` and `authenticated` grants.
--
-- FILENAME / LEDGER NOTE (RESOLVED 2026-08-21): `apply_migration` stamps its own wall-clock
-- ledger version at apply time rather than honouring a file's version prefix. This pair was
-- AUTHORED as 20260821120000; when the UP was applied to production `shktyoxqhundlvkiwguu` on
-- 2026-08-21 the ledger stamped 20260821082059 (name `restrict_secdef_views_to_service_role`).
-- BOTH files were RENAMED TO MATCH THE LEDGER — the ledger was never repaired to match the files
-- — so the filenames and `supabase_migrations.schema_migrations` now AGREE and the pair stays
-- discoverable under one version. The ledger records what actually happened; the authored
-- filename did not.
--
-- NOTE THE SORT DIRECTION: the stamped 20260821082059 sorts BEFORE the authored 20260821120000,
-- so an unreconciled UP file would have read as still unapplied to `supabase db push` and been
-- re-run — harmless, because the UP is idempotent, but a standing false signal. Same
-- reconciliation as 20260821061915_revoke_public_execute_quiz_serving_rpcs.sql.
--
-- ============================================================================
-- *** THIS FILE RESTORES A KNOWN-VULNERABLE STATE ***
-- *** INCLUDING ANONYMOUS INSERT / UPDATE / DELETE ON TWO AUTO-UPDATABLE VIEWS ***
-- ============================================================================
-- Do not run this casually. Read this section in full first.
--
-- The captured ACL on all seven views was BYTE-IDENTICAL:
--
--     {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--      authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- `arwdDxtm` is not SELECT. It is INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN — the complete set, i.e. `GRANT ALL`. Every `GRANT ALL ... TO anon, authenticated`
-- below therefore hands back all eight privileges, not read access.
--
-- All seven views are owned by `postgres` with `security_invoker` UNSET (`reloptions` was NULL),
-- so they resolve as their owner and are RLS-EXEMPT. `postgres` has `rolbypassrls = true`. Two of
-- the seven are auto-updatable (`pg_relation_is_updatable = 28`; no INSTEAD OF triggers, no
-- rules) — `question_bank_student_safe` and `v_my_consent_status` — so restoring their write
-- privileges to `anon` restores an apparent unauthenticated, RLS-bypassing write path. For
-- `question_bank_student_safe` that path reaches the ENTIRE production question bank (its body is
-- `FROM question_bank` with no WHERE; 18,765 rows at capture). That path was NOT tested — testing
-- it would have required DML against production — so its exact reachability is unconfirmed, which
-- is a reason for more caution here, not less.
--
-- Running this file makes seven RLS-bypassing views anonymously readable again, and restores an
-- unverified but plausible anonymous write path into the production question bank.
--
-- ============================================================================
-- WHY THIS FILE IS NOT IN supabase/migrations/
-- ============================================================================
-- `supabase db push` applies EVERY file in `supabase/migrations/` in version order. A
-- down-migration living there would be applied automatically on the next deploy and would
-- SILENTLY RE-OPEN this exposure — with no operator decision, no incident, and no signal that
-- anything had changed. Worse than the read regression: it would silently restore the anon write
-- grants on the two auto-updatable views.
--
-- It therefore lives in `docs/runbooks/` and is NEVER auto-applied. Rolling back is a conscious,
-- hand-run act:
--
--     psql "$DATABASE_URL" -f docs/runbooks/20260821082059_restrict_secdef_views_to_service_role.DOWN.sql
--
-- Do not move this file into `supabase/migrations/`.
--
-- ============================================================================
-- LIMITS OF THIS ROLLBACK
-- ============================================================================
-- 1. IT RESTORES GRANTS, NOT DATA. Everything here is privilege-layer. It does not recreate,
--    alter, or reference any view BODY, any base table, any row-level rule, or any row. If rows
--    were written, deleted, or corrupted through one of these views while the UP migration was in
--    effect, or before it, nothing below replays, reverses, or reconciles them. Rows written stay
--    written; rows deleted stay deleted. Data remediation is separate, explicit work.
-- 2. IT DOES NOT UNDO A BEHAVIOUR CHANGE, BECAUSE THE UP MADE NONE. The UP migration is eight
--    grant statements and no DDL. So if a caller is failing, a privilege restore is the only
--    thing this file can possibly fix — and if the failure is not a privilege failure, this file
--    will not fix it. Diagnose before running.
-- 3. IT IS BREAK-GLASS ONLY. Use it only if the UP migration is found to break a legitimate
--    caller that could not be enumerated beforehand. PREFER THE NARROWER REMEDY: route the broken
--    caller through the service-role client (BYPASSRLS, needs no grant), or grant back exactly
--    the one privilege on the one view that broke. Restoring `GRANT ALL` to `anon` on all seven
--    should be the last option, not the first — and if only one view broke, edit this file down
--    to that one statement before running it.
-- 4. IT ASSUMES ALL SEVEN VIEWS STILL EXIST UNDER THESE EXACT NAMES. If any has since been
--    dropped or renamed, the corresponding statement will FAIL. That is intentional: a privilege
--    statement that cannot resolve its target must raise, not be silently skipped.
--
-- ============================================================================
-- WHY THESE SEVEN LINES ARE THE EXACT INVERSE — AND WHY THERE ARE ONLY SEVEN
-- ============================================================================
-- The UP migration removes privileges from exactly three grantees — `PUBLIC`, `anon`,
-- `authenticated` — and adds one grant (`SELECT` on `v_backup_health_summary` to
-- `service_role`, which was already held). It does not touch `postgres` and does not reduce
-- `service_role`. The inverse of that is therefore only: give `anon` and `authenticated` their
-- captured privileges back.
--
--   * `GRANT ALL` on a view in PostgreSQL 17 is precisely `arwdDxtm` — the same eight privileges
--     the capture showed. So `GRANT ALL ... TO anon, authenticated` reproduces the captured ACL
--     entries exactly: no more, no less. No privilege has to be enumerated by hand.
--   * THERE IS NO `REVOKE ... FROM postgres` BELOW, AND THAT IS DELIBERATE. `postgres` is the
--     OWNER and the UP never revoked from it. Emitting a revoke here would UNDER-RESTORE — it
--     would leave the database in a state that never existed.
--   * THERE IS NO STATEMENT TOUCHING `service_role` BEYOND WHAT THE UP CHANGED. The UP's single
--     `GRANT SELECT ... TO service_role` was a no-op re-assertion of an existing privilege
--     (`service_role=arwdDxtm` was in the capture), written for self-sufficiency on a fresh
--     environment. Revoking it here would break the one real application reader of
--     `v_backup_health_summary` (`packages/lib/src/data-platform.ts` →
--     `/api/super-admin/governance/health`), which is a service-role caller. It is left alone.
--   * THERE IS NO `ALTER VIEW ... RESET (security_invoker)` BELOW. `reloptions` was NULL at
--     capture and the UP does not set it. A RESET here would be out of scope for this rollback
--     and would imply the UP had changed something it did not.
--   * THERE IS NO `REVOKE ... FROM PUBLIC` BELOW. No PUBLIC entry existed at capture
--     (`aclexplode` returned zero `grantee = 0` rows across all 224 ACL entries), and the UP's
--     `FROM PUBLIC` clause was defence-in-depth against a state that did not exist. There is
--     nothing to restore.
--
-- ============================================================================
-- WHAT IS NOT TOUCHED
-- ============================================================================
-- No view body. No base table. No row-level rule. No row. No `reloptions`. No `pg_default_acl`
-- entry. No object outside the seven named below.
--
-- UP migration: supabase/migrations/20260821082059_restrict_secdef_views_to_service_role.sql
-- Ledger:       docs/audits/FIX-LEDGER.md  (DB-1)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. question_bank_student_safe (18,765 rows at capture)
--    THIS IS THE MOST DANGEROUS LINE IN THE FILE. The view is auto-updatable
--    and its body is `FROM question_bank` with no WHERE, resolving as owner
--    `postgres` (rolbypassrls). Restoring ALL to `anon` restores an apparent
--    unauthenticated INSERT/UPDATE/DELETE path into the whole question bank.
-- ---------------------------------------------------------------------------
GRANT ALL ON public.question_bank_student_safe   TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. v_analytics_freshness_status (0 rows at capture)
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_analytics_freshness_status TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. v_backup_health_summary (1 row at capture) — discloses backup posture.
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_backup_health_summary      TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_my_consent_status (0 rows at capture)
--    Also auto-updatable. Its read side is bounded by an `auth.uid()` qual
--    against an empty table, but the write grant is not bounded by that.
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_my_consent_status          TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. v_queue_health (1 row at capture)
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_queue_health               TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. v_secret_rotation_health (1 row at capture) — discloses total_secrets = 7.
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_secret_rotation_health     TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. v_xp_ledger_drift (14 rows at capture) — 14 live student UUIDs with real
--    XP balances (max 12,825). This is the read leak that was verified
--    behaviourally under `SET LOCAL ROLE anon`.
-- ---------------------------------------------------------------------------
GRANT ALL ON public.v_xp_ledger_drift            TO anon, authenticated;

COMMIT;
