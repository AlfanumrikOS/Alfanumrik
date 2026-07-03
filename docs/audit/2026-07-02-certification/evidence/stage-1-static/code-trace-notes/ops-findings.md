# Ops Findings — Production Certification, Wave 1 / Stage 1 (Static, Read-Only)

**Agent**: ops. **Date**: 2026-07-02. **Method**: direct file reads + `gh` CLI (authenticated, read-only) + DNS/HTTP probes. `docs/audit/2026-07-02-discovery/06-ops-flags.md` was read and used as a cross-check only, not trusted blindly — every claim re-derived from source where practical.

Confidence tags: HIGH (read exact source) / MEDIUM (inferred from partial evidence) / LOW / NOT VERIFIED-DEFERRED (needs credentials/access not available).
Impact tags: Blocker / Should-Fix-Before-Release / Post-Release-Acceptable / Informational.

---

## Task 1 — Super-admin surface inventory

**Full classification table**: `docs/audit/2026-07-02-certification/evidence/inventory/super-admin-pages.csv` (62 rows, matches `find src/app/super-admin -name page.tsx | wc -l` = 62 exactly).

API route count: `find src/app/api/super-admin -name route.ts | wc -l` = **119** (HIGH — exact command output). This confirms the discovery doc's "62 pages / 119 routes" and refutes the constitution's stale "43 pages / 75 routes, last reconciled 2026-04-27" figure in `.claude/CLAUDE.md` Critical File Map — **the surface has grown ~44% in pages and ~59% in routes since that reconciliation date and the constitution has not been updated.** Confidence: HIGH. Impact: Should-Fix-Before-Release (constitution accuracy; not a functional defect).

### Tier-0 auth-gate spot checks (HIGH confidence — exact grep/read of source)

| Route | Auth mechanism | Level required | Audit logging |
|---|---|---|---|
| `api/super-admin/users` PATCH | `authorizeAdmin()` | `super_admin` | not confirmed this pass |
| `api/super-admin/rbac` POST | `authorizeAdmin()` | `super_admin` (GET is `support`) | `logAdminAudit` imported |
| `api/super-admin/feature-flags` POST/PATCH/DELETE | `authorizeAdmin()` | `super_admin` | **VERIFIED**: `logAdminAudit(auth, 'feature_flag.{created,updated,deleted}', ...)` fires on every mutation — satisfies the ops rejection condition "feature flag change not logged to audit trail" |
| `api/super-admin/subjects/plan-access` GET/PUT/DELETE | `authorizeRequest()` (RBAC lib, distinct code path from `admin-auth.ts`) | `super_admin.subjects.manage` permission code | n/a (RBAC-gated, not admin_users-gated) |
| `api/super-admin/students/[id]/impersonate` POST/PATCH | `authorizeAdmin()` | POST=`super_admin`, PATCH=`admin` | not confirmed this pass |
| `api/super-admin/oauth-apps` POST (`approve_app`/`reject_app`/`suspend_app`) | `authorizeAdmin()` | **`support`** (lowest tier) | `logAdminAudit` present |
| `api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry` POST | `authorizeAdmin()` | **`support`** (lowest tier) | `logAdminAudit` present |
| `api/super-admin/test-accounts` POST | `authorizeAdmin()` | `super_admin` | `logAdminAudit` present |
| `api/super-admin/payment-ops/reconcile` POST | `authorizeAdmin()` | `super_admin` | `logAdminAudit` present |

**Finding OPS-1** (MEDIUM confidence, Should-Fix-Before-Release / Informational): two of the routes the constitution names as REG-119 "high-blast-radius" (OAuth app approve/suspend, dead-letter event replay) are gated at `support` — the *lowest* of the 6 `AdminLevel` ranks (`support < analyst < content_manager < finance < admin < super_admin`, `src/lib/admin-auth.ts:28-45`). The regression catalog's REG-119 entry (`.claude/regression-catalog.md:3450-3457`) states these 7 routes "each ALREADY ship a working auth gate — the coverage scan confirmed no security hole" and that REG-119 "pins" the exact tier so a future refactor can't silently downgrade it. I did not find the actual REG-119 test file content to confirm `support` (vs. e.g. `admin`) is the *intended* pinned tier or whether the pin only asserts "some gate exists". Recommend architect/testing confirm the REG-119 test literally asserts `'support'` and that this was a deliberate business decision (e.g., support staff needs to retry a stuck webhook without escalating) rather than an unnoticed floor. Not a blocker — a gate exists and audit-logs the action — but worth independent confirmation given "OAuth client-secret issuance" and "dead-letter replay" are named explicitly in the constitution as high-blast-radius.

### Domain-ownership cross-reference
Per `.claude/skills/super-admin-reporting/SKILL.md`'s per-page ownership matrix, `frontend` owns UI/layout and `ops` owns business-rule/metric-definition logic for every page in the CSV; `assessment` co-owns learner-KPI definitions on `/learning`; `assessment` co-owns content QA on `/cms`. This agent did not verify frontend implementation or assessment sign-off in this pass (out of ops read-only scope for Stage 1 — flagged for the frontend/assessment Stage-1 tracks).

---

## Task 2 — Operational Certification (primary deliverable, feeds report 10)

### Deployment — `.github/workflows/deploy-production.yml` + `deploy-staging.yml` (HIGH — both read in full)

**Production** (`deploy-production.yml`): triggers on push to `main` + `workflow_dispatch`. Job chain: `quality` (lint/type-check/test/build) → `pre-deploy-checklist` (migration diff summary, destructive-SQL grep, secret-pattern grep, env-requirement echo) → `migrations` (runs `supabase db push --linked --include-all` against prod, gated `environment: production`) → `deploy` (Vercel CLI path, **conditionally skipped** unless `vars.USE_CLI_DEPLOY == 'true'` — currently `false` per `gh variable list`, so the canonical web deploy is Vercel's native GitHub App auto-deploy, not this workflow) → `health-check` (5 attempts against `https://alfanumrik.com/api/v1/health`, with Vercel Security-Checkpoint 429 soft-pass logic) → `deploy-functions` (redeploys only changed Supabase Edge Functions, or all if `_shared/` changed) → `post-deploy-verify` (probes `/`, `/login`, security headers) → `release` (tags a GitHub release, gated on `health-check` + `post-deploy-verify` both succeeding).

**Staging** (`deploy-staging.yml`): triggers on push to `develop`/`staging` + `workflow_dispatch`. `quality` → `migrations` (staging Supabase project, separate token) → `deploy` (Vercel Preview, always runs, comments preview URL on the associated PR) → `deploy-functions` → `health-check` (3 attempts, no Vercel-Checkpoint bypass logic — a gap relative to prod's 429-soft-pass).

**Required checks / approval gates**: Both declare `environment: production` / `environment: staging` on relevant jobs. **Finding OPS-2 (HIGH confidence, Should-Fix-Before-Release)**: I queried `gh api repos/AlfanumrikOS/Alfanumrik/environments` (read-only) and found 11 configured GitHub Environments, **every single one with `"protection_rules":[]`** — including the `staging` environment. There is **no `production` (lowercase) environment in the list at all** — the closest matches are `Production` (capital P), `Production – alfanumrik`, and `Production – alfanumrik-learning-os` (three differently-named, seemingly redundant prod-labelled environments, none of which is the exact string `production` the workflow references). Net effect: `environment: production` / `environment: staging` in the workflows provide **secret/variable scoping only** — they are **not** functioning as manual-approval deployment gates (GitHub's "required reviewers" protection is what would make an `environment:` block an actual gate, and none is configured). **Deploys to both staging and production are fully automatic on push — there is no human approval gate in this pipeline today**, despite the environment-name declarations giving the visual impression of one. This should be flagged to architect/user: either configure required-reviewer protection rules on `production` (and clean up the 3 duplicate/legacy Production-labelled environments), or explicitly document that deploys are intentionally auto-approve-on-green-CI.

**Finding OPS-3 (HIGH confidence, Should-Fix-Before-Release)** — undisclosed second deployment pipeline: `.github/workflows/deploy-aws.yml` exists (also triggers on push to `main`) and builds a Docker image → ECR → ECS Fargate, gated behind `vars.ENABLE_AWS_DEPLOY`. The workflow's own header comment says "**DORMANT BY DEFAULT**... Set ENABLE_AWS_DEPLOY = 'true' only during the Route 53 weighted-routing cutover." I ran `gh variable list` (read-only) and found **`ENABLE_AWS_DEPLOY = true`** is currently set at the repo level, along with `PRODUCTION_DOMAIN = https://da8yhieheuw7p.cloudfront.net` (a CloudFront pseudo-domain, not `alfanumrik.com`), `AWS_REGION = ap-south-1`, `ECS_CLUSTER = alfa-prod`, `ECS_SERVICE = web`. This means the AWS ECS pipeline is **actively running on every push to `main`** — not dormant — building and deploying to a live ECS Fargate service, in parallel with the Vercel deploy. I independently confirmed via `nslookup alfanumrik.com` (resolves to `216.150.1.129`, a Vercel anycast range) and `curl -I https://alfanumrik.com` (response header `Server: Vercel`, `X-Vercel-Id: bom1::...`) that **the canonical production domain is still served by Vercel** — the AWS/CloudFront target is pre-cutover and not yet customer-facing. Net: this is a real, currently-running second production-adjacent pipeline that is **completely undocumented in `.claude/CLAUDE.md` and `CLAUDE.md`** (both describe "Deployment: Vercel (bom1/Mumbai)" only, with no mention of AWS/ECS/Route 53 cutover anywhere). Not a blocker (Vercel remains canonical, AWS smoke-tests itself independently with its own auto-rollback via ECS deployment circuit breaker), but this is a significant undisclosed-infrastructure gap for a certification audit and should be called out to architect and the user directly — an in-progress cloud migration that the constitution has zero visibility into.

### Rollback (HIGH — read `docs/BACKUP_RESTORE.md` + both deploy workflows)
- **Vercel**: instant rollback documented (`docs/BACKUP_RESTORE.md:57-71`) — "Promote to Production" on a prior deployment (<30s), plus git-revert-based rollback. `deploy-production.yml`'s `health-check` job also has **automated** rollback-on-failure (`vercel promote` to the previous `Ready` deployment) gated to skip when the only failure signal was a Vercel Security-Checkpoint 429 (correctly avoids false-positive rollbacks).
- **AWS ECS** (new, undocumented pipeline per OPS-3): has its own two-layer rollback — the ECS deployment circuit breaker (automatic) plus an explicit `aws ecs update-service --task-definition <previous>` fallback in the `smoke-test` job.
- **Database migrations**: confirmed **forward-only** — `docs/BACKUP_RESTORE.md:73-91` explicitly documents this limitation and the mitigation is "write a reverse migration" (manual, example given is a `DROP COLUMN` reverse script) or `supabase db reset` (destructive, resets to migration 0 — clearly marked WARNING). This matches Postgres/Supabase reality; no false claim of automatic migration rollback. Confidence: HIGH.

### Monitoring / Alerting

**Sentry** (HIGH — read all 3 config files in full): `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` all initialize with `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN` — **env-driven, not hardcoded**, confirmed by direct read (no literal DSN string anywhere in the 3 files). All three implement a `beforeSend` redactor that (a) drops all events outside `NODE_ENV === 'production'`, (b) reduces `event.user` to `{ id }` only, (c) strips `authorization`/`cookie`/`set-cookie`/`x-api-key` headers, (d) redacts `request.data`/`query_string`/`breadcrumbs`/`extra`/`contexts`/`tags` via the shared `redactPII()` (server/edge) or a dedicated `redactSentryEvent()` (client), and (e) sanitizes URLs via `sanitizeUrl()` to strip token/email query params from `request.url` and from breadcrumb messages. This is a genuine, code-verified implementation matching the constitution's REG-49 claim, not just a docstring assertion.

**CI pipeline-failure alerting — `pipeline-alert.yml`** (HIGH — read in full, independently re-verified against the REG-130 claim, not cited from the catalog blindly): the mechanism is real and matches the constitution's description exactly. It is triggered by `on: workflow_run` for 3 named workflows (`"Deploy Production — Alfanumrik"`, `"Sync Migrations to Staging"`, `"CI — Alfanumrik"`) filtered to `branches: [main]` and `types: [completed]` — genuinely out-of-band (separate workflow file, fires after the watched run concludes, so a totally-dead watched pipeline still triggers this). **Watched-name byte-equality**: confirmed — the `case "$WF_NAME" in "Deploy Production — Alfanumrik") ...` block and the issue-title match (`jq -r --arg t "$TITLE" '.[] | select(.title == $t) | .number'`) both do exact string comparison against the workflow's literal `name:` field (em-dashes included, per the file's own comment warning that a rename requires updating this list). **Dedupe**: confirmed — before opening a new issue it lists open `pipeline-failure`-labeled issues and comments on an existing one with a matching title instead of opening a duplicate. **Self-heal**: confirmed — a separate `resolve` job (triggered on `conclusion == 'success'` for the same 3 workflows) finds and closes the matching open issue with a "Resolved" comment, so an open `pipeline-failure` issue is guaranteed to mean "currently broken." Slack alerting is present as a secondary, best-effort channel (`|| true`, no hard dependency). **Verdict: REG-130's claim is accurate, not overstated.**

**`synthetic-monitor.yml`** (HIGH — read in full): runs a Playwright spec (`e2e/synthetic/`) against `https://alfanumrik.com` (or `vars.SYNTHETIC_TARGET_URL`) every 15 minutes via `schedule: cron: '*/15 * * * *'`, plus `workflow_dispatch`. On failure: uploads trace/screenshot artifacts (14-day retention) and posts to `SYNTHETIC_MONITOR_SLACK_WEBHOOK` if configured (no-op otherwise, workflow still fails/shows red in Actions either way). Optional authenticated-dashboard checks (rows 7+8 per the file's own comment) run only if `SYNTHETIC_AUTH_EMAIL`/`SYNTHETIC_AUTH_PASSWORD` secrets are set — I could not verify from read-only code inspection whether those secrets are actually configured (see gh secret list results below — they are **not** present in the repo-level secret list I retrieved, so those two authenticated checks are most likely skipping in every run today). Flag: NOT VERIFIED whether `SYNTHETIC_AUTH_EMAIL`/`PASSWORD` exist — `gh secret list` only returns names for repo-level secrets I queried; if they're environment-scoped under an environment I didn't separately query, they could still exist. Confidence: MEDIUM.

### Logging — `src/lib/logger.ts` + `src/lib/ops-events-redactor.ts` (HIGH — read both in full)

`logger.ts` delegates all PII redaction to `redactPII()`, imported from `@/lib/ops-events-redactor`, which itself re-exports the canonical implementation from `supabase/functions/_shared/redact-pii.ts` (shared between Next.js and Deno Edge Functions — single source of truth, not two divergent implementations). Every `logger.{debug,info,warn,error}` call routes metadata through `redactPII(meta)` before it's assigned onto the log entry (`createEntry()` line 66-69) — genuinely implemented, not just a docstring claim. `logger.error()` additionally forwards to Sentry via `captureException`/`captureMessage`, wrapped in its own try/catch so a Sentry outage can't break logging. I did not re-read the full `redact-pii.ts` implementation in this pass to confirm the exact key list (password/token/email/phone/API keys) matches the constitution's claim verbatim — **NOT VERIFIED at the key-list level**, though the wiring (every log call → redactor → output) is confirmed. Recommend a follow-up read of `supabase/functions/_shared/redact-pii.ts` to close this gap (out of remaining time budget this pass).

### Health checks — `src/app/api/v1/health/route.ts` (HIGH — read in full)

Comprehensive, always-200 endpoint (explicit design comment: "load balancers don't remove the instance" even when degraded). Checks, run in parallel via `Promise.all`:
- **Database**: `supabaseAdmin.from('curriculum_topics').select('id').limit(1)`, 3s timeout (`SLO.HEALTH_CHECK_TIMEOUT_MS`).
- **Auth**: `supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 })`.
- **Edge Functions**: OPTIONS preflight against the `grounded-answer` Edge Function URL; 5xx = degraded, anything else = reachable; skipped if Supabase env vars absent.
- **Redis** (Upstash): `ping()` or fallback `SET`; skipped if not configured (optional dependency, correctly non-fatal).
- **Razorpay**: authenticated GET against a known-bad payment ID; 200/404/400 = healthy (reachable+authenticated), 401/403 = credential failure, 5xx = Razorpay-side outage; skipped if creds absent.
Top-level `status` is `healthy`/`degraded`/`unhealthy` based on which checks fail; response always includes `version`, `environment`, `uptime_seconds`, `memory`, `cache` stats, and SLO thresholds for dashboard consumption. This satisfies the ops rejection condition "health check endpoint removed or degraded (must always return status)" — the endpoint is present, comprehensive, and structurally cannot itself return non-200.

### Backup strategy / Restore procedure (HIGH — read `docs/BACKUP_RESTORE.md` in full)

Documents Supabase Pro-plan **daily automatic backups (7-day retention)** and **PITR up to 7 days**, both accessed via the Supabase Dashboard (not scripted/repo-automated — this is a manual/dashboard-mediated capability, which is a legitimate NOT VERIFIED item: I cannot confirm from the repo alone whether the production Supabase project is actually on the Pro plan or whether PITR is actually enabled — that requires Supabase dashboard access I don't have. **NOT VERIFIED-DEFERRED**: "is Supabase Pro / PITR actually active on prod" requires Supabase dashboard credentials.). Manual `pg_dump`/`pg_restore` commands are documented for full-DB, schema-only, and table-scoped exports/restores. RTO/RPO targets table is present (RPO <24h / RTO <2h / RPO-with-PITR <5min). Emergency procedures cover DB corruption, security breach (secret rotation list — **still references the already-removed `SUPER_ADMIN_SECRET` as something to rotate, see OPS-4 below**), payment-system failure (flag-based kill switch), and AI/Foxy overload (flag-based kill switch). A weekly monitoring checklist is present but is a manual checklist, not automated.

Separately, `docs/runbooks/per-school-backup-restore.md` exists (not read in full this pass — flagged for a follow-up pass if per-tenant backup granularity needs certifying).

### Secrets management (HIGH — spot-checked)

`.env.example` lists 10 vars: `ANTHROPIC_API_KEY`, `INTERNAL_CALLER_SIGNING_SECRET`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPER_ADMIN_SECRET`, `VOYAGE_API_KEY`. No email-provider credentials appear in `.env.example`, consistent with the constitution's claim that email creds live as Supabase Edge Function secrets, not `.env` (I did not independently re-verify the Edge Function secret store, since I have no `supabase secrets list` access — **NOT VERIFIED-DEFERRED**, requires Supabase project access).

**Finding OPS-4 (HIGH confidence, Should-Fix-Before-Release — documentation contradicts actual system behavior)**: `docs/BACKUP_RESTORE.md:104` lists secrets to rotate during a security breach and includes the line `(SUPER_ADMIN_SECRET removed — admin auth is now session-based)`. This claim is **false** as of the current codebase: I confirmed by direct grep/read that `SUPER_ADMIN_SECRET` is (a) still listed as `required: true` in `src/lib/env-validation.ts:53`, (b) still read via `process.env.SUPER_ADMIN_SECRET` in `src/lib/admin-auth.ts:406` as part of a still-live header-based (`x-admin-secret`) auth path documented at the top of that same file ("Server routes: check `x-admin-secret` request header ONLY"), and (c) still present in `.env.example` as a required var. So the codebase runs **two parallel admin-auth mechanisms** — session-based (`authorizeAdmin`, used by essentially all `/api/super-admin/*` routes I sampled) **and** a still-live secret-header path — while `docs/BACKUP_RESTORE.md` asserts the secret-header path was removed. This is exactly the kind of "documentation contradicts actual system behavior" case in ops' rejection conditions. Per those conditions I should "fix docs to match reality, or fix system" — as a read-only Stage-1 agent I cannot edit either; **flagging for architect/backend follow-up**: either the `x-admin-secret` path needs a genuine deprecation (removing it from `admin-auth.ts` and `env-validation.ts`), or `docs/BACKUP_RESTORE.md` needs the false "(SUPER_ADMIN_SECRET removed...)" parenthetical corrected. This also means the security-breach runbook's rotation checklist is currently *incomplete-by-omission* if a reader trusts the parenthetical and skips rotating `SUPER_ADMIN_SECRET` during an actual incident.

### Environment parity — `.env.example` vs. deploy workflow requirements (MEDIUM confidence)

`deploy-staging.yml` hardcodes `NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co'` and a placeholder JWT at the workflow `env:` level (lines 18-19) purely so the **quality/build** job can run `next build` without real staging credentials (the real staging Supabase project is only used later, in the `migrations` job, via `SUPABASE_STAGING_*` secrets). This is intentional (there's a matching guard in `deploy-production.yml`'s "Reject placeholder env values from Vercel" step that fails the *production* build if it ever sees this exact placeholder string baked into a real deployment) — not a parity bug, but worth noting the pattern exists specifically to prevent placeholder leakage into prod while tolerating it for staging's build-only step. `deploy-aws.yml` (OPS-3) requires a **different and non-overlapping** secret set (`AWS_DEPLOY_ROLE_ARN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY/HOST/ENABLED` as *secrets* rather than the Vercel-injected env vars) baked in at Docker build time — none of these AWS-specific requirements are reflected in `.env.example` at all, which is consistent with `.env.example` being a local-dev file, but worth flagging since AWS is a second live-ish deploy target now (OPS-3).

### Disaster recovery — `docs/runbooks/schema-reproducibility-fix.md` (HIGH — read first 120 lines)

This is a **schema-reproducibility** runbook, not a full DR runbook — its stated purpose is narrowly "replace the broken legacy migration chain with a single pg_dump-derived baseline so a fresh Supabase project can be bootstrapped from scratch." It does constitute a real DR-adjacent capability for one specific failure mode (needing to stand up a brand-new Supabase project from nothing — e.g., if the entire prod project were unrecoverably lost) — Section 4 of the runbook is literally "fresh-project bootstrap test." It explicitly is **not** a data-recovery runbook (no data is captured, only schema) — full data DR still depends on the Supabase Pro PITR/daily-backup story in `BACKUP_RESTORE.md` (see NOT VERIFIED-DEFERRED above for whether that's actually active on prod). Safety rail explicitly documented: "No command in Sections 1-4 mutates prod. The only prod write is Section 5 (`migration repair --status applied`), which is metadata-only." Owner is `architect (DB) with ops oversight`, approver is the user — consistent with this agent's non-DB-schema domain boundary.

### Feature flags — fail-safe verification (HIGH — read `src/lib/feature-flags.ts` in full)

Confirmed fail-**closed** (safe) on every unreachable/malformed path:
- `loadFlags()`: on missing `NEXT_PUBLIC_SUPABASE_URL`/service-role key → returns `[]`. On fetch throwing (network/DNS failure) → returns cached list or `[]` (never throws). On a non-2xx response → returns cached list or `[]`. On a malformed/non-array JSON body → explicitly coerces to `[]` via `Array.isArray(parsed) ? parsed : []`, with an inline comment stating this is deliberate so "every flag then falls back to its default (OFF for all ff_* flags)."
- `isFeatureEnabled()`: defensively re-checks `Array.isArray(flags)` before `.find()` (so even a corrupted cache can't throw); if the flag isn't found → `return false`; if found but `is_enabled === false` → `return false`. Every scoping check (`environment`/`role`/`institution`/`rollout_percentage`) is an explicit deny-unless-matched, never an implicit allow.
This matches the constitution's claim and the ops rejection-condition bar for fail-safe flag evaluation. Confidence: HIGH.

### Operational runbooks — `docs/runbooks/` inventory (HIGH — directory listing; NOT individually read for staleness beyond spot-checks below)

67 files under `docs/runbooks/` (including a `2026-04-27-chunks/` subfolder of 12 raw SQL migration chunks and a `grounding/` subfolder of 6 incident runbooks). Full list captured via `find docs/runbooks -type f`. Spot-checked for currency:
- `docs/runbooks/audit-production-readiness.md` — exists, referenced directly by `.claude/CLAUDE.md`'s reconciliation instructions; not read in full this pass.
- `docs/runbooks/schema-reproducibility-fix.md` — read, internally consistent, dated/scoped clearly (see DR section above).
- `docs/runbooks/vault-secret-rotation.md`, `docs/runbooks/sentry-alert-setup.md`, `docs/runbooks/database-outage-response.md`, `docs/runbooks/payment-webhook-recovery.md`, `docs/runbooks/dead-letter-inspection.md` — present but **not read this pass**; flagged as NOT VERIFIED for staleness, follow-up recommended given the volume (67 files is a lot to certify individually in one Stage-1 pass).
- Two runbooks explicitly named around technical debt rather than aspiration: `docs/runbooks/schema-reproducibility-debt.md` and `docs/runbooks/migration-placeholders-audit.md` — their existence suggests the team tracks debt honestly rather than only aspirationally; not read in full.
- **Scope note**: `docs/ADMIN_OPERATIONS.md` (this agent's directly-owned file per the agent charter) was read in full — see Finding OPS-5 below, a genuine staleness finding in an ops-owned doc, not a runbook.

**Finding OPS-5 (HIGH confidence, Should-Fix-Before-Release)**: `docs/ADMIN_OPERATIONS.md` describes the super-admin panel as having exactly **8 tabs** (Dashboard, Users, Content, Analytics, Feature Flags, Schools, Support, Reports). This is dramatically stale against the actual 62-page / 119-route surface confirmed in Task 1 — entire functional areas documented nowhere in this file include RBAC, OAuth apps, institutions/B2B provisioning, entitlements, invoices, revenue/geography intelligence, marking-integrity forensics, AI grounding/oracle/mol-shadow dashboards, misconceptions curator, AlfaBot, diagnostics/observability/SLA/readiness-rubric, command-center, and workbench. This is the same doc-vs-reality gap class as OPS-4, but at the "entire panel structure" level rather than a single env var. Recommend this doc be regenerated from the current page inventory (this agent's CSV deliverable is a ready-made input) rather than incrementally patched.

**Finding OPS-6 (out-of-scope discovery, Informational)**: while investigating file ownership boundaries I found `docs/` contains substantially more subdirectories than this agent's charter enumerates (`docs/ops/`, `docs/identity/`, `docs/security/`, `docs/architecture/`, `docs/product/`, `docs/b2b/`, `docs/audits/`, `docs/audit/` itself, etc. — dozens of files), none of which were listed in this agent's "Documentation" ownership section or in the constitution's "docs/ (5 operational docs)" claim. The constitution's doc-count claim ("5 operational docs") is stale by at least an order of magnitude. Flagging for architect/orchestrator since doc ownership boundaries may need re-drawing — not fixing this myself as it's outside my write scope and outside my explicitly-listed file ownership.

---

## Task 3 — Reports/Notifications/Analytics journey steps (Super Admin + School Administrator) — feeds report 04

**Super Admin**:
1. Login → session-based auth via `admin_users` table (`authorizeAdmin`), no query-param secrets (`docs/ADMIN_OPERATIONS.md:5-7`, code-consistent per `admin-auth.ts` session path).
2. Control room (`/super-admin`) → platform totals, deployment/backup/audit widgets (ops-owned KPI definitions per `stats`/`observability`/`deploy` routes).
3. Drill into a metric category → dedicated dashboard page (analytics, learning, intelligence/revenue, marking-integrity, grounding/*, sla, etc.) — each backed by its own `route.ts` under `/api/super-admin/`.
4. Export → `/super-admin/reports` → CSV/JSON, capped at 5,000 rows per `ADMIN_OPERATIONS.md` (not independently re-verified against the route's actual row cap this pass — **NOT VERIFIED**, flagged since a PII-bearing export is a P13 concern per this agent's rejection conditions and requires explicit user approval per the super-admin-reporting skill).
5. Alerting loop: `/super-admin/observability` + `/super-admin/alerts` surfaces read from the same health/error-rate signals the `/api/v1/health` endpoint and Sentry produce; `observability/channels` + `observability/rules` let an admin configure where/when alerts fire (this is the admin-facing counterpart to the CI-level `pipeline-alert.yml`/`synthetic-monitor.yml` mechanisms verified above — the two systems watch different things: CI workflows watch pipeline health, `/super-admin/observability` watches product/runtime health).

**School Administrator** (`/school-admin`, NOT this agent's domain — B2B/school territory owned by backend+frontend+architect per the ops-flags discovery doc's Section 2.3, included here only because Task 3 explicitly asks for it):
1. Login → separate `/school-admin` route/auth path (not `/super-admin`'s `admin_users` table — a distinct tenant-admin auth surface; NOT independently verified by this agent since it's outside ops' file ownership).
2. Command Center home (`page`) → gated behind `ff_school_command_center` (comment in the flag registry says "globally ON in prod as of 2026-06-16, legacy dispatch removed client-side" — NOT VERIFIED by ops this pass, cited from the discovery doc's own reading of the flag-registry comment, not independently re-read by me).
3. `reports` / `reports-depth` pages → school-wide mastery/Bloom's reporting, gated behind `ff_school_reports_depth` (default false, no seed migration found per the discovery doc — **flag exists in the registry but is reportedly unseeded in the DB**, meaning `isFeatureEnabled()` would return `false` for everyone since an absent row = "flag doesn't exist → disabled" per the fail-closed logic verified above; NOT VERIFIED independently by ops this pass, flagged for backend/architect to confirm whether this flag has since been seeded).
4. `audit-log` page → school-scoped audit trail, parallel to super-admin's `/super-admin/logs` but tenant-scoped (not independently verified).
5. `billing` page → gated behind `ff_school_self_service_billing_v1` per the discovery doc (not independently verified).

I did not deep-dive the School Administrator journey beyond this cross-reference — it is explicitly out of this agent's domain ownership (`.claude/CLAUDE.md` "NOT Your Domain" does not list school-admin, but the discovery doc's own Section 2.3 correctly notes school-admin belongs to backend/frontend/architect, not ops) and Task 3 only asked for journey *steps*, not a full certification of that surface.

---

## Independent re-verification worklist

### 1. CI pipeline-failure alerting (REG-130) — DONE, see "Monitoring / Alerting" section above.
**Verdict: claim matches implementation.** Confidence: HIGH.

### 2. `gh variable list` / `gh secret list` — DONE (read-only, `gh` authenticated as `AlfanumrikOS`, token scopes `gist, read:org, repo, workflow`)

**Repo-level variables** (`gh variable list`):
```
AWS_REGION           ap-south-1
ECR_REPOSITORY       alfa-web
ECS_CLUSTER          alfa-prod
ECS_SERVICE          web
ENABLE_AWS_DEPLOY    true          <- see OPS-3, this is the live-cutover flag
PRODUCTION_DOMAIN    https://da8yhieheuw7p.cloudfront.net
USE_CLI_DEPLOY       false
```
`gh variable list --env production` and `--env staging` both returned empty — no environment-scoped variables, everything is repo-level.

**Repo-level secrets** (names only, `gh secret list --json name`):
```
AWS_DEPLOY_ROLE_ARN, GCP_PROJECT_ID, GCP_RUNTIME_SERVICE_ACCOUNT, GCP_SERVICE_ACCOUNT,
GCP_WORKLOAD_IDENTITY_PROVIDER, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL,
STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY, STAGING_SUPABASE_URL,
SUPABASE_ACCESS_TOKEN, SUPABASE_CLI_GITHUB_TOKEN, SUPABASE_PROJECT_ID,
SUPABASE_STAGING_ACCESS_TOKEN, SUPABASE_STAGING_DB_PASSWORD, SUPABASE_STAGING_PROJECT_REF,
TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD, VERCEL_AUTOMATION_BYPASS_SECRET, VERCEL_TOKEN
```
**`production` environment secrets** (`gh secret list --env production`): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` — present. **`staging` environment secrets** (`gh secret list --env staging`): **empty `[]`**.

**This directly informs Stage 3 provisioning feasibility**: `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY` **do exist** as repo-level secrets (confirmed present by name), so `deploy-staging.yml`'s reference to `secrets.SUPABASE_STAGING_ACCESS_TOKEN`/`SUPABASE_STAGING_DB_PASSWORD`/`SUPABASE_STAGING_PROJECT_REF` resolves correctly (repo-level secrets are visible to jobs declaring `environment: staging` even though the `staging` *environment* itself has zero secrets of its own — GitHub environment secrets and repo secrets are additive, not exclusive). **VERCEL_TOKEN and VERCEL_AUTOMATION_BYPASS_SECRET both exist** at repo level — meaning the two-tier Vercel Security-Checkpoint bypass logic documented in `deploy-production.yml`'s health-check job has a real bypass secret configured, not just a soft-pass fallback. I cannot verify secret *values* (by design — `gh secret list` only ever returns names) so I cannot confirm the tokens are valid/non-expired; that would require an actual workflow run, which is execution not read-only inspection.

**Environments** (`gh api repos/.../environments`, 11 total): `ANTHROPIC_API_KEY`, `copilot`, `Preview`, `Production`, `Production – alfanumrik`, `Production – alfanumrik-learning-os`, `staging`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN_2`, `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_DB_PASSWORD`. Note the last 5 environment *names* are literally secret-variable-shaped strings (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN_2`, etc.) — this looks like environments were accidentally created with secret-name-shaped titles at some point (possibly a UI mis-click history, or leftover from an experiment), not a security leak (environment *names* aren't secret values), but it's messy and worth a cleanup pass. **All 11 environments have `protection_rules: []`** — see OPS-2 above, no approval gates exist anywhere in this repo today.

### 3. Regression catalog count cross-check (HIGH — direct `wc`/`grep` on `.claude/regression-catalog.md`)

**The constitution's claim is stale and understates the real count by a wide margin.** `.claude/CLAUDE.md` states: *"142 entries catalogued (target: 35 — TARGET EXCEEDED)... latest REG-175 Digital Twin + Knowledge Graph Slice 1"* and separately *"This narrative line was last reconciled through REG-134."*

Actual file (`.claude/regression-catalog.md`, 7019 lines): the file's **own internal running-total markers** (`grep -n "^\*\*Total catalog:"`) show a monotonically-increasing series ending at:
```
**Total catalog: 192 entries (target: 35 — TARGET EXCEEDED).**   (through REG-225)
**Total catalog: 193 entries (target: 35 — TARGET EXCEEDED).**   (through REG-226, today's entry)
```
The highest REG-ID present in the file is **REG-226** (`quiz_rpc_ownership_check`, added 2026-07-02 — same day as this audit — closing a critical cross-student quiz-RPC forgery vulnerability found by "Phase 2 security audit SD-SWEEP"). Unique REG-IDs counted directly (`grep -oE "REG-[0-9]+" ... | sort -u`) = **191** distinct IDs spanning REG-36 through REG-226 (the catalog's own numbering has some gaps/renumbers noted inline, e.g. "REG-123 id was taken by the renumbered Foxy-OS entry" — consistent with the file's own self-correcting narrative).

**Verdict: the real, current, authoritative count is 193 entries (per the file's own last "Total catalog:" line) / REG-226 is the latest ID — not 142 entries / REG-175 as the constitution claims.** This is a **51-entry, 51-ID understatement** in `.claude/CLAUDE.md` — a materially stale reconciliation, not a rounding error. Confidence: HIGH (direct grep of the authoritative source file, cross-checked two independent ways — the file's own printed running totals, and an independent unique-ID count). Impact: **Should-Fix-Before-Release** — a certification board relying on the constitution's "142/REG-175" figure would materially undercount test coverage of product invariants and miss that a *same-day* critical security fix (REG-226, cross-student quiz-RPC forgery closed via migration `20260702150000_p3w1_5_quiz_rpc_ownership_check.sql`) already has a regression pin in place. Recommend orchestrator trigger a full constitution reconciliation pass (the constitution's own header says exactly how: "run the production-readiness audit... or invoke the orchestrator with 'audit production readiness'").

---

## Summary of findings requiring board attention

| ID | Finding | Confidence | Impact |
|---|---|---|---|
| OPS-1 | REG-119 OAuth-app / dead-letter-replay routes gated at `support` (lowest tier) — gate exists + audit-logged, but tier-appropriateness not independently confirmed against the REG-119 test's actual pinned assertion | MEDIUM | Informational / Should-Fix-Before-Release (confirm intent) |
| OPS-2 | No GitHub Environment in this repo has protection rules configured — `environment: production`/`staging` in workflows provide secret-scoping only, NOT a human approval gate; deploys are fully automatic on green CI | HIGH | Should-Fix-Before-Release |
| OPS-3 | Second, currently-**active** (not dormant) AWS ECS deploy pipeline (`ENABLE_AWS_DEPLOY=true`) building/deploying to a CloudFront domain on every push to `main`, completely undocumented in the constitution's "Deployment: Vercel" claim; confirmed Vercel remains canonical for `alfanumrik.com` today (DNS + `Server: Vercel` header) | HIGH | Should-Fix-Before-Release (disclosure gap, not a live outage) |
| OPS-4 | `docs/BACKUP_RESTORE.md` falsely claims `SUPER_ADMIN_SECRET` was "removed — admin auth is now session-based"; the secret-header (`x-admin-secret`) admin-auth path is still live in `src/lib/admin-auth.ts` and still `required: true` in `env-validation.ts` — doc contradicts actual system behavior, and the contradiction sits inside a security-breach rotation runbook | HIGH | Should-Fix-Before-Release |
| OPS-5 | `docs/ADMIN_OPERATIONS.md` describes an 8-tab admin panel; actual surface is 62 pages / 119 routes across ~20 functional groups — doc is severely stale | HIGH | Should-Fix-Before-Release |
| OPS-6 | Constitution's "docs/ (5 operational docs)" claim is stale by roughly an order of magnitude; large `docs/` subtree (ops/, identity/, security/, architecture/, product/, b2b/, audits/, etc.) exists outside any agent's explicitly-listed doc ownership | LOW/Informational | Post-Release-Acceptable |
| OPS-7 | Regression catalog: constitution claims 142 entries / latest REG-175; actual file's own running total is **193 entries / latest REG-226** — 51-entry understatement, including a same-day critical security-fix regression pin (REG-226) the constitution has zero visibility into | HIGH | Should-Fix-Before-Release |
| — | `redact-pii.ts` exact PII key list not re-verified this pass (wiring confirmed, key list not) | MEDIUM | NOT VERIFIED-DEFERRED, low risk given wiring is confirmed |
| — | Supabase Pro plan / PITR actually active on prod — cannot verify from repo alone | N/A | NOT VERIFIED-DEFERRED (requires Supabase dashboard access) |
| — | `SYNTHETIC_AUTH_EMAIL`/`PASSWORD` secrets — not found in repo-level secret list, so authenticated synthetic checks likely skip every run; could exist environment-scoped and unqueried | MEDIUM | NOT VERIFIED-DEFERRED |
| — | 65 of 67 `docs/runbooks/` files not read for staleness this pass (2 spot-checked) | N/A | NOT VERIFIED-DEFERRED, follow-up recommended |
| — | 53 of 62 super-admin pages' backing routes not individually auth-spot-checked this pass (9 verified, see CSV) | N/A | NOT VERIFIED-DEFERRED, follow-up recommended for Tier-0 rows specifically |

## Files referenced (for board traceability)
- `src/app/super-admin/**/page.tsx` (62 files), `src/app/api/super-admin/**/route.ts` (119 files)
- `src/lib/feature-flags.ts`, `src/lib/logger.ts`, `src/lib/ops-events-redactor.ts`, `src/lib/admin-auth.ts`, `src/lib/env-validation.ts`
- `src/app/api/v1/health/route.ts`
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- `.github/workflows/deploy-production.yml`, `deploy-staging.yml`, `deploy-aws.yml`, `pipeline-alert.yml`, `synthetic-monitor.yml`
- `docs/BACKUP_RESTORE.md`, `docs/ADMIN_OPERATIONS.md`, `docs/RBAC_MATRIX.md`, `docs/runbooks/schema-reproducibility-fix.md`
- `.claude/regression-catalog.md` (7019 lines, 193-entry authoritative total as of REG-226)
- `.env.example`
- `docs/audit/2026-07-02-discovery/06-ops-flags.md` (supporting evidence, cross-checked not blindly trusted)
