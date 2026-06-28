# 03 — Root Cause: <workflow name>

> Phase: ROOT CAUSE. Copy to `cycles/<cycle>/<workflow>/03-root-cause.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Author squad:** <agent>
- **Date:** <YYYY-MM-DD>
- **Gap reference:** `./02-gap-analysis.md`

## Per-gap root cause

### <WF>-G01 — <title>
- **Observed symptom:** <what the gap looks like>
- **5 Whys / chain:**
  1. Why? <…>
  2. Why? <…>
  3. Why? <…>
- **True root cause:** <the underlying reason>
- **Cause category:** missing-validation | missing-state | wrong-contract | RLS/RBAC-gap | invariant-drift | empty-state-unhandled | perf | i18n | tech-debt | other
- **Blast radius:** <other workflows/files affected by the same root cause>

### <WF>-G02 — <title>
<repeat>

## Systemic patterns
<Root causes shared across multiple gaps — fixing the pattern fixes many gaps.>

## Inputs to design
<What the solution-design phase must address given these root causes.>
