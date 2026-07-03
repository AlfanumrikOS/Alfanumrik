# Environment Readiness Assessment — Certification-on-Staging (Ops)

**Agent**: ops. **Date**: 2026-07-02. **Method**: direct file reads only (read-only investigation — nothing written/edited/dispatched outside this report). Cross-checked against `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/ops-findings.md` (prior pass) where relevant; re-derived independently, not trusted blindly.

---

## Verdicts

**TRACEABILITY: MUST BE ESTABLISHED**
**MONITORING: RISK OF FALSE ALERT (low) + RISK OF SILENT ABSORPTION (low-medium), AND a confirmed environment-tagging defect that is safety-relevant**
**CLEANUP: MANUAL/PARTIAL** (no single-operation clean teardown exists for a certification tenant that includes seeded students/teachers under a school)
**ANALYTICS ISOLATION: CONFIRMED for Supabase-backed metrics (separate staging project), NOT VERIFIABLE for PostHog (single project, no code-level environment split found — this is a Vercel-dashboard configuration question, not something the repo can answer)**

---

## 1. TRACEABILITY — MUST BE ESTABLISHED

**No platform-wide convention exists that is both (a) DB-queryable and (b) consistently applied.** Evidence, in order of relevance:

### 1a. `seed-staging-test-student.yml` — the existing precedent does NOT mark its student as synthetic
Read in full (`.github/workflows/seed-staging-test-student.yml`). This workflow creates/refreshes **one** E2E test student on staging (used by REG-45/REG-46) via `TEST_STUDENT_EMAIL`/`TEST_STUDENT_PASSWORD` repo secrets. Its `bootstrap_user_profile` RPC call and the follow-up `students` UPDATE:
- Set `grade='10'`, `board='CBSE'`, `onboarding_completed=true`.
- Do **NOT** set `is_demo=true`.
- Do **NOT** set `account_status='test'`.
- Do **NOT** use a reserved/recognizable email domain — the email is an arbitrary value from a GitHub secret, unqueryable from inside the database.
- `user_metadata.role='student'` and `name='E2E Test Student'` are set on the **auth.users** row only (Supabase Auth metadata), not on the `students` table itself, so a SQL query against `students` cannot distinguish this row from a real user by any column.

**Conclusion: the one existing seeded staging test account is indistinguishable from a real student inside the database.** It is not a usable precedent for "traceability of certification traffic" — it is the counter-example the CEO is right to worry about.

### 1b. `synthetic-host-monitor` — does not create user/account data at all
Read in full (`supabase/functions/synthetic-host-monitor/index.ts`). This function is **read-only against `schools`** and only ever `INSERT`s into `synthetic_monitor_results` (a dedicated monitoring table, not a user-data table). It probes `/api/school-config` on every active school's host and never creates students, quizzes, or AI-tutor calls. It is not "synthetic traffic" in the sense the task means (no account/quiz/AI-tutor volume) — it is a health probe. Not usable as precedent for account/quiz/AI-tutor traceability, but its own traffic is already self-evidently distinguishable (its own dedicated results table, and its User-Agent header `Alfanumrik-Synthetic-Monitor/1.0 (+ops@alfanumrik.com)` on outbound probes).

### 1c. `staging-adaptive-drill.yml` — the best precedent in the codebase, and it IS a real, disciplined marking convention
Read in full (`.github/workflows/staging-adaptive-drill.yml`). This is the closest existing analogue to a "certification run" and it gets the marking convention right:
- Every seeded row carries `is_demo=true` on the `students` row.
- Email is namespaced: `drill-synthetic-<drill_run_id-uuid>@example.invalid` (RFC 2606 reserved TLD — guaranteed never to collide with a real address or attempt real delivery).
- `name` is namespaced `drill-synthetic-<first 8 chars of uuid>`.
- A per-run `drill_run_id` UUID ties every child row (state_events, learner_mastery, adaptive_interventions) back to the seed, with a **deterministic** synthetic `auth_user_id` (md5-derived from the run id) so teardown can recompute exactly which rows to delete without needing an FK or a lookup table.
- Teardown is **mandatory** (`if: always()`), deletes by marker + derived id, and **fails the job** if any synthetic row survives (an explicit `RAISE EXCEPTION` "TEARDOWN LEAK" assertion). This is a hard fail-closed guarantee, not a best-effort cleanup.
- Two human gates (literal `RUN-ON-STAGING` confirm string + a prod-ref negative-assertion) prevent accidental execution against production.

This workflow proves the team already has the engineering discipline to do certification-traffic marking correctly — it's just scoped narrowly (one synthetic student, three Pulse-signal drills) and has never been generalized into a repo-wide convention that a certification-scale seeding script (many accounts, quiz sessions, AI-tutor calls) could reuse directly.

### 1d. A broader, already-shipped `is_demo` convention exists and is respected by reporting — this is the right base to extend
Independent of the drill workflow, the platform already has a first-class `is_demo` boolean on `students`, `teachers`, `guardians`, `admin_users`, `school_admins`, `schools`, `student_subscriptions`, and `school_subscriptions` (migrations `20260515000001_add_is_demo_to_teachers_and_guardians.sql`, `20260528000001_promote_demo_accounts_v2.sql`), each with a partial index `WHERE is_demo = true`. Critically, **the super-admin reporting APIs already filter it out**: `src/app/api/super-admin/stats/route.ts` (`countRows('students', 'is_demo=eq.false')` — used for total/active/signup counts) and `src/app/api/super-admin/analytics/route.ts` (signup trend, plan distribution, leaderboard all filtered `is_demo=eq.false`). So marking certification data `is_demo=true` is not just cosmetic — it is **already wired to keep it out of the metrics an operator would look at**, on both staging and (if this pattern were ever reused) production.

There is also a `demo_accounts` registry table + a `purge_demo_account_by_id(p_demo_account_id UUID)` SECURITY DEFINER RPC (migration `20260528000004_demo_account_purge_cron.sql`) that does a clean, single-call, role-aware cascade (including, for `role='school_admin'`, deleting the demo-flagged students under that school **before** deleting the `schools` row itself, correctly avoiding the FK-ordering problem documented in §3 below). This RPC is real, callable via service role today, and is a strong candidate primitive for certification teardown — but see the important caveat in §3: **its automated trigger (the `demo-account-purger` Edge Function referenced in its own comments) does not exist in the codebase, and the `pg_cron` schedule that would call it is commented out** (`-- SELECT cron.schedule(...)` in the same migration). It is a designed-but-not-deployed automation; the RPC itself is usable manually today.

### 1e. `/api/super-admin/test-accounts` — a third, narrower, inconsistent convention
`src/app/api/super-admin/test-accounts/route.ts` (super_admin-gated) creates ad hoc test accounts and sets `is_demo=true` PLUS `user_metadata.is_test_account=true` PLUS (students only) `account_status='test'`. It does **not** insert a `demo_accounts` registry row, so accounts created this way are invisible to `purge_demo_account_by_id`/`demo_accounts_due_for_purge` even if that automation were deployed. Three different "this is synthetic" conventions exist in the codebase today (`is_demo` alone; `is_demo` + `drill-synthetic-*` email; `is_demo` + `is_test_account` + `account_status='test'`, no registry row) and none of them is documented as *the* canonical one.

### 1f. Real pre-production users on staging — likely, not fully verifiable from code alone
Staging is deployed as a genuine, persistent Vercel **Preview** environment (`deploy-staging.yml`: `vercel pull --yes --environment=preview`) against its own Supabase project, with its own seeded E2E test student (§1a) and its own flag-rollout drills (§1c). The existence of `seed-staging-test-student.yml`, `staging-flag-set.yml`, and `staging-adaptive-drill.yml` as standing, repeatable workflows strongly implies staging is used for ongoing internal validation/dogfooding beyond one-off deploys, but I found no explicit staging-user roster or "internal team account list" in the repo (this would live in the staging DB itself, which is out of static-read-only reach). **Practical implication for certification**: certification seeding must NOT assume staging is empty of real-shaped accounts — the marking convention needs to be strict enough that a query `WHERE is_demo = false` reliably excludes certification rows even if other non-demo test/dogfooding accounts coexist.

### Proposed minimal, actionable convention (since none is canonical today)
Adopt and generalize the `staging-adaptive-drill.yml` pattern for the certification run, layered onto the already-reporting-respected `is_demo` flag:

1. **DB flag**: every row created by certification seeding sets `is_demo = true` on its base table (`students`/`teachers`/`guardians`/`schools`/`school_admins`/`student_subscriptions`/`school_subscriptions` all already have the column).
2. **Email domain**: `*@certification.alfanumrik.invalid` (RFC 2606 `.invalid` TLD — same reserved-namespace pattern the drill workflow already uses with `@example.invalid`, guaranteeing no real-delivery risk and trivial `LIKE '%@certification.alfanumrik.invalid'` querying independent of the `is_demo` flag — i.e., two independent signals, not one, so a bug in setting `is_demo` doesn't silently deanonymize the run).
3. **Run marker**: a single `certification_run_id` UUID (generated once per certification run) embedded in the `name` field (`cert-<run_id_short>`) exactly as the drill workflow does with `drill-synthetic-<run_id>`, so every row from one run can be found/deleted without needing an FK.
4. **Registry row**: insert one row per top-level account (or one per synthetic school) into `demo_accounts` with `role` set appropriately, so the existing `purge_demo_account_by_id` RPC becomes directly usable for teardown (see §3) rather than requiring bespoke SQL.
5. **`schools.tenant_type`**: if certification seeds a synthetic school, consider a distinguishing `name` prefix like `[CERTIFICATION]` for human-readable operator visibility in the `/super-admin/institutions` list (this is a UI/display convenience layered on top of #1-#4, not a substitute for them).

This is additive to existing schema (no migration required — every column above already exists) and is fully compatible with the existing reporting filters (`is_demo=eq.false`) and the existing (if currently undeployed) purge RPC.

---

## 2. MONITORING/ALERTING — RISK OF FALSE ALERT (low) + RISK OF SILENT ABSORPTION (low-medium) + a confirmed Sentry environment-tagging defect

### `synthetic-monitor.yml` (read in full)
Runs a Playwright spec against `https://alfanumrik.com` (or `vars.SYNTHETIC_TARGET_URL`) every 15 minutes. It targets **production by default**; certification traffic on staging would only interact with this workflow if `SYNTHETIC_TARGET_URL` were deliberately pointed at staging during the certification window. **No false-alert risk from certification volume** under default configuration, because this workflow doesn't watch staging at all unless explicitly redirected. If an operator *does* redirect it at staging during certification, its Playwright spec runs independently of whatever certification traffic exists (it's a fixed synthetic script, not a volume/rate-based anomaly detector), so a burst of certification-created accounts/quizzes would not trip it either way — it only fails on functional breakage of the specific flows the spec exercises. **Verdict: not an anomaly detector, so it cannot misfire on volume, but it also provides no coverage of certification-specific issues unless manually pointed at staging.**

### `pipeline-alert.yml` (read in full)
Watches **CI/CD pipeline conclusion** (`workflow_run` for `"Deploy Production — Alfanumrik"`, `"Sync Migrations to Staging"`, `"CI — Alfanumrik"`), filtered to `branches: [main]`. It has **no relationship to runtime traffic volume at all** — it can only fire if a certification run somehow causes one of those three named CI/CD workflows to fail (e.g., if certification seeding were run through a modified version of `sync-staging-migrations.yml` that broke). Under a normal certification run (traffic against an already-deployed staging build, no new pushes to `main`), this workflow cannot fire, false or otherwise. **Verdict: no false-alert exposure from certification traffic; irrelevant to this exercise unless certification work also touches CI on `main`.**

### Silent-absorption risk
Neither workflow classifies "expected synthetic traffic" vs "real" — `synthetic-monitor.yml` doesn't inspect application data at all (it's an external black-box Playwright probe), and `pipeline-alert.yml` only watches CI conclusions. So there is no mechanism by which certification traffic could be silently bucketed into "expected synthetic monitor traffic" and swallow a genuine certification-caused problem **at the CI/pipeline-alert layer**. The actual silent-absorption risk is one layer down, in Sentry (below): if certification-caused application errors get the SAME `environment: 'production'` tag production errors already carry, they are not silently dropped, but they ARE silently merged into the production error stream — indistinguishable from a real incident by an on-call engineer, which is the inverse failure mode (pollution, not suppression) and equally unsafe for a certification run.

### Sentry environment tagging — CONFIRMED DEFECT, re-verified independently and going further than the prior pass

All three Sentry init files (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) set:
```ts
environment: process.env.NODE_ENV || 'development',
```
and (server/edge) drop events entirely when `process.env.NODE_ENV !== 'production'` inside `beforeSend`.

The prior Stage-1 pass (`ops-findings.md` "Monitoring / Alerting" section) noted the drop-outside-production behavior but treated it as a working feature and did not check what `NODE_ENV` actually resolves to on staging. I traced this further:

- `deploy-staging.yml` deploys staging as a Vercel **Preview** deployment (`vercel pull --yes --environment=preview`).
- Next.js's `next build` **always** sets `NODE_ENV=production` internally for a production-mode build, regardless of which Vercel environment (Production vs Preview) the build is destined for. This is standard, well-documented Next.js/Vercel behavior — Vercel does not override `NODE_ENV` per deploy target; `VERCEL_ENV` (`production`/`preview`/`development`) is the only value Vercel itself varies per environment.
- **Every other environment-sensitive call site in this codebase correctly reads `VERCEL_ENV` first** — I found 35+ call sites (feature flags, PostHog, health check, entitlements resolver, dive/rhythm/synthesis routes, super-admin contracts/reconciliation routes, etc.) using the pattern `process.env.VERCEL_ENV || process.env.NODE_ENV`. The three Sentry config files are the **outlier**: they read `NODE_ENV` only, never `VERCEL_ENV`.

**Net effect, verified by direct comparison against the deploy workflow, not assumed:** on staging, `NODE_ENV` resolves to `'production'` (same as real production), so (a) the `beforeSend` drop-outside-production guard does **not** drop staging events — they are sent — and (b) the `environment` tag on every staging Sentry event reads `'production'`, byte-identical to a real production error. **Certification-caused errors on staging will land in Sentry tagged `environment: production`, indistinguishable from genuine production incidents**, polluting whatever error budget / on-call signal the team relies on Sentry's `environment` filter to separate. This is exactly the safety-relevant scenario the task asked to re-confirm, and it is real — not merely a hygiene note as the prior pass implicitly treated it.

**Minimal fix** (flagged for architect/backend, not implemented by this read-only pass): change all three configs to `environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'`, matching the pattern already used everywhere else in the codebase. Until that lands, **certification on staging should not run with a live `NEXT_PUBLIC_SENTRY_DSN`** pointed at the same Sentry project as production, OR the certification window should be run with Sentry temporarily disabled on the staging deployment (`NEXT_PUBLIC_SENTRY_DSN` unset — both `enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN` gates confirm this is a legitimate, code-supported way to fully suppress Sentry for the run), OR (if Sentry visibility during certification is wanted) the fix above should be shipped first so staging events are correctly tagged `environment: preview` and are filterable/excludable from the on-call view.

---

## 3. CLEANUP/TEARDOWN — MANUAL/PARTIAL (no clean single-operation path for a school-scoped certification tenant with seeded students)

### `account-purge` Edge Function — per-account only, requires a pre-existing deletion-request row, not a bulk/tenant tool
Read in full (`supabase/functions/account-purge/index.ts` + its caller `src/app/api/cron/account-purge/route.ts`). This is the DPDP right-to-erasure executor:
- Operates on **exactly one** `{account_id, account_role, deletion_log_id}` per invocation — student/teacher/parent, never a school/tenant.
- Requires a pre-existing `account_deletion_log` row (created by the self-service deletion request flow) in a non-terminal status; the Edge Function itself does **not** enforce the 30-day cooling-off window — only the cron route's query does (`.lte('cooling_off_ends_at', ...)`). **This means it CAN be pointed at an arbitrary account immediately** (bypassing the 30-day wait) by invoking the Edge Function directly with service-role + `CRON_SECRET` and a valid `deletion_log_id`, but that still requires manufacturing one `account_deletion_log` row per account first — there is no batch/tenant-scoped mode.
- Its hard-delete of `auth.users` + PII nulling + payment-FK anonymization is real and would work correctly on a certification-seeded student/teacher/parent — but it is a per-account tool, not a tenant teardown tool, and it does not touch the `schools` row at all.

### `data-erasure-purger` — narrower still, parent-initiated child-erasure only
Read in full (`supabase/functions/data-erasure-purger/index.ts`). This is Stage 2 of the **parent-initiated child-data erasure flow** (DPDP S15) — it processes `data_erasure_requests` rows (`guardian_id`/`student_id` pairs) via the `execute_data_erasure_purge` RPC. It is not usable for certification cleanup unless certification specifically simulates the parent-erasure flow (out of scope for a general certification-teardown need).

### `schools` row deletion — NO clean single-operation cascade; a real, verified gap
This is the most consequential finding of this section, and directly contradicts an in-repo code comment.

`src/app/api/super-admin/institutions/route.ts`'s `DELETE` handler comment claims (lines 196-199): *"Hard delete... Cascades via existing FKs (students, school_subscriptions, etc. have `ON DELETE CASCADE` referencing schools)."*

I verified the actual foreign-key definitions in `supabase/migrations/00000000000000_baseline_from_prod.sql`. The claim is **only partially true**:

| FK | ON DELETE CASCADE? |
|---|---|
| `classes_school_id_fkey` | Yes |
| `school_admins_school_id_fkey` | Yes |
| `school_announcements_school_id_fkey` | Yes |
| `school_api_keys_school_id_fkey` | Yes |
| `school_exams_school_id_fkey` | Yes |
| `school_invite_codes_school_id_fkey` | Yes |
| `school_questions_school_id_fkey` | Yes |
| `school_subscriptions_school_id_fkey` | Yes |
| `quiz_sessions_school_id_fkey` | **No** (plain `REFERENCES`, default `NO ACTION`) |
| `school_alert_rules_school_id_fkey` | **No** |
| `school_audit_log_school_id_fkey` | **No** |
| `school_invoices_school_id_fkey` | **No** |
| `school_seat_usage_school_id_fkey` | **No** |
| `student_learning_profiles_school_id_fkey` | **No** |
| **`students_school_id_fkey`** | **No** |
| **`teachers_school_id_fkey`** | **No** |

`students.school_id` and `teachers.school_id` — the two tables that would actually hold a certification tenant's seeded population — reference `schools(id)` with **no** `ON DELETE CASCADE`. In Postgres this defaults to `NO ACTION`/`RESTRICT`: **attempting to hard-delete a `schools` row while any `students` or `teachers` row still references it will fail with a foreign-key-violation error (Postgres `23503`)**, not silently cascade. The route's own code handles this gracefully at the HTTP layer (`hardRes.ok` false → returns the Postgres error text with the original `hardRes.status`), so it fails safely rather than corrupting data — but it means **the hard-delete endpoint cannot, by itself, remove a certification school that still has seeded students/teachers attached.** The existing unit test (`src/__tests__/api/super-admin/institutions-delete.test.ts`) does not catch this because it fully mocks `fetch()` and always returns a canned success response for the `DELETE` call — it never exercises the real Postgres constraint, so this gap is untested as well as unremediated.

**Practical consequence for certification teardown of a school-scoped run**: an operator (or an automated teardown script) would need to, in order:
1. Delete/purge every `students` row for the certification school (via `account-purge` per-student, or a direct `DELETE FROM students WHERE school_id = ... AND is_demo = true` if the operator has direct DB access — the super-admin API has no bulk "delete all students under a school" endpoint),
2. Delete/purge every `teachers` row the same way,
3. Then soft-delete (`DELETE /api/super-admin/institutions?id=...`) then hard-delete (`?id=...&force=true`) the `schools` row itself.

There is **no single super-admin API call that does this in one operation today.**

**The one exception, not wired into the super-admin API surface**: `purge_demo_account_by_id()` (migration `20260528000004_demo_account_purge_cron.sql`) already solves exactly this ordering problem for the `role='school_admin'` case — it explicitly deletes `students WHERE school_id = v_school_id AND is_demo = true` **before** `DELETE FROM schools WHERE id = v_school_id AND is_demo = true`, in the correct order, inside one SECURITY DEFINER function, callable today via a direct service-role RPC call (`SELECT purge_demo_account_by_id('<demo_accounts.id>')`). This is real and usable **if and only if** the certification school and its seeded students are registered in `demo_accounts` with `is_demo=true` set consistently on both the `schools` row and every seeded `students` row (see the proposed convention in §1). Its `teachers` handling is missing from the school_admin branch (the function does not delete `teachers WHERE school_id = ...`), so any certification-seeded teacher accounts under the tenant would still need to be cleaned up separately (e.g., via `account-purge` per teacher, or a direct `is_demo`-scoped delete) before/alongside calling this RPC — teacher rows do not block the `schools` delete inside this RPC only because the RPC never attempts to delete the `schools` row until after clearing the FK-blocking `students`, but a leftover `teachers` row **would still block it** given `teachers_school_id_fkey` has no cascade either. **This RPC is the closest thing to a clean single-operation teardown that exists, but it is incomplete (missing the teacher branch) and its own trigger automation (the `demo-account-purger` Edge Function + the `pg_cron` schedule referenced in its comments) does not exist in the codebase — the schedule is commented out in the same migration file.** It must be invoked manually via direct RPC call today.

### Explicit gap statement (per the task's instruction not to paper over this)
**There is no existing, ready-to-use, single-operation mechanism to cleanly remove a `[CERTIFICATION]`-style school tenant and everything under it.** The closest primitive (`purge_demo_account_by_id`) is real, callable, and gets the FK ordering right for students, but (a) is missing teacher cleanup, (b) requires the certification seeding to register into `demo_accounts` (not yet part of any seeding script), and (c) has no automated trigger deployed. Absent using that RPC, teardown requires a multi-step manual sequence (purge students → purge teachers → soft-delete school → hard-delete school) with no existing bulk tooling for steps 1-2. **This should be built or at minimum manually rehearsed on staging before certification is authorized to run at meaningful scale**, since the alternative is an operator hand-deleting rows across `students`, `teachers`, and `schools` (plus whatever quiz/chat/subscription history was generated) after the fact.

---

## 4. NO-PRODUCTION-IMPACT / ANALYTICS ISOLATION

### Supabase — CONFIRMED isolated
Per the prior session's finding (re-confirmed structurally by this pass): staging runs against its own distinct Supabase project (`STAGING_SUPABASE_URL`/`STAGING_SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STAGING_PROJECT_REF` secrets, all distinct from the production `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`/`SUPABASE_DB_PASSWORD` production-environment secrets per `deploy-staging.yml` and `staging-adaptive-drill.yml`'s explicit prod-ref fail-closed check against the hardcoded `PROD_PROJECT_REF: shktyoxqhundlvkiwguu`). Certification data written to staging's Postgres cannot reach production's database — there is no shared table, no cross-project FK, no replication path found in any migration or workflow read this pass.

### PostHog — NOT VERIFIABLE from code (likely single shared project)
`src/lib/posthog/server.ts` and `src/lib/posthog/client.ts` both read a single pair of env vars — `POSTHOG_PROJECT_API_KEY`/`NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` — with no environment-conditional branching in the source code itself. The live MCP tool context available to this session shows exactly **one** active PostHog project ("Default project", id 159341) under the org. Whether staging's deployed build is given a *different* API key (pointing at a separate PostHog project) than production is purely a matter of Vercel dashboard environment-variable scoping — which this repo cannot answer from static inspection (same class of gap the prior pass flagged for Supabase Pro/PITR — requires dashboard access this agent does not have). **What the code DOES guarantee**: every server-side `capture()` call stamps `environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'` onto the event properties (`src/lib/posthog/server.ts:78, 245`), so **IF** staging and production share one PostHog project, certification events would still be *filterable* by `environment='preview'` inside that shared project (unlike Sentry, PostHog's `VERCEL_ENV`-based tagging is correct) — but they would NOT be physically separated the way Supabase is, and a dashboard/insight built without an explicit `environment` filter would show certification traffic mixed into whatever that dashboard queries. This is exactly the "shared analytics dashboard" risk the task named. **Recommend backend/architect confirm via the Vercel dashboard whether `NEXT_PUBLIC_POSTHOG_KEY` differs between the Production and Preview environment scopes before certification runs at volume; if it is the same key, any pre-built PostHog dashboard/insight used to monitor production KPIs during the certification window must have an explicit `environment != 'preview'` (or `environment = 'production'`) filter applied, and the certification run should additionally use the §1 proposed marking convention as a second, PostHog-side filter dimension (e.g., stamping a `is_certification: true` event property) since `environment` tagging alone conflates "certification" with any other staging/preview traffic (e.g., PR preview deploys, the adaptive-loop drills).**

### Architect/backend parallel work
Per instructions, proceeded independently without blocking on architect/backend's concurrent Stage-1 files (not present in `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/` at investigation time beyond this agent's own prior-pass `ops-findings.md`). No file conflicts encountered; findings above are self-contained and cite exact file paths/line evidence for independent cross-check.

---

## Summary table for the CEO

| Question | Answer | Confidence |
|---|---|---|
| Is there a ready-to-use synthetic-traffic marking convention? | No single canonical one; 3 partial/inconsistent conventions exist (`is_demo` alone, `is_demo`+email marker in the drill workflow, `is_demo`+`is_test_account`+`account_status` in test-accounts). A concrete, minimal convention is proposed in §1 built from pieces that already exist. | HIGH |
| Will certification traffic misfire an alert? | No — neither `synthetic-monitor.yml` nor `pipeline-alert.yml` is a volume/anomaly detector; both are functional/CI-conclusion watchers with no exposure to certification traffic volume under default config. | HIGH |
| Will certification traffic silently mask a real problem? | Low risk at the CI/pipeline-alert layer (no absorption mechanism exists there). Real risk is the inverse at the Sentry layer: certification errors will be tagged `environment: production` and mixed into the real production error stream, not suppressed — this is a genuine, verified defect, not a hygiene note. | HIGH |
| Is staging's Sentry environment tag distinct from production's? | **No — confirmed defect.** All 3 Sentry configs read `NODE_ENV` (always `'production'` on any Next.js production build, including staging's Vercel Preview build) instead of `VERCEL_ENV` (the value Vercel actually varies). Every other env-sensitive call site in the codebase gets this right; Sentry is the outlier. | HIGH |
| Can certification data be cleanly deleted afterward? | Only per-account, and only for students/teachers already wrapped in a deletion-request row (`account-purge`) or a `demo_accounts` registration (`purge_demo_account_by_id`, which itself is missing a teacher-cleanup branch). **No single-operation tenant teardown exists** — `students_school_id_fkey`/`teachers_school_id_fkey` lack `ON DELETE CASCADE`, contradicting the super-admin institutions route's own code comment. This is a real, unremediated gap. | HIGH |
| Could certification traffic reach a shared analytics view with production? | Supabase: no (separate project, confirmed). PostHog: not verifiable from code — depends on Vercel env-var scoping not visible in this repo; event-level `environment` tagging is correct if it does share a project, but that alone won't stop an unfiltered dashboard from mixing the two. | MEDIUM |

## Files referenced (traceability)
- `.github/workflows/seed-staging-test-student.yml`, `staging-adaptive-drill.yml`, `synthetic-monitor.yml`, `pipeline-alert.yml`, `deploy-staging.yml`
- `supabase/functions/synthetic-host-monitor/index.ts`, `account-purge/index.ts`, `data-erasure-purger/index.ts`
- `src/app/api/cron/account-purge/route.ts`
- `src/app/api/super-admin/institutions/route.ts`, `src/__tests__/api/super-admin/institutions-delete.test.ts`
- `src/app/api/super-admin/test-accounts/route.ts`, `src/app/api/super-admin/analytics/route.ts`, `src/app/api/super-admin/stats/route.ts`
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- `src/lib/posthog/server.ts`, `src/lib/posthog/client.ts`
- `supabase/migrations/00000000000000_baseline_from_prod.sql` (FK definitions, lines ~18857-19733)
- `supabase/migrations/20260515000001_add_is_demo_to_teachers_and_guardians.sql`, `20260528000001_promote_demo_accounts_v2.sql`, `20260528000004_demo_account_purge_cron.sql`
- `next.config.js` (NODE_ENV usage cross-check)
- Prior pass: `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/ops-findings.md`
