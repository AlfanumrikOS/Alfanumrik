# Regression Catalog

Authoritative list of regression tests that MUST exist and pass before release.
Each entry links to the asserting test(s). Removing an entry requires explicit
user approval.

Status key: `E` = exists and passing | `P` = partial | `M` = missing.

**Total catalog: 256 entries (target: 35 — TARGET EXCEEDED).**
Latest: REG-287..REG-289 (2026-07-20, super-admin session/routing/error-contract repair — the 2026-07-20 super-admin RCA pins: httpOnly-cookie single-source admin session + ordered Bearer→cookie credential fallback (the ~2.5-min session-death fix), admin-aware Layer 0.65 routing via the `get_admin_level` RPC with the uncached ROLE_UNKNOWN fail-open sentinel + both repair migrations' static SQL pins (the student-bounce fix), and AdminShell structured `ApiResult` error classification incl. Vercel security-checkpoint detection + 401 refresh-retry — see `10-rbac-rls.md`). Prior: REG-285..REG-286 (2026-07-20, protected-flag console guardrail + posture canary — the 2026-07-20 console bulk-enable incident pins: typed-confirmation gate on the super-admin feature-flags API + nightly fail-closed posture-drift canary — see `10-rbac-rls.md`). Prior: REG-284 (2026-07-20, E2E full-suite topology — label-gated advisory PR run + watched blocking nightly — see `11-infrastructure.md`); REG-281..REG-283 (2026-07-20, feature-flag RCA repair — see `10-rbac-rls.md`; renumbered from REG-277..279 after ID collision with the Foxy ramp package, which holds REG-277..REG-280 — see `02-foxy-ai.md`).

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
