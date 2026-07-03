# Test-Run Cover Sheet — Stage 2/3 Fill-In Template

**Purpose:** one cover sheet per certification test run. Copy this file into the relevant stage's
evidence folder (e.g. `evidence/stage-2-local-integration/test-run-logs/2026-0X-XX-cover-sheet.md`
or the equivalent `stage-3-staging/test-run-logs/` path) at the START of a run, fill in the header
fields immediately, and complete the summary section at the END of the run. Every other evidence
file produced during the run (per-role verdict table, API spot-check sheet, screenshots, raw
Playwright/log output) should be cross-referenced from here so a reviewer can reconstruct the
full run from this one document.

---

## Run identity

| Field | Value |
|---|---|
| Run date | __________ |
| Run start time (with timezone) | __________ |
| Run end time (with timezone) | __________ |
| Operator name | __________ |
| Operator role (testing agent / human QA / other) | __________ |

## Target environment

| Field | Value |
|---|---|
| Stage | Stage 2 (local integration) / Stage 3 (staging) — circle one |
| Target base URL (`CERTIFICATION_BASE_URL`) | __________ |
| Supabase project ref targeted | __________ |
| Confirmed NOT the production project ref? (see `scripts/seed-certification-accounts.ts`'s fail-closed guard output) | Y / N |
| CERT-17 status at time of this run (OPEN blocks Path B / CLOSED — cite the closure record) | __________ |
| Path A (direct DB/workflow) or Path B (browser-driven) certification? | __________ |

## Build identity

| Field | Value |
|---|---|
| Commit SHA certified against | __________ |
| Branch | __________ |
| Baseline document this run certifies against (e.g. `RC-2026-07-02-baseline.md`) | __________ |
| Any drift from that baseline noted before this run started? (new commits, new migrations) | __________ |

## Certification traffic identity

| Field | Value |
|---|---|
| Certification run ID (full UUID printed by `scripts/seed-certification-accounts.ts`) | __________ |
| `run_id_short` (first 8 hex chars) | __________ |
| Seeding command used | __________ |
| Seeding output confirms production-reference guard passed? | Y / N |
| Roles seeded this run (should be all 7 mission roles) | __________ |
| Synthetic school seeded? (Y/N, name if Y) | __________ |

## Evidence produced this run (cross-references)

| Artifact | Filename / path | Notes |
|---|---|---|
| Per-role step verdict table | __________ | using `templates/per-role-step-verdict-table.md` |
| API contract spot-check sheet | __________ | using `templates/api-contract-spot-check.md` |
| Screenshots | __________ | directory listing or count |
| Raw Playwright output / trace files | __________ | __________ |
| Raw seed-script console output | __________ | __________ |

## Summary

| Metric | Value |
|---|---|
| Total journey steps assessed (sum across all 7 roles) | __________ |
| PASS | __________ |
| PARTIAL | __________ |
| FAIL | __________ |
| BLOCKED | __________ |
| NOT VERIFIED | __________ |
| New defects opened this run (ticket IDs) | __________ |
| Defects re-confirmed closed this run | __________ |
| Verdicts that changed from the prior stage's findings (list + explain each) | __________ |
| Overall run verdict (PASS / PASS WITH CONDITIONS / FAIL / INCOMPLETE) | __________ |

## Teardown

| Field | Value |
|---|---|
| Teardown performed? (Y/N) | __________ |
| Teardown method (`purge_certification_tenant` RPC / manual DELETE per runbook) | __________ |
| Post-teardown leak-check query result (must be 0 — see `docs/runbooks/certification-traffic-traceability.md`, "Mandatory post-teardown leak check") | __________ |

## Sign-off

| Role | Name | Date |
|---|---|---|
| Operator | __________ | __________ |
| Reviewer (if applicable) | __________ | __________ |

## Free-form notes

__________
