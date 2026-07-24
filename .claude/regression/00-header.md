# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

**Total catalog: 308 entries (target: 35 — TARGET EXCEEDED).**
Latest: REG-308 (2026-07-24, GenAI Phase 1 — provider-agnostic Model Gateway
backward-compat + provider-routing safety: flag-OFF `ff_model_gateway_v1` forces
the `default` policy which reproduces the legacy Anthropic-primary chain
byte-for-byte, the router never selects a dormant `configured:false` provider
(both Gemini seams), config.ts model-name byte-identity, and Deno↔TS
`MODEL_FALLBACK_ORDER` parity — P12; see `02-foxy-ai.md`).
Prior: REG-306..REG-307 (2026-07-22, Master Action Plan Phase 2.3–2.5 + 3.10 —
REG-306 Alfa OS shell launch [Practice/Revision/Test OS presentation shells:
default-OFF client-first-paint flag identity + existing-nav non-regression +
shell render contract + PredictedScoreCard byte-parity + REG-125-conformant
seed shape for the 3 new `20260722104000/104100/104200` flag seeds; presentation
only, P1/P2/P3 untouched] — see `15-cross-cutting.md`; REG-307 Hindi
teacher-feedback language-aware display [P7 fallback matrix asserted verbatim on
web + mobile, `pickTeacherFeedback` ↔ `feedbackFor` pick-logic parity, and the
teacher-dashboard write/read path carrying both language columns] — see
`07-teacher-school.md`). Prior: REG-304..REG-305 (2026-07-22, Master Action Plan Phase 8 monitoring/
alerting rollout-enablement prerequisites — REG-304 adaptive-loops monitoring
gate [aggregate-only `get_adaptive_loops_health` SECURITY DEFINER RPC + fail-
closed nightly monitor cron with runbook-sourced thresholds (ceiling=0,
storm>50%@≥10-sample, heartbeat>26h) + super-admin dashboard + 3 seeded
alert_rules + the adaptive-remediation `job_health` heartbeat it reads] — see
`09-adaptive-program.md`; REG-305 Monthly-Synthesis delivery-failure monitor
(>20%@≥5-attempts) [8.4] + nightly LLM-as-judge quality sampler writing the
RLS-locked `synthesis_quality_scores` table [8.6] + both super-admin
dashboards, all P13 aggregate/ID-only with the parent summary body/bundle/
phone/name never persisted or rendered — see `02-foxy-ai.md`). Prior: REG-303 (2026-07-21, live-production dead-flag-gate fix —
`GET /api/learner/revise-stack` had gated on `isFeatureEnabled('ff_revise_route_v1')`
after migration `20260603120000_remove_ff_revise_route_v1.sql` deleted that
flag row as part of Study Menu v2 consolidation, so the route 404'd
UNCONDITIONALLY for every student in production while both the web
Chapter Refresh section and the mobile Refresh screen silently swallowed the
404 into an empty state; fixed by deleting the dead gate rather than
re-seeding the flag — see `11-infrastructure.md`). Prior: REG-302 (2026-07-22, Master Action Plan Phase 4 — Foxy explorer mode
token-budget fix + dedicated Socratic/artifact-draft persona directive [item
4.1], Monthly Synthesis parent-summary fabrication oracle [number + Devanagari
digits + chapter/topic cross-check against the bundle, word-cap sentence-
boundary truncation, deterministic bilingual template fallback, 5-failure/60s
circuit breaker — item 4.2], and the WhatsApp pre-send fabrication re-check
gate writing a new `flagged` `parent_share_status` [additive migration
`20260722098000`, item 4.5] — see `02-foxy-ai.md`). Prior: REG-301 (2026-07-22, Master Action Plan Phase 2.2 remediation — CBSE-board
dynamic-assembly mock-exam rebuild: legacy `/mock-exam` Section B count fix
[38/78 -> 39/80 marks], the submit-route idempotency replay-guard column bug
[`paper_id` does not exist on `mock_test_attempts` -- fixed to `exam_paper_id`,
so the guard had never actually short-circuited a double-submit against the
real database], the new dynamic snapshot-assembly start/submit flow
[`POST /api/exams/papers/[id]/start` + `start_mock_test_attempt`/
`submit_mock_test_attempt` RPCs, migrations `20260722096000..20260722097100`],
and the legacy multi-subject sample paper's soft deactivation [`is_active =
false`, migration `20260722097200`, no dangling FK] — see
`03-quiz-integrity.md`). Prior: REG-297..REG-300 (2026-07-22, Master Action Plan Phase 3 — REG-297
Loop D verify evaluator [route-level dispatch wiring + the false-positive-
resolution bug assessment caught and backend fixed before merge] + REG-298
cron-worker scale hardening [fairness ordering, escalation-cache N+1
batching, run-lock TOCTOU race closed via migration `20260722095000`] — both
see `09-adaptive-program.md`; REG-299 assignment completion multi-attempt +
due-date lockout hardening — see `07-teacher-school.md`; REG-300 WhatsApp
channel wired for the 3 adaptive-loop parent escalations, closing a
zero-prior-coverage gap on the fetch call itself — see
`09-adaptive-program.md`). Prior: REG-296 (2026-07-22, flag-governance hardening Phase 0 — DB-layer defense-in-depth (BEFORE UPDATE trigger + `admin_flip_feature_flag` RPC + velocity/burst guard) + TS/DB registry parity + canary watch-list growth to 56 names after two live-but-unprotected constitution-pinned flags were found and registered -- see `10-rbac-rls.md`). Prior: REG-290..REG-295 (2026-07-20, parent-dashboard RCA -- the 11-policy `active`/`approved` RLS mismatch silently emptying score/xp/coin/quiz/skill-state/exam/monthly-report tables for OTP-linked guardians + OTP redeem invite_code/link_code fix + teacher_parent_threads INSERT policy + synthesis/parent-share RBAC-gate parity, the billing multi-child deep-link fix, the P7 lockout-message bilingual fix, and three design-system presentational refactors on /parent/reports, ParentGlanceHome, and /parent/profile -- see `08-parent-portal.md`). Prior: REG-287..REG-289 (2026-07-20, super-admin session/routing/error-contract repair — the 2026-07-20 super-admin RCA pins: httpOnly-cookie single-source admin session + ordered Bearer→cookie credential fallback (the ~2.5-min session-death fix), admin-aware Layer 0.65 routing via the `get_admin_level` RPC with the uncached ROLE_UNKNOWN fail-open sentinel + both repair migrations' static SQL pins (the student-bounce fix), and AdminShell structured `ApiResult` error classification incl. Vercel security-checkpoint detection + 401 refresh-retry — see `10-rbac-rls.md`). Prior: REG-285..REG-286 (2026-07-20, protected-flag console guardrail + posture canary — the 2026-07-20 console bulk-enable incident pins: typed-confirmation gate on the super-admin feature-flags API + nightly fail-closed posture-drift canary — see `10-rbac-rls.md`). Prior: REG-284 (2026-07-20, E2E full-suite topology — label-gated advisory PR run + watched blocking nightly — see `11-infrastructure.md`); REG-281..REG-283 (2026-07-20, feature-flag RCA repair — see `10-rbac-rls.md`; renumbered from REG-277..279 after ID collision with the Foxy ramp package, which holds REG-277..REG-280 — see `02-foxy-ai.md`).

## Split Files

| File | Feature area |
|---|---|
| `01-subject-governance.md` | Subject Governance (SG-1..SG-6) |
| `02-foxy-ai.md` | Foxy AI tutor, AlfaBot, structured rendering, prompt routing, diagrams, math |
| `03-quiz-integrity.md` | Quiz scoring, server-shuffle, authenticity, marking, offline replay, E2E critical paths |
| `04-payments.md` | Razorpay, billing, pricing SoT, RBI pre-debit |
| `05-xp-scoring.md` | XP economy, daily cap, anti-cheat, consecutive_wrong |
| `06-auth-onboarding.md` | Auth module, parent-child link, B2C funnel, email onboarding |
| `07-teacher-school.md` | Teacher remediation/grading/notify, school admin, seat provisioning, TSB-4 |
| `08-parent-portal.md` | Consumer Minimalism waves, parent portal, consent |
| `09-adaptive-program.md` | Adaptive remediation loops A/B/C/D, digital twin |
| `10-rbac-rls.md` | RBAC matrix, RLS policies, Student Pulse, XC-3 phases, mutation gates |
| `11-infrastructure.md` | Python AI ports, Voice, Mobile parity, CI alerting + sharded-CI fan-in contract + E2E label-gated/nightly topology, PWA, curriculum versioning, design system |
| `12-observability.md` | Monitoring data boundary, PostHog analytics |
| `13-rag-cache.md` | RAG eval harness, Voyage rerank, grounded-answer cache, response-cache, Knowledge Intelligence |
| `14-audit-remediation.md` | Engineering audit cycles 1-8, tier-2 PRs |
| `15-cross-cutting.md` | Cross-cutting, schema reproducibility, event-sourced migration |
