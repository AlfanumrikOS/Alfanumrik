# 01 — Map: <workflow name>

> Phase: MAP. Copy to `cycles/<cycle>/<workflow>/01-map.md` and fill in.

- **Cycle:** <cycle-N>
- **Workflow:** <name>
- **Primary invariants:** <P-list>
- **Author squad:** <agent>
- **Date:** <YYYY-MM-DD>

## Business purpose
<One paragraph: what this workflow exists to achieve and for whom.>

## User journeys
1. <entry → step → step → outcome>
2. <alternate / error path>

## Surface map

### Pages / components
| Path | Role | Purpose |
|---|---|---|
| `src/app/...` | | |

### API routes
| Route | Method | Auth (RBAC perm) | Purpose |
|---|---|---|---|
| `/api/...` | | | |

### Edge Functions / cron (if any)
| Function | Trigger | Purpose |
|---|---|---|

### DB tables (best-effort — verify)
| Table | RLS? | Key columns | Notes |
|---|---|---|---|

## Data flow
<Describe the request→response and write paths. Note atomic operations, RPCs, caches.>

## External dependencies
<Razorpay / Supabase Auth / Claude API / email / Redis / etc.>

## Invariant touchpoints
| Invariant | Where it applies in this workflow |
|---|---|

## Open questions for later phases
- <unknowns to confirm during GAP / ROOT-CAUSE>
