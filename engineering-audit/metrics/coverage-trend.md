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
| 2026-06-29 (Cycle 4 — foxy-ai-rag REGRESSION) | **305/305 vitest + 3/3 Deno PASS** (+P12 live grounded-path output content backstop `screenStudentFacingText` + Deno twin across every student-facing exit, +P12 student-message injection neutralization `neutralizeInjectionAttempt`, +P13 prompt-assembly contract test, +FOX-3 mode-template reconciliation, +Deno HARD_BLOCK_PATTERNS parity); not re-measured globally this cycle | not re-measured globally this cycle | **150** with REG-182 (P12 output backstop) + REG-183 (P12 injection neutralization); REG-37/39/50/54/66/67 still green; cap target 35 — exceeded | build PASS — bundle within P10 caps (server/Deno validation modules; /foxy route already shipped, no new shared chunk) | /foxy still largest, 0 pages > 260 kB | local green; type-check PASS, lint 0 errors; assessment APPROVE WITH CONDITIONS (addressed) + quality independent APPROVE; sweep GREEN |
| 2026-06-29 (Cycle 5 — teacher-school-b2b REGRESSION) | **527/527 vitest PASS** (+P8/P13 teacher-dashboard grade-fallback tenant-scoping across all 8 query sites via auth-derived `resolveTeacherSchoolId`, fail-closed; +P8 teacher-assigned RLS backstop on `public.students`, predicate-identical to the active `is_teacher_of(id)` branch); 15 TSB-1 + 10 TSB-2 new edge-fn/RLS tests; not re-measured globally this cycle | not re-measured globally this cycle | **152** with REG-184 (P8/P13 teacher tenant-scoping) + REG-185 (P8 teacher RLS backstop); REG-120/121/122/124/128 still green; cap target 35 — exceeded | build PASS — **no bundle impact** (Edge Function + migration only) | /foxy still largest, 0 pages > 260 kB | local green; type-check PASS, lint 0 errors; quality independent **APPROVE WITH CONDITIONS** (migration-ordering — RESOLVED via byte-identical rename `20260629000000`→`20260702010000`); sweep GREEN |
| 2026-06-29 (Cycle 6 — super-admin-observability REGRESSION) | **6/6 new (4 SAO-7 + 2 SAO-4) + 351/351 broad super-admin/analytics/observability PASS** (+P9 admin-route auth-gate FULL-SURFACE sweep — 134 routes, 207/207 DB-touching handlers gate-before-I/O, `super-admin/login` sole allowlist; +P13 bare-name log canary — no bare `name`/`email`/`phone` logger key, conservative compound-key exclusion); also SAO-3 observability-CSV egress `redactPII` + SAO-2 `top_students.email` drop; not re-measured globally this cycle | not re-measured globally this cycle | **154** with REG-186 (P9 full-surface gate sweep) + REG-187 (P13 bare-name log canary); REG-49/115/116/119 still green; cap target 35 — exceeded | build PASS — bundle within P10 (analytics/observability server routes + 2 test-only files; **no shared-chunk or page-budget impact**) | /foxy still largest, 0 pages > 260 kB | local green; type-check PASS, lint 0 errors; quality independent **APPROVE**; sweep GREEN |

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

## Notes on the Cycle-4 row (2026-06-29 — foxy-ai-rag REGRESSION)
- **305/305 vitest + 3/3 Deno:** the new validation suites (output-screen, input-guard, route non-streaming,
  streaming.ts, Deno `pipeline-stream`, Deno `output-screen-deno-parity`) plus the FOX-6 prompt-assembly P13
  contract test were re-run by quality — all pass. The FOX-3 mode widening updated the two `output-screen.test.ts`
  cases that pinned the OLD injection-token intent to the NEW CS-exemption intent (bare `<system>`/`[inst]` PASS;
  LLaMA-paired `<s>[INST]…[/INST]</s>` BLOCK) — an intent correction, not a weakened assertion. Global coverage %
  was not re-measured this cycle (targeted Foxy/RAG/validation run only).
- **Catalog:** REG-182 (P12 live grounded-path output content backstop) + REG-183 (P12 student-message injection
  neutralization) filed → **150**. Existing P12 entries REG-37 / REG-39 / REG-50 / REG-54 / REG-66 / REG-67 remain
  green. Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** FOX-1/2 add small server-side TS validation modules + a Deno twin; the `/api/foxy` route was
  already in the /foxy bundle and gains only two cheap function calls — no new shared chunk, 0 pages over the 260 kB
  page budget.
- **Gates:** type-check PASS, lint 0 errors, build PASS; assessment correctness review APPROVE WITH CONDITIONS (CS
  literal-markup over-block — addressed by the FOX-1 injection-pattern refinement) + quality independent verdict
  APPROVE; regression sweep GREEN.
- **Gated / follow-up (not in these numbers):** FOX-4 (OpenAI MoL shadow — USER-gated provider governance; not
  student-facing today), FOX-7-new (extend the screen to the legacy fallback persist path — ai-engineer), streaming
  live-view residual (`ff_foxy_streaming`; frontend full-closure), Hindi profanity-token coverage — none implemented.
- **Topology note:** the constitution's "`/api/foxy` not yet wired to UI" line is STALE — `/api/foxy` is the LIVE
  route; `foxy-tutor` Edge Function no longer exists; `grounded-answer` is the LLM pipeline. Correct on next
  constitution reconciliation.

## Notes on the Cycle-5 row (2026-06-29 — teacher-school-b2b REGRESSION)
- **527/527 vitest:** the 25 new tests (15 TSB-1 tenant-scoping over the 8 grade-fallback query sites + the
  fail-closed-on-null-`school_id` branch; 10 TSB-2 teacher SELECT policy assertions — assigned row visible,
  zero rows for non-assigned / inactive-enrollment, predicate parity, idempotent) plus the broad teacher /
  RLS suites were re-run by quality — all pass. Global coverage % was not re-measured this cycle (targeted
  teacher-dashboard / RLS run only).
- **The 8-site finding:** the audit named 2 grade-fallback sites; backend found **8** (incl. a cross-tenant
  WRITE in `handleSetGradeBookCell`). Fixing only the named 2 would have left sites 3–8 exploitable by a
  teacher *with* a school. All 8 are now `school_id`-scoped via the auth-derived `resolveTeacherSchoolId`
  and fail-closed (empty / 403 / zero) on a null `school_id`.
- **TSB-2 premise correction:** `public.students` ALREADY had a teacher backstop via `students_select_merged`
  → `is_teacher_of(id)` (stricter — adds `is_active` guards). The new named policy is predicate-IDENTICAL
  (PERMISSIVE OR-combine → unchanged row set, provably no over-grant); its value is discoverability +
  helper-independence. HIGH → reclassified defense-in-depth.
- **Catalog:** REG-184 (`teacher_dashboard_grade_fallback_tenant_scope`, P8/P13) + REG-185
  (`teacher_assigned_students_rls`, P8) filed → **152**. Existing B2B/boundary entries REG-120 / REG-121 /
  REG-122 / REG-124 / REG-128 remain green. Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** TSB-1 edits a Deno Edge Function; TSB-2 adds one additive idempotent migration — neither
  ships in any client bundle. **No bundle impact**, 0 pages over the 260 kB page budget.
- **Gates / condition:** type-check PASS, lint 0 errors, build PASS; quality independent verdict APPROVE WITH
  CONDITIONS — the single condition (TSB-2 migration timestamped `20260629000000`, out-of-order before the
  true latest `20260702000800`) is **RESOLVED** by an architect rename to `20260702010000` (byte-identical
  content; testing repointed the test reference; re-verified). Sweep GREEN.
- **Gated / follow-up (not in these numbers):** TSB-4 (dual `class_students`/`class_enrollments` — the table
  DROP is USER-gated; read-consolidation auto-fix-safe), TSB-3 full convergence (shared Next.js↔Deno authz
  module — ai/architect), TSB-5 (`ff_school_pulse_v1` render-vs-data comment — ops/frontend), pre-existing
  TS2352 join-cast cleanup, vacuously-green roster-join walker, Deno pre-warm retry — none implemented.

## Notes on the Cycle-6 row (2026-06-29 — super-admin-observability REGRESSION)
- **6/6 new + 351/351 broad:** the two new test files (`admin-route-auth-gate-sweep.test.ts` — 4 tests;
  `bare-name-log-canary.test.ts` — 2 tests) plus the broad super-admin/analytics/observability suite were
  re-run by quality — all pass. Global coverage % was not re-measured this cycle (targeted run only).
- **The 134-route sweep (SAO-7):** the MAP phase proved a `Grep` token match on all 119 super-admin route
  files but read only ~10 line-by-line. SAO-7 converts that into a 100%-surface invariant — every admin route
  on disk (super-admin **119** + `v1/admin` **2** + `internal/admin` **13** = **134**) carries a canonical
  gate token, and **207/207** DB-touching handlers gate BEFORE first DB I/O, with `super-admin/login` the
  sole allowlisted self-auth exception. Any future mis-ordered/ungated handler now fails PR-CI.
- **P13 data minimization:** SAO-3 wraps the observability-export `context_json` cell in the canonical
  `redactPII` (reused, no new scheme) before CSV egress — defense-in-depth, header/columns/order unchanged,
  clean rows = identity transform. SAO-2 drops gratuitous `email` from the analytics `top_students` payload
  (confirmed zero UI consume sites) at query+type+map, and frontend removed the two stale `email: string`
  decls. SAO-4 adds a bare-name logger-key canary without widening the redactor's global key set.
- **Catalog:** REG-186 (`admin_route_auth_gate_sweep`, P9) + REG-187 (`bare_name_log_canary`, P13) filed →
  **154**. Existing super-admin/observability entries REG-49 / REG-115 / REG-116 / REG-119 remain green.
  Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** the two changed routes are server-side; the two new files are test-only — no shared-chunk
  or page-budget impact. 0 pages over the 260 kB page budget.
- **Gates:** type-check PASS, lint 0 errors, build PASS; quality independent verdict **APPROVE**; sweep GREEN.
- **Gated / follow-up (not in these numbers):** SAO-1 (bulk PII export at the `support` floor tier —
  USER-gated, DPDP-relevant admin access-model decision; most consequential Cycle-6 finding, on the program
  RISK register), SAO-5 (audit-log admin-PII export — folds into SAO-1), the export `message`-column
  free-form-redaction follow-up (apply `redactPIIInText` only if a future template interpolates user PII),
  and the periodic manual re-read of the highest-PII-sensitivity routes (process) — none implemented.

## How to add a row
At the end of each cycle's REGRESSION phase, run `npm test`, `npm run test:coverage`,
and `npm run build`; read the catalog count; append one row with measured values and
drop the "to verify" qualifiers you confirmed.
