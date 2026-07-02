# API Contract Spot-Check Template — Stage 2/3 Fill-In

**Purpose:** operator-filled record of live API-contract spot-checks for one certification run,
extending the Stage 1 static findings in
`docs/audit/2026-07-02-certification/reports/05-api-contract-certification-report.md` with real
HTTP responses. Copy this file into the relevant stage's evidence folder (e.g.
`evidence/stage-2-local-integration/test-run-logs/2026-0X-XX-api-contract-spot-check.md`) and
fill in every row before treating the API-contract portion of a stage as complete.

**Scope guidance (per report 05):** prioritize the 44 Tier-0 routes (auth, payments, cron, quiz
submission/scoring, and the 7 high-blast-radius admin routes) before spending time on Tier-1/2
routes. Add rows as needed — this table is a starting skeleton, not an exhaustive route list.

**Result legend:** `MATCH` (live response matches the expected contract exactly) · `DRIFT` (live
response differs from what report 05 / the code trace claims — describe the diff) · `NOT RUN`
(not exercised this pass).

---

## Run metadata

| Field | Value |
|---|---|
| Fill-in date | __________ |
| Operator name | __________ |
| Stage | Stage 2 (local integration) / Stage 3 (staging) — circle one |
| Target base URL | __________ |
| Commit SHA certified against | __________ |
| Tool used (curl / Postman / Playwright `request` fixture / other) | __________ |

---

## Authorization spot-checks

| Route | Method | Tier | Auth mechanism (expected, per report 05) | Request identity used | Expected status | Actual status | Result | Evidence (response body / notes) |
|---|---|---|---|---|---|---|---|---|
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ | __________ |

## Idempotency / atomicity spot-checks

| Route | Scenario (e.g. "same razorpay_event_id sent twice") | Expected behavior | Actual behavior | Result | Evidence |
|---|---|---|---|---|---|
| `/api/payments/webhook` | Duplicate event id | Second call short-circuits, no second DB write | __________ | __________ | __________ |
| `atomic_quiz_profile_update` (via quiz submission route) | Concurrent submission for same student | Single transaction, no partial write | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ |

## Status codes and error envelope shape

| Route | Scenario | Expected envelope shape | Actual envelope | Result | Evidence |
|---|---|---|---|---|---|
| __________ | Happy path | `{success, data}` or bilingual quiz envelope (per report 05) | __________ | __________ | __________ |
| __________ | Invalid/missing auth | `401` with `{success: false, error}` | __________ | __________ | __________ |
| __________ | Invalid payload | `400` with field-level error detail | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ |

## Mobile-contract cross-check (routes the Flutter app calls)

| Route | Called by mobile? (Y/N) | Exists server-side? (Y/N) | Request/response shape matches mobile expectation? | Result | Evidence |
|---|---|---|---|---|---|
| __________ | __________ | __________ | __________ | __________ | __________ |
| __________ | __________ | __________ | __________ | __________ | __________ |

---

## Open findings this run (new — not already in report 05 or the risk register)

| Finding | Route(s) | Severity (S1-S3) | Suggested owner | Notes |
|---|---|---|---|---|
| __________ | __________ | __________ | __________ | __________ |

## Summary

| Metric | Count |
|---|---|
| Routes spot-checked | __________ |
| MATCH | __________ |
| DRIFT | __________ |
| NOT RUN | __________ |
| New findings opened | __________ |

Operator sign-off: __________  Date: __________
