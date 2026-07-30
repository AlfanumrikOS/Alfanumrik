# DSA Review — Tracked Follow-Ups (2026-07-29)

**Source:** the data-structures/algorithms review PR (nightly leaderboard
recalculation ported to a set-based RPC, 6-arg quiz XP ledger write fix,
performance-score RPC, `audit_logs` index).

**Status of this document:** these items were identified during ops Gate 5
review of that PR and were **deliberately NOT implemented in it**. They are
recorded here so they survive the PR. Nothing below is done. Each item names the
owning agent; none is authorised to ship by this document alone.

**Also shipped in this PR (docs half, for context — not follow-ups):**

- `docs/runbooks/SRE_RUNBOOK.md` §9 "Leaderboard Enable" corrected. It claimed a
  manual operator `UPDATE` at "≥50 students with mastery data"; the system has
  been auto-enabling both flags nightly at `>= 2` ranked students with no
  operator in the loop. A runbook that instructs an operator to do something the
  system already does, at a threshold 25× off, is a docs-contradicts-reality
  defect.
- `docs/runbooks/feature-flag-governance.md` now registers `daily-cron` as the
  one sanctioned automated `feature_flags` mutator, so the canary-response
  procedure stops sending on-call after a known-benign write.

---

## F3 — `leaderboard_snapshots` has no application reader (**decision needed**)

**Owner:** ops (call) → architect + backend (execution). **Priority: highest of
these five** — it is the only one that questions whether a whole nightly job
should exist.

### What was verified

| Claim | Evidence |
|---|---|
| No application code reads `leaderboard_snapshots` | Repo-wide search over `apps/`, `packages/`, `supabase/functions/`, `mobile/` returns only: the generated `database.types.ts` entry, an RLS-policy-name assertion in `rls-no-cross-table-recursion.test.ts`, this PR's own contract test, and the writer itself. **Zero readers.** |
| The student-facing leaderboard does not use it | `apps/host/src/app/api/v1/leaderboard/route.ts:42` calls the `get_leaderboard` RPC, which computes live from `students ⋈ daily_activity`. It never touches the snapshots table. |
| `leaderboard_global` is seeded nowhere in the repo | Only textual mentions are comments in this PR's migration `20260729130100` and its test. No `INSERT`/seed anywhere under `supabase/migrations/`. |
| `wave1_leaderboard` is seeded only under `_legacy/` | `supabase/migrations/_legacy/timestamped/20260408000018_p5_wave_rollout_feature_flags.sql`. `supabase db push` only applies files at the immediate `supabase/migrations/` root, so `_legacy/` is skipped on every deploy. |

### Why this matters

This PR's leaderboard fix is real and correct — the old JS path silently
truncated at PostgREST's 1000-row cap and mis-ranked everyone past it. But it
makes a **write-only table correct**. Nightly compute is being spent producing
rows nothing reads, gated by flags that no deployable migration creates.

### The decision (pick one; do not leave it open)

- **(a) Wire it up.** Point `/api/v1/leaderboard` at `leaderboard_snapshots`.
  This is the reason the nightly job exists, and it also retires the
  `O(S log S)` full-population aggregate-and-sort that the DSA audit found
  `get_leaderboard` performing **on every cache miss** — replacing it with an
  indexed read of pre-computed ranks. Costs: ranks become up-to-24h stale (a
  product call — leaderboards arguably *should* be daily-settled, but the user
  must agree), and the snapshot table needs the read path's RLS verified.
- **(b) Retire it.** Delete the `leaderboard_entries` cron step and both flags.
  Cheapest, and honest about what is actually in use. Costs: the live-compute
  hot path stays, so (a)'s performance win is forgone.

**Do not choose (c) "leave as is."** As-is, the platform pays for a nightly job,
carries an unaudited flag mutator (F4) to serve it, and gets nothing.

**Blocked on:** ops+architect recommendation, then user sign-off — (a) changes
what students see (freshness), (b) removes a feature surface.

---

## F4 — the nightly flag flip is an unaudited service_role mutation

**Owner:** ops (spec) + backend (implementation).

`recalculateLeaderboards()` in `supabase/functions/daily-cron/index.ts` issues a
bare `.from('feature_flags').update({ is_enabled: true })` as `service_role`,
writing no `admin_audit_log` and no `audit_logs` row. The flag-governance model
assumes every mutation is audited (console/RPC) or marked (migration); this is
the sole exception.

**Do:** route it through `admin_flip_feature_flag`, or emit an `audit_logs` row
alongside it, so the governance model has zero unexplained mutators rather than
one documented one.

**Interim mitigation (shipped, not a fix):** the exception is now written down in
`docs/runbooks/feature-flag-governance.md` so on-call does not escalate it.

**Note the ordering dependency:** if F3 resolves as **(b) retire**, F4 disappears
with it. Do not implement F4 before F3 is decided.

---

## F1 — extend REG-282's scanned call-site set to include `daily-cron`

**Owner:** testing.

REG-282 (`feature-flags-app-code-column-contract.test.ts`, catalogued in
`.claude/regression/10-rbac-rls.md`) is a static-source canary asserting that
every column used against `feature_flags` in application code is a member of the
known live column set. It exists because a nonexistent-column selection
(`target_plans`) once nulled the flags query and turned **every flag OFF for
every user**.

It currently scans **three** call sites:
`apps/host/src/app/api/internal/admin/feature-flags/route.ts`,
`supabase/functions/identity/index.ts`, and
`apps/host/src/app/api/super-admin/feature-flags/route.ts`.

`supabase/functions/daily-cron/index.ts` is a **fourth** `feature_flags` call
site (it writes `flag_name`, `is_enabled`, `updated_at`) and is not scanned —
exactly the gap REG-282 exists to close. Add it to the scanned set.

**Ordering:** if F4 lands first, the call site changes shape (RPC instead of a
direct column write) — coordinate, or do F1 first since it is cheap and
independent.

---

## F2 — admin audit-log pagination: estimated count + keyset

**Owner:** backend. **Ops call already made:** the unfiltered default view does
**NOT** require an exact total row count. Approximate is fine there.

`apps/host/src/app/api/super-admin/logs/route.ts:28-35` requests
`Prefer: count=exact` and paginates with `offset`/`limit` over
`order=created_at.desc` against `admin_audit_log` — the hottest audit table.
Both halves degrade as the table grows:

- `count=exact` forces a full count on every page request, including the
  unfiltered default view where nobody reads the number.
- `offset` pagination makes page *N* cost proportional to *N* (the DB walks and
  discards every skipped row).

**Do:** switch the unfiltered path to `count=estimated`, and move pagination to
keyset on `(created_at, id)` — `id` is required as the tie-break, since
`created_at` is not unique and offset-free pagination on a non-unique sort key
silently skips or duplicates rows.

**Keep exact counts** where a filter is applied and the operator is genuinely
counting matches (e.g. "how many `feature_flag.*` actions last week").

---

## F5 — `admin_audit_log` carries two duplicate `created_at DESC` indexes

**Owner:** architect (index/schema domain).

`supabase/migrations/00000000000000_baseline_from_prod.sql` creates both:

```sql
CREATE INDEX "idx_admin_audit_created"     ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);  -- line 16484
CREATE INDEX "idx_admin_audit_log_created" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);  -- line 16493
```

These are byte-identical in definition. Two identical btrees on the hottest
audit table means every insert maintains both — pure write amplification, with
no read benefit, on an append-heavy table. (A third index,
`idx_admin_audit_log_admin_created` on `(admin_id, created_at DESC)`, is
distinct and should stay.)

**Do:** drop one. Verify against production `pg_stat_user_indexes` /
`pg_index` first — the two names come from different eras (one traces to
`_legacy/timestamped/20260328070000_scale_readiness.sql`) and the baseline is a
prod dump, so confirm both actually exist live before writing the migration, and
drop the one with zero scans.

**Requires:** this is a `DROP INDEX`, not a `DROP TABLE`/`DROP COLUMN`, so it is
not in the constitution's user-approval set — but it touches the audit table's
write path, so architect reviews and testing confirms no query plan regresses.

---

## Summary

| ID | Item | Owner | Blocked on |
|---|---|---|---|
| F3 | `leaderboard_snapshots` has no reader — wire it up or retire it | ops → architect + backend | product decision (user sign-off) |
| F4 | Audit the nightly flag flip | ops + backend | F3 decision |
| F1 | Add `daily-cron` to REG-282's scanned set | testing | none (do it) |
| F2 | `count=estimated` + keyset pagination on admin logs | backend | none (ops call made) |
| F5 | Drop one duplicate `created_at DESC` index | architect | prod index-usage check |
