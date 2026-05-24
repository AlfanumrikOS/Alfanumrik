# Python AI Services — Operations Runbook

Operational runbook for the FastAPI AI/ML service running on Google Cloud Run
(`asia-south1` / Mumbai). Built during the Phase 0 strategic shift from
TypeScript Edge Functions to Python — ai-engineer owns `python/services/ai/`,
architect owns the Cloud Run deploy pipeline, ops (this doc) owns the
operational layer.

The service writes the SAME `mol_request_logs` rows as the existing TS
Edge Functions, so the [super-admin MOL panel](../src/app/super-admin/mol-shadow/page.tsx)
keeps working unchanged once cutover begins. Treat the existing MoL ops
docs as the canonical reference for shared telemetry behaviour:

- Cross-reference: [`docs/MOL_OPERATIONS.md`](MOL_OPERATIONS.md) — student-traffic and Phase 1A admin-traffic alert thresholds (applies to Python service once cutover begins; the underlying telemetry is identical).
- Architecture reference: [`docs/MOL_ARCHITECTURE.md`](MOL_ARCHITECTURE.md) — TS MoL framework (remains live throughout transition) and the "Transition to Python" addendum.
- Architecture spec for the Python service: `docs/PYTHON_AI_ARCHITECTURE.md` (owned by architect, in flight).

## Daily checks

Run at start of shift. Five minutes, end-to-end.

1. **Super-admin → Platform health → MOL panel**. Confirm the Python service is
   present in `mol_request_logs`:
   - Rows with `provider IN ('anthropic','openai')` arriving within last 5 min
     for each migrated function.
   - `surface` column matches the function namespace (foxy / quiz / solver /
     ocr) for student-traffic functions; for admin-traffic functions the
     synthetic `admin-<function>-<grade>-<subject>` key in `request_id`.
   - p95 latency under the per-task targets from [MOL_OPERATIONS.md](MOL_OPERATIONS.md)
     (student single-shot < 2000ms, hybrid < 3500ms; admin short-form < 4000ms,
     admin long-form quiz/eval < 8000ms).

2. **Cloud Run dashboard**. Direct URL pattern (replace `<PROJECT_ID>` with
   the production GCP project id once CEO confirms naming):
   ```
   https://console.cloud.google.com/run/detail/asia-south1/ai-services/metrics?project=<PROJECT_ID>
   ```
   Verify:
   - **Active instances**: spikes correlate with traffic. A flat-line at
     `min_instances` while `mol_request_logs` shows load means autoscaling is
     stalled (likely a concurrency or readiness-probe issue — investigate).
   - **Request count last 24h**: trending within ±20% of yesterday for the
     same hour-bucket. Sudden zero = proxy fallback to legacy, sudden surge =
     possible runaway loop.
   - **p95 latency < 3s** (service-level target; per-task targets in step 1
     are more specific).
   - **Error rate < 1%**. If higher, drop into step 3.
   - **Memory utilization < 80%**. Above 80% means we should bump the Cloud
     Run instance memory (architect-owned config) before the next OOM crash.

3. **Error logs scan**:
   ```bash
   gcloud run services logs read ai-services \
     --region=asia-south1 \
     --limit=20 \
     --severity=ERROR
   ```
   Any unhandled exception is a defect — file an issue immediately. Provider
   timeouts that the MoL chain recovers from will surface as INFO in
   `mol_request_logs.failure_chain` instead of ERROR in Cloud Run logs;
   don't double-count them.

## Rollout playbook for new function ports

This is the standard cadence for each function that ai-engineer ports from
TypeScript Edge Functions to Python. Each port is a separate canary cycle.

**Pre-canary** (architect + ai-engineer):
- Python implementation deployed to Cloud Run with traffic at 0%.
- Supabase Edge proxy code merged but `ff_python_ai_services_v1` flag is OFF
  (or set to `rollout_percentage: 0`).
- Staging green: smoke tests pass against the Python service URL directly.

**Initial canary** (ops driver):
1. Flip the proxy flag to route 10% of traffic for ONE function (e.g.
   `bulk-question-gen` first, since it's admin-only and lowest blast
   radius). The flag scope is per-function — use the
   `metadata.functions_enabled = ['bulk-question-gen']` field so the other
   five admin functions stay on legacy TS.
2. Watch 4 hours. Track:
   - `mol_request_logs` Python-vs-TS provider/latency parity for the
     migrated function (cost should be ~identical; both providers are
     OpenAI/Anthropic).
   - Cloud Run error rate.
   - p95 latency parity vs the same function on TS Edge in the prior 24h.
   - Any user complaints from support ticket inbox.
3. If clean, ramp: **10% → 25% → 50% → 100%** over 24-48 hours, holding
   8-12 hours at each step.

**Backout** (any step):
- Change the proxy flag to forward 100% to the legacy Edge handler:
  ```sql
  update public.feature_flags
     set is_enabled = false,
         metadata = metadata || jsonb_build_object('kill_switch', true, 'enabled', false),
         updated_at = now()
   where flag_name = 'ff_python_ai_services_v1';
  ```
  5-minute flag-cache TTL (same pattern as `ff_mol_admin_functions_v1`) →
  Python traffic stops within 5 min, no redeploy needed.

**100% cutover**:
- Once a function has held at 100% Python for 7 days with no incidents and
  cost/latency parity holds, ai-engineer can delete the legacy TS Edge
  handler in a follow-up PR. Update the migration tracking checklist below
  in the same PR.

## Cutover procedure for individual functions

Phase 1 (2026-05-24) ships a dedicated **per-function** feature flag for
each port instead of the originally-planned shared
`ff_python_ai_services_v1` flag. The decision: per-function control means
each function has its own cutover schedule + blast radius, and an OpenAI
incident on one function doesn't force-flip every other function to TS at
the same time. This mirrors the Phase 1A admin-routing pattern but inverts
the granularity (one flag per function, not one shared flag for six
functions).

Each function's flag is named `ff_python_<function_name>_v1` and carries
the same envelope shape:

```json
{
  "enabled": false,
  "kill_switch": false,
  "rollout_pct": 0,
  "description": "...",
  "owner": "ai-engineer"
}
```

Kill-switch precedence (read by `shouldProxyToPython` in
`supabase/functions/_shared/python-ai-proxy.ts`):

1. `metadata.kill_switch === true` → never proxy (legacy TS path)
2. `typeof metadata.enabled === 'boolean'` → that value wins
3. else → `is_enabled` column

Defensive default on any flag-read failure: do NOT proxy. Cost > correctness
during a flag-read outage — same trade-off as `isMolAdminRoutingEnabled()`.

### Bumping rollout for one function

Replace `<function>` with the migrated function name (first port:
`bulk_question_gen`).

**10% canary** (after Cloud Run smoke tests are green):

```sql
update public.feature_flags
   set is_enabled = true,
       metadata = metadata
                  || jsonb_build_object(
                       'enabled', true,
                       'kill_switch', false,
                       'rollout_pct', 10
                     ),
       updated_at = now()
 where flag_name = 'ff_python_<function>_v1';
```

5-minute flag-cache TTL → 10% of traffic begins forwarding to Cloud Run
within 5 min. Watch `mol_request_logs` and Cloud Run dashboards for 8-12h
per the rollout playbook above.

**25% / 50% / 100% ramps** — same SQL, change `rollout_pct` to the next
step:

```sql
update public.feature_flags
   set metadata = metadata || jsonb_build_object('rollout_pct', 25),
       updated_at = now()
 where flag_name = 'ff_python_<function>_v1';
```

```sql
update public.feature_flags
   set metadata = metadata || jsonb_build_object('rollout_pct', 50),
       updated_at = now()
 where flag_name = 'ff_python_<function>_v1';
```

```sql
update public.feature_flags
   set metadata = metadata || jsonb_build_object('rollout_pct', 100),
       updated_at = now()
 where flag_name = 'ff_python_<function>_v1';
```

### Emergency kill switch for one function

When Cloud Run is up but producing bad output for this specific function,
flip the kill switch WITHOUT touching the other in-flight cutovers:

```sql
update public.feature_flags
   set metadata = metadata || jsonb_build_object('kill_switch', true),
       updated_at = now()
 where flag_name = 'ff_python_<function>_v1';
```

Within 5 minutes the proxy reverts the affected function to its legacy
TS path; other functions in mid-cutover are unaffected.

### Verify the current rollout state

```sql
select flag_name,
       is_enabled,
       (metadata->>'enabled')::boolean         as metadata_enabled,
       (metadata->>'kill_switch')::boolean     as kill_switch,
       (metadata->>'rollout_pct')::int         as rollout_pct,
       updated_at
  from public.feature_flags
 where flag_name like 'ff_python_%_v1'
 order by flag_name;
```

The same row shape applies to every per-function flag; this query
shows the entire Python-cutover fleet at a glance.

### First-port checklist (bulk-question-gen)

Apply this checklist verbatim for each subsequent function port.

- [ ] `PYTHON_AI_BASE_URL` env var set on the Edge Function (architect).
- [ ] Cloud Run service health: `/live` returns 200, `/readyz` returns
      200 (no upstream issues).
- [ ] Staging smoke test: hit the Python service URL directly with a
      valid admin JWT and a known-good `bulk-question-gen` request body.
      Compare response shape to the TS function's output.
- [ ] Flag exists and is in default state:
      `select * from public.feature_flags where flag_name = 'ff_python_bulk_question_gen_v1';`
      should show `is_enabled=false`, `rollout_pct=0`.
- [ ] Bump to 10% canary using the SQL above.
- [ ] Watch 8-12h: Cloud Run error rate < 1%, p95 latency parity vs TS,
      `mol_request_logs` shows correct provider attribution for the
      forwarded slice.
- [ ] Ramp 25% → 50% → 100% per the cadence above.
- [ ] At 100% Python for 7 days clean → ai-engineer deletes the legacy TS
      Edge handler in a follow-up PR, updates the migration tracking
      table below.

## Alerts

Thresholds below are CLOUD-RUN-SPECIFIC. For underlying provider-fallback
and cost alerts on the shared MoL telemetry path, see
[MOL_OPERATIONS.md](MOL_OPERATIONS.md) — those alert tables apply equally to
the Python service since it writes the same `mol_request_logs` rows.

| Condition | Severity | Action |
|---|---|---|
| Cloud Run error rate > 5% over 5 min | P2 | Check `gcloud run services logs read ai-services --region=asia-south1 --severity=ERROR`. If sustained → rollback to previous revision via `gcloud run services update-traffic` (see Rollback procedures below). |
| Cloud Run p95 latency > 5s over 15 min | P3 | Investigate slow upstream provider via `mol_request_logs.provider, latency_ms` split. Possibly increase Cloud Run instance memory or concurrency settings (architect-owned config in `python/deploy/`). |
| Cloud Run cold start rate > 30% over 1h | P3 | Bump `--min-instances=1` (costs ~₹500/mo extra at current traffic; eliminates cold starts). Architect owns the deploy YAML change. |
| `/readyz` returning 503 sustained > 5 min | P1 | Service cannot reach Supabase or AI providers — check Secret Manager values for the active revision, check Supabase status page, check Anthropic + OpenAI status pages. Cloud Run readiness probe should already have stopped routing traffic to the bad instance. |
| Provider `failure_chain` rate > 10% (any task type) over 1h | P2 | OpenAI or Anthropic degraded — check provider status pages. If sustained > 30 min, consider flag-flipping to single-provider via `mol_routing_weights` adjustment. Cross-reference: this is the same condition as the Phase 1A admin-functions table in [MOL_OPERATIONS.md](MOL_OPERATIONS.md). |
| Monthly Cloud Run cost > ₹2,000 (10x baseline projection) | P3 | Likely a runaway loop or dropped request-caching. Investigate via `mol_request_logs` top offenders (existing pattern: `tsx scripts/mol-cost-report.ts --hours=24`). |
| `gcloud run services list` shows revision count > 20 for `ai-services` | P4 (housekeeping) | Old revisions are charged storage; prune via `gcloud run revisions delete` keeping the last 5. |

## Rollback procedures

Three options, ranked from fastest to safest.

### 1. Cloud Run traffic split (INSTANT, no redeploy)

Best for "the new deploy is broken" — bad code reached Cloud Run but the
previous revision is still tagged and healthy.

```bash
# List recent revisions to pick the previous good one
gcloud run revisions list \
  --service=ai-services \
  --region=asia-south1 \
  --limit=5

# Point 100% of traffic at the previous revision
gcloud run services update-traffic ai-services \
  --to-revisions=<PREVIOUS_REV_ID>=100 \
  --region=asia-south1
```

Takes effect within 30s. The bad revision stays in Cloud Run but receives
zero traffic — useful for post-incident forensics.

### 2. Edge proxy fallback flag (5 MIN, no redeploy)

Best for "Python service is up but producing wrong results" — Cloud Run is
healthy from its own perspective, but downstream validation (oracle gates,
P6 checks, user complaints) shows the output is bad.

```sql
update public.feature_flags
   set is_enabled = false,
       metadata = metadata || jsonb_build_object('kill_switch', true, 'enabled', false),
       updated_at = now()
 where flag_name = 'ff_python_ai_services_v1';
```

5-min flag-cache TTL → proxy reverts to legacy TS handler (Phase 1A MoL
admin-functions or whatever was there pre-cutover). Same kill-switch
precedence pattern as `ff_mol_admin_functions_v1`:

1. `metadata.kill_switch === true` → legacy path
2. `typeof metadata.enabled === 'boolean'` → that value
3. else → `is_enabled` column

Defensive default: any flag-read failure → legacy path (never routes to
Python when ops thinks the switch is off).

### 3. Full GitHub revert (5-10 MIN, redeploy)

Best for "the new code introduced a critical bug we need erased from
history" — invariant violation, security issue, or anything that needs to
stop showing up in CI / future reverts.

1. Revert the merge commit on `main` (use `git revert -m 1 <commit_sha>`,
   not `git reset` — main is protected).
2. CI runs gates 1-4, Cloud Build pipeline deploys the reverted code to
   Cloud Run.
3. Architect owns the deploy pipeline; ops monitors `mol_request_logs` to
   confirm error rate drops back to baseline.

Slowest of the three but the only one that gives a guaranteed clean state.
Use only when options 1 + 2 are insufficient.

## Cost monitoring

End-of-shift daily check (5 min).

1. **Provider cost from `mol_request_logs`**:
   ```sql
   select provider, surface, count(*) as calls,
          round(sum(inr_cost)::numeric, 2) as total_inr,
          round(avg(latency_ms)::numeric, 0) as avg_latency_ms
     from public.mol_request_logs
    where created_at > now() - interval '24 hours'
    group by provider, surface
    order by total_inr desc;
   ```
   Compare to yesterday and 7-day moving average. Variance > ±15% needs
   investigation — same threshold as the existing MoL daily check.

2. **Cloud Run billing**. Direct URL pattern (replace `<PROJECT_ID>`):
   ```
   https://console.cloud.google.com/billing/<BILLING_ACCOUNT_ID>/reports?project=<PROJECT_ID>
   ```
   Filter to service=`ai-services`. Daily spend should be near-zero while
   we're within the free tier (see Capacity planning below).

3. **TS-vs-Python parity during transition**. During cutover (any week where
   `ff_python_ai_services_v1` is at rollout < 100%), compare the same
   function's `inr_cost` per call on TS vs Python. They should be within
   ±5% — both call the same OpenAI/Anthropic models with the same
   prompts. Drift indicates Python is doing extra tokens (prompt-caching
   regression, double-call bug, etc.).

## Incident response checklist

First 15 minutes when alerts fire. Don't skip steps — the order is
deliberate.

1. **Acknowledge the alert** in the escalation channel (PagerDuty / Sentry /
   whatever CEO confirms — see Open questions section).
2. **Cloud Run logs (last 15 min)**:
   ```bash
   gcloud run services logs read ai-services \
     --region=asia-south1 \
     --limit=50 \
     --freshness=15m
   ```
3. **Service health from outside** (don't trust internal probes during an
   incident):
   ```bash
   curl -i https://<SERVICE_URL>/live
   curl -i https://<SERVICE_URL>/readyz
   ```
   The Cloud Run service URL pattern is
   `https://ai-services-<HASH>-asia-south1.run.app`. `/live` should
   return 200 if the process is alive; `/readyz` returns 503 if upstream
   dependencies (Supabase, providers) are unhealthy. (We use `/live`
   instead of `/healthz` because Cloud Run's frontend intercepts the
   path `/healthz` before it reaches the container — confirmed
   2026-05-24.) See REG-72 in
   [`.claude/regression-catalog.md`](../.claude/regression-catalog.md) for
   the contract.
4. **Provider status pages**:
   - Anthropic: https://status.anthropic.com/
   - OpenAI: https://status.openai.com/
   - If either is degraded, the MoL `failure_chain` rate should already
     show it — confirm via `mol_request_logs` query in the Cost monitoring
     section above.
5. **Supabase status page** (only if `/readyz` returned 503):
   - https://status.supabase.com/
   - Check our project `shktyoxqhundlvkiwguu` specifically; status-page
     incidents are usually region-wide.
6. **Decide rollback strategy** using the three options in the Rollback
   procedures section above:
   - Bad deploy → option 1 (Cloud Run traffic split).
   - Bad results (output quality) → option 2 (proxy flag).
   - Bad code that needs to be erased → option 3 (GitHub revert).
7. **Execute rollback**.
8. **Document in the incident log**. We do not have a dedicated incident
   log yet — proposed format until one exists:
   - File: `docs/incidents/YYYY-MM-DD-<short-title>.md`
   - Sections: Trigger, Detection, Diagnosis, Rollback action, Root cause
     (TBD if post-incident), Follow-ups.
   - Open a follow-up issue for architect to formalize an incident-log
     workflow (Linear / GitHub Issues / dedicated repo).

## Capacity planning

**Google Cloud Run free tier** (per month, per billing account, as of
2026-05-24):

- 2,000,000 requests
- 360,000 vCPU-seconds
- 180,000 GiB-seconds
- 1 GB network egress (to internet; egress to other GCP services in same
  region is free)

**Current Phase 1A admin-traffic volume** (~50,000 admin Edge Function
calls per month, source: [MOL_OPERATIONS.md](MOL_OPERATIONS.md) Phase 1A
section):
- Requests: ~2.5% of free tier.
- vCPU-seconds: assuming avg 2s per call × 1 vCPU = 100,000 vCPU-s →
  ~28% of free tier.
- Memory-seconds: assuming 512 MiB × 2s × 50,000 = 50,000 GiB-s → ~28% of
  free tier.

**Projected post-Phase-3 volume** (foxy-tutor migrated, student-facing,
~500,000 calls/month):
- Requests: ~25% of free tier.
- vCPU-s + GiB-s: ~280% of free tier → first chargeable month.

**Cost estimates**:
- **First chargeable month** (after foxy-tutor migration completes): ₹500–₹1,500.
- **Steady-state with 1M calls/month**: ₹2,000–₹5,000 depending on average
  call duration and memory.

These figures EXCLUDE the AI provider costs themselves (OpenAI + Anthropic
tokens) — those are already accounted in `mol_request_logs.inr_cost` and
don't change between TS Edge and Python.

**Bump triggers**:
- If `--min-instances=0` causes > 30% cold-start rate → bump to 1
  (~₹500/mo extra at our memory config).
- If p95 latency creeps above 3s consistently → bump instance memory from
  default 512 MiB to 1 GiB (~doubles GiB-s cost).
- If we exceed 10M requests/month → revisit pricing math, possibly move to
  Cloud Run committed-use discount (3-year contract, ~30% saving).

## Migration tracking

Source of truth for "what's where" during the 3-6 week transition. Update
weekly during Phase 1-6. Status key:

- **legacy-only**: still served by TS Edge Function, no Python equivalent
  deployed.
- **proxy-ready (legacy serves all traffic)**: Supabase Edge proxy block
  merged + per-function flag created (default OFF, `rollout_pct=0`), but
  either Cloud Run isn't deployed yet OR `PYTHON_AI_BASE_URL` env var
  isn't wired. Functionally identical to `legacy-only` at runtime; the
  delta is the proxy infrastructure is in place ready to ramp.
- **proxied (canary)**: Python implementation deployed, proxy flag at
  rollout < 100%.
- **proxied (100%)**: Python serves all traffic via the proxy; TS Edge
  Function still in repo as fallback.
- **python-only**: TS Edge Function deleted; proxy passthrough removed.

| Function | Status | Cutover date | Notes |
|---|---|---|---|
| `bulk-question-gen` | proxy-ready (legacy serves all traffic) | TBD | Admin-only. First canary candidate (lowest blast radius). Edge proxy + `ff_python_bulk_question_gen_v1` flag shipped 2026-05-24 (default OFF, `rollout_pct=0`). Awaiting Cloud Run setup + `PYTHON_AI_BASE_URL` env wiring before first 10% ramp. |
| `bulk-non-mcq-gen` | legacy-only | TBD | Admin-only. |
| `generate-concepts` | legacy-only | TBD | Admin x-admin-key. |
| `generate-answers` | legacy-only | TBD | Admin x-admin-key. RAG context baked into system prompt. |
| `extract-ncert-questions` | legacy-only | TBD | Admin x-admin-key. |
| `parent-report-generator` | legacy-only | TBD | Parent JWT, rate-limited 1/day. Has template fallback. |
| `foxy-tutor` | legacy-only | TBD | Student-facing. Phase 1B in original MoL plan. |
| `ncert-solver` | legacy-only | TBD | Student-facing. |
| `quiz-generator` | legacy-only | TBD | Student-facing wrapper around `question_bank` reads. |
| `cme-engine` | legacy-only | TBD | Algorithmic (BKT/IRT) — no LLM call. May skip Python port entirely if no AI logic involved. |
| `scan-ocr` | legacy-only | TBD | Vision (Claude Sonnet). |
| `grade-experiment-conclusion` | legacy-only | TBD | Student-facing (writes coins). |
| `daily-cron` (challenge generator slice) | legacy-only | TBD | Low volume; defer. |
| `nep-compliance` | legacy-only | TBD | No direct LLM call. May not need Python port. |

(This list mirrors the "Caller status" table in
[MOL_ARCHITECTURE.md](MOL_ARCHITECTURE.md) — keep both in sync.)

## See also

- [`docs/MOL_OPERATIONS.md`](MOL_OPERATIONS.md) — alerts and rollout playbook for the shared MoL telemetry layer
- [`docs/MOL_ARCHITECTURE.md`](MOL_ARCHITECTURE.md) — TS MoL framework architecture (live throughout transition)
- `docs/PYTHON_AI_ARCHITECTURE.md` — Python service architecture (architect, in flight)
- [`docs/super-admin-python-ai-dashboard-spec.md`](super-admin-python-ai-dashboard-spec.md) — spec for the `/super-admin/python-ai-health` page (frontend to build)
- [`.claude/regression-catalog.md`](../.claude/regression-catalog.md) — REG-72 health contract for `/live` and `/readyz`
