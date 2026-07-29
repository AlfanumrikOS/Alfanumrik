# Regression Catalog

**This file has been split to reduce context cost. It is a thin pointer,
not a second source of truth — it intentionally carries no entry count.**

The full catalog now lives in `.claude/regression/`. `00-header.md` is the
SOLE authoritative source for the running total and the latest/next-free
REG-id — read it directly rather than trusting a number copied here, which
has drifted out of sync with the shard files at least twice before
(reconciled 2026-07-29: this file previously read "317 entries" while a
separate stale copy of it had drifted to "256", and `.claude/CLAUDE.md`'s
narrative text separately drifted to "142" — all three numbers disagreed
with the shards' own self-maintained total. Do not add a number here again;
add it only in `00-header.md`, in the same commit that adds the entry.)

| File | Feature area |
|---|---|
| `00-header.md` | Index and status key |
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
| `11-infrastructure.md` | Python AI ports, Voice, Mobile parity, CI alerting + sharded-CI fan-in contract + build invocability & CI gate blocking posture, PWA, curriculum versioning, design system |
| `12-observability.md` | Monitoring data boundary, PostHog analytics |
| `13-rag-cache.md` | RAG eval harness, Voyage rerank, grounded-answer cache, response-cache, Knowledge Intelligence |
| `14-audit-remediation.md` | Engineering audit cycles 1-8, tier-2 PRs |
| `15-cross-cutting.md` | Cross-cutting, schema reproducibility, event-sourced migration |

To read the full catalog, read the files in `.claude/regression/`.
To add a new entry, append to the appropriate feature-area file.
