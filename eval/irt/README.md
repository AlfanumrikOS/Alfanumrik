# IRT shadow-eval harness (Phase 3 E2)

Offline, **read-only** measurement harness that decides whether the calibrated
2PL IRT model has earned a ramp of `ff_irt_question_selection` (IRT-scored
live question serving).

## What it measures

1. **Shadow divergence** — aggregates the `irt_shadow_divergence` telemetry
   samples in `system_metrics` (emitted fire-and-forget by the live selector
   when `ff_irt_shadow_v1` is ON): median Spearman rho and median top-5/top-10
   Jaccard overlap between the live serving order and the fisher-info shadow
   order. **Informational only** — divergence says how *different* IRT serving
   would be, not whether it would be *better*.
2. **Predictive fit (the gate)** — on responses to calibrated items
   (`irt_calibration_n >= 30`, non-null `irt_a`/`irt_b`/`irt_difficulty`),
   paired comparison of:
   - 2PL: `P = sigmoid(a * (theta - b))` (via `packages/lib/src/irt/fisher-info.ts` `irt2plProb`)
   - proxy: `P = sigmoid(theta - irt_difficulty)`
   scored by AUC (discrimination) and Brier (calibration).

## Verdict (eval/irt/harness/verdict.ts)

- **PASS** — `>= 500` calibrated responses across `>= 50` students, AND
  `deltaAUC >= +0.03` AND `deltaBrier <= -0.005`.
- **INCONCLUSIVE** — volume gates unmet or any gate metric unmeasurable.
- **FAIL** — measurable on sufficient volume but thresholds not cleared.

The CLI exits 0 on every *completed* run (PASS/FAIL/INCONCLUSIVE alike); the
ramp decision reads the `verdict` field in the report artifact. Exit 2 is
reserved for operator/config errors (no creds, malformed baseline).

## Running it

```bash
# From the REPO ROOT:
npm run eval:irt:harness
# or with flags:
npm run eval:irt:harness -- --window-days 30 --baseline eval/irt/baseline/irt-baseline-v1.json --out eval/irt/reports/my-run.json
```

Requires `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) +
`SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local` (the CLI
self-loads it). Read-only: the harness only SELECTs from `system_metrics`,
`quiz_responses` (+ `question_bank` embed), and `student_learning_profiles`.

## ⚠️ npm-script cwd note (why the script is in the ROOT package.json)

`eval:irt:harness` is declared in the **repo-root `package.json`** with body
`npx tsx eval/irt/harness/cli.ts`, which resolves correctly from the root —
where `eval/` actually lives. This deliberately avoids the historical
`eval:rag:harness` mismatch, where the script was declared only in
`apps/host/package.json` while the files live at the repo root (see the "RAG
retrieval-quality eval-harness" row in the root `CLAUDE.md`). JSON has no
comments, so this README carries the rationale. Do not move the script into
`apps/host/package.json` without also rewriting its relative path.

## Layout (house pattern from eval/rag/harness)

| File | Role |
|---|---|
| `harness/cli.ts` | Operator entrypoint: flags, env creds, real service-role reads, report + verdict print |
| `harness/run-eval.ts` | Pure assembler over injected deps; report writer |
| `harness/metrics.ts` | Pure math: median, AUC (Mann-Whitney, tie-aware), Brier, shadow aggregation, 2PL-vs-proxy comparison |
| `harness/verdict.ts` | Pure three-state gate (PASS / FAIL / INCONCLUSIVE) |
| `baseline/irt-baseline-v1.json` | Committed drift baseline (placeholder until a reviewed run populates it) |
| `reports/` | Run artifacts (gitignored by convention; not committed) |

Tests: `apps/host/src/__tests__/eval/irt/`.

Owning agent: ai-engineer. Gate thresholds are assessment-reviewed.
