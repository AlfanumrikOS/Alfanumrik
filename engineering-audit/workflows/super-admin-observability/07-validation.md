# 07 — Independent Validation: Super-Admin & Observability (Cycle 6)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-6
- **Workflow:** super-admin-observability (P9 RBAC enforcement; P13 data privacy)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`
- **Verdict:** **APPROVE**

## Independence statement

The validating quality agent did **not** author any Cycle-6 change (SAO-3/SAO-2 ops; SAO-2 frontend type cleanup; SAO-7/SAO-4 testing). It re-ran every gate from a clean state rather than trusting the builders' reported results, and independently confirmed (a) `top_students[].email` has zero UI consume sites before the drop, and (b) the SAO-7 sweep walks the full 134-route admin surface.

## What was verified (not trusted)

### SAO-3 — observability export egress redaction (P13)
- Confirmed `src/app/api/super-admin/observability/export/route.ts` wraps the `context_json` cell in `redactPII(row.context)` before `JSON.stringify`, using the canonical key-based deep redactor re-exported at `@/lib/ops-events-redactor` — the same redactor `logger.ts` uses in-flight. No new redaction scheme.
- Confirmed `CSV_COLUMNS` (header + order + count) is unchanged; only the `context_json` cell VALUE changes, and only for rows whose context carries a `SENSITIVE_KEYS` member. Clean context is an identity transform. The other 9 columns (timestamps/enums/UUID/correlation-id/template message) are intact; `subject_id` UUID deliberately retained for forensic joinability.

### SAO-2 — analytics `top_students.email` drop (P13)
- Independently re-derived that `email` has **zero render/consume sites**: leaderboard renders Rank/Name/Grade/XP/Streak/Assessment, CSV export emits name/grade/xp/streak, LearnerHealth widget reads xp_total only, React keys use `s.id`. Dropping `email` is data minimization with no render regression.
- Confirmed dropped at all three sites (select projection, row type, response map) and that the two frontend stale `email: string` decls were removed. type-check PASS confirms no dangling reference.

### SAO-7 — full-surface P9 gate sweep (P9)
- Confirmed `admin-route-auth-gate-sweep.test.ts` enumerates the full admin surface — **134** routes (super-admin **119** + `v1/admin` **2** + `internal/admin` **13**) — and asserts **207/207** DB-touching handlers gate BEFORE the first DB I/O, with `super-admin/login` as the sole allowlisted self-auth exception. This mechanically closes the MAP-phase "only 10/119 read line-by-line" coverage gap. → REG-186.

### SAO-4 — bare-name log canary (P13)
- Confirmed `bare-name-log-canary.test.ts` scans `logger.*(...)` call sites for a bare `name`/`email`/`phone` key and that the anchor conservatively excludes compound `*_name` keys (no false positive on `full_name`/`flag_name`/`event_name`/`school_name`/etc.). The redactor's global key set was NOT widened. → REG-187.

## Gate re-run (verified, not trusted) — quality gates, verbatim

- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **6/6 new** (4 SAO-7 + 2 SAO-4) + **351/351** broad super-admin/analytics/observability
- [x] **build** — **PASS**
- [x] **bundle** — within **P10** caps (analytics/observability are server routes; the two new files are test-only — no shared-chunk or page-budget impact)

## MINOR follow-ups (documented, not validation failures)

1. **Export `message` column not free-form-redacted.** Pre-existing; the `message` column is a controlled developer-authored template scalar (the key-based `redactPII` is a no-op on plain strings by design — we did NOT introduce a second text-regex scheme on a controlled column). If a future event template interpolates user PII into `message`, apply `redactPIIInText` at the write site (an SAO-4-class write-time fix, not an egress change).
2. **Periodic manual re-read of highest-risk routes.** The SAO-7 sweep guards breadth mechanically; a periodic manual line-by-line re-read of the highest-PII-sensitivity routes remains good practice.

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P9 RBAC enforcement | yes (primary) | yes — strengthened | SAO-7 mechanically pins 207/207 DB-touching admin handlers gate-before-I/O across the full 134-route surface; `super-admin/login` sole allowlist. No role/permission/grant change. |
| P13 Data privacy | yes (primary) | yes — strengthened | SAO-3 adds egress redaction to the observability CSV export; SAO-2 drops gratuitous `email` from the analytics leaderboard; SAO-4 canary blocks bare-PII logger keys. No PII added to any log. |
| P10 Bundle budget | yes | yes (unchanged) | Server routes + test-only files; no shared-chunk or page-budget impact; build within caps. |
| P1–P8, P11, P12, P15 | no (this cycle) | n/a | No scoring/XP/anti-cheat/atomic/grade-format/question-quality/RLS-schema/payment/AI/onboarding surface touched. |

## Gated dispositions (independent confirmation)

- **SAO-1 (USER-GATED).** Bulk PII export at the `support` floor tier is an admin access-model decision (DPDP-relevant). Confirmed not touched; correctly surfaced to the program RISK register for CEO decision.
- **SAO-5 (USER-GATED, folds into SAO-1).** Audit-log CSV admin-PII export — same tiering decision. Confirmed not touched.
- **SAO-6 (COMPLIANT-BY-DESIGN).** `ip_address` in admin-only RLS-restricted forensic tables is a documented intentional exception. Confirmed not a defect.

## Verdict

**APPROVE** — the in-scope auto-fix-safe set (SAO-3 + SAO-2 ops, SAO-2 frontend type cleanup, SAO-7 + SAO-4 testing) passes independent re-test; all gates green (type-check PASS, lint 0 errors, 6/6 new + 351/351 broad PASS, build PASS, bundle within P10); the email-unused and full-surface-sweep claims independently confirmed; no invariant regression. SAO-1 (USER-gated PII-export tiering) + SAO-5 (folds into SAO-1) + the two MINOR follow-ups (message redaction; periodic manual re-read) are documented gated/follow-ups, not validation failures.

## Gate 5 (P14 review-chain) confirmation

The mandatory super-admin reporting / monitoring chain is **COMPLETE**: ops (impl SAO-3/SAO-2 + PII definitions) + frontend (trimmed-shape render confirmation + stale-type cleanup) → testing (SAO-7 sweep + SAO-4 canary, coverage GREEN) + quality (independent **APPROVE**). See `08-regression.md`.

## Required fixes before COMPLETE (if REJECT)

None outstanding for the auto-fix-safe set. The workflow is not marked fully COMPLETE only because **SAO-1** (and SAO-5, which folds into it) is USER-gated (PII-export tiering / admin access-model decision) and the two MINOR follow-ups (message redaction; periodic manual re-read) are tracked; see `STATUS.md`.
