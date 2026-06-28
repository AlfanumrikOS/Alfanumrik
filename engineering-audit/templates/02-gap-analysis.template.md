# 02 — Gap Analysis: <workflow name>

> Phase: IDENTIFY GAPS. Copy to `cycles/<cycle>/<workflow>/02-gap-analysis.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Author squad:** <agent>
- **Date:** <YYYY-MM-DD>
- **Map reference:** `./01-map.md`

## Method
<How gaps were found: code reading, manual walkthrough, test run, invariant check.>

## Gap register

Each gap uses the standard schema. Gap IDs: `<WORKFLOW>-G<NN>` (e.g. `AUTH-G01`).

| Gap ID | Title | Evidence (file:line) | Business impact | Technical impact | Root cause (link) | Severity | Likelihood | Recommendation | Est. effort | Expected ROI |
|---|---|---|---|---|---|---|---|---|---|---|
| <WF>-G01 | | `path:line` | | | `03-root-cause.md#<id>` | Critical/High/Med/Low | High/Med/Low | | S/M/L | High/Med/Low |

## Severity definitions
- **Critical** — breaks the workflow, violates an invariant, or leaks PII / money.
- **High** — significant broken/empty state or security weakness; degraded but not down.
- **Med** — quality/UX/robustness gap; no invariant breach.
- **Low** — polish, consistency, minor a11y/i18n.

## Prioritised fix order
1. <Gap ID — why first>
2. <Gap ID>

## Cross-workflow gaps
<Gaps that actually belong to another workflow domain — cross-link, do not jump queue.>
