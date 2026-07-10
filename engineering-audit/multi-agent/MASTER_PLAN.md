# Multi-Agent Master Plan

Date: 2026-07-10
Mode: Stage 1 parallel reconnaissance; read-heavy; no broad implementation.

## Loaded Instructions

- `AGENTS.md` (present, empty)
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `docs/V2_READINESS_AUDIT.md`
- `docs/ops/release-checklist.md`
- `engineering-audit/CODEX_HANDOVER.md`
- `engineering-audit/FULL_RCA_BACKEND_WORKFLOWS_PRODUCT_READINESS_2026-07-09.md`
- `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md`

## Objective

Establish current product-readiness truth across architecture, backend/data security, frontend UX, adaptive intelligence, Foxy AI safety, QA/certification, and DevOps/platform readiness before selecting any implementation batch.

## Stage 1 Agents

| Agent | Workstream | Mode | Deliverable |
|---|---|---|---|
| A | Architecture and Integration Lead | Read-only | `architecture-report.md` |
| B | Backend and Data Security Engineer | Read-only | `backend-security-report.md` |
| C | Frontend and Design-System Engineer | Read-only | `frontend-report.md` |
| D | Adaptive Intelligence Engineer | Read-only runtime trace | `adaptive-intelligence-report.md` |
| E | AI Tutor and Safety Engineer | Read-only | `foxy-ai-report.md` |
| F | QA and Certification Engineer | Read-only plus focused non-destructive tests where safe | `qa-certification-report.md` |
| G | DevOps, Reliability and Performance Engineer | Read-only plus non-destructive command inspection | `platform-readiness-report.md` |
| H | Independent Reviewer | Read-only review after A-G report | `independent-review.md` |

## Parallelisation Plan

- Run A-G concurrently because their first-pass inspections are independent and read-heavy.
- Keep H sequenced after A-G so review is based on actual reconnaissance outputs.
- The orchestrator owns shared ledgers, conflict control, prioritisation, and final execution plan.

## Current Baseline Signals

- Branch: `codex/backend-health-fixes-clean`
- Worktree: heavily dirty with many modified and untracked files; all pre-existing changes are treated as user/generated work.
- Recent ledger claims repo-owned gates were green after the latest batch, while environment-owned launch proof remains separate.
- Known recurring risks: service-role route surface, canonical class membership cutover, live cron health proof, API contract drift, feature-flag/runtime parity, Foxy/adaptive runtime evidence.

## Stage 1 Exit Criteria

- A-G reports completed with exact file evidence.
- Duplicate or unsupported findings consolidated.
- P0/P1/P2/P3 ranking produced from repo evidence.
- Explicit implementation batch proposed with file ownership and tests.
- No broad implementation begins until the orchestrator risk checks pass.

## Consolidated Stage 1 Findings

| Priority | Finding | Evidence |
|---|---|---|
| P0 | Broad-launch readiness is not supported by current evidence. | Current live evidence bundle: 5 pass, 3 fail, 7 not_run; independent review reran verifier and rejected launch readiness. |
| P0 | Service-role/RLS transition remains incomplete. | Current `scripts/admin-client-allowlist.json` count is 257; XC-3 execution remains not_run in live evidence. |
| P0 | TSB-4 canonical membership cutover is not launch-complete. | Live evidence marks `tsb4-live-cutover` fail; legacy/canonical membership retirement remains decision-gated. |
| P0 | Live cron/job health is failing. | Current bundle and platform report show 0/13 registered jobs with live last-success metrics. |
| P1 | July 10 SECURITY DEFINER RPC wave lacks complete central hardening/live-verifier coverage. | Backend report found hardening manifest still covers only the older three RCA-18 functions. |
| P1 | Certification browser suite is discoverable but not executed as current release proof. | QA listed 36 tests across 8 files; live bundle marks certification E2E not_run. |
| P1 | Adaptive runtime exists for BKT/SM-2/IRT/CME/Foxy personalization, but DKT is not active runtime code. | Adaptive report traced active code paths and found DKT only in historical/future references. |
| P1 | Foxy `/api/foxy` has strong safety buffering, but direct Edge streaming is not independently first-paint safe. | Foxy report contrasted Next buffering with Edge streaming residual. |
| P2 | Frontend has good shell/primitives, but visual/mobile/a11y certification is not proven by static inspection. | Frontend report found shallow certification checks and no screenshot/browser validation in Stage 1. |

## Proposed Execution Plan

1. Freeze shared manifests and rerun current inventory before any implementation batch.
2. Treat the next milestone as evidence closure: repo gates plus a fresh live evidence bundle, not feature-count completion.
3. Start with P0 runtime/security blockers: job health, XC-3 route/RPC batch, TSB-4 live tenant proof, certification E2E, and live evidence bundle.
4. In parallel where non-conflicting, prepare P1 hardening and product decisions: SECURITY DEFINER manifest expansion, public `class_code` decision, school-admin preflight disclosure decision, teacher Foxy/content-support role decisions, historical XP decision.
5. Defer broad frontend polish until security/runtime launch gates have owners, while still adding targeted browser/a11y evidence for demo-critical routes.
