# Coverage Trend

Point-in-time snapshots of platform-health metrics, taken at the end of each audit
cycle's REGRESSION phase. Append a row; never edit historical rows (append-only).

Sources: `.claude/CLAUDE.md`, `.claude/regression-catalog.md`, `vitest.config.ts`,
`scripts/check-bundle-size.mjs`, CI. Mark "to verify" where a number was not freshly
measured in-session.

| Date | Test count | Coverage % | Regression catalog entries | Shared JS kB | Largest page kB | CI status |
|---|---|---|---|---|---|---|
| 2026-06-28 | 2,511 (84 files) | ~37% global (threshold 35%, to verify) | 142 (target 35 — exceeded) | CAP_SHARED_KB cap 280; single-chunk metric ~168.5 (to verify current) | /foxy ~254 (to verify) | to verify (assume green on main) |
| 2026-06-28 (Cycle 1 — auth-onboarding REGRESSION) | +27 new assertions this cycle (10 Deno always-200 + 7 AO-4 vitest + 3-role E2E `test.fixme`-gated + fs-guard); targeted run 940/940 + Deno 10/10 | not re-measured globally this cycle | 144 with REG-177 (P15 `send_auth_email_always_200`) once filed; cap target 35 — exceeded | build PASS — shared **279.7 / 284 kB** (CAP_SHARED_KB) | /foxy still largest, 0 pages > 260 kB | local green; middleware 116.2/120 kB; CI Deno-lane wiring of always-200 suite in flight |
| 2026-06-29 (Cycle 2 — payments-subscriptions REGRESSION) | payment suite **236/236 PASS** (verify-HMAC-reject + subscribe RBAC gate now pinned + reconcile-atomic-RPC + dedupe-no-op regressions); not re-measured globally this cycle | not re-measured globally this cycle | **146** with REG-178 (`verify_route_hmac_reject`, P11) + REG-179 (`subscribe_rbac_gate_pre_razorpay`, P9/P11) once filed; cap target 35 — exceeded | build PASS (`vercel.json` VALID — 13 crons ≤ 40 Pro limit) | /foxy still largest, 0 pages > 260 kB (config-only PAY-4 change; no bundle impact) | local green; type-check PASS, lint 0 errors; architect security APPROVE + quality APPROVE; REG-178/179 catalog filing in flight |
| 2026-06-29 (Cycle 3 — student-learning-core REGRESSION) | **40/40 new + ~1678 broad quiz/xp/scoring PASS** (+P1 three-way score-formula parity, +P2 XP earning-literal parity, +P3 pattern-flag asymmetry pin, +submit-idempotency contract pin; SLC-7 P6-gate wiring); not re-measured globally this cycle | not re-measured globally this cycle | **148** with REG-180 (`score_formula_three_way_parity`, P1) + REG-181 (`xp_sql_literal_parity`, P2); REG-45/48/51/53 still green; cap target 35 — exceeded | build PASS — bundle within P10 caps (SLC-7 is a small pure-React change in an existing page; test-only files have no bundle impact) | /foxy still largest, 0 pages > 260 kB | local green; type-check PASS, lint 0 errors; quality APPROVE (one MINOR brace nit fixed); sweep GREEN |

## Notes on the seed row (2026-06-28)
- **Test count** 2,511 / 84 files: from `.claude/CLAUDE.md` testing cell. `CLAUDE.md`
  (root) also cites 175 across 7 files in the release-gates skill — that figure is
  stale; the constitution's 2,511 is the reconciled number. **Verify with `npm test`.**
- **Coverage %**: global threshold is 35% statements (authoritative: `vitest.config.ts`);
  real coverage noted as ~37% in CLAUDE.md TODO. Run `npm run test:coverage` to confirm.
- **Regression catalog**: 142 entries (latest REG-175), target 35 exceeded. Authoritative
  source is `.claude/regression-catalog.md`.
- **Bundle**: two caps exist — `SHARED_JS_LIMIT_KB` (single largest shared chunk, ~160 kB
  baseline / ~168.5 kB observed) and `CAP_SHARED_KB` (first-load total, raised to 280 on
  2026-06-12). Run `npm run build` for current.
- **Largest page**: /foxy historically ~254 kB (P10 page budget 260 kB). Verify per build.

## Notes on the Cycle-1 row (2026-06-28 — auth-onboarding REGRESSION)
- **+27 new assertions:** 10 Deno always-200 (`send-auth-email/__tests__/always-200.test.ts`) + 7 AO-4
  vitest (`bootstrap-rpc-logical-failure.test.ts`) + the 3-role E2E (`auth-onboarding-3role.spec.ts`,
  honestly `test.fixme`-gated until ops seeds per-role staging fixtures) + the fs-guard that replaced the
  `expect(true).toBe(true)` placeholder.
- **Catalog:** REG-177 (`send_auth_email_always_200`, P15) being filed by a separate testing task → 144
  once landed. Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** independently re-verified this cycle — shared 279.7 / 284 kB, middleware 116.2 / 120
  kB, 0 pages over the 260 kB page budget. Global coverage % was not re-measured this cycle (targeted
  auth/onboarding/identity run only: 940/940 + Deno 10/10).

## Notes on the Cycle-2 row (2026-06-29 — payments-subscriptions REGRESSION)
- **Payment suite 236/236:** the targeted payment suite (webhook integration, the new
  `verify-hmac-reject.test.ts`, extended `payments-subscribe-rbac.test.ts`, reconcile atomic-RPC + dedupe
  no-op regressions, GST gates) was independently re-run by quality — all pass. Global coverage % was not
  re-measured this cycle (targeted payment run only).
- **Catalog:** REG-178 (`verify_route_hmac_reject`, P11) + REG-179 (`subscribe_rbac_gate_pre_razorpay`,
  P9/P11) being filed by a separate testing task → 146 once landed (confirm ids with orchestrator if they
  shift). Existing payment-funnel entries REG-46 / REG-47 remain green. Authoritative source remains
  `.claude/regression-catalog.md`.
- **Build / config:** `vercel.json` VALID (12 → 13 crons after PAY-4 registered `payments-health` at
  `*/10 * * * *`; ≤ 40 Pro-plan limit). PAY-4 is config-only — no middleware/bundle/code-path impact.
- **Gates:** type-check PASS, lint 0 errors, build PASS; architect P14 security review APPROVE + quality
  independent verdict APPROVE; regression sweep GREEN.

## Notes on the Cycle-3 row (2026-06-29 — student-learning-core REGRESSION)
- **40/40 new + ~1678 broad:** the four new test files (`score-formula-three-way-parity.test.ts`,
  `xp-sql-literal-parity.test.ts`, `quiz-pattern-flag-intended-behavior.test.ts`,
  `quiz-submit-idempotency-contract-pin.test.ts`) plus the broad quiz/xp/scoring suite were re-run by
  quality — all pass. SLC-7 (wiring the dead P6 `isValidQuestion` gate into `startQuiz`) preserves P1/P4
  served-count consistency by deriving `mcqIds` + `displayQuestions` + the submitted set from one filtered
  array (independently re-derived by quality). Global coverage % was not re-measured this cycle (targeted
  quiz/xp/scoring run only).
- **Catalog:** REG-180 (`score_formula_three_way_parity`, P1) + REG-181 (`xp_sql_literal_parity`, P2)
  filed → 148. REG-181 closes the REG-48 cap-only gap (REG-48 guarded the cap; the 10/20/50 earning
  literals were unguarded). Existing learner-core entries REG-45 / REG-48 / REG-51 / REG-53 remain green.
  Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** SLC-7 is a small pure-React change inside an existing page; the four new files are
  test-only — no shared-chunk or page-budget impact. 0 pages over the 260 kB page budget.
- **Gates:** type-check PASS, lint 0 errors, build PASS; quality independent verdict APPROVE (the one MINOR
  brace nit in the SLC-6 matcher now fixed); regression sweep GREEN.
- **Gated (not in these numbers):** SLC-1 (uncapped XP trigger — USER-GATED), SLC-4 (dual cap impl), SLC-5
  (server-records-flagged), SLC-8 cutover (`ff_server_only_quiz_submit`) — cross-agent, not implemented.

## How to add a row
At the end of each cycle's REGRESSION phase, run `npm test`, `npm run test:coverage`,
and `npm run build`; read the catalog count; append one row with measured values and
drop the "to verify" qualifiers you confirmed.
