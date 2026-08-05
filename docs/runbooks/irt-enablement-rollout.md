# IRT Enablement — Rollout Runbook

**Date:** 2026-08-05
**Status:** Pre-rollout. `ff_irt_shadow_v1` and `ff_irt_question_selection` both seeded OFF (0%).
**Flags:**
- `ff_irt_shadow_v1` — telemetry-only; gates emission of shadow-metric rows into `POST /api/telemetry/irt-shadow`. Seeded OFF by migration `20260809000000_seed_ff_irt_shadow_v1.sql`.
- `ff_irt_question_selection` — ramps the *serving* switch from the v1 Fisher-info RPC to the v2 IRT-scored path. Seeded OFF; **does not flip** until the paired eval gate below PASSes.
**Data layer:** `select_questions_by_irt_info_v2` (migration `20260809000100`), `estimateTheta` (`packages/lib/src/irt/estimate-theta.ts`), `shadow-metrics` (`packages/lib/src/irt/shadow-metrics.ts`), telemetry route (`apps/host/src/app/api/telemetry/irt-shadow/route.ts`).
**Eval harness:** `eval/irt/harness/{cli,run-eval,metrics,verdict}.ts`; runner `npm run eval:irt:harness` (apps/host).
**Spec:** `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §1.3 E2
**Owner:** ops (this runbook + flag flips) · ai-engineer (RPC v2 + estimate-theta + shadow-metrics) · assessment (verdict thresholds) · backend (telemetry route)

## What this controls

Two independent flags, ramped sequentially:

1. **`ff_irt_shadow_v1`** — turns ON the telemetry path that computes a per-request IRT shadow prediction (2PL, Fisher-info + Newton-Raphson `estimateTheta`) alongside the live v1 serving decision and posts it to `/api/telemetry/irt-shadow`. Serving order is **unchanged** (REG-357a): the v2 RPC's return set + ORDER BY match v1 exactly, and no serving path consumes the shadow prediction.
2. **`ff_irt_question_selection`** — flips *serving* to the IRT-scored v2 RPC. **Only ramps after the eval harness PASSes on the shadow window** (see gate below).

## Prerequisites (must all be true before flipping `ff_irt_shadow_v1`)

- [ ] Phase 3 wave 3a merged: shadow telemetry route + `estimateTheta` + `shadow-metrics` deployed.
- [ ] Phase 3 wave 3b merged: `select_questions_by_irt_info_v2` deployed with bilingual columns (`question_hi`, `explanation_hi`, `hint`) and Tier-0 quality predicates matching the v1 RPC. This resolves E2's named P7 blocker (v1 RPC lacked bilingual columns, per tracker E2 notes).
- [ ] Migration `20260809000000_seed_ff_irt_shadow_v1.sql` applied. Verify:
  ```sql
  SELECT flag_name, is_enabled, rollout_percentage
  FROM feature_flags WHERE flag_name = 'ff_irt_shadow_v1';
  -- expect: is_enabled = false, rollout_percentage = 0
  ```
- [ ] Migration `20260809000100_select_questions_by_irt_info_v2.sql` applied and `select_questions_by_irt_info_v2` visible in `pg_proc`.
- [ ] `POST /api/telemetry/irt-shadow` responds 401 without auth and accepts a well-formed payload with a valid session (P13: UUIDs + numbers only, ZOD rejects free text — pinned by REG-357b).
- [ ] Baseline: `npm run eval:irt:harness` produces an `INCONCLUSIVE` verdict (no shadow rows yet) — this is the expected pre-shadow state, treated as a re-run signal, not a failure.

## Per-request telemetry contract (REG-357)

Every request in `ff_irt_shadow_v1`-selected traffic emits ONE row to `POST /api/telemetry/irt-shadow` with:

| Field | Type | Notes |
|---|---|---|
| `studentId` | UUID | server-side session-derived |
| `questionId` | UUID | from v1 selection |
| `theta` | number | `estimateTheta` output for this student's calibrated response history |
| `discrimination` | number | 2PL `a` parameter for the question |
| `difficulty` | number | 2PL `b` parameter for the question |
| `probability` | number | 2PL P(correct) at this theta |
| `served_via` | enum | `'v1_fisher'` while `ff_irt_question_selection` OFF; `'v2_shadow'` mirror-only |

**P13 boundary (REG-357b):** no free text, no name/email/phone, no request body echo, no header echo. Route is `authorizeRequest`-gated.

**Anti-farming note:** shadow emission is per legitimate served item — the route rejects payloads whose `questionId` was not part of the caller's active `foxy_served_items` set for the current session window. Direct client-side POSTs cannot flood the table.

## Staged flip: `ff_irt_shadow_v1` (5% → 25% → 100%)

Each stage: minimum 48h dwell, health check between stages. Kill switch = flag OFF (no deploy).

### Stage A — 5%

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 5,
    target_environments = ARRAY['production']::text[],
    updated_at = now()
WHERE flag_name = 'ff_irt_shadow_v1';
```

Health check (48h after flip):
- `SELECT count(*) FROM irt_shadow_telemetry WHERE emitted_at > now() - interval '48 hours';` — expect roughly 5% of the 48h served-item volume.
- No new Sentry errors on `/api/telemetry/irt-shadow` or `select_questions_by_irt_info_v2`.
- `select_questions_by_irt_info` (v1) p95 latency unchanged (serving path did NOT move).

### Stage B — 25%

Same UPDATE, `rollout_percentage = 25`. Same health check + spot-verify that `served_via` is still `'v1_fisher'` on 100% of rows (serving unchanged).

### Stage C — 100%

Same UPDATE, `rollout_percentage = 100`. Let telemetry accumulate for **>= 14 days** before running the paired eval gate.

## Paired eval gate — REQUIRED before ramping `ff_irt_question_selection`

Run:

```bash
npm run eval:irt:harness -- --window=last-14d --out=artifacts/irt-eval-<date>.json
```

The gate PASSes only when `evaluateIrtVerdict` returns `PASS` per `eval/irt/harness/verdict.ts`:

| Gate | Threshold | Constant |
|---|---|---|
| Calibrated responses in window | `>= 500` | `MIN_CALIBRATED_RESPONSES` |
| Distinct students contributing | `>= 50` | `MIN_STUDENTS` |
| 2PL vs proxy AUC uplift | `deltaAUC >= +0.03` | `MIN_DELTA_AUC` |
| 2PL vs proxy Brier loss | `deltaBrier <= -0.005` | `MAX_DELTA_BRIER` |

Verdict handling:
- **PASS** — you may proceed to the cohort ramp below.
- **INCONCLUSIVE** — volume gate unmet or `deltaAUC`/`deltaBrier` unmeasurable. **This is a re-run signal, not a fail.** Let shadow telemetry accumulate longer (typically another 7 days) and re-run. Do NOT ramp on an INCONCLUSIVE verdict, and do NOT treat it as an escalation.
- **FAIL** — volume gate met but deltas do not clear thresholds. Do NOT ramp. Root-cause with ai-engineer + assessment before revising calibration; do not lower the thresholds.

Persist the artifact under `artifacts/irt-eval-<date>.json` and link it in the cohort-ramp change record.

Shadow-divergence metrics (median Spearman rho, median top-K overlap) are **INFORMATIONAL ONLY** and never gate.

## Cohort ramp: `ff_irt_question_selection` (5% → 25% → 100%)

Only after PASS above. Each stage: minimum 72h dwell.

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 5,   -- then 25, then 100
    target_environments = ARRAY['production']::text[],
    updated_at = now()
WHERE flag_name = 'ff_irt_question_selection';
```

Per-stage health check:
- Quiz score distribution: no >=5 pp regression on the cohort vs the control (last 7d prior).
- `answer_method='mcq'` correct-rate on served items: no >=3 pp regression.
- No new Sentry errors on the v2 RPC path.
- P1 score-formula invariant untouched (server is the only re-deriver — pinned by REG-51/REG-53).

**Kill switch — instant, no deploy:**
```sql
UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
       updated_at = now()
WHERE flag_name = 'ff_irt_question_selection';
```
Flag cache TTL is 5 minutes. Serving reverts to the v1 Fisher-info RPC on the next fetch. In-flight quizzes are unaffected — question selection is per-request, no session pinning.

## Rollback procedures

| Symptom | Action |
|---|---|
| Shadow route errors spiking | Set `ff_irt_shadow_v1` `is_enabled=false`; investigate `estimateTheta` convergence or v2 RPC join before re-flipping. |
| Eval harness verdict flips PASS → FAIL after cohort ramp | Kill-switch `ff_irt_question_selection` immediately; re-run harness on the post-ramp window; do NOT re-ramp until you know why. |
| Serving-order divergence detected (REG-357a) | Kill-switch both flags; treat as a P1-adjacent regression; open architect + assessment review before any re-ramp. |
| Telemetry P13 audit finding | Kill-switch `ff_irt_shadow_v1`; the route must never persist free text (REG-357b). |

## Notes

- P7 bilingual blocker resolved: the v2 RPC returns `question_hi`, `explanation_hi`, and `hint` in the same row shape as v1 (see `select_questions_by_irt_info_v2` migration body). This was the named blocker in tracker record E2.
- Deferred: the same-misconception evidential-twin serving is tracked under L5, not this rollout.
- The IRT nightly calibration cron (`/api/cron/irt-calibrate` at 02:50 UTC, REG-44 pinned in `vercel.json`) is unchanged by this rollout; it maintains `question_bank.irt_a`/`irt_b` regardless of flag state.
