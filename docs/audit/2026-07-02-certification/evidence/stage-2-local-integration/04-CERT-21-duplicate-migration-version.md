# CERT-21 - Duplicate migration version 20260702150000 (schema-reproducibility defect)

2026-07-02. Surfaced trying to sync our branch's migrations to staging (to run the teardown
integration test live). High-value, pre-existing finding - not introduced this session.

> **RESOLUTION (2026-07-02, architect):** the flag-seed file was renamed
> `20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql` ->
> `20260702151000_p3w2_8_backfill_legacy_only_flag_seeds.sql`, breaking the collision. The
> ownership-check file keeps version `20260702150000` (it is the file already recorded under
> that version on both prod and staging — the CRITICAL cross-student RPC forgery fix IS live on
> both). Read-only migration-history checks confirmed version `20260702150000` is recorded as
> `p3w1_5_quiz_rpc_ownership_check`, and that `p3w2_8` + migrations `160000/170000/180000/190000`
> were blocked/unapplied on staging AND prod. Both files are re-apply-safe (flag seed:
> `ON CONFLICT DO NOTHING`; ownership check: `CREATE OR REPLACE` + idempotent REVOKE/COMMENT).
> Convergence + repair steps: `docs/runbooks/2026-07-02-cert21-duplicate-migration-version-repair.md`.
> The rename applies as new on the next push everywhere — no `migration repair` needed in the
> observed state.

## What was found

Two distinct migration files share the exact version prefix 20260702150000:
- 20260702150000_p3w1_5_quiz_rpc_ownership_check.sql (the cross-student RPC forgery fix)
- 20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql (the legacy flag-seed backfill)

Supabase records migrations in supabase_migrations.schema_migrations with `version` as the
primary key. Two files with the same version means only ONE can ever be recorded; the second
collides with:

  ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
  Key (version)=(20260702150000) already exists.

## Evidence it is live and unresolved

- Our dispatched staging migration sync (run 28602607892) failed on exactly this, applying the
  first of five pending migrations.
- The most recent PRIOR staging sync on main (run 28572403629, from a merge of this same branch
  earlier today) ALSO failed - same root cause, independently confirming this is not a
  one-off.

## Why this matters (beyond blocking the cert teardown test)

1. Schema reproducibility: a fresh environment rebuilt from these migrations (new staging, DR
   restore, a CI live-DB run) fails at this version - the platform's own stated schema-repro
   guarantee is broken at this point in the chain.
2. Uncertain prod state: because only one of the two version-20260702150000 files can be
   recorded, it is not certain from migration history alone that BOTH files' SQL actually ran on
   production. Architect verified earlier this session (by reading the FILES) that the RPC
   ownership-check SQL and the flag-seed SQL are each correct, and that the ownership check
   appears present - but "the file is correct" and "the migration applied cleanly and is
   recorded" are different claims, and this collision means one version's recording is
   necessarily absent. This needs a live migration-history check on prod and staging to
   determine which of the two names is recorded under version 20260702150000 and whether the
   other's SQL actually executed.
3. Blocks staging cert: our teardown functions (20260702180000, 20260702190000) sit AFTER the
   collision in the pending list, so they cannot reach staging via the normal sync until the
   collision is resolved.

## Ownership / next step

Architect owns migrations. Routed to architect to: confirm the collision, check what name is
recorded under version 20260702150000 on staging and prod (supabase migration list), determine
whether the un-recorded file's SQL actually applied, rename one file to a distinct version with
verified idempotency (both files' SQL should be re-apply-safe - the flag seed uses ON CONFLICT
DO NOTHING per architect's own Task 3.4 note; the ownership-check migration's re-apply safety
must be confirmed), and lay out the migration-history repair so staging and prod converge
cleanly. This is a real fix to committed migration files, so it goes through the full gate
(architect implements, quality reviews) - it is not a cert-only doc change.

## Impact on the current cert flow

Does NOT block Option B (browser journeys) - those need the seeded accounts (present on
staging), not the teardown functions. DOES block Option A (live teardown validation) until the
collision is resolved and the teardown migrations reach staging. The certification tenant
(4e6979d0) remains intact and is_demo-marked; it can be cleaned up via the manual delete
statements the seed printed even without the teardown functions on staging, if needed.
