# Migration and rollback plan (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Scope:** how we safely change the Alfanumrik database + code in a
live production environment — and how we undo each class of change
when it goes wrong. Concrete recipes, not abstract principles.

## Why a plan?

The abandoned `feat/performance-score-system` branch demonstrated
every mistake we want to avoid:

- a single 229-file commit bundling schema, auth, payment, and docs
- an irreversible `ALTER TABLE ... SET SCHEMA` with no copy-verify
  phase
- a critical hotfix (`20260423151533_fix_identity_bootstrap...sql`)
  that was never committed
- a rogue out-of-order migration (`20260322000000_core_schema.sql`)
  that would have recreated empty `public.students` shells if deployed

This document is a reaction. Every Phase 0 branch adheres to these
patterns; any future extraction obeys them or is rejected.

## Migration hygiene

### Naming and ordering

- Filename format: `YYYYMMDDHHMMSS_short_description.sql` — 14
  digits + underscore + description.
- **Never modify an already-applied migration file.** If you need to
  change behaviour, write a new migration. The abandoned branch
  violated this by editing
  [`supabase/migrations/20260414120000_payment_subscribe_atomic_fix.sql`](../../supabase/migrations/20260414120000_payment_subscribe_atomic_fix.sql);
  the fix is re-landed here as
  [`20260424120000_atomic_subscription_activation_rpc.sql`](../../supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql)
  instead.
- **Timestamps must be monotonic.** If you generate a migration with
  a past timestamp (which Supabase CLI will do if your clock is off)
  and the timestamp lands before an already-applied migration,
  reject and regenerate. Supabase does not accept out-of-order
  application on a production DB.

### Idempotency

Every migration in this repo should be safe to run against a
partially-applied DB. Patterns:

- `CREATE TABLE IF NOT EXISTS` — for new tables
- `CREATE INDEX IF NOT EXISTS` — for new indices
- `CREATE OR REPLACE FUNCTION` — for RPCs
- `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  — for policies (Postgres has no `CREATE POLICY IF NOT EXISTS`)
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — for column adds
- `ALTER TABLE ... DROP COLUMN IF EXISTS` — for removals (but see
  "Destructive changes" below)

**Exception:** `ALTER TABLE ... SET SCHEMA` is NOT idempotent and has
no `IF NOT EXISTS` form. Any proposal to use it must ship with an
explicit rollback migration AND a coordinated SECDEF-function rewrite
(R9 / R10).

### RLS by default

Every new table must:

1. `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;` in the same
   migration that creates it
2. At least one explicit policy — usually `<name>_service_role` for
   server-side access, plus owner-based policies for authenticated
   users
3. Never grant `SELECT` to `anon` on user data

The pre-commit hook
[`.claude/hooks/post-edit-check.sh`](../../.claude/hooks/post-edit-check.sh)
checks for missing RLS when a new table is introduced.

### Triggers / implicit cascades

- Any `CREATE TRIGGER` that writes to a table outside its own
  context must be catalogued in
  [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md) under
  "implicit writers" (risk R8)
- Prefer explicit RPC calls over triggers wherever feasible
- Triggers that cascade across > 2 tables require architect review

## Destructive changes — user approval required

Per `.claude/CLAUDE.md` invariants P8 and the approval matrix, the
following require **explicit user approval** before a migration
lands:

| Change | Why approval |
|---|---|
| `DROP TABLE` | Data loss |
| `DROP COLUMN` (except reversible add-remove-add same type) | Data loss |
| `DROP FUNCTION` that has callers in application code | Behaviour change |
| `DROP POLICY` without replacement | RLS gap |
| `DROP INDEX` on a table > 1 M rows | Performance cliff |
| `ALTER TABLE ... SET SCHEMA` | See R9 / R10 blast radius |
| `ALTER TYPE` that narrows a value set | Data incompatibility |
| Changing primary key, unique constraint | Integrity change |
| Removing FK | Referential integrity change |
| `ALTER TABLE ... ALTER COLUMN ... TYPE` that changes storage width or collation | Silent full-table rewrite on large tables; long lock |
| `ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT` when existing code still writes | Breaks inserts mid-deploy |
| `REVOKE` on `public` schema grants used by `anon` or `authenticated` | Role-level auth break |
| `ALTER TABLE ... DISABLE TRIGGER` | Silent behaviour change (not DDL in feel, but is) |
| `DROP EXTENSION` (esp. `pgvector`, `pg_cron`, `pg_stat_statements`) | Cascading loss of RAG, schedules, observability |

A migration that includes any of the above must link to the user
approval message in its preamble comment and have a matching
rollback migration in the same PR.

The `.claude/hooks/bash-guard.sh` hook refuses to land `DROP TABLE`
or `DROP COLUMN` without these markers; `.claude/hooks/post-edit-check.sh`
warns on same.

## Rollback migrations

For any migration that is (a) destructive or (b) hard to reverse by
just writing a follow-up (e.g. schema move), ship a rollback
migration in the same PR. Name convention:
`YYYYMMDDHHMMSS_rollback_<original_description>.sql`.

The abandoned branch had a correctly-structured rollback migration
for its identity extraction, even though the extraction itself was
unsafe. That rollback file (`20260423151532_rollback_identity_service_extraction.sql`)
does NOT exist on this branch — it was dropped along with the
forward extraction in Option C — but it is preserved at git tag
`quarantine/feat-performance-score-system-pre-option-c-20260424`
and can be recovered with:
```
git show quarantine/feat-performance-score-system-pre-option-c-20260424:supabase/migrations/20260423151532_rollback_identity_service_extraction.sql
```
The pattern it exemplified — reverse-dependency-order `SET SCHEMA`,
explicit FK re-create, policy re-create — is the template for any
future schema-move rollback.

The rollback migration is NOT applied automatically. It sits ready.
When a rollback is needed, an operator applies it via Supabase
Dashboard or `psql`.

## Deploy procedure (Supabase)

Today's reality:

- Application code deploys to Vercel on push to `main`
- Schema migrations apply manually via `supabase db push` or the
  Supabase Dashboard SQL Editor
- The CLI frequently desyncs against remote state (the abandoned
  branch documented "CLI sync issues" at length)

Recommended operator procedure per migration:

1. **Preflight on staging** — apply migration to a staging clone
   of production data; run `npm test`, `npm run test:e2e`, and a
   manual smoke test of the three onboarding roles (student,
   teacher, parent)
2. **Apply to prod** during the lowest-traffic window (India time:
   02:00-05:00 IST)
3. **Postflight verification** — run `node scripts/verify-*.js`
   scripts if one exists for the change; otherwise hand-verify
   known call paths
4. **Code deploy** — only after DB migration is verified. Vercel
   deploy is the trigger.

For Phase 0 modularization branches, most migrations are
`CREATE OR REPLACE FUNCTION` or `CREATE TABLE IF NOT EXISTS` — safe
to apply during any window.

## Code + schema coupling

Rule of thumb: **code and schema must be deployable in either
order for at least one release cycle.**

Concretely:

- When adding a column: ship the column in migration N, start using
  it in code release N+1. Never same release.
- When removing a column: stop using it in code release N, drop in
  migration N+1. Never same release.
- When renaming a column: add new column in N, dual-write in N+1,
  backfill + read from new in N+2, stop writing old in N+3, drop
  old in N+4. Yes, four releases. Renames are expensive.
- RPC signature changes: the new signature must coexist with the
  old one for at least one release; never change an RPC's parameter
  list in-place.

The abandoned branch violated the "coexistence" rule by shipping the
identity extraction and changing the app code in the same commit,
with no release-cycle spread.

## Code rollback procedures

### Branch level (unpushed)

For any unpushed branch including the current
`feat/stabilization-phase-0`:

```bash
git branch -D <branch>           # remove the local branch
git tag -d <quarantine-tag>      # if you tagged for preservation
```

No remote cleanup needed.

### Commit level (pushed but not merged)

```bash
git push origin :refs/heads/<branch>   # delete remote branch
```

Or, leave the branch and open a new branch off `main` for a fresh
start.

### Commit level (merged, post-merge revert)

```bash
git revert <sha>                  # safe: creates a new commit
git push origin main              # CI re-deploys the reverted state
```

For merge commits:

```bash
git revert -m 1 <merge-sha>       # revert the merge, keeping -m parent 1
```

### Full-branch revert on `main`

If an entire PR is bad after merge:

```bash
git revert -m 1 <merge-sha>
```

This is always cleaner than `git reset --hard` on a shared branch.

### Application-layer feature flag

Every Phase 0 change should be wrapped in a feature flag from
[`supabase/migrations/20260418100800_feature_flags.sql`](../../supabase/migrations/20260418100800_feature_flags.sql)'s
table-backed registry:

- `ff_domain_events_enabled`
- `ff_atomic_subscription_activation`
- `ff_grounded_ai_foxy` (already exists)
- `ff_domain_module_enforcement` (proposed for Phase 0a)

Flipping a flag to false is a 1-second rollback that requires no
deploy. This is the preferred rollback path for behaviour changes.

## Database rollback procedures

### Rollback of an idempotent additive migration

Usually not needed. `CREATE TABLE IF NOT EXISTS` + no code using the
table = no harm. Delete the table later if truly unwanted:

```sql
DROP TABLE IF EXISTS public.<name> CASCADE;
```

### Rollback of a function change

```sql
-- Restore the previous definition from git history:
CREATE OR REPLACE FUNCTION ... (as of the prior commit)
```

### Rollback of a destructive migration

Apply the paired rollback migration (see
[`supabase/migrations/20260423151532_rollback_identity_service_extraction.sql`](../../supabase/migrations/)
for the canonical example). The rollback migration must be written
at the same time as the forward migration — never retroactively.

### Rollback of data corruption

1. Identify the window via `pg_stat_statements` + app logs
2. Point-in-time restore in Supabase Dashboard (retention: current
   plan-specific — check before assuming)
3. Or selective restore via a staging snapshot + `\COPY` of affected
   tables

## Specific rollback patterns per change class

### Schema move (e.g. `ALTER TABLE ... SET SCHEMA`)

- **Forward migration:** `ALTER TABLE public.<x> SET SCHEMA <new>;`
  + recreate every FK + RLS policy pointing to the new location +
  `ALTER FUNCTION` for every SECDEF that touches the table
- **Rollback migration:** reverse every step

**We are not doing any schema moves in Phase 0.**

### New table + RLS

- **Forward:** `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL
  SECURITY` + policies
- **Rollback:** `DROP TABLE IF EXISTS ... CASCADE`
- Safe if no data was written; if data was written, add a data
  export step before drop

### New RPC

- **Forward:** `CREATE OR REPLACE FUNCTION` (idempotent)
- **Rollback:** `DROP FUNCTION IF EXISTS public.<name>(<signature>);`
  ONLY if no callers. Otherwise recreate previous definition.

### FK addition

- **Forward:** `ALTER TABLE ... ADD CONSTRAINT <fk_name> FOREIGN KEY`
  wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL END $$`
- **Rollback:** `ALTER TABLE ... DROP CONSTRAINT IF EXISTS <fk_name>;`

### Policy addition

- **Forward:** `DO $$ BEGIN CREATE POLICY ... EXCEPTION WHEN
  duplicate_object THEN NULL; END $$;`
- **Rollback:** `DROP POLICY IF EXISTS ... ON <table>;`

### Dual-write period for refactors

When refactoring how data is written (e.g. moving from direct write
to domain-module-mediated write):

1. Release N: add new code path behind flag, keep old path
2. Release N+1: flip flag to true; read from new, write to both
3. Release N+2: verify parity; remove old write
4. Release N+3: remove old read path + feature flag

The abandoned branch's `data-migration.ts` drift-detection helper
tried to compress this into a single deploy via dual-write; that is
the right idea but only after the new path is proven in a prior
release.

## Incident response

When a migration causes user-visible breakage:

1. **Flip feature flag** if one gates the code path (≤ 1 minute)
2. **Revert code** via `git revert` + push (≤ 5 minutes)
3. **Apply rollback migration** if the schema change itself is bad
   (5-30 minutes via Supabase Dashboard)
4. **Communicate** via status page + team channel

RTO targets (realistic for one-engineer ops):
- Code revert: < 10 min
- Flag flip: < 2 min
- DB rollback: < 60 min

RPO: Supabase PITR retention varies by plan. Data loss window is
capped at that retention — usually 7 days today.

## Migration review checklist

Every PR adding a migration must affirmatively answer:

- [ ] Filename timestamp is monotonic (> latest applied)
- [ ] RLS enabled on every new table
- [ ] All SECDEF functions that touch identity / billing tables
      use appropriate `SET search_path`
- [ ] Additive operations use `IF NOT EXISTS` / `CREATE OR REPLACE`
- [ ] Destructive operations (`DROP`, `ALTER ... SET SCHEMA`,
      constraint changes) have user approval + paired rollback
- [ ] No edits to previously-applied migrations
- [ ] Application code is release-decoupled (can deploy without the
      migration, or migration can apply without new code)
- [ ] Preamble comment names the change, cites the source (branch,
      discussion, commit), and — for destructive changes — links
      the approval

This checklist should be a PR template comment for any migration PR.

## Relation to the brief

Brief section 14 required a phased implementation strategy.
This document is the concrete form. It is stricter than the brief
asked — because the abandoned branch showed that the default
cautions are necessary.

| Brief expectation | This plan's commitment |
|---|---|
| Add missing tests around critical flows | Phase 0 branches include P14 chain testing |
| Add logging/tracing | Every module emits structured logs; outbox gives event-level observability |
| Feature flags / kill switches | Every Phase 0 behaviour change is flag-gated |
| Rollback plans for each extraction | Per-class recipes above; paired rollback migrations mandatory |
| Contract tests between modules | Phase 0 introduces type-level contracts in `src/lib/domains/*/types.ts` |
| Observability for critical services | Outbox lag + sentry + super-admin dashboards extant; add per-module metrics |
