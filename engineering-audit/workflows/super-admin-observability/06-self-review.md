# 06 — Self-Review: Super-Admin & Observability (Cycle 6)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-6
- **Workflow:** super-admin-observability (P9 RBAC enforcement; P13 data privacy)
- **Reviewer (authors):** ops (lead — SAO-3 egress redaction + SAO-2 field drop + PII definitions) + frontend (SAO-2 stale-type cleanup) + testing (SAO-7 gate sweep + SAO-4 log canary)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Severity | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|---|
| **SAO-3** | MED (P13) | ops | yes | `src/app/api/super-admin/observability/export/route.ts` — `context_json` cell now `JSON.stringify(redactPII(row.context))` before CSV egress | Defense-in-depth egress redaction; reuses canonical `redactPII` from `@/lib/ops-events-redactor` (no new scheme). CSV header/columns/order unchanged; clean rows = identity transform. |
| **SAO-2** | MED (P13) | ops + frontend | yes | `src/app/api/super-admin/analytics/route.ts` — `email` dropped from the `top_students` select + row type + map; frontend removed the two stale `email: string` decls | Data minimization at the `support` tier. ops+quality confirmed email is consumed by NO super-admin UI before dropping. Non-breaking. |
| **SAO-7** | MED (P9, process) | testing | yes (test-only) | `admin-route-auth-gate-sweep.test.ts` — 134 admin routes, 207/207 DB-touching handlers gate before first DB I/O; `super-admin/login` sole allowlist | Closes the "only 10/119 read line-by-line" coverage gap mechanically. → REG-186 |
| **SAO-4** | LOW-MED (P13) | testing | yes (test-only) | `bare-name-log-canary.test.ts` — no logger call passes a bare `name`/`email`/`phone` key; conservative compound-key exclusion | Keeps the documented redactor precision-vs-recall tradeoff (no global key-set change); adds call-site enforcement. → REG-187 |
| **SAO-1** | **HIGH** (P13, DPDP) | user | **GATED (USER)** | `/api/super-admin/reports` bulk-exports raw student name+email, parent name+email+PHONE, teacher email at the LOWEST `support` tier | Raising the tier / splitting a PII-export permission changes the admin access model → REQUIRES CEO APPROVAL. Added to program RISK register. NOT touched. |
| **SAO-5** | LOW (P13) | user | **GATED (USER, folds into SAO-1)** | audit-log CSV export carries `admin_name`/`admin_email` in `details` at `support` | Same tiering decision as SAO-1; no separate action. NOT touched. |
| **SAO-6** | INFO | architect | **COMPLIANT-BY-DESIGN** | `ip_address` persisted to admin-only RLS-restricted forensic tables (`redact-pii.ts:58-65` documents the intentional exception) | Listed for completeness; not a leak if RLS holds. No action. |

## Self-review checklist

- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly gated/deferred (SAO-3/SAO-2 landed; SAO-7/SAO-4 test-only landed; SAO-1/SAO-5 USER-gated; SAO-6 compliant-by-design).
- [x] **SAO-3 reuses the existing `redactPII`** (canonical key-based deep redactor) — no new redaction scheme invented; applied to the only object/free-form CSV column (`context_json`); deep-redacts nested objects; clean data unchanged; CSV header/columns/order preserved.
- [x] **SAO-2 minimization, not tiering** — `email` confirmed unused by any UI BEFORE dropping (leaderboard renders Rank/Name/Grade/XP/Streak; CSV export uses name/grade/xp/streak; LearnerHealth widget uses xp_total only; React keys use `s.id`). Dropped at query + type + map; frontend stale decls removed. No access tier changed.
- [x] **No RBAC role/permission added or altered; no access tier changed** — SAO-1/SAO-5 + the SAO-2 raise-tier branch left GATED (owner = user).
- [x] **SAO-7 covers the full surface** — 134 routes (super-admin 119 + v1/admin 2 + internal/admin 13); 207/207 DB-touching handlers gate before first DB I/O; `super-admin/login` is the sole allowlisted self-auth exception. No sampling.
- [x] **SAO-4 is conservative** — the canary anchor excludes compound `*_name` keys (`full_name`/`flag_name`/`event_name`/`school_name`/etc.), so it flags only the genuinely-risky bare-`name`/`email`/`phone` shape; the redactor's global `SENSITIVE_KEYS` set was deliberately NOT widened.
- [x] **No new PII in logs**; no `console.log` added; the existing `logAdminAudit` call is unchanged and already metadata-only.
- [x] **type-check** PASS; **lint** 0 errors; **6/6 new + 351/351 broad** tests PASS; **build** PASS; bundle within P10.
- [x] Ownership/scope — ops edits limited to the two API routes; frontend edits limited to the two type decls; testing edits limited to two new test files. No payment / onboarding / scoring / AI surface touched.

## Known limitations carried forward (for the independent reviewer)

1. **SAO-1 is USER-GATED, not fixed.** PII-heavy bulk exports (student name+email, parent name+email+phone, teacher email) sit at the LOWEST `support` tier because the admin ladder gates by ACTION-destructiveness, not READ-data-sensitivity. This is the most consequential Cycle-6 finding and is DPDP-relevant. Raising the tier (or splitting a PII-export permission) is an access-model change requiring CEO approval. Surfaced to the program RISK register.
2. **SAO-5 folds into SAO-1.** Audit-log CSV export carries admin_name/admin_email in `details` — same tiering decision; no separate action.
3. **Export `message` column not free-form-redacted (MINOR follow-up).** The observability export's `message` column is a controlled developer-authored template scalar, not free-form user input; the key-based `redactPII` is a no-op on plain strings (by design — we did NOT bolt on a second text-regex scheme on a controlled column). If a future event template ever interpolates user PII into `message`, apply `redactPIIInText` at that write site (an SAO-4-class write-time fix, not an egress change).
4. **Periodic manual re-read of highest-risk routes (process).** The SAO-7 sweep now guards breadth mechanically, but a periodic manual line-by-line re-read of the highest-PII-sensitivity routes remains good practice.

## Ready for independent validation?

**YES.** All Cycle-6 auto-fix-safe items (SAO-3 + SAO-2 ops, SAO-2 frontend type cleanup, SAO-7 + SAO-4 testing) are implemented and locally green. SAO-1/SAO-5 (USER-gated tiering) and SAO-6 (compliant-by-design) are explicitly recorded with owners and were not touched. The two MINOR follow-ups (message redaction; periodic manual re-read) are documented.
