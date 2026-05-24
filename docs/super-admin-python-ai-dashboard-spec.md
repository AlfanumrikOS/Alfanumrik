# Super-Admin Dashboard Spec: `/super-admin/python-ai-health`

One-page operational dashboard surfacing Python AI service health on Cloud
Run during and after the 3-6 week TS-to-Python transition. Frontend builds
this in a follow-up PR; this spec is the ops-owned contract for what the
page shows.

This dashboard COMPLEMENTS — does not replace — the existing
[`/super-admin/mol-shadow`](../src/app/super-admin/mol-shadow/page.tsx)
panel. MoL Shadow shows TS-vs-Python output parity at the shadow-pair
level (same prompt, both providers' outputs side-by-side); this page
shows aggregate health, traffic split, and migration status at the
service level.

## Page metadata

- **URL**: `/super-admin/python-ai-health`
- **RBAC**: super-admin only (same authorizeAdmin gate as other super-admin
  pages).
- **Refresh cadence**: 60s server-side refresh + manual refresh button.
  Cache-control: `s-maxage=30, stale-while-revalidate=60`.
- **Mobile breakpoint**: collapses sections vertically; tables become
  stacked cards below `md` breakpoint.

## Data sources

| Source | Used for | Notes |
|---|---|---|
| `mol_request_logs` | Sections 3, 4, 5 (cost, migration status, recent errors) | Existing table; Python service writes identical rows. Query via existing `/api/super-admin/observability` route or new dedicated endpoint. |
| `feature_flags` (`ff_python_ai_services_v1`) | Section 2 (traffic split) | Read `is_enabled`, `metadata.rollout_percentage`, `metadata.functions_enabled[]`. |
| Cloud Run metrics API (optional v2) | Section 1 (service health) | v1 ships with a "View in GCP Console" link-out only; v2 adds direct API integration via service-account credentials. |
| `mol_health_24h` view | Section 1 (latency rollup) | Existing view; covers both TS and Python rows. |

## Sections

### 1. Service health tile (top-left, prominent)

A single-card summary of Cloud Run service state.

| Field | Source | Render |
|---|---|---|
| Service status | Cloud Run metrics API (v2) OR last `/live` ping (v1) | Pill: `Healthy` (green) / `Degraded` (yellow) / `Down` (red) / `Unknown` (gray, v1 only) |
| Active revision | `gcloud run revisions list` (v2) | Truncated revision id (`ai-services-00042-xyz`) + deploy timestamp |
| Instance count | Cloud Run metrics API (v2) | Integer, with trendline last 1h |
| Last deploy | Deploy webhook → `deployment_history` (existing table) | Relative time ("2h ago") + commit SHA + author |
| p95 latency (24h) | `mol_health_24h` | Number in ms, with target threshold |
| Error rate (24h) | `mol_request_logs.failure_chain != ''` | Percentage, with target threshold |

**v1 fallback**: if the Cloud Run metrics API integration isn't ready,
show "Service status" derived from the last `mol_request_logs` row
timestamp (Healthy = < 5 min old; Degraded = 5-15 min; Down = > 15 min)
PLUS a prominent "View in GCP Console" link-out using the URL pattern from
[PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md#daily-checks).

### 2. Traffic split tile (top-right, prominent)

Per-function rollout state from the proxy flag.

For each function in the migration tracking table:

| Function | Render |
|---|---|
| `bulk-question-gen` | Horizontal bar: `[████████░░] 80% Python / 20% TS` |
| `bulk-non-mcq-gen` | `[░░░░░░░░░░] 0% Python / 100% TS` (legacy-only) |
| `foxy-tutor` | `[██████████] 100% Python / 0% TS` (when cutover complete) |

Click-through expands to show:
- Current `rollout_percentage` from flag metadata.
- Function-status pill (legacy-only / proxied canary / proxied 100% /
  python-only).
- Cutover date (target or actual).

Source: `feature_flags.metadata.functions_enabled[]` and
`feature_flags.metadata.rollout_percentage` (or per-function override
field — let backend pick the shape).

### 3. Cost comparison table

Per-function TS-vs-Python cost parity check. Runs during transition only;
disappears once all functions are python-only.

Columns:
- Function name
- 7-day TS calls
- 7-day TS ₹/call (avg `inr_cost`)
- 7-day Python calls
- 7-day Python ₹/call (avg `inr_cost`)
- Delta % (highlight if outside ±5% — should be ~0 since both use the
  same OpenAI/Anthropic models)

Source: `mol_request_logs` grouped by function (derive from `surface` or
`request_id` namespace) and by source platform. The source-platform
column doesn't exist in `mol_request_logs` today — backend follow-up:
add `runtime` column with values `'ts_edge'` / `'python_cloud_run'` (NULL
for pre-transition rows). Until that lands, derive from `request_id`
prefix or `metadata.runtime` if Python service stamps it.

### 4. Per-function migration status table

Pinned source of truth for "what's where during transition", mirroring
the table in [PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md#migration-tracking)
but populated dynamically from `mol_request_logs` + `feature_flags`.

Columns:
- Function name
- Status (legacy-only / proxied canary / proxied 100% / python-only)
- 7-day call count
- 7-day error rate
- Cutover date (TBD or actual)
- Quick action link: "View recent calls" → filter Section 5 to this
  function.

### 5. Recent errors (bottom)

Last 20 errors from `mol_request_logs.failure_chain != ''` across all
migrated functions.

Columns (no PII per P13; explicit allowlist):
- request_id (UUID, link-out to existing forensic-investigation runbook)
- task_type
- failure_chain (e.g. `openai:timeout|anthropic:ok`)
- latency_ms
- created_at (relative time)
- runtime (`ts_edge` / `python_cloud_run`, when the column lands)

Source: `mol_request_logs` query. RLS already prevents non-service-role
reads — this page uses the existing super-admin server-side fetch
pattern.

## Daily-glance behavior

Designed for the ops daily-check workflow described in
[PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md#daily-checks):

1. Operator opens this page first thing in shift.
2. Sections 1 + 2 are the "everything OK at a glance" check.
   - Section 1 all-green + Section 2 traffic split matches what the
     migration tracking expects → 30-second daily check is done; move on.
3. If anything red:
   - Drill into Section 4 to see which function is affected.
   - Click "View recent calls" to filter Section 5.
   - Use the failure_chain to decide rollback option (1 / 2 / 3 from
     [PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md#rollback-procedures)).

## Out of scope (defer to v2)

- Direct Cloud Run logs view (operators use `gcloud` CLI per the runbook).
- Direct revision-management UI (architect-owned via deploy pipeline).
- Cost projections / budget alerts (handled by Cloud Billing budget
  notifications, separately).
- Output-quality / TS-vs-Python diff view (already lives in
  [`/super-admin/mol-shadow`](../src/app/super-admin/mol-shadow/page.tsx) —
  cross-link to it from Section 4's per-function row).

## Handoff requirements

Per the [super-admin-reporting skill](../.claude/skills/super-admin-reporting/SKILL.md)
handoff protocol for "Adding a new metric or report":

1. **ops** (this doc): defines what's shown, data sources, severity
   thresholds.
2. **architect**: reviews data-source RLS / PII boundaries; reviews any
   new `mol_request_logs.runtime` column migration; reviews Cloud Run
   metrics API integration (v2) for credential handling.
3. **backend**: implements `/api/super-admin/python-ai-health` route +
   any new aggregation queries; adds the `runtime` column to
   `mol_request_logs` (forward-only; NULL for historical rows).
4. **frontend**: implements the page at `/super-admin/python-ai-health`
   following the per-page ownership pattern in the
   [super-admin-reporting skill](../.claude/skills/super-admin-reporting/SKILL.md#per-page-ownership).
5. **testing**: contract tests on API response shape; component tests on
   each section's render behavior; E2E test that exercises the page
   under super-admin RBAC.
6. **quality**: review chain completion gate.

Estimated implementation: 1 day frontend + 1 day backend + 0.5 day testing
once the Python service goes live on Cloud Run.

## See also

- [PYTHON_AI_OPERATIONS.md](PYTHON_AI_OPERATIONS.md) — operational
  runbook (this dashboard implements the visibility surface)
- [MOL_OPERATIONS.md](MOL_OPERATIONS.md) — existing MoL ops doc
  (alert thresholds reused)
- [`/super-admin/mol-shadow`](../src/app/super-admin/mol-shadow/page.tsx)
  — complementary TS-vs-Python output-pair dashboard
- [`.claude/skills/super-admin-reporting/SKILL.md`](../.claude/skills/super-admin-reporting/SKILL.md)
  — ownership matrix and handoff protocols
