# 08 — Regression: Cross-Cutting Invariants (Cycle 8, FINAL)

> Phase: REGRESSION. Dependent-workflow regression sweep. Final cycle of the 8-cycle program.

- **Cycle:** cycle-8
- **Workflow:** cross-cutting — P7 (bilingual breadth), P8 (RLS breadth), P10 (bundle), mobile-web sync
- **Verification squad:** **testing** (+ quality/orchestrator self-validation)
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] **11/11 cross-cutting tests PASS** — `subscription-price-drift.test.ts` + `score-config-drift.test.ts` + `bundle-cap-pin.test.ts`.
- [x] No previously-passing test now skipped or weakened — the three new files are **additive** pins; no existing assertion edited. The P7 change to `daily-cron/index.ts` is pure-additive `data.*_hi` strings (no English/trigger/threshold change), so existing daily-cron tests are unaffected.
- [x] type-check green; lint 0 errors. **Build deferred to the CI backstop** (transient platform outage during validation; Deno Edge Function + test-only files → negligible bundle risk).

## P14 review-chain completeness — COMPLETE

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker (P7 server notifications) | **backend** | XC-1/XC-2 — `data.title_hi`/`data.body_hi` on the 3 score-milestone producers + relocate parent-digest dead top-level `body_hi` into `data.body_hi` + add `data.title_hi` | DONE |
| Maker (drift/cap guards) | **testing** | XC-6/XC-5/XC-4a — web↔mobile price + score-config parity tests + bundle-cap pin; filed REG-191/192/193 | **GREEN** (11/11) |
| Independent validation | **quality / orchestrator** | re-ran all gates; confirmed `data.*_hi` shape match, dead-`body_hi` relocation, parity-only drift tests | **APPROVE** |
| Noted (larger-program follow-ups) | **architect** | XC-3 RLS defense-in-depth (subsumes TSB-2 + PP-5); XC-4b @supabase/* first-paint split | NOTED (initiative) |

**Chain: COMPLETE** for the auto-fix-safe set.

## Dependent-workflow regression result

The cross-cutting surface touches the notification pipeline (Track A) and the mobile/web contract + bundle gate (Track B). No regressions:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Notification render (`notifications/page.tsx`) | client reads `data.title_hi`/`data.body_hi`, falls back to English | none — Track A adds twins in the exact shape the client reads; rows without a twin still fall back as before |
| Adaptive Loops B/C notification producers (REG-134) | the bilingual house shape (`data.*_hi`) | none — Track A follows the same shape REG-134 pins; no producer of REG-134's set was edited |
| Landing-page pricing verbatim (REG-65) | INR price values | none — XC-6 pins web↔mobile parity; no price value changed |
| Mobile quiz XP/score path | server-authoritative (device holds no earning constant) | none — XC-5 pins the score-config display constants only; the earning path is unchanged |
| Bundle gate (CI `check:bundle-size`) | `scripts/check-bundle-size.mjs` caps | none — XC-4a pins the cap declarations; no cap value changed (still 284/260/120) |

## Existing regressions — still green

| REG-ID | Pins | Status after Cycle 8 |
|---|---|---|
| REG-49 | Sentry client `beforeSend` PII redaction (P13) | **green** — untouched |
| REG-65 | landing-page pricing-verbatim drift (P11-adjacent) | **green** — XC-6 complements it (web↔mobile parity), no value changed |
| REG-134 | Loops-B/C bilingual notification house shape (P7) | **green** — Track A follows the same `data.*_hi` shape |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Filed in catalog? |
|---|---|---|---|
| **REG-191** | P11-adjacent / mobile | subscription price web↔mobile parity — Dart `subscription.dart` literals == web `plans.ts`; parity-only (no value pinned), so a one-sided web edit fails CI | filed → catalog 160 |
| **REG-192** | mobile / P1-adjacent | score-config web↔Flutter parity — all 41 `score_config.dart` constants == `src/lib/score-config.ts`; parity-only | filed → catalog 160 |
| **REG-193** | P10 | bundle-cap pin — CAP_SHARED_KB=284 / CAP_PAGE_KB=260 / CAP_MIDDLEWARE_KB=120 in `check-bundle-size.mjs`; anti cap-creep (cap raised 5× to date) | filed → catalog 160 |

> `.claude/regression-catalog.md` is authoritative. Catalog **157 → 160**.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| P7 server notifications (score-milestone) | 3 producers English-only (no Hindi twin) | **`data.title_hi`/`data.body_hi` on all 3** (Track A) |
| P7 parent-digest notifications | Hindi body on a DEAD top-level `body_hi` (never rendered) + no title_hi | **Hindi relocated to `data.body_hi` (renders) + `data.title_hi` added** (Track A) |
| Mobile↔web price drift | duplicated literals, comment-only sync, no test | **web↔mobile parity test** (REG-191) |
| Mobile↔web score-config drift | 41 duplicated constants, comment-only sync, no test | **41-constant parity test** (REG-192) |
| Bundle-cap creep | single freely-editable number, raised 5× | **cap declarations pinned** (REG-193) |
| Regression catalog entries | 157 (REG-188/189/190, Cycle 7) | **160** with REG-191/192/193 |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-8 row + program-summary line).

## Residual risk (LARGER-PROGRAM — tracked initiatives)

1. **XC-3 (P8, HIGH, systemic) — LARGER-PROGRAM.** 316/362 routes (87%) use the RLS-bypassing admin client; the route-layer boundary is app code, not RLS. A single missing/wrong `authorizeRequest`/`canAccessStudent` = full cross-tenant read with no DB backstop. Dedicated multi-sprint RLS defense-in-depth program; subsumes Cycle-5 TSB-2 and Cycle-7 PP-5.
2. **XC-4b (P10) — LARGER-PROGRAM.** Split @supabase/* out of first paint (~57 kB), then ratchet CAP_SHARED_KB back toward the 160 kB baseline. P15-touching. Until then, shared-JS headroom is razor-thin (279.7/284 kB); the XC-4a pin is the interim friction.
3. **XC-7 (P7) — LARGER-PROGRAM.** No central i18n primitive; adopt the `today/copy.ts` keyed-resolver as the house standard + a missing-string lint so server/client parity becomes mechanically enforceable (the chokepoint whose absence produced XC-1/XC-2).
4. **P7 follow-ups (same class as XC-1/XC-2):** `school-operations.ts` and the parent-portal insights/tips/glance (PP-7) carry the same English-only-title gap — bounded out of the daily-cron Track-A scope.

## Sweep verdict

**GREEN** — 11/11 cross-cutting tests PASS, P14 chain complete for the auto-fix-safe set (quality/orchestrator **APPROVE**), no dependent-flow regression, REG-49/65/134 still green, three new guards (REG-191/192/193) close the mobile-web drift + bundle-cap-creep + P7 server-notification Hindi gaps; the residual XC-3 / XC-4b / XC-7 are tracked LARGER-PROGRAM initiatives, not sweep failures. **This is the final REGRESSION phase of the 8-cycle program.**
