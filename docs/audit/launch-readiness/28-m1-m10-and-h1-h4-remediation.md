# M1–M10 investigation, and H1–H4 re-verification — 2026-08-31

This closes out the Medium-severity findings (M1–M10) from the original
5-domain schema review, and independently re-verifies the High-severity
findings (H1–H4) already addressed in
[27-schema-review-remaining-findings.md](27-schema-review-remaining-findings.md).
Every finding below was re-investigated from live production evidence — code
grep, `pg_catalog`/`information_schema` queries, and Supabase logs — rather
than trusted from the earlier one-line summaries, several of which turned out
to be imprecise or stale.

## Fixed and applied to production (`shktyoxqhundlvkiwguu`)

**M1 — unnecessary `authenticated` EXECUTE grant on `reconcile_payment`.**
The function's own logic (two-person rule, row locks, advisory lock,
idempotency) was already sound — the actual gap was a leftover grant from a
2026-05-10 automated grant-restoration sweep that appears to have
false-positived on the string `reconcile_payment` inside a service-role-only
route. The only real caller (`/api/super-admin/reconciliation/[id]/approve`)
uses the service-role client, unaffected by the revoke.
`REVOKE EXECUTE ON FUNCTION public.reconcile_payment(uuid) FROM authenticated;`

**M2 — 8 internal governance tables readable by any signed-in user.** Not the
audit-log tables originally suspected (those are correctly scoped) — the real
leak was a batch of tables from the 2026-08-06 audit-remediation migration
wave (`data_classification` — a PII/sensitivity map — plus
`data_processing_purposes`, `data_quality_check_results`,
`kpi_metric_contracts`, `source_of_truth_registry`,
`table_row_count_baselines`, `restore_drill_log`, `analytics_freshness_log`),
each with an `authenticated`-wide `USING (true)` SELECT policy and zero
legitimate app consumers (verified by repo-wide grep). Dropped all 8 policies;
each table already had its own service-role-only policy, so this just closes
the redundant hole.

**M3 — `foxy_response_cache` had an unscoped public SELECT policy.** Confirmed
dormant (0 rows, zero readers/writers in app code, documented unused since
2026-05-16, superseded by an in-memory/Redis cache) and contains no PII by
schema design — so this was hygiene, not a live leak. Locked to
service-role-only.

**M6 — no GSTIN format validation anywhere.** 6 columns across 5 tables had
zero CHECK constraint. Verified every value in production is currently NULL
(the GST-invoicing feature is pre-launch), so this was unusually safe to close
immediately — added format CHECK constraints to all 6.

**M8 — `super_admin_subject_readiness` view had loose grants.** The real
RLS-bypass bug this finding originally described was already fixed on
2026-05-16 (`security_invoker=on`) — independently re-verified still in
effect. What remained was that `anon`/`authenticated` still held table-level
grants despite the view's name implying super-admin-only intent, with zero
call sites anywhere in the repo. Locked to service-role-only.

**H1 (re-verified, then shipped) — `question_bank.correct_answer_index`
readable by any authenticated user.** The mobile blocker this finding was
previously left open for turned out to be stale: mobile already excludes the
answer-key column (commit `681b8b43`, 2026-08-11, both `useV2` code paths),
and multiple independent signals (frozen app version since 2026-06-06, zero
release tags ever pushed, an unchecked Play Store row, zero authenticated-role
traffic to `question_bank` across four 24h log samples spanning 6+ weeks, 75
total student rows) show no real installed mobile user base exists to break.
Shipped the two-step `REVOKE ALL` + column-level `GRANT SELECT` on a 94-column
allowlist (withholding the 9 answer-key columns), modeled exactly on the
already-proven-safe pattern from `20260814000020` for a sibling table.
Converted `apps/host/src/__tests__/security/question-bank-answer-key-exposure.test.ts`
from a "the hole is open, here's the blocker inventory" canary into a real
static assertion that the ACL exists and holds — 22/22 tests passing.

## Found and could not fix (documented, not silently dropped)

**H4 residual — `supabase_admin` grantor's default-ACL still grants TRUNCATE.**
An independent re-verification pass of the earlier H4/DB-12 fix found the
2026-08-24 recovery migration only restored/narrowed default privileges `FOR
ROLE postgres`; `pg_default_acl` carries a second entry for grantor
`supabase_admin` that was never touched and still grants
`anon`/`authenticated` TRUNCATE on any future table created under that role.
Not currently exploitable — every existing `public` table is owned by
`postgres` — but the "future tables are safe" claim was incomplete. Attempted
to close it (`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` and, when
that failed with `42501 permission denied`, `SET ROLE supabase_admin` first)
— both attempts hit a hard platform boundary: the project-level `postgres`
role is deliberately not a member of `supabase_admin` in Supabase's role
hierarchy, and no SQL mechanism available to this session can cross it.
Closing this needs a Supabase support ticket, not a migration. Documented as
an accepted residual risk.

## Independently re-verified (no gap found)

**H2 — `database.types.ts` regeneration.** A dedicated re-verification agent
confirmed exact 425/425 table coverage against live `pg_tables`, spot-checked
8 tables' columns against `information_schema.columns` (including
nullable-vs-required distinctions), and re-ran `tsc --noEmit` fresh in both
`apps/host` and `packages/lib` — clean. No competing source of truth found.
**VERIFIED.**

## Investigated, correctly deferred (each for a specific, documented reason)

**M4 — `security_request_audit` has no retention policy.** Real and specific:
this is the largest (118k rows / 49MB) and fastest-growing table in the whole
log/audit family, and unlike `audit_logs`/`ops_events`/analytics tables — all
of which already have working retention — it's on none of the three
retention mechanisms this codebase runs. Not applied because a daily job
(`security_rebuild_tenant_ai_usage_from_audit()`, `cron.job` id 29) may depend
on historical rows beyond whatever window gets chosen, and that dependency
wasn't verified. Needs that check, plus a compliance-owner sign-off on the
retention window, before shipping.

**M5 — embedding-backfill cron job (`embedding-backfill-tick`) is disabled and
has never once fired.** 100% of `question_bank` (18,765 rows) has no
embedding — a real, total, ~9-week-old gap, though it only degrades quiz
question *ranking* to random order (no RPC hard-filters on
`embedding IS NULL`, so nothing is actually unservable). Not re-enabled
because the job's dependent secrets (`ADMIN_API_KEY`,
`projector_runner_service_role_key_v2`) couldn't be validated from this
session, and turning it on dispatches real, rate-limited, budgeted requests to
Voyage — needs an operator to confirm both before flipping it on. Separately
flagged: this cron job's function/table/queue infrastructure was set up
directly against production and has no corresponding migration in the repo —
worth capturing as its own follow-up regardless of the re-enable decision.

**M7 — `foxy_pending_expectations` table doesn't exist despite its migration
being recorded as applied in the ledger.** This is worse than typical
"unwired dead code": migration `20260528000013` is marked applied in
`supabase_migrations.schema_migrations`, but `to_regclass()` returns NULL for
the table, and the function/flag it also created are both absent too. App
code (`packages/lib/src/learn/foxy-expectations.ts`,
`apps/host/src/app/api/foxy/route.ts`) is correctly wired and currently
harmless only because the feature flag row is also missing (which fails safe
to "disabled" per `feature-flags.ts`'s own fallback). Not recreated because
the reason it disappeared is unknown — it may have been deliberately dropped
outside migration tooling, and blindly recreating it could reintroduce a
problem someone already fixed. Needs investigation into *why* before any
action; if the answer is "genuine drift," this doubles as a signal to audit
whether other "applied" migrations have similarly vanished objects.

**M10 — `guardian`/`parent` role split-brain.** Confirmed real and
incident-driven (a documented 2026-06-03 bug — `sync_user_roles_on_insert()`
mapped new guardian signups to a role name, `'guardian'`, that didn't
resolve, silently locking every parent out of `/parent/*` until fixed), not
an intentional design. `role_permissions` grants are currently identical
between the two roles, and only **1 of 11** `user_roles` rows belongs to a
real, non-test user — so live impact today is effectively zero. Not touched
this session: the recommended fix (consolidate onto `parent`, the name
already declared canonical in `identity/constants.ts`/`rbac-types.ts`) is
bounded but touches ~15 files across two genuinely different subsystems
(session/route identity, which still hardcodes `'guardian'` throughout
`proxy.ts`/`middleware-helpers.ts`, vs. RBAC permission grants, which already
use `'parent'`) plus DB objects (`get_user_role()` RPC, CHECK constraints).
This is scoped, planned work for a dedicated session, not something to rush
alongside an unrelated migration batch.

**H3 — 50 of 52 orphaned Edge Functions (2 already handled in the prior PR).**
A full investigation (all 50 sources fetched, invocation logs sampled across
4 windows spanning 6+ weeks, mobile code and `cron.job` cross-referenced)
found: **39 are already `410`-tombstoned in production since 2026-07-13** (an
existing ops runbook, `docs/runbooks/edge-function-drift-report.md`, already
did this work — deleting them now just removes an already-inert stub);
**11 more are live-but-real-writer functions with zero invocations and zero
repo/mobile references** (`agent-orchestrator`, `agent-worker`,
`auth-write-skeleton`, `embed-ncert-books`, `embed-rag-remaining`,
`rag-query-v3`, `rag-answer-v3/v4/v5`, `rag-ingest-batch`,
`rag-ingest-status`) — recommended for the same tombstone-then-delete
treatment, not a straight delete, since they were never put through the
30-day observation window the 39 already had; **3 need explicit human
sign-off**: `edge-health-audit` (a genuinely useful, just-unwired self-test
tool), `grade-written-answer` (a fully-built Claude answer-grader that was
never committed to git at all — built via CLI/dashboard directly), and
`export-report` (was repo-tracked, deliberately deleted in PR #1363, and its
one caller now uses `parent-report-generator` instead — recoverable via `git
show` if ever wanted back, not a delete-blind candidate). None deleted this
session — no Edge Function delete credential/tool is available to it (same
gap as the prior PR). `auth-write-skeleton` separately carries an independent
security finding (DB-6: a caller-controlled `audit_logs.action` field) worth
a human's attention regardless of its orphan status.

## Verification

- `tsc --noEmit` clean across `apps/host` and `packages/lib`.
- `eslint` clean on the changed test file.
- 22/22 tests passing on the rewritten
  `question-bank-answer-key-exposure.test.ts` (Lane A converted from
  blocker-inventory to a real ACL-shape assertion + drift guard; Lanes B/C
  unchanged and still passing).
- `rls-inventory.test.ts` and `rls-no-cross-table-recursion.test.ts` (the
  migration-chain-replay static parsers) both pass unmodified — the 8 M2
  policy drops and the M3/M8 grant changes were correctly picked up by their
  existing regex-based tracking.
- `node scripts/lint-migrations.js` — 640 files scanned, 0 failures.
- `node scripts/foxy-alignment/analyze.mjs` — PASS.
- Every applied migration's post-application state was re-queried live
  (column privileges, policy lists, constraint presence) before being
  declared done, not assumed from the migration text.
