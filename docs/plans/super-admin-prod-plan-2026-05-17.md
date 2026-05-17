# Super-Admin Production-Readiness Plan

**Date:** 2026-05-17
**Author:** Build agent (acting on CEO directive)
**Scope:** Make `/super-admin/*` and `/api/super-admin/*` production-grade — live data everywhere it claims, demo accounts with full access creatable end-to-end, RBAC enforced, audit complete.
**Status:** Draft for CEO acceptance. Phase F sequencing assumes Phases A–E (May 2026 readiness plan) already on `main`.

---

## 0. Unbiased one-paragraph verdict

The super-admin console is **mostly wired** to live Supabase / PostHog / Sentry sources — 43 of the 50 pages and ~91 of 96 API routes hit real tables. Three discrete defect classes are responsible for the CEO-perceived "many features not working" / "data not live" / "can't create demo accounts" symptoms:

1. **A single un-applied migration** (`demo_accounts` table + `reset_demo_account` RPC, currently quarantined in `supabase/migrations/_legacy/timestamped/`) breaks every demo-create / demo-reset action.
2. **Three pages render synthetic fallbacks without disclosure** — SLA endpoint latencies (`school_slo` table doesn't exist in prod), the deploy version header (`'2.0.0'` literal), and `grounding/health.circuitStates` (permanently `{}`).
3. **RBAC is shallow** — every super-admin API checks "is the caller in `admin_users` and active", but never checks the caller's `admin_level`. Today this is operationally safe because all 3 active admins are `super_admin` tier, but the moment a `support` or `analyst` row is added, the gate is effectively open. Pages also rely on a client-side `useEffect` redirect with no server-side gate.

Everything else (institutions, analytics, observability, oracle health, feature flags, CMS, content coverage, RBAC console, OAuth apps, foxy quality, marking integrity, misconceptions, subscriptions billing, invoices, support, bulk actions, projector replay, view-as) reads from the real schema. There is no codebase-wide "stub" problem. The work below is targeted, not a rewrite.

---

## 1. Audit findings (by priority)

Citations use `path:line` against the canonical repo at `C:\Users\Bharangpur Primary\Alfanumrik-repo`.

### P0 — Blocks demo onboarding or fakes production data

| # | Finding | Evidence | Why P0 |
|---|---|---|---|
| P0-1 | `demo_accounts` table and `reset_demo_account` RPC do not exist in prod. Every `POST /api/super-admin/demo-accounts` succeeds on auth-user create, succeeds on profile-row insert (the `is_demo` columns DO exist), then **fails on the registry insert** (`route.ts:275, 461`) and rolls back the auth user (`route.ts:481`). Operator sees 400 / 500. | Verified via Supabase MCP against prod project `shktyoxqhundlvkiwguu`. Migration body lives in `supabase/migrations/_legacy/timestamped/20260402110000_demo_accounts_tables_and_rpc.sql`. | Root cause of "unable to create demo accounts with full access." |
| P0-2 | UI persona enum mismatch. `src/app/super-admin/demo/page.tsx:35` offers `weak_student`; API Zod at `src/app/api/super-admin/demo-accounts/route.ts:324` accepts only `weak | average | high_performer`. Selecting "Weak Student" 400s before any DB write. | Direct read of both files. | Blocks the most-used persona in single-create mode. |
| P0-3 | `guardian_student_links.approved_by` is typed `uuid` (baseline 11422); demo route writes the string `'admin'` (`route.ts:255-269, 441-456`). Insert silently fails (response not checked) → parent demo accounts have no linked student → parent portal is empty for the demo. | Code + baseline. | Parent demo flow ships a non-functional account. |
| P0-4 | `subscription_plan='unlimited'` is set on `students` (`route.ts:381, 201`) but no row is inserted into `student_subscriptions` and no call to `atomic_subscription_activation`. Anything that gates on the canonical subscription record treats the demo as `free`. | Code + baseline 637 comment on split-brain risk. | "Full access" demo isn't actually full access. |
| P0-5 | No `super_admin` or `school_admin` demo path exists. Only `student | teacher | parent`. CEO directive says "demo accounts with full access" — interpreted strictly that means demo super-admin + demo school-admin must also be creatable. | `page.tsx:11`, `route.ts:321`. | Missing functionality, not a bug. |
| P0-6 | `/super-admin/sla` injects 5 synthetic endpoint latency rows + `99.9%` uptime per school whenever `school_slo` / `health_check_log` is empty (and both tables do not exist in prod). No banner signals fallback. | `src/app/api/super-admin/sla/route.ts:82, 149-164, 212-222, 248`. Verified via Supabase MCP — tables absent. | Operator believes synthetic numbers are real SLA measurements. |
| P0-7 | `/super-admin` Control Room shows `app_version: '2.0.0'` — string literal, not derived from any build. | `src/app/api/super-admin/deploy/route.ts:23`. | Misleads on what's actually deployed. |

### P1 — Real but degraded; security thinning

| # | Finding | Evidence |
|---|---|---|
| P1-1 | `authorizeAdmin` never compares `admin_level` to a required value. Any active `admin_users` row passes every super-admin route. | `src/lib/admin-auth.ts:51-172`, no caller compares the returned `adminLevel`. |
| P1-2 | Silent fallback in `admin-auth.ts:141-153`: when service-role `admin_users` lookup returns empty, retries with caller's own JWT and admits if that returns a row. Defeats any tightened RLS on `admin_users`. Logged only as `console.warn`. | Code. |
| P1-3 | `rbac/route.ts` mints elevations, impersonations, and delegation tokens with **manual truthy validation only** (lines 102-220) — no Zod, no UUID validation, no `durationHours` bounds. | Code. |
| P1-4 | Pages have no server-side auth gate. `layout.tsx:10-16` is cosmetic; every page is `'use client'` and redirects via a `useEffect` in `AdminShell.tsx:69-99`. Page chrome paints before redirect; redirect bypassable with JS disabled. | Code. |
| P1-5 | Audit-table mismatch. Blueprint §3 says writes land in `audit_logs`. All super-admin writes land in `admin_audit_log`. SIEM/queries pointed at `audit_logs` miss every super-admin action. `admin_audit_log` also lacks `school_id`, `user_agent`, `before_state`/`after_state` columns. | `src/lib/admin-auth.ts:182, 222, 295`; MCP describe of `admin_audit_log`. |
| P1-6 | All student-PII read routes (`students/[id]/profile|dashboard|foxy-history|progress|quiz-history`) have **no audit log write**. Admins can read full learner PII invisibly. | Routes. |
| P1-7 | Impersonation start (`students/[id]/impersonate/route.ts:63-122`) lets any admin become any student — no level check. | Code. |
| P1-8 | `/super-admin/login` bypasses the Next proxy entirely (`signInWithPassword` directly from browser) → app's 60/min admin rate-limit does not apply. Brute-force protection is Supabase Auth-side only. | `src/app/super-admin/login/page.tsx:22`; `src/proxy.ts:927-938`. |
| P1-9 | `feature-flags` PATCH allows any admin to flip `target_grades / target_institutions / target_roles / target_environments`. Audit is present, but no level gate. A `support` admin could enable `ff_agent_mesh_v1` at 100% in prod. | `feature-flags/route.ts:133-225`. |

### P2 — UX defects and operational gaps

| # | Finding | Evidence |
|---|---|---|
| P2-1 | `/super-admin/subscriptions` plan-filter UI is dead — `page.tsx:58` sets the wrong query param. User picks a plan, list doesn't filter. | Code. |
| P2-2 | `/super-admin/grounding/health` always renders empty "Circuit States" — `circuitStates: {}` with TODO at `route.ts:20` waiting for a column. | Code. |
| P2-3 | `goal-profiles` is a constant array dressed as an API. Operators see it as "data" but cannot persist edits. | `goal-profiles/route.ts:31-36`. |
| P2-4 | `improvement/staging` workflow is stubbed for `code_patch` and `manual` execution types (no actual patch). | `improvement/staging/route.ts:5-9`. |
| P2-5 | `Math.random()` used for credential material in 3 places (demo, test-accounts, bulk-upload). Fine for throwaway demo, but **bulk-upload provisions real student accounts** with these passwords (`bulk-upload/route.ts:179`). | Code. |
| P2-6 | `demo-accounts` GET swallows fetch errors on the page (`page.tsx:51`). When the table is missing, operator sees "0 accounts" not "DB error". | Code. |
| P2-7 | `alerts/route.ts:54-57` returns `[]` when `school_alert_rules` is missing — masks "no rules configured" vs "table not migrated". | Code. |
| P2-8 | Per-school health column (`/super-admin/health`) shows `'na'` white-label dot until `synthetic_monitor_results` has data. Table exists, but the synthetic-host-monitor Edge Function is deployed-but-not-scheduled (per Phase E.5 follow-up). | Code + memory. |
| P2-9 | `improvement/staging` and several `command-center` actions auto-mark items as `staging` without performing the underlying action — operators may believe a fix shipped when it didn't. | `improvement/staging/route.ts`. |
| P2-10 | No "Show password again" or "Email credentials" path on demo create. If operator dismisses the modal, password is gone (passwords are not retrievable). | `demo/page.tsx:361-414`. |

### P3 — Polish & developer ergonomics

| # | Finding |
|---|---|
| P3-1 | `deploy/route.ts:11-77` writes `deployment_history` on every GET with no audit row. Read with a side-effect. |
| P3-2 | `admin-auth.ts:283-306` `logAdminAction()` writes `admin_id: null` "until proper admin accounts are used" — pre-existing TODO. |
| P3-3 | `/super-admin/students/[id]` is intentionally partial per its own docstring; richer version pending merge from `feature/observability-console`. |
| P3-4 | `proxy.ts:229` `return null; // Network error, allow through` — fail-open in session validation. Not on super-admin path but lives in the file that owns admin gating. |
| P3-5 | Control-Room polls 8 endpoints every 30s. At even 10 concurrent operators, that's ~9 600 super-admin requests/hour — costly and noisy. |
| P3-6 | No structured "blueprint compliance" comment in super-admin handlers — hard to ratchet enforcement via lint. |

### What's actually working well (don't break)

- Institutions, analytics, analytics-b2b, oracle-health, marking-integrity, observability (snapshot/events/channels/rules), logs, flags, CMS, content-coverage, workbench, users, support, invoices, RBAC console, OAuth apps, alerts, module-overrides, misconceptions, foxy-quality, grounding/coverage/traces/ai-issues/verification-queue, subscribers, subjects/{grade-map,plan-access,violations}, view-as student dashboards, command-center improvement console — all read from real tables / real services with consistent auth.

---

## 2. Production plan — Phase F → J

Phases A–E are landed (per `project_prod_readiness_phase_e_complete.md`). This continues the sequence. Each phase ends with a feature-flag-gated PR and an acceptance test.

### Phase F — Unbreak the demo & purge synthetic fallbacks (Week 1, ~5 days)

Goal: every page either shows live data or shows a structured "no data" state with a banner — no silent synthetic values; demo creation works end-to-end for **5 personas** (student, teacher, parent, school-admin, super-admin).

**F.1  Demo-accounts schema restoration** *(P0-1, P0-3, P0-4)*
- New migration `20260518000001_promote_demo_accounts_from_legacy.sql` — verbatim promotion of `_legacy/timestamped/20260402110000_demo_accounts_tables_and_rpc.sql` into the active set, **plus**:
  - `guardian_student_links.approved_by` insert path: change route to write the calling admin's `auth_user_id` (which is a UUID), not the string `'admin'`. Pure code fix in `demo-accounts/route.ts:267, 454`.
  - On successful student demo create, also insert a `student_subscriptions` row by calling `atomic_subscription_activation` with `plan_code='unlimited'` and a year-out `period_end`. Eliminates the split-brain.
- Acceptance: `POST /api/super-admin/demo-accounts {role:'student', persona:'weak_student'}` returns 200, the persona is correctly validated (see F.2), and the new `student_subscriptions` row exists with `plan_code='unlimited'`.

**F.2  Persona enum reconciliation** *(P0-2)*
- Single source of truth: `src/lib/demo/personas.ts` exporting `DEMO_PERSONAS = ['weak_student', 'average', 'high_performer'] as const`.
- Import in both UI (`demo/page.tsx`) and API Zod (`demo-accounts/route.ts:324`). Rename `weak` → `weak_student` repo-wide (one find-replace + Zod update).
- Acceptance: type-check passes; UI option matches API enum exactly.

**F.3  Demo super-admin + demo school-admin paths** *(P0-5)*
- Extend `demo-accounts/route.ts` to support `role: 'super_admin' | 'school_admin'`:
  - `super_admin` → create auth user, insert `admin_users` row with `admin_level='super_admin'`, `is_active=true`, `is_demo=true` (new column on `admin_users`, see F.4).
  - `school_admin` → create auth user, insert `school_admins` row pointing at a fresh demo school (auto-create `schools` row with `is_demo=true`), insert classroom + 3 seed students, attach to a paid `school_subscriptions` row in `status='trial'` with a 30-day window.
- New migration `20260518000002_demo_account_extensions.sql` adds `is_demo bool default false` on `admin_users`, `schools`, `student_subscriptions`, `school_subscriptions`.
- Reset RPC extended to clear demo school cascade (students → subscriptions → school).
- Acceptance: operator can create 5 demo accounts (student / teacher / parent / school_admin / super_admin), log in to each, and exercise the relevant portal end-to-end with the seeded data.

**F.4  Demo lifecycle hardening** *(P2-5, P2-6, P2-10)*
- Replace `Math.random()` credential generation with `crypto.randomBytes(9).toString('base64url')` in all 3 routes.
- Replace silent fetch error swallow with a top-of-page error banner (`Sonner` toast — already in the stack).
- Add `POST /api/super-admin/demo-accounts/:id/resend-credentials` that emails the new password via the existing email service (`src/lib/email/*`).
- Auto-purge demo accounts older than 30 days via a daily cron (`pg_cron` already used for data-erasure — same pattern).
- Acceptance: passwords are cryptographically random; lost-password path works; no orphan demo accounts after 31 days.

**F.5  Kill synthetic fallbacks** *(P0-6, P0-7, P2-2, P2-3, P2-7)*
- `sla/route.ts:82, 149-164, 212-222`: when `school_slo` / `health_check_log` empty, **return `{state: 'no_data', message: 'SLO instrumentation not yet enabled — see runbook'}` and have the page render a yellow "No SLA data" banner**. Remove every hardcoded number.
- New migration `20260518000003_school_slo_and_health_check_log.sql` — creates the two tables + a single nightly aggregator function `aggregate_school_slo_daily()` driven by `pg_cron`.
- `deploy/route.ts:23`: read `app_version` from `process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) ?? 'dev'` + the `package.json` version. Fall back to `'unknown'`, never to a hardcoded string.
- `grounding/health/route.ts:20`: add the missing `circuit_state` column via `20260518000004_grounding_circuit_state.sql`; back-fill from existing `grounded_ai_traces` aggregates; remove the TODO.
- `goal-profiles/route.ts`: add migration `20260518000005_goal_profiles_table.sql` mirroring the constant; switch route to DB-read; add PATCH for inline edits with audit.
- `alerts/route.ts:54-57`: replace `return []` with `return { state: 'table_missing', rules: [] }`; UI banners.
- Acceptance: grep over all super-admin routes for `hardcoded`, `99.9`, `Math.random`, `Lorem`, `Coming soon`, `Not implemented`, `'2.0.0'` returns zero hits.

**F.6  Subscriptions plan filter fix** *(P2-1)*
- 1-line fix in `subscriptions/page.tsx:58` to send `plan=` query param; backend already supports it via `analytics?plan=`.

### Phase G — Tight RBAC, server-side gates, complete audit (Week 2, ~5 days)

Goal: blueprint §3 conformance — auth + role + audit on every super-admin route; pages refuse to render to anonymous users on the server.

**G.1  `admin_level` enforced everywhere** *(P1-1, P1-7, P1-9)*
- Refactor `authorizeAdmin(request, requiredLevel?: AdminLevel = 'support')` to compare the resolved level against a precedence table (`super_admin > admin > finance > content_manager > support > analyst`).
- Every route declares its minimum level. Defaults:
  - `read-only routes` → `support`
  - `mutations on students/teachers/guardians` → `admin`
  - `impersonation, rbac elevations, delegation tokens, bulk plan changes, feature-flag flips, tenant provisioning` → `super_admin`
- Add Vitest matrix covering all 96 routes — assert each rejects the levels below its minimum.

**G.2  Remove the JWT-fallback** *(P1-2)*
- Delete `admin-auth.ts:141-153`. The service-role query is authoritative; if it doesn't find the user, return 403.
- Add Vitest: a user with a session but no `admin_users` row gets 403 deterministically.

**G.3  Server-side gate on every super-admin page** *(P1-4)*
- Convert `src/app/super-admin/layout.tsx` to a server component that:
  - Reads the Supabase session server-side.
  - Calls `requireAdmin('support')` (new server util mirroring `authorizeAdmin`).
  - On failure, `redirect('/super-admin/login')` server-side — no client paint.
- Keep `AdminShell` for client-only chrome (notification poller, theme), strip the auth `useEffect`.
- Per-page level escalation: pages that mutate (e.g. `/super-admin/rbac`, `/super-admin/flags`) declare their minimum via a top-of-file `export const requiredAdminLevel = 'super_admin'` consumed by the layout.

**G.4  Migrate audit writes to `audit_logs`** *(P1-5)*
- New migration `20260519000001_admin_audit_log_to_audit_logs_view.sql`: keep `admin_audit_log` table for backwards compat but make `audit_logs` the canonical destination. Add `school_id`, `user_agent`, `before_state jsonb`, `after_state jsonb` to `audit_logs` if not already there.
- Replace every `admin_audit_log` insert in `admin-auth.ts:182, 222, 295` with `audit_logs` writes, capturing the missing fields.
- Add a database view `admin_audit_log` selecting from `audit_logs WHERE actor_type='admin'` so existing dashboards still work.
- Backfill `audit_logs` from `admin_audit_log` once.

**G.5  Audit student-PII reads** *(P1-6)*
- Add `logAdminAudit({ action: 'student_profile.read', entity: 'student', entity_id })` to: `students/[id]/profile`, `students/[id]/dashboard`, `students/[id]/foxy-history`, `students/[id]/progress`, `students/[id]/quiz-history`.
- Throttle: at most 1 audit row per (admin, student, action, hour) to avoid log explosion on multiple page loads — use the existing `INSERT … ON CONFLICT DO NOTHING` pattern with a `(admin_id, entity_id, action, date_trunc('hour', now()))` unique index.

**G.6  Tighten input validation** *(P1-3)*
- Replace all manual `if (!x || !y)` validation in `rbac/route.ts`, `institutions/route.ts`, `bulk-actions/*`, `institutions/provision`, `verify-domain`, `attach-vercel-domain` with Zod schemas declared in `src/lib/schemas/super-admin/*.ts`.
- Centralized `zUuid = z.string().uuid()`, `zAdminLevel = z.enum(...)`, `zDurationHours = z.number().int().min(1).max(72)`.
- Zod errors return a `400 { code: 'validation_error', issues: [...] }`.

**G.7  Brute-force protection on super-admin login** *(P1-8)*
- Add a server-action wrapper at `/api/super-admin/login` that calls `signInWithPassword` server-side and is gated by the proxy's admin rate-limit bucket (60/min/IP).
- Add per-email 5-attempt-then-15min-lockout via a new `admin_login_attempts` table (idempotent insert with a window).
- Front the form with `@upstash/ratelimit` (already in stack via Vercel KV — confirm or fall back to in-table counter).

### Phase H — Live data quality, observability, "no data" UX (Week 3, ~4 days)

**H.1  Synthetic-host-monitor scheduling** *(P2-8)*
- Wire `synthetic-host-monitor` Edge Function into `pg_cron` at 5-minute cadence (per Phase E.5 follow-up).
- Acceptance: white-label per-school dot turns green/yellow/red within 10 min of an outage.

**H.2  "No data" component library**
- New `<NoDataState reason="..." learnMoreHref="..." />` component in `src/app/super-admin/_components/`. Every page that depends on an instrumentation table renders this when the table is empty, never a fallback constant.
- Add an admin-side "instrumentation status" badge per page (green = live, yellow = partial data, red = table missing).

**H.3  Real-time refresh via Supabase realtime, not polling** *(P3-5)*
- Replace the 30s polling in the Control Room with a `supabase.channel('admin-ops')` subscribed to `ops_events` + `quiz_sessions` count via the existing `ff_realtime_subscriptions_v1` flag (already in the codebase, default OFF). Promote to ON for super-admin operators only via `target_roles`.

**H.4  Sentry integration on `/super-admin/health` errors_24h column** *(per Phase E.6 follow-up)*
- Use `@sentry/nextjs` `getCurrentHub().getClient()` and the Sentry HTTP API to fetch per-school issue counts for last 24h; replace the `—` placeholder with real values.

**H.5  PostHog HogQL parity for analytics**
- `/super-admin/analytics` uses Supabase counts only. Add a parallel PostHog HogQL pull (DAU, WAU, retention, funnel) on the same page so operators see product analytics alongside DB counts. Already partially wired via `oracle-health`.

### Phase I — White-label + multi-tenant super-admin (Week 4, ~5 days)

Today the super-admin is single-tenant in spirit. To handle "numerous number of schools" (CEO directive 2026-05-16), we need:

**I.1  Tenant filter** — top bar lets the operator scope every page to one school / one franchise / all (default). Persisted in URL search-param; every API accepts `?tenant_id=`. RLS already supports `tenant_id`-scoped queries (Phase B/C/D foundation).

**I.2  "View as school admin" / "View as parent"** — extend `view-as` beyond students to school-admin and parent dashboards. Same impersonation flow, gated to `super_admin` level only.

**I.3  Tenant onboarding wizard** — wraps the existing `provision`, `verify-domain`, `attach-vercel-domain`, `bulk-upload` routes into a single 5-step wizard with progress + rollback. Each step idempotent.

**I.4  Per-tenant feature-flag overrides surface** — `module-overrides` page already exists; extend to surface ALL `ff_*` flags overridable per tenant via `target_institutions`. PATCH writes audit.

### Phase J — Operational hardening, runbooks, scale (Week 5, ~3 days)

**J.1  Lint rule** `no-hardcoded-fallback-in-admin-route` — fails CI on `Math.random`, hardcoded percentages, hardcoded version strings, `Coming soon`, `not implemented` in `src/app/api/super-admin/**`. Allow-list via `// admin-fallback:allow <reason>`.

**J.2  Vitest contract test per super-admin route** — asserts each route (a) requires auth, (b) enforces its declared `admin_level`, (c) writes audit on success and on permission-denied, (d) returns structured `{code, message, details?}` on error. ~96 tests; can be generated from a single template + a route registry.

**J.3  Synthetic E2E with Playwright** — login as a demo super-admin every 15 min, click through 5 critical pages (Control Room, institutions, RBAC, demo, flags), assert no console errors and no 5xx. Surfaces regressions before operators do.

**J.4  Per-school health drill-down on `/super-admin/health`** — clicking a row opens a drawer with last 7 days of synthetic monitor results, last 24h Sentry issues, latest deploy SHA. Already 80% wired; needs the drawer.

**J.5  Runbooks**
- `docs/runbooks/super-admin-demo-accounts.md` — how to create, rotate, reset, audit demo accounts; how to investigate a failed create.
- `docs/runbooks/super-admin-rbac.md` — how to add an admin, promote/demote level, audit a contested action.
- `docs/runbooks/super-admin-sla.md` — what each column on the SLA page means; when "No data" is expected vs alarming.

---

## 3. Tooling / plugin choices (best-tech but stack-conformant)

The blueprint §11 forbids new services without explicit ask. Below is the minimal set that's either already in the stack or is a direct extension of it:

| Need | Choice | Why |
|---|---|---|
| Brute-force protection on super-admin login | **Vercel KV + `@upstash/ratelimit`** (likely already installed for proxy.ts rate limits) | No new vendor; sliding-window primitives; per-IP and per-email windows. |
| Real-time admin notifications | **Supabase Realtime** (already in stack, `ff_realtime_subscriptions_v1`) | No new service; collapses Control Room polling cost. |
| Synthetic E2E from super-admin perspective | **Playwright** (assumed; if not present, smallest reasonable add) | Standard for Next.js App Router; runs from GitHub Actions. CEO approval required since this is technically a "new dev dep". |
| Error tracking on super-admin pages | **Sentry** (`@sentry/nextjs` already in stack per #779/#784 incident memory) | Already wired; just add per-school issue API call. |
| Product analytics for admin behaviour | **PostHog** (already in stack — `oracle-health`, `marking-path-mix` already proxy HogQL) | Capture `admin_action_taken`, `admin_impersonation_started`, `admin_flag_flipped` events; feed back into super-admin analytics. |
| Cron for demo-purge / SLO aggregation | **`pg_cron`** (already in stack — data-erasure cron, projector-runner cron) | No new infra. |
| Email demo credentials | **existing email service** (used by Phase B school-admin students endpoint) | No new provider. |
| Audit-table SIEM forwarding (optional, defer) | **Logflare → BigQuery** (Supabase native) | Only if/when compliance asks. Don't add now. |

Explicitly NOT adding: no Redis, no separate queue, no separate auth provider, no separate logger, no ORM. All conform to blueprint §3 rule 11.

---

## 4. Acceptance criteria (per phase)

| Phase | Pass criteria |
|---|---|
| F | (1) Demo accounts for 5 personas creatable end-to-end with operator login + portal exercise. (2) grep over super-admin code returns zero hits for `Math.random`, `99.9`, `'2.0.0'`, `Lorem`, `Coming soon`, `Not implemented`, `hardcoded`. (3) SLA page renders banner not fake rows when tables empty. (4) Synthetic-host-monitor running. |
| G | (1) Vitest passes the 96-route auth/level/audit matrix. (2) `admin_audit_log` writes route through `audit_logs` view. (3) Server-side redirect occurs before page paint for unauthenticated visitor. (4) Brute-force lockout fires at 5 attempts on super-admin login. |
| H | (1) `/super-admin/health` shows real Sentry counts and real white-label dots. (2) Control Room request volume drops ≥80% per operator-hour. (3) Every "no data" state uses `<NoDataState>` with a learn-more link. |
| I | (1) Operator can scope all 50 pages to a single tenant. (2) Operator can view-as school-admin and parent. (3) Tenant onboarding wizard provisions a school end-to-end with one form submission. |
| J | (1) Lint rule live in CI. (2) Contract tests run on every PR. (3) Playwright synthetic green for 7 consecutive days. (4) 3 runbooks published. |

---

## 5. Out of scope (call-outs)

- Mobile super-admin (not requested; CEO has not flagged demand).
- AI-assisted operator copilot (interesting but post-launch).
- Per-state compliance dashboards (DPDP is covered; per-state add-ons can wait for first state contract).
- The `/super-admin/students/[id]` rich profile merge from `feature/observability-console` — out-of-band; track separately, do not block Phase F on it.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| F.1 migration touches auth flows | Roll out behind `ff_demo_accounts_v2` (default OFF); flip after manual smoke-test in staging. |
| G.1 level-enforcement breaks existing admins | Pre-flight query: `SELECT count(*) FROM admin_users WHERE admin_level IS NULL OR admin_level NOT IN (...)`. Fix any nulls before deploy. The 3 current admins are all `super_admin`, so blast radius today is zero. |
| G.3 server-side gate could hard-loop | Cover with Vitest before merge; staging canary at 10% for 24h. |
| F.5 `school_slo` migration adds new tables | Idempotent; zero-downtime; default empty. |
| Phase J Playwright dependency | Confirm with CEO before adding. If declined, fall back to a Bash-script smoke runner. |

---

## 7. Sequencing & ownership

- **Phase F:** 1 engineer, 5 days. Solo-PR-able.
- **Phase G:** 1 engineer + reviewer (security-sensitive), 5 days.
- **Phase H:** 1 engineer, 4 days.
- **Phase I:** 1 engineer + 1 designer half-time, 5 days.
- **Phase J:** 1 engineer, 3 days.

Total: ~22 working days, ~4.5 calendar weeks for one engineer; can compress to 3 weeks with 2 engineers running F||G and H||I.

---

## 8. Compliance with Alfanumrik blueprint

```
Blueprint compliance
- Scope: docs/plans/super-admin-prod-plan-2026-05-17.md (planning artifact only)
- Hard rules: PASS — no placeholders proposed; no new vendors; demo schema fix is a verbatim promotion of an already-written migration; no static curriculum fallback; RBAC strengthened, not removed.
- Backward compat: PASS — every new column is nullable / defaulted; admin_audit_log retained as a view; ff_demo_accounts_v2 flag gates the demo changes.
- RBAC/auth: PLAN — Phase G explicitly closes the level-enforcement, JWT-fallback, server-gate, and audit-table gaps surfaced by the audit.
- RAG/NCERT integrity: N/A — super-admin surfaces; CMS / question-bank queries remain unchanged.
- Schema integrity: PLAN — touches admin_users, admin_audit_log → audit_logs, demo_accounts (restore), school_slo (new), health_check_log (new), goal_profiles (new), grounded_ai_traces.circuit_state (new column). Canonical four tables (curriculum_topics, question_bank, student_learning_profiles, feature_flags) untouched.
- Production impact: contained — every change behind a flag or a no-op fallback; rollback = flip flag OFF.
- Open questions: (a) approve Playwright dep (J.3)?  (b) approve demo-school auto-provisioning of 3 seed students per school (F.3)?  (c) approve replacement of `admin_audit_log` table writes with `audit_logs` view-based path (G.4)?
```
