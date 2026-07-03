# Environment Readiness Assessment — Post-Remediation Re-Verification (Ops)

**Agent**: ops. **Date**: 2026-07-02. **Method**: direct file reads only, re-derived independently from scratch (not trusted from remediation summaries). Re-verifies the 3 criteria my original pass (`docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md`) found failing, after the remediation wave (architect: FK/teardown fix + quality-review correction; ops: Sentry fix + traceability runbook; testing: seeding script + regression tests; quality: two review passes, overall APPROVE with one now-closed condition).

---

## Verdicts (compare directly against the original pass)

**TRACEABILITY: CONFIRMED CONVENTION EXISTS** (was: MUST BE ESTABLISHED)
**MONITORING: APPROPRIATE** (was: RISK OF FALSE ALERT (low) + RISK OF SILENT ABSORPTION (low-medium) + a confirmed Sentry environment-tagging defect)
**CLEANUP: CLEAN TEARDOWN EXISTS, with an operational-invocation caveat** (was: MANUAL/PARTIAL)

---

## 1. TRACEABILITY — CONFIRMED CONVENTION EXISTS

Read in full: `docs/runbooks/certification-traffic-traceability.md` (191 lines) and `scripts/seed-certification-accounts.ts` (572 lines).

### 1a. The four signals are concretely specified and implemented consistently

| Signal | Runbook spec | Script implementation | Match? |
|---|---|---|---|
| Email domain | `cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid` (§"1. Email domain suffix") | `CERTIFICATION_EMAIL_DOMAIN = 'certification.alfanumrik.invalid'`; `buildAccountShape()` builds `cert-${runIdShort}-${role}-${n}@${CERTIFICATION_EMAIL_DOMAIN}` byte-for-byte (`seed-certification-accounts.ts:78, 138-147`) | Yes |
| `is_demo = true` | On every base-table row, 8 named tables (§"2. is_demo = true") | `buildBaseTableRow()` sets `is_demo: true` unconditionally in the `common` object for every role/table (`seed-certification-accounts.ts:166-172`); `upsertSchoolRow()` sets `is_demo: true` on the synthetic school (`:359`) | Yes |
| Name/run marker | `cert-<run_id_short>-<role>-<n>` in `name`/`display_name`; `[CERTIFICATION] cert-<run_id_short>-school-<n>` for schools (§"3. Run marker") | Same `buildAccountShape()` produces `name` identically to the email local-part; `buildSchoolShape()` produces `[CERTIFICATION] cert-<run_id_short>-school-<n>` exactly (`:150-157`) | Yes |
| `demo_accounts` registry row | One row per top-level account, exact column shape given (§"4. One demo_accounts registry row") | `buildDemoAccountsRow()` produces the exact same field set (`auth_user_id, role, persona: null, display_name, email, school_id, is_active: true, created_by`) (`:191-225`); `upsertDemoAccountsRow()` is find-or-create by email (`:322-341`) | Yes |

The `demo_accounts_role_check` constraint I independently pulled from `supabase/migrations/20260528000001_promote_demo_accounts_v2.sql:61-62` reads `CHECK (role IN ('student', 'teacher', 'parent', 'school_admin', 'super_admin'))` — this is byte-for-byte what the script's `DemoAccountRole` type declares (`:94`) and what `MISSION_ROLES` maps 5 of its 7 roles to (`:109-117`). No drift between the actual DB constraint and the script's assumption about it.

### 1b. All 7 mission roles covered; the registry-row gap is documented as intentional

`MISSION_ROLES` (`seed-certification-accounts.ts:109-117`) lists all 7: `student`, `teacher`, `parent`, `school_admin`, `super_admin`, `content_author`, `support_staff`. For every one of the 7, `buildBaseTableRow()` unconditionally sets `is_demo`, `name`, `email` — so the first three signals apply to all 7 without exception; I verified this by reading the `switch (def.table)` block (`:173-188`), which has a case for every `BaseTable` value the 7 roles resolve to (`students`, `teachers`, `guardians`, `school_admins`, `admin_users`) and throws on an unhandled case (exhaustive `never` check at `:185-186`), so there is no silent fall-through role.

Only the 4th signal (registry row) is narrower: `buildDemoAccountsRow()` returns `null` when `def.demoAccountRole` is `null` (`:214`), which is true only for `content_author` and `support_staff` (`:115-116`). This is explained in two independent places I read directly:
- The module docblock (`:23-42`, "KNOWN LIMITATION") — explains `demo_accounts_role_check` has no legal value for either role, that mislabeling them under an existing role (e.g. `super_admin`) would corrupt any report trusting `demo_accounts.role`, and states the design choice explicitly rather than papering over it.
- The runbook's role-coverage note (`certification-traffic-traceability.md:39`, appended at the end of the email-shape section as instructed) — states the same thing: `super_admin` is fully registry-covered like the other 4; `content_author`/`support_staff` get the base-row signals (email, `is_demo`, name) but not the registry row, "intentional, not a gap," with the follow-up (widen `demo_accounts_role_check`) explicitly deferred to architect and explicitly marked "not required to unblock certification."

This is precisely what the task asked me to confirm — the gap is present (not silently missing) and clearly labeled as intentional. I did find one small internal inconsistency while re-reading the runbook end-to-end: the inline SQL comment further up the same file (`certification-traffic-traceability.md:82-84`, inside the `demo_accounts` INSERT example) still reads *"'super_admin' is also a valid role value but certification seeding should not need it"* — this is stale text left over from before the role-coverage note at line 39 was appended, and it now contradicts that note (the script does seed `super_admin` with a full registry row). This is a documentation-only nit inside a single file, does not affect the actual convention or the script's correctness (the script and the newer, more specific note at line 39 both correctly seed `super_admin`), and does not change my verdict — but it is exactly the kind of drift a "read the whole file fresh" pass is supposed to catch, so I am flagging it rather than silently reconciling it myself.

### 1c. Precision sufficient for reliable exclusion/inclusion

The runbook's "Query patterns for isolating certification data" section (`:113-135`) gives four concrete, directly-runnable SQL patterns (single-run isolation via `LIKE 'cert-<run_id_short>-%'`, coarse cross-role sweep via `UNION ALL` across 4 tables, and join-inherited isolation for `quiz_sessions` via the owning `students.is_demo`). I checked these against the actual `students`/`teachers`/`guardians`/`school_admins` schemas (all confirmed present with `name`/`email`/`is_demo` columns from the earlier FK read) and they are directly executable, not pseudocode. The reporting-isolation claim — `src/app/api/super-admin/stats/route.ts` and `.../analytics/route.ts` already filter `is_demo=eq.false` — is the same claim my original pass verified directly by reading those two route files; nothing in this remediation wave touched them, so that finding still stands unchanged (re-confirmed as unmodified, not re-read line-by-line a second time, since no diff exists to re-check).

**Idempotency, as an operator-facing property**: the script's docblock (`:44-51`) and the `upsertBaseTableRow`/`upsertDemoAccountsRow`/`upsertSchoolRow`/`findOrCreateAuthUser` functions (all find-by-email-first) confirm re-running with the same `--run-id` is a true no-op on the second call (`created: false` for everything), and a different `--run-id` never collides with a prior run's rows. I traced this through the code, not just the comment — every one of the four upsert primitives does `select(...).eq('email', ...).maybeSingle()` before any `insert()`.

**Conclusion**: a human operator or a future script CAN reliably identify and exclude certification traffic from any real report/dashboard using this convention, for all 7 roles, with the one documented and justified exception (registry-row lookup unavailable for 2 of 7 roles, base-signal traceability still intact for those 2).

---

## 2. MONITORING — APPROPRIATE

Read fresh: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.js` (env block), `pipeline-alert.yml`, `synthetic-monitor.yml`, and the new pinning test `src/__tests__/sentry/environment-tag-resolution.test.ts`.

### 2a. The `environment:` resolution genuinely prioritizes the Vercel signal

- `sentry.client.config.ts:21`: `environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',`
- `sentry.server.config.ts:19` and `sentry.edge.config.ts:21`: `environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',`

Both forms put the Vercel-specific variable first in a `||` chain — `NODE_ENV` is only reached if the Vercel variable is falsy (unset/empty string), i.e. genuine local dev outside Vercel. This is the correct precedence, not just a cosmetic reordering.

### 2b. Client-safe vs server-safe variable naming is correct

`next.config.js`'s `env` block (confirmed by direct read, line 68): `NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? ''`. This is the mechanism that makes `VERCEL_ENV` (a server-only system variable Vercel does not expose to browser bundles without the `NEXT_PUBLIC_` prefix) readable from client code at all. `sentry.client.config.ts` correctly reads the prefixed `NEXT_PUBLIC_VERCEL_ENV` (it executes in the browser bundle); `sentry.server.config.ts`/`sentry.edge.config.ts` correctly read the bare `VERCEL_ENV` (neither ever executes in a browser context, so the prefix is unnecessary and the bare system variable is directly available). I did not just trust the inline comments claiming this — I independently traced the `NEXT_PUBLIC_VERCEL_ENV` definition back to `next.config.js` myself to confirm it isn't a dangling reference to an undefined variable.

### 2c. Would this produce `environment: preview` for a real Vercel Preview deployment?

Reasoning through it end-to-end, independent of the remediation record's own narrative: `deploy-staging.yml` deploys staging via `vercel pull --yes --environment=preview`, which is the standard mechanism by which Vercel sets `VERCEL_ENV=preview` for that build. `next.config.js`'s `env` block runs at build time and inlines `process.env.VERCEL_ENV` (which will read `'preview'` in that build context) into `NEXT_PUBLIC_VERCEL_ENV`. At runtime, `sentry.client.config.ts` reads `NEXT_PUBLIC_VERCEL_ENV` first — `'preview'` is truthy, so it wins over `NODE_ENV` (which is `'production'` per Next.js's own `next build` convention, confirmed in my original pass and unchanged). Same logic server-side with the bare `VERCEL_ENV`. So yes: this genuinely resolves to `environment: preview`, not `environment: production`, for a real Preview deployment. This is a correctly-reasoned conclusion, not an assumption inherited from the remediation summary.

I also read the new pinning test (`src/__tests__/sentry/environment-tag-resolution.test.ts`, REG-227) fresh. It does two independent things worth noting as evidence quality, not just as "a test exists": (1) a static-source assertion that the exact expected expression string is present in all 3 files and that the old NODE_ENV-only shape never reappears (`REGRESSED_LINE_RE`), and (2) a semantic behavioral test using `vi.stubEnv('VERCEL_ENV', 'preview')` + `vi.stubEnv('NODE_ENV', 'production')` that asserts the resolved value is `'preview'`, not `'production'` — this is the exact Preview-shaped scenario I reasoned through above, verified by a locally-reproduced pure function (deliberately not imported from the Sentry config files, since those call `Sentry.init()` as a side effect at import time and would trigger the real SDK under Vitest). This is legitimate test coverage of the specific claim, not a tautological test.

### 2d. Re-checking `pipeline-alert.yml` and `synthetic-monitor.yml` with certification traffic in mind

Read both in full again, this time explicitly picturing what a certification run produces: seeded accounts (via `seed-certification-accounts.ts`, direct Supabase Admin API calls — `auth.admin.createUser` + table inserts, no HTTP traffic against the app), plus (per the certification plan referenced in the seeding script's docblock) live quiz submissions and AI-tutor calls against the deployed staging app once Stage 2 begins.

- `synthetic-monitor.yml`: schedules every 15 min against `https://alfanumrik.com` (prod) by default; only points at staging if `vars.SYNTHETIC_TARGET_URL` is deliberately overridden. It runs a fixed Playwright spec (`e2e/synthetic/`) — not a request-volume or anomaly detector — so a burst of certification-generated quiz/AI-tutor traffic on staging cannot trip it, with or without the override, because it doesn't observe application traffic volume at all, only the pass/fail of its own scripted flows. Unchanged conclusion from my original pass; re-confirmed by a fresh full read, not just referenced from memory.
- `pipeline-alert.yml`: triggers only on `workflow_run` completion for 3 named CI/CD workflows, filtered to `branches: [main]`. Certification traffic against an already-deployed staging build involves zero pushes to `main` and zero CI/CD workflow runs, so this cannot fire from certification activity under any normal execution of the certification plan. Unchanged conclusion, re-confirmed by a fresh full read.

Neither workflow needed remediation and neither was touched by the remediation wave (no diff exists for either file relative to what I read the first time) — my original "no false-alert risk" conclusion holds, now on a doubly-independent read.

### Net verdict

The confirmed Sentry environment-tagging defect — the one concrete, safety-relevant issue from my original pass — is fixed and independently re-verified: correct precedence, correct client/server variable split, correct reasoned outcome for a real Preview deployment, and backed by a test that exercises the specific claim rather than merely re-stating it. The other two original findings (no false-alert risk from `pipeline-alert.yml`/`synthetic-monitor.yml`) were never defects and remain unchanged on a fresh read. **MONITORING: APPROPRIATE.**

---

## 3. CLEANUP — CLEAN TEARDOWN EXISTS, with an operational-invocation caveat

Read the corrected `supabase/migrations/20260702180000_certification_tenant_teardown.sql` in full (504 lines) — the actual SQL, not the remediation summaries — plus `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` (for what's actually asserted) and the DELETE-handler comment block in `src/app/api/super-admin/institutions/route.ts:190-223` (to check the previously-false claim was actually corrected, not just superseded).

### 3a. The `is_demo` guard is inside the function body, not just the GRANT

`purge_certification_tenant(p_school_id UUID)`:
```sql
IF v_school.is_demo IS NOT TRUE THEN
  RAISE EXCEPTION
    'purge_certification_tenant: refusing to tear down school % — is_demo is not true. ...'
    USING ERRCODE = '42501';
END IF;
```
(lines 380-386). This check runs after the `SELECT ... INTO v_school` and before any `DELETE` statement in the function body — I traced the control flow myself rather than trusting the migration's own comment describing it. A `service_role` caller that invokes this RPC against a real (non-demo) school id gets a hard exception before any row is touched, not a silent no-op and not a partial delete. The `GRANT EXECUTE ... TO service_role` / `REVOKE ... FROM public, anon, authenticated` (lines 487-488) is a separate, second layer restricting *who* can call it at all — the `is_demo` check is what stops it from being turned into a real-school-deletion path even by a legitimate, correctly-authenticated caller who passes the wrong id. Two independent layers, confirmed by reading both, not just one.

### 3b. Teardown order — I traced every DELETE statement against the FK claims made in the header

The migration's own header claims a "corrected FK inventory" of 7 blocking tables (4 per-student: `foxy_chat_messages`, `foxy_sessions`, `ai_workflow_traces`, `admin_impersonation_sessions`; 3 school/B2B-level with a chained dependency: `payment_reconciliation_queue` → `school_invoices`, plus `school_contracts`), each with `ON DELETE RESTRICT` or no `ON DELETE` clause (Postgres default `NO ACTION`, same blocking effect). Reading the function body directly, in execution order:

1. **(a)** Loop over `demo_accounts` rows with `role IN ('student','teacher')`, calling `purge_demo_account_by_id()` per row (students before teachers, via `ORDER BY CASE role WHEN 'student' THEN 1 WHEN 'teacher' THEN 2`) — line 397. That function's own student branch (lines 268-280, re-read directly) clears the 4 per-student tables before deleting the `students` row.
2. **(b)** A defensive direct sweep of the same 4 per-student tables (lines 419-426) — necessary because not every demo student is guaranteed a `demo_accounts` registry row (the codebase has 3 inconsistent demo-marking conventions, as my original pass §1e found and this migration's own comment cites). Then `DELETE FROM students ...` and `DELETE FROM teachers ...` (lines 428-432).
3. **(c)** The 3 school/B2B tables, in dependency order: `payment_reconciliation_queue` (line 447) is deleted *before* `school_invoices` (line 450) — I checked this against the claimed chained FK (`payment_reconciliation_queue.invoice_id → school_invoices(id) ON DELETE RESTRICT`) and the order is correct; reversing it would 23503 on the `school_invoices` delete while a `payment_reconciliation_queue` row still references it. `school_alert_rules`, `school_audit_log`, `school_seat_usage` (no inter-table ordering constraint among themselves) are also cleared here. `school_contracts` is cleared separately (line 458) — the migration's own comment (lines 453-457) correctly notes this table has no *downstream* ordering constraint of its own (its two inbound references are both `ON DELETE SET NULL`), so its position relative to the others doesn't matter, only that it happens before step (e).
4. **(d)** `demo_accounts` registry rows for the tenant (line 464) — correctly scoped by `school_id`, which the migration notes has no FK, so nothing else would clean it up.
5. **(e)** `DELETE FROM schools WHERE id = p_school_id AND is_demo = true` (line 474) — last, with the `is_demo` guard repeated here as a second, redundant check (belt-and-suspenders, explicitly commented as such).

I did not attempt to re-derive the full FK inventory from the raw schema a fourth time (per the task's instruction — architect and quality have each done this independently twice already), but I did verify the *internal consistency* of the migration myself: every table the header claims is blocking is in fact cleared before the statement that would otherwise hit it, in the order the chained dependency requires. I found no ordering gap on this read.

One thing genuinely worth registering as a small residual risk, not a defect: the header's "CHECKED AND CONFIRMED SAFE" section (lines 146-186) is a large hand-maintained list of tables verified to already cascade correctly. I did not independently re-verify all 60+ named tables in that list against the schema — that re-derivation is explicitly what the task said I don't need to redo a fourth time, and it is the one part of this migration that depends on trusting prior work rather than something I re-traced statement-by-statement myself.

### 3c. Idempotency

Confirmed directly: `IF NOT FOUND THEN RETURN jsonb_build_object('success', true, 'already_absent', true, ...); END IF;` (lines 368-374) fires when the `schools` row is already gone — this is a `SELECT ... INTO v_school FROM schools WHERE id = p_school_id` that found nothing, which is exactly the state after a first successful teardown call. A second call against the same `p_school_id` therefore returns a success response with `already_absent: true` rather than erroring or attempting a second (now-empty) set of deletes. `CREATE OR REPLACE FUNCTION` for the function definitions themselves, and idempotent `REVOKE`/`GRANT`, make the migration file itself safe to re-run (a distinct, correct claim from "the function is idempotent to call twice," and both hold).

### 3d. Operational read — could I, as the agent who will eventually run this, follow it without guesswork?

This is where I found a real, if non-blocking, gap. Reading the migration plus the seeding script's own printed teardown hints (`seed-certification-accounts.ts` `printSummary()`, lines 482-504) together:

- **Invocation mechanism**: there is no wrapper script and no admin API route that calls `purge_certification_tenant`. I grepped the whole repo for `purge_certification_tenant` and it appears in exactly 4 places: the migration itself, the seeding script's printed operator hint (a raw `SELECT purge_certification_tenant('<school_id>');` string, meant to be copy-pasted into a SQL console), the integration test, and a documentation-only comment in `src/app/api/super-admin/institutions/route.ts` (confirmed by direct read, lines 213-220 — it explains the function exists and hard-refuses non-demo schools, but does not call it; the route's `DELETE` handler itself is unchanged and still only does the soft/hard-delete-with-FK-failure path it always did). The `/super-admin/institutions` page has no button wired to this RPC. **An operator must have direct database/service-role SQL access (e.g. the Supabase SQL editor or a `psql`/service-role script) to actually run a teardown today — there is no product-surface way to trigger it.**
- **Standalone (non-school-scoped) accounts are NOT covered** by `purge_certification_tenant` at all — `parent` (guardians), `super_admin`, `content_author`, `support_staff` are all outside its scope by design (none are `school_id`-scoped). The script's own `printSummary()` correctly says this out loud and prints 3 separate raw `DELETE ... WHERE email LIKE 'cert-<run_id_short>-%@certification.alfanumrik.invalid'` statements for `guardians`, `admin_users`, and `demo_accounts` as the teardown path for those. I independently checked one FK risk in this raw-DELETE path myself: `guardian_student_links_guardian_id_fkey` (confirmed `ON DELETE CASCADE` at `00000000000000_baseline_from_prod.sql:19089`), so a raw `DELETE FROM guardians` will not 23503 on that table. I did not exhaustively re-derive every other FK against `guardians`/`admin_users` beyond this one spot-check — a full second FK sweep for the non-school-scoped accounts (mirroring the rigor the migration itself received for the school-scoped path) has not been done by anyone in this remediation wave, since the original defect finding was specifically about the `schools`-tenant path.
- **The integration test is written but unexecuted.** `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` says so explicitly in its own header (lines 64-80, "STAGE-2 COVERAGE NOTE"): it self-skips without live Supabase credentials, and this session had none, so the SQL-level proof of the teardown's own claims (guard fires, idempotent no-op, zero rows remain across all 7+ tables) is written and ready but has never actually executed against a real database in this remediation wave. This is an honest, self-disclosed limitation in the test file itself, not something I had to dig for — but it means "the migration's own regression test passed" cannot yet be said; only "the migration's own regression test exists and has not yet been run."

None of this contradicts the SQL logic itself, which I traced and found internally consistent (§3a-3c above). It is a gap in the *operational path around* the SQL, exactly the category the task asked me to flag rather than paper over.

---

## Overall statement

Criteria 3 (traceability), 4 (monitoring), and 5 (cleanup) of the original 6-criterion Environment Readiness Assessment are now **satisfied, with one caveat** on criterion 5.

**The caveat, precisely**: `purge_certification_tenant(p_school_id)` is a correctly-guarded, correctly-ordered, idempotent SQL function — confirmed by my own direct trace of its body, not by trusting the remediation summary — but **no wrapper script or admin-API route exists yet to invoke it**; an operator must run raw SQL via direct service-role database access (Supabase SQL editor or equivalent) to actually execute a teardown, and the same is true of the 3 raw `DELETE` statements needed for the non-school-scoped roles (parent, super_admin, content_author, support_staff). Additionally, the migration's own integration test (`certification-tenant-teardown-e2e.test.ts`) is written but has never executed against a live database in this remediation wave (self-skips without Supabase integration credentials, which are not present in this session) — so the teardown's zero-row/idempotency/guard claims are proven by static code trace (mine, plus architect's and quality's two independent passes) but not yet by an executed test run. This is an operational gap, not a logic defect — nothing here should block authorizing a certification run, since the SQL primitive itself is sound and reachable by any operator with service-role DB access, but a certification runbook should say explicitly "run this via the Supabase SQL editor with service-role access" rather than implying a self-service admin-panel button exists, and the integration test should be run for real (`RUN_INTEGRATION_TESTS=1`) against staging at least once before or immediately after the first certification pass, per its own header's stated next step.

## Files read this pass (traceability)
- `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md` (my own original pass, re-read as the baseline to compare against)
- `docs/runbooks/certification-traffic-traceability.md`, `scripts/seed-certification-accounts.ts`
- `supabase/migrations/20260528000001_promote_demo_accounts_v2.sql` (line 61-62, `demo_accounts_role_check`), `src/lib/admin-auth.ts` (`ADMIN_LEVELS`)
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.js` (env block), `src/__tests__/sentry/environment-tag-resolution.test.ts`
- `.github/workflows/pipeline-alert.yml`, `.github/workflows/synthetic-monitor.yml`
- `supabase/migrations/20260702180000_certification_tenant_teardown.sql` (full read)
- `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts`, `src/app/api/super-admin/institutions/route.ts` (lines 190-223)
- `supabase/migrations/00000000000000_baseline_from_prod.sql:19089` (`guardian_student_links_guardian_id_fkey` spot-check)
- `docs/runbooks/2026-07-02-environment-readiness-remediation.md` (remediation record — read for cross-check, not trusted as the source of verdicts)
