# Alfanumrik Master QA Suite — Execution Record

Workbook: `Alfanumrik_Master_QA_Suite2.xlsx` (950 tests / 27 sheets). This folder is the
living execution record. **Hard rule: nothing is marked PASS without auditable evidence.**

## What was done this pass (defaults-approved scope)

### Phase 0 — Sheet instrumentation (confirmation in the sheet) ✅
- New **`Execution_Plan`** tab (tier legend, per-tier counts, scope, terminology findings).
- Every one of the 950 rows tagged in **Notes** + **Tester** with its evidence tier / phase / owner.
- **Status left untouched** except where genuinely executed below.

### Phase 1 (T1 static) + Phase 2 (T2 automated) — partial, evidence-backed ✅
- Ran **509** repo unit/integration tests across quiz/anti-cheat, payments-webhook, foxy-grounding,
  auth-onboarding — **all passing** (logs in `evidence/`).
- **6 P0 rows certified PASS** (each cites its exact test + `evidence/T2_certified_rows_testlog.txt`):
  QUIZ-0001, QUIZ-0002, PAY-0003, PAY-0004, FOXY-0001, FOXY-0002.

## Findings (surfaced, NOT smoothed into a pass)
- **QA-FIND-001** — `LANGUAGE_GAP` contract (Hindi→explicit gap) is **not implemented** in code
  (0 grep hits; docs-only). Affects FOXY-0004 + 17_I18N. Candidate P1. Confirm live.
- **QA-FIND-002** — baseline has `SECURITY DEFINER` fns but 0 explicit `REVOKE … FROM anon`;
  needs positive architect confirmation no destructive fn is anon-executable (SEC-0003).
- Terminology: `CURRICULUM_GAP` = grounded-answer `abstain/coverage` (not a literal token);
  `ff_ui_v3_*` = `one_experience_v3_*`, which were seeded→disabled→**removed**.

## Roll-up
| Total | PASS | FAIL | NOT RUN |
|---|---|---|---|
| 950 | 6 | 0 | 944 |

## What unblocks the remaining 944 (by tier)
- **T3 (121 rows, live-DB):** read access to live/staging Supabase + A/B test accounts → RLS matrix,
  BKT invariant, quota atomicity, readiness/Hindi coverage.
- **T4 (714 rows, live-browser/API):** a running staging URL + test accounts + Razorpay TEST keys →
  RBAC/INPUT/DEVICE/EDGE/NAV/CONTENT matrices, nav no-blank, live Foxy.
- **T5 (10 rows, manual):** human executor for real ₹ LIVE Razorpay (+ dashboard screenshot),
  WhatsApp delivery, physical low-end Android, real email inbox.
- **Deeper T1:** specialist-agent review (architect/ai-engineer) for REG-0004 retry-coverage &
  SEC-0003 anon-lockdown before those flip to PASS.

## Reproduce the certified rows
```
cd apps/host && npx vitest run \
  src/__tests__/api/quiz-server-shuffle-authority.test.ts \
  src/__tests__/anti-cheat-server-parity.test.ts \
  src/__tests__/api/payments/verify-hmac-reject.test.ts \
  src/__tests__/payments/webhook-retry-and-dedupe-semantics.test.ts \
  src/__tests__/payments/webhook-concurrent-fire.test.ts \
  src/__tests__/foxy-grounded-gate.test.ts \
  src/__tests__/api/foxy/structured-abstain-and-history.test.ts \
  src/__tests__/api/foxy/grounded-failure-fallback.test.ts
```
