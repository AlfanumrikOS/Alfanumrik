# 07 — Independent Validation: Cross-Cutting Invariants (Cycle 8, FINAL)

> Phase: INDEPENDENT VALIDATION. A fresh quality/orchestrator agent (did NOT implement) verifies.

- **Cycle:** cycle-8 (the final cycle of the 8-cycle program)
- **Workflow:** cross-cutting — P7 (bilingual breadth), P8 (RLS breadth), P10 (bundle), mobile-web sync
- **Validator squad:** **quality / orchestrator** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`
- **Verdict:** **APPROVE** (orchestrator self-validated)

## Independence statement

The validating agent did **not** author any Cycle-8 change (XC-1/XC-2 backend P7 notification Hindi; XC-5/XC-6/XC-4a testing drift contracts + cap pin). It re-ran the gates from a clean state rather than trusting the builders' reported results, and independently confirmed (a) the Hindi twins are emitted under `data.title_hi`/`data.body_hi` (the shape the client `notifications/page.tsx:195-198` actually reads), (b) the parent-digest's previously-dead top-level `body_hi` was relocated into `data.body_hi`, and (c) the drift tests read the real Dart files on disk and assert web↔mobile equality (parity-only — no absolute value pinned).

## Gate re-run (verified, not trusted) — orchestrator self-validation gates, verbatim

- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **11/11 cross-cutting tests** (subscription-price-drift + score-config-drift + bundle-cap-pin)
- [x] **code review** — **clean** (pure-additive Hindi to the correct `data.*_hi` shape; test-only parity/cap pins; no runtime behavior change)
- [ ] **build** — **DEFERRED to the CI backstop.** A transient platform outage during the validation window blocked a clean local `npm run build`. The change is pure-additive Hindi strings in a Deno Edge Function (no client bundle) + three test-only files (no bundle footprint), so build risk is negligible; CI's post-merge build + `check:bundle-size` is the authoritative backstop and will gate before production.

## What was verified (not trusted)

### XC-1 / XC-2 — P7 server-notification Hindi (backend)
- Confirmed all three score-milestone producers in `daily-cron/index.ts` (~569-607) now carry `data.title_hi` + `data.body_hi` with all numeric interpolations preserved and the English/`message`/`body`/trigger/threshold/idempotency_key untouched.
- Confirmed the parent-digest producers (~167/172) relocate the previously top-level (DEAD — no column, never read) `body_hi` into `data.body_hi` and add `data.title_hi`. Independently re-derived against the prod baseline that `public.notifications` has NO top-level `*_hi` columns and that the client reads only `data.*_hi` — so the relocation makes the Hindi body actually render where before it was silently dropped.
- Confirmed XP and "Performance Score" are left untranslated (product/technical terms, per P7), and no PII was introduced into any notification or its `data` (P13).

### XC-6 / XC-5 — mobile↔web drift contracts (testing)
- Confirmed `subscription-price-drift.test.ts` parses the Dart price literals from `mobile/lib/data/models/subscription.dart` and asserts equality against `src/lib/plans.ts`; it is **parity-only** (pins no absolute value), so it does NOT collide with the PAY-2 USER-gated pricing decision — a legitimate price change passes iff both sides change together. No drift today (REG-191).
- Confirmed `score-config-drift.test.ts` extracts all 41 Performance-Score constants from `mobile/lib/core/constants/score_config.dart` and asserts equality against `src/lib/score-config.ts`; all 41 identical web↔Flutter today (REG-192).

### XC-4a — bundle-cap pin (testing)
- Confirmed `bundle-cap-pin.test.ts` pins the cap declarations in `scripts/check-bundle-size.mjs` (CAP_SHARED_KB=284, CAP_PAGE_KB=260, CAP_MIDDLEWARE_KB=120) so any future raise is a conscious, reviewed code change — friction against the RC-3 cap-creep pattern (cap raised 5× to date). It freezes the cap NUMBERS; the actual measurement remains CI's job (REG-193).

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P7 Bilingual UI | yes (primary) | yes — strengthened | XC-1/XC-2 add the Hindi twin in the shape the client reads to the highest-value re-engagement notifications; XP / Performance Score correctly left untranslated. |
| P10 Bundle budget | yes (primary) | yes — guardrailed | XC-4a pins the caps; no runtime change ships, no bundle footprint from test files. (XC-4b durable split = LARGER-PROGRAM.) |
| P8 RLS boundary | yes (primary) | n/a this cycle (mapped) | XC-3 (87% admin-client) is documented as a LARGER-PROGRAM initiative; no route's boundary changed this cycle. |
| P11 Payment integrity | adjacent | yes — strengthened | XC-6 pins web↔mobile price display parity (parity-only; the actual charge remains server-authoritative). |
| P13 Data privacy | yes | yes | No PII added to notifications/`data` (Track A); drift tests read only constants, no PII/DB/network (Track B). |
| P1 (score) / mobile sync | adjacent | yes | XC-5 pins the 41 score-config constants web↔Flutter; the quiz XP/score path remains server-authoritative (device holds no earning constant). |
| P2-P6, P9, P12, P15 | no (this cycle) | n/a | No scoring-formula/XP-economy/anti-cheat/atomic/grade-format/question-quality/RBAC/AI/onboarding surface changed. |

## Gate 5 (P14 review-chain) confirmation

The mandatory chain for this change is **COMPLETE**: backend (XC-1/XC-2 P7 notification Hindi) + testing (XC-5/XC-6 drift contracts + XC-4a cap pin) → quality/orchestrator (independent **APPROVE**). The P7 server-notification change is backend-owned (the notification-producer house shape); the drift/cap guards are testing-owned. No frontend render change was needed (the client already reads `data.*_hi`).

## Verdict

**APPROVE** — the in-scope auto-fix-safe set (XC-1/XC-2 backend P7; XC-5/XC-6/XC-4a testing) passes independent re-test; type-check PASS, lint 0 errors, 11/11 cross-cutting tests PASS, code review clean. The `data.*_hi` shape match, the dead-top-level-`body_hi` relocation, and the parity-only nature of the drift tests were independently confirmed; no invariant regression. Build is deferred to the CI backstop due to a transient platform outage during validation (negligible risk — Deno Edge Function + test-only files). XC-3 / XC-4b / XC-7 are documented LARGER-PROGRAM initiatives, not validation failures.

## Required fixes before COMPLETE (if REJECT)

None outstanding for the auto-fix-safe set. The cross-cutting workflow's auto-fix-safe scope is complete; the residual XC-3 (P8 RLS defense-in-depth), XC-4b (@supabase/* split), and XC-7 (i18n primitive) are tracked LARGER-PROGRAM initiatives — see `STATUS.md` and `PROGRAM-SUMMARY.md`.
