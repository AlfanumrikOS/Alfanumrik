# 08 — Regression: <workflow name>

> Phase: REGRESSION. Copy to `cycles/<cycle>/<workflow>/08-regression.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Verification squad:** **testing**
- **Date:** <YYYY-MM-DD>
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [ ] Full `npm test` green (n/total)
- [ ] Relevant E2E specs green (`e2e/...`)
- [ ] No previously-passing test now skipped/weakened

## New regression catalog entries
For any new invariant surface created/restored, file an entry in
`.claude/regression-catalog.md` (that file is authoritative — this is a pointer).

| Proposed REG-ID | Invariant | What it pins | Test file | Filed in catalog? |
|---|---|---|---|---|
| REG-<nnn> | P<n> | | `src/__tests__/...` | yes/no |

## Coverage delta
| Metric | Before | After |
|---|---|---|
| Test count | | |
| Coverage % | | |
| Catalog entries | | |

> Snapshot the same numbers into `metrics/coverage-trend.md`.

## Residual risk
<Invariant areas still tested-only or no-coverage after this cycle.>

## Sweep verdict
**GREEN / NOT GREEN** — <reason>
