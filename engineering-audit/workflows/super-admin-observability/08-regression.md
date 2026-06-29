# 08 — Regression: Super-Admin & Observability (Cycle 6)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-6
- **Workflow:** super-admin-observability (P9 RBAC enforcement; P13 data privacy)
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Super-admin / analytics / observability suites green — **6/6 new** (4 SAO-7 + 2 SAO-4) + **351/351** broad PASS.
- [x] No previously-passing test now skipped or weakened — the new tests are **additive** pins (full-surface gate sweep; bare-name log canary). No existing assertion edited.
- [x] type-check green; lint 0 errors; build green; bundle within **P10** caps (server routes + test-only files; no shared-chunk or page-budget impact).

## P14 review-chain completeness (super-admin reporting / monitoring) — COMPLETE

Per `.claude/skills/super-admin-reporting/SKILL.md` + `.claude/skills/review-chains/SKILL.md`, an ops-owned reporting / data-contract + monitoring change requires ops (definitions) → frontend (render) + testing (coverage) + quality (independent validation):

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker (data minimization + egress redaction + PII definitions) | **ops** | SAO-3 observability export `redactPII`; SAO-2 `email` drop at query+type+map | DONE |
| Maker (trimmed-shape render + type cleanup) | **frontend** | confirmed no leaderboard render regression; removed the two stale `email: string` decls | DONE |
| Coverage | **testing** | SAO-7 full-surface gate sweep (134 routes; 207/207 gate-before-I/O) + SAO-4 bare-name log canary; filed REG-186/187 | **GREEN** (6/6 new + 351/351 broad) |
| Independent validation | **quality** | re-ran all gates; re-derived email-unused; confirmed full-surface sweep | **APPROVE** |

**Chain: COMPLETE** for the auto-fix-safe set. (SAO-1 + SAO-5 open their own USER-governance gate for the PII-export tiering / admin access-model decision.)

## Dependent-workflow regression result

The super-admin & observability surface shares dependencies with the analytics dashboards, the audit-log pipeline, and the Sentry/logger redaction layer. No regressions:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Super-admin learning / control-room dashboards | `top_students` payload shape (email dropped) | none — email had zero consume sites; render unchanged; stale frontend types cleaned |
| Observability CSV export consumers | `CSV_COLUMNS` header/order/count | none — only the `context_json` cell value is redacted; header/columns/order identical; clean rows = identity transform |
| Logger / Sentry / analytics redaction (P13) | canonical `redactPII` from `@/lib/ops-events-redactor` | none — SAO-3 REUSES the existing redactor (no scheme change); REG-49 still green |
| Admin auth gate ordering (P9) | `authorizeAdmin` / `authorizeRequest` / `requireAdminSecret` | none — SAO-7 is a read-only static sweep; no route behavior changed; REG-116/119 still green |

## Existing super-admin / observability regressions — still green

| REG-ID | Pins | Status after Cycle 6 |
|---|---|---|
| REG-49 | Sentry client `beforeSend` PII redactor (identity/headers/url/body/cookies/extra/contexts/breadcrumbs/tags) | **green** — SAO-3 reuses the same redactor on a different egress; no Sentry-path change |
| REG-115 | Phase-5 dashboard per-student cache P13 isolation | **green** — untouched |
| REG-116 | Internal-admin secret-gate enforcement | **green** — SAO-7 now also pins the `internal/admin` secret gate across all 13 routes |
| REG-119 | High-blast-radius mutation-route gate pins (exact tier/permission; deny before DB I/O) | **green** — SAO-7 generalizes the gate-before-I/O assertion to the full 134-route surface |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Filed in catalog? |
|---|---|---|---|
| **REG-186** | P9 | admin-route auth-gate full-surface sweep — all **134** admin routes (super-admin 119 + v1/admin 2 + internal/admin 13) carry a canonical gate token; **207/207** DB-touching handlers gate BEFORE first DB I/O; `super-admin/login` is the sole allowlisted self-auth exception | filed → catalog 154 |
| **REG-187** | P13 | bare-name log canary — no `logger.*(...)` call passes a bare `name`/`email`/`phone` key; conservative compound-key exclusion (`full_name`/`flag_name`/`event_name`/`school_name`/etc. allowed) so the redactor's global key set stays unchanged | filed → catalog 154 |

> `.claude/regression-catalog.md` is authoritative. Catalog **152 → 154**.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Admin P9 gate-ordering coverage | ~10/119 super-admin routes read line-by-line; ordering for ~109 + v1/admin + internal/admin unverified | **134/134 routes swept; 207/207 DB-touching handlers gate-before-I/O** pinned mechanically (REG-186) |
| P13 log call-site coverage | key-based redactor only; bare-`name` caller-discipline risk unguarded | **bare-name/email/phone logger-key canary** (REG-187) |
| Observability CSV egress (P13) | `context_json` serialized verbatim; no export-time redaction | **`redactPII` on egress** (SAO-3, defense-in-depth) |
| Analytics PII surface (P13) | `top_students` carried `email` at `support` tier | **email dropped** at query+type+map+frontend type (SAO-2) |
| Regression catalog entries | 152 (REG-184/185, Cycle 5) | **154** with REG-186 (P9 gate sweep) + REG-187 (P13 log canary) |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-6 row).

## Residual risk

1. **SAO-1 — GATED (USER, HIGH, DPDP-relevant).** `/api/super-admin/reports` bulk-exports raw student name+email, parent name+email+PHONE, teacher email at the LOWEST `support` tier. The admin ladder gates by ACTION-destructiveness, not READ-data-sensitivity. Raising the tier / splitting a PII-export permission changes the admin access model → requires **CEO approval**. Most consequential Cycle-6 finding; on the program RISK register.
2. **SAO-5 — GATED (USER, LOW, folds into SAO-1).** Audit-log CSV export carries `admin_name`/`admin_email` in `details` at `support` — same tiering decision.
3. **Export `message` column not free-form-redacted — FOLLOW-UP (MINOR).** Controlled developer-authored template scalar; key-based `redactPII` is a no-op on plain strings (by design). Apply `redactPIIInText` only if a future template interpolates user PII (write-time, SAO-4-class).
4. **Periodic manual re-read of highest-risk routes — PROCESS.** SAO-7 guards breadth mechanically; a periodic manual line-by-line re-read of the highest-PII-sensitivity routes remains good practice.
5. **SAO-6 — COMPLIANT-BY-DESIGN.** `ip_address` in admin-only RLS-restricted forensic tables is a documented intentional exception (confirm forensic-table RLS remains admin/service-role-only — architect-owned).

## Sweep verdict

**GREEN** — 6/6 new + 351/351 broad PASS, P14 chain complete for the auto-fix-safe set (quality **APPROVE**), no dependent-flow regression, REG-49/115/116/119 still green, the two new guards (REG-186/187) add full-surface P9 gate coverage + the P13 log canary; the residual SAO-1 (USER-gated) + SAO-5 + the message-redaction + periodic-re-read follow-ups are gated/follow-up, not sweep failures.
