# Runbook — CERT-21: duplicate migration version 20260702150000 repair

**Owner:** architect
**Created:** 2026-07-02
**Severity:** high (schema-reproducibility defect; blocks staging sync + prod migrations job)
**Status:** fix implemented (file rename); convergence steps below

## Summary

Two migration files shared the version prefix `20260702150000`:

- `20260702150000_p3w1_5_quiz_rpc_ownership_check.sql` — the cross-student RPC
  forgery fix (adds `auth.uid()` ownership checks to `submit_quiz_results` and
  both `atomic_quiz_profile_update` overloads).
- `20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql` — backfills 4
  `feature_flags` rows that were only ever seeded under `_legacy/`.

`supabase_migrations.schema_migrations` uses `version` as its primary key, so only
one file could ever be recorded. The fix **renames the flag-seed file** to a
distinct later version:

```
20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql
  ->  20260702151000_p3w2_8_backfill_legacy_only_flag_seeds.sql
```

The ownership-check file **stays at `20260702150000`** — it is the file already
recorded under that version on every deployed environment, so leaving it in place
keeps the recorded history matched and requires **no `migration repair`** in the
normal case.

## Confirmed state at time of fix (read-only diagnosis)

| Environment | version `20260702150000` recorded as | flag-seed (p3w2_8) applied? | 160000/170000/180000/190000 applied? |
|---|---|---|---|
| **staging** (`gzpxqklxwzishrkiaatd`) | `p3w1_5_quiz_rpc_ownership_check` | **no** (23505-blocked) | no |
| **prod** (`shktyoxqhundlvkiwguu`) | `p3w1_5_quiz_rpc_ownership_check` | **no** (23505-blocked) | no |

Evidence:
- Staging sync run **28572403629** (first apply): applied `140000` -> `150000_p3w1_5`
  (recorded) -> `150000_p3w2_8` **failed** with `duplicate key ... schema_migrations_pkey`.
- Staging sync run **28602607892** (later apply): pending list was
  `[p3w2_8, 160000, 170000, 180000, 190000]` — `p3w1_5` was **absent** from pending,
  proving version `20260702150000` is recorded under the `p3w1_5` name (the CLI
  matched the remote version row to the `p3w1_5` local file by name and left
  `p3w2_8` pending).
- Prod `supabase migration list --linked` (read-only): `20260702140000` and
  `20260702150000` show a remote match; the second `20260702150000` local row and
  `160000`/`170000`/`180000`/`190000` show **no** remote match (all pending).

**Security note:** the ownership-check SQL (p3w1_5) IS live on both prod and
staging — the CRITICAL cross-student RPC forgery fix is deployed. Only the
flag-seed backfill and the four migrations after it were blocked.

## Re-apply safety (gating prerequisite for the rename)

The rename makes the flag-seed file **pending on every environment**, so it must be
re-apply-safe. It is:

- **`20260702151000_p3w2_8` (renamed flag seed):** wrapped in a
  `to_regclass('public.feature_flags') IS NOT NULL` guard; all 4 inserts are
  `ON CONFLICT (flag_name) DO NOTHING`. No DDL, pure data seed. Re-applying where
  the rows already exist (prod, and any env an operator has touched) is a
  guaranteed no-op and can never clobber an operator-set value.
- **`20260702150000_p3w1_5` (ownership check, unchanged):** all three functions use
  `CREATE OR REPLACE FUNCTION` with signatures/return types identical to the live
  definitions; `COMMENT ON FUNCTION` and `REVOKE EXECUTE ... FROM anon` are
  idempotent (revoking an already-revoked grant is a no-op). No `CREATE TYPE`, no
  bare `CREATE TABLE`, no `ALTER`, no `DROP`. Safe to re-run (it will only actually
  re-run on a fresh environment; on staging/prod its version is already recorded).

## Convergence steps by environment

### A. Staging (`gzpxqklxwzishrkiaatd`)

No `migration repair` needed. On the next sync the renamed file applies as new:

1. Merge this branch (the rename) to `main`, **or** dispatch the workflow against
   this branch:
   ```
   gh workflow run sync-staging-migrations.yml --ref <branch>
   ```
2. `supabase db push --linked --include-all` will now apply, in order:
   `20260702151000_p3w2_8` (new) -> `160000` -> `170000` -> `180000` -> `190000`.
   Version `20260702150000` is already recorded (p3w1_5) and is skipped.
3. Verify:
   ```
   supabase migration list --linked    # all 6 versions show a remote match
   ```
   and confirm the 4 flags exist:
   ```sql
   SELECT flag_name, is_enabled FROM public.feature_flags
   WHERE flag_name IN ('ff_atomic_subscription_activation','ff_irt_question_selection',
                       'ff_foxy_streaming','ff_rag_mmr_diversity');
   ```

### B. Production (`shktyoxqhundlvkiwguu`) — **do not run manually; goes through `deploy-production.yml`**

Prod is in the same state as staging (version `20260702150000` = p3w1_5 recorded;
p3w2_8 + `160000..190000` pending). On the next `main` deploy the migrations job
runs `supabase db push` and applies the identical pending set with no collision.

Pre-flight verification (read-only, safe) before the deploy lands — confirm the
recorded name under `20260702150000` is the ownership-check file:
```
supabase migration list --linked
```
If (and only if) prod had somehow recorded the **flag-seed** name under
`20260702150000` instead of `p3w1_5` (not observed — sort order guarantees p3w1_5
applied first), the ownership-check SQL would NOT be live on prod and a repair
would be required:
```
# ONLY if 20260702150000 is recorded under the p3w2_8 name (NOT the observed case):
supabase migration repair --status reverted 20260702150000 --linked
supabase db push --linked --include-all   # re-applies p3w1_5 at 150000, then 151000+
```
In the observed case this is unnecessary — do nothing beyond the normal deploy.

### C. Fresh environments (new staging, DR restore, CI live-DB run)

No action. Baseline applies, then the root chain applies in version order:
`...150000_p3w1_5` -> `151000_p3w2_8` -> `160000` -> ... . No collision, both files
run exactly once.

## Why the flag seed was the file renamed (not the ownership check)

1. Version `20260702150000` is **already recorded as `p3w1_5`** on both deployed
   environments. Renaming `p3w1_5` would orphan that recorded version (remote row
   with no matching local file) and could leave the ownership-check SQL considered
   "applied" while the flag seed silently never runs — the worse outcome.
2. The flag seed is trivially idempotent (`ON CONFLICT DO NOTHING`), so making it
   pending-everywhere via the rename is risk-free.
3. The flag seed is the file whose SQL never recorded, so renaming it is precisely
   what causes it to finally apply on staging/prod/fresh envs.

## Rollback of the fix itself

The rename is reversible by moving the file back to `20260702150000_...`, but do
NOT — that reintroduces the collision. If the renamed migration must be undone on a
specific environment, use the manual DOWN in the file header (delete the 4 rows),
after checking current values (an operator may have flipped one on).
