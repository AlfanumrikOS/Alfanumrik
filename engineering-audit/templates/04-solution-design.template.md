# 04 — Solution Design: <workflow name>

> Phase: DESIGN. Copy to `cycles/<cycle>/<workflow>/04-solution-design.md`.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Author squad:** <agent>
- **Date:** <YYYY-MM-DD>
- **Root-cause reference:** `./03-root-cause.md`

## Design principles for this cycle
- Fix root causes, not just symptoms.
- No new features — restore/complete existing intent.
- Preserve invariants P1–P15; never weaken a gate to pass.

## Per-gap design

### <WF>-G01 — <title>
- **Proposed change:** <what will change, in which files>
- **Approach:** <code / schema / config / docs>
- **Invariants touched:** <P-list> and how they remain upheld
- **RLS/RBAC impact:** <none | describe>
- **Migration needed:** <no | idempotent migration sketch>
- **Backward compatibility:** <contract/shape impact, mobile sync>
- **Alternatives considered:** <option B and why rejected>
- **Test plan:** <unit / E2E / regression to add>

### <WF>-G02 — <title>
<repeat>

## Review-chain plan (P14)
| Critical file touched | Mandatory reviewers |
|---|---|

## Approval gates
<Anything requiring USER approval: invariant change, pricing, RBAC add, AI model, DROP, PII export.>

## Rollout / rollback
<Feature flag? Phased? How to revert safely.>
