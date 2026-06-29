# Cycle 6 — Super-Admin & Observability — 02 GAP ANALYSIS

Evidence-driven. Each gap cites file:line. Routes I read in full: `feature-flags`, `students/[id]/impersonate`, `reports`, `rbac`, `observability/export`, `analytics`, `login`, `bulk-actions/plan-change`, `v1/admin/roles`, `internal/admin/bulk-action`. The `Grep` confirming an auth-gate token in all 119 super-admin route files is a structural signal, not a per-route ordering proof — see SAO-7.

## Compliance summary (what is CORRECT — say so explicitly)

- **P9 — auth gate before DB I/O**: COMPLIANT on every sampled route. The gate is the first statement of each handler and returns the denial response before any `fetch`/`supabaseAdmin` call (`feature-flags/route.ts:19,65,140,237`; `rbac/route.ts:60,146`; `impersonate/route.ts:11,67,142`; `plan-change/route.ts:24`; `reports/route.ts:28`; `observability/export/route.ts:36`; `analytics/route.ts:37`; `v1/admin/roles/route.ts:13,51,152`; `internal/admin/bulk-action/route.ts:40-43`). Pinned by REG-119 + `mutation-gate-pins.test.ts`.
- **Constant-time secret compare**: COMPLIANT. `requireAdminSecret` uses `secureEqual` (`admin-auth.ts:412`, `secure-compare.ts:16-23`); reads header only, never URL param. 503 when secret unconfigured (fail-closed).
- **Least-privilege on mutations**: COMPLIANT for the destructive set — RBAC mutations, impersonation-start, bulk plan-change, feature-flag writes all require `super_admin` and audit-log.
- **P13 — logger**: COMPLIANT. `redactPII` runs on all metadata before emit (`logger.ts:67`); key set covers passwords/tokens/keys/email/phone/full_name/etc (`redact-pii.ts:37-66`).
- **P13 — analytics events**: COMPLIANT. `redactPII(properties)` before any backend (`analytics.ts:152`); identify uses hashed UUID (`analytics.ts:216`); event type map is PII-free by construction.
- **P13 — Sentry**: COMPLIANT. client/server/edge `beforeSend` scrub identity/headers/cookies/body/url/breadcrumbs/extra/contexts/tags and drop all non-prod events. REG-49.
- **Feature flags default-OFF**: COMPLIANT. Unknown/malformed → OFF (`feature-flags.ts:97-98,122`). All audited `ff_*` seeds (school_pulse, adaptive_remediation, adaptive_loops_bc, school_admin_rbac) seeded `is_enabled=false, rollout=0`. No ungated flag-write found.

## Gaps

### SAO-1 — Bulk PII export gated at the LOWEST admin tier
- **Title**: `/api/super-admin/reports` exports raw student/parent/teacher PII at `support` level.
- **Evidence**: `src/app/api/super-admin/reports/route.ts:28` gates `authorizeAdmin(request, 'support')`. Selects include `students: id,name,email,...` (`:45`), `teachers: id,name,email,school_name` (`:49`), `parents(guardians): id,name,email,phone` (`:55`), up to 5000 rows (`:5`), streamed as CSV/JSON. The export IS audit-logged (`:98-100`).
- **Business impact**: any account at the floor admin tier (a "support" agent) can download the entire student roster with emails and every parent phone number — a DPDP-Act minors'-data exposure and a mass-exfiltration vector if one low-tier credential is phished.
- **Technical impact**: violates least-privilege; the tier ladder exists precisely to bound blast radius (`admin-auth.ts:28-45`) but the highest-sensitivity export sits at its floor.
- **Severity**: High. **Likelihood**: Medium.
- **Recommendation**: raise the required level for PII-bearing report types (`students`/`teachers`/`parents`/`audit`) to `finance`/`admin`; keep aggregate/non-PII types lower. This changes the admin ACCESS MODEL → REQUIRES USER APPROVAL (do not change tiers unilaterally). Add a regression pinning the chosen tier.

### SAO-2 — Super-admin analytics response embeds student name + email at `support`
- **Title**: `/api/super-admin/analytics` returns `top_students` with `name` + `email`.
- **Evidence**: `src/app/api/super-admin/analytics/route.ts:86` selects `id,name,email,grade,xp_total,...`; `:184-192` returns them in `top_students`. Gated at `support` (`:37`).
- **Business impact**: a learner leaderboard with email at the floor tier. P13 technically permits admin-via-service-role access, so this is a least-privilege/data-minimization concern rather than a hard P13 breach — but email is not needed to render a top-XP leaderboard.
- **Technical impact**: widens the PII surface of a dashboard endpoint; if the dashboard only needs name, email is gratuitous.
- **Severity**: Medium. **Likelihood**: Medium.
- **Recommendation**: ops decision — drop `email` from `top_students` (keep name+grade) OR raise the tier. Dropping a field from the response is an ops-owned data-contract change → notify frontend (dashboard render) + testing. AUTO-FIX-SAFE if the field is confirmed unused by the page; otherwise an access-model change (approval).

### SAO-3 — Observability export ships `context_json` without an export-time redaction pass
- **Title**: `/api/super-admin/observability/export` serialises `row.context` verbatim into CSV.
- **Evidence**: `src/app/api/super-admin/observability/export/route.ts:91` `escapeCSV(row.context ? JSON.stringify(row.context) : null)` — no `redactPII` at export. Gated `support` (`:36`), up to 100k rows (`:68`).
- **Business impact**: ops events are SUPPOSED to be PII-free at write time (`logOpsEvent`), but this export is the last line of defense and applies none. A single mis-instrumented event that put a student name/email into `context` would be exfiltrated in bulk.
- **Technical impact**: defense-in-depth gap; the in-flight redactor (`redactPII`) is available and cheap but not invoked on this egress path.
- **Severity**: Medium. **Likelihood**: Low (depends on an upstream logging mistake).
- **Recommendation**: wrap the context with `redactPII(row.context)` before `JSON.stringify` at `:91`. AUTO-FIX-SAFE (additive redaction, no behavior change for clean data) — notify testing for a regression.

### SAO-4 — Logger redactor intentionally omits bare `name` / `ip_address`
- **Title**: `SENSITIVE_KEYS` excludes `name` and `ip`/`ip_address` (documented tradeoff) — a caller logging `{ name: <student full name> }` is not redacted.
- **Evidence**: `supabase/functions/_shared/redact-pii.ts:43-46,58-66` explicitly excludes bare `name` and `ip` to avoid colliding with `event_name`/`subject_name`/metrics. Only `full_name`/`first_name`/`last_name` are caught (`:48`).
- **Business impact**: if any admin/analytics code path logs a student's name under the key `name` (not `full_name`), it reaches Vercel logs / Sentry `extra` un-redacted. P13 risk is conditional on caller discipline.
- **Technical impact**: the redactor is key-based, so a legitimate-but-unlucky key name bypasses it. No structural enforcement that callers use `full_name`.
- **Severity**: Low-Medium. **Likelihood**: Low.
- **Recommendation**: keep the documented exclusion, but (a) add an ESLint/grep canary that flags `logger.*({ ... name: ...student... })` patterns, or (b) have the super-admin/analytics layer normalize to `full_name` before logging. AUTO-FIX-SAFE (lint/test only). Do NOT add bare `name` to the global set without auditing collision impact.

### SAO-5 — Audit-log CSV export carries admin email/name inside `details`
- **Title**: `reports` `type=audit` exports `admin_audit_log.details`, which `logAdminAudit` enriches with `admin_name` + `admin_email` (`admin-auth.ts:258`).
- **Evidence**: `reports/route.ts:67-68` selects `details` for the audit export; `admin-auth.ts:258,293` write `admin_name`/`admin_email` into every audit `details`. Gated `support`.
- **Business impact**: admin (staff) PII, not student PII — lower sensitivity, but still a staff-directory leak at the floor tier and inherits SAO-1's tiering concern.
- **Severity**: Low. **Likelihood**: Medium.
- **Recommendation**: fold into SAO-1's tier decision (raise `audit` export tier). No separate action. Approval-gated (access model).

### SAO-6 — Impersonation/audit rows persist `ip_address` (documented exception)
- **Title**: `admin_impersonation_sessions` and `audit_logs` store `ip_address` by design.
- **Evidence**: `impersonate/route.ts:97-108` writes client IP; `redact-pii.ts:58-65` documents `ip_address` is intentionally NOT redacted because it is written to admin-only RLS-restricted forensic tables.
- **Business impact**: none if RLS holds — this is a deliberate security-forensics exception, not a leak. Listed for completeness.
- **Severity**: Informational. **Likelihood**: n/a.
- **Recommendation**: none. Confirm the forensic tables' RLS is admin/service-role-only (architect-owned). COMPLIANT-by-design.

### SAO-7 — Coverage gap: only ~10 of 119 super-admin routes read line-by-line
- **Title**: structural `Grep` proves an auth-gate TOKEN exists in all 119 files, but not that the gate precedes DB I/O in the other ~109.
- **Evidence**: `Grep` matched 119/119 files for the gate tokens (345 occurrences). 10 routes verified by full read. The remaining ~109 (notably `intelligence/*`, `strategic-reports/*`, `subscribers/*`, `observability/*`, `institutions/*`, `students/[id]/*` PII reads) are unverified for ordering.
- **Business impact**: a route could import `authorizeAdmin` yet place a `fetch` before it, or gate a GET but not a sibling mutation in the same file.
- **Severity**: Medium (process). **Likelihood**: Low.
- **Recommendation**: complete the 119-route sweep; add an AST/lint check that asserts the first statement of every exported handler in `api/super-admin/**` is an `authorize*`/`requireAdminSecret` call. AUTO-FIX-SAFE (tooling + tests).

## Classification

| Gap | AUTO-FIX-SAFE | REQUIRES USER APPROVAL |
|---|---|---|
| SAO-1 PII export tier | — | YES (admin access model / tiering) |
| SAO-2 analytics email field | YES if field unused (drop field + notify frontend/testing) | YES if solved by raising tier |
| SAO-3 observability export redaction | YES (add `redactPII` on egress) | — |
| SAO-4 logger `name` exclusion | YES (lint/test canary) | — |
| SAO-5 audit export admin PII | — | YES (folds into SAO-1 tiering) |
| SAO-6 ip_address forensic | n/a (compliant-by-design) | — |
| SAO-7 full-sweep + AST lint | YES (tooling/tests) | — |

No RBAC roles/permissions were added or altered in this analysis. SAO-1/SAO-2(tier)/SAO-5 are reported as gated pending approval.
