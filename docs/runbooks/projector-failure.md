# Runbook — projector failure

**Triggered by:**
- PostHog alert on `projector_health_degraded` event (severity = `warn` or `critical`)
- Manual query of `public.subscriber_lag` showing `events_behind > 0` AND `age_behind > 30 s`
- A user-facing symptom that traces to stale projection state (e.g., student answers a question but `concept_mastery.mastery_mean` doesn't update)
- Cron job `projector-runner-tick` or `projector-health-check-tick` not firing

**Severity:**
- `warn` (5–29 s lag) — investigate within 30 minutes; rarely user-visible
- `critical` (≥ 30 s lag) — page architect; user-visible drift becomes likely above ~60 s
- Dead-letter accumulation — always at least `warn`; see [`dead-letter-inspection.md`](./dead-letter-inspection.md)

**Owner:** assessment (handler bugs) + ops (infrastructure)

## 1. Confirm scope

Open Supabase SQL editor against production. Run:

```sql
SELECT
  subscriber_name,
  kind_filter,
  events_behind,
  events_in_retry,
  events_dead_lettered,
  last_processed_occurred_at,
  age_behind,
  EXTRACT(EPOCH FROM age_behind)::int AS age_behind_seconds
FROM public.subscriber_lag
ORDER BY age_behind DESC;
```

A subscriber with `events_behind = 0` is healthy even if `age_behind` is large — `age_behind` measures wall-clock since last advance, not lag. The PostHog event's `severity` field is the canonical signal; this query confirms.

## 2. Check the kill-switch

```sql
SELECT flag_name, is_enabled, rollout_percentage, target_environments
FROM public.feature_flags
WHERE flag_name IN ('ff_projector_runner_v1', 'ff_event_bus_v1');
```

If `ff_projector_runner_v1` is `is_enabled = false`, the runner is intentionally off and the health check should be returning `{ skipped: true, reason: 'runner_flag_off' }`. The lag in this state is expected; there is nothing to fix. Confirm whether the flag was flipped deliberately (check `audit_logs` for `feature_flag.toggled`) before re-enabling.

## 3. Check the cron is firing

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('projector-runner-tick', 'projector-health-check-tick');

SELECT job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobname = 'projector-runner-tick'
ORDER BY start_time DESC
LIMIT 10;
```

Expected: rows every minute for `projector-runner-tick`, every 2 minutes for `projector-health-check-tick`, all with `status = 'succeeded'`. If `status = 'failed'`, read `return_message` — most common: HTTP 401 (auth header malformed), HTTP 500 from the function (env missing / DB error), or `network: TCP connection refused` (Edge Function not deployed).

## 4. Check Vault secrets

```sql
SELECT name, created_at, updated_at
FROM vault.decrypted_secrets
WHERE name IN (
  'projector_runner_url',
  'projector_runner_service_role_key',
  'projector_health_check_url'
);
```

All three must exist. If any is missing, the cron's `net.http_post` resolves to NULL URL or empty Authorization header and the function never receives the request. Recreate via:

```sql
SELECT vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/projector-health-check',
  'projector_health_check_url',
  'URL of the projector-health-check Edge Function'
);
```

See [`vault-secret-rotation.md`](./vault-secret-rotation.md) (Iteration 3) for the full rotation procedure including JWT-secret rotation.

## 5. Check Edge Function deployment

Supabase dashboard → Edge Functions → projector-runner / projector-health-check. Confirm:
- Latest version's git SHA matches the latest deploy from `.github/workflows/deploy-changed-edge-functions.yml`
- Function logs (last 15 min) show no `[projector-runner] fatal:` or `[projector-health-check] fatal:` lines
- Logs show recent invocations with `200` status

If the function isn't deployed, force redeploy by touching `index.ts` in a follow-up PR (matches the pattern from [PR #754](https://github.com/AlfanumrikOS/Alfanumrik/pull/754)). The CI's `Deploy Changed Edge Functions` job only deploys functions whose code changed in the commit.

## 6. Check retry state for stuck events

```sql
SELECT
  event_id,
  subscriber_name,
  attempt_count,
  last_error,
  first_attempted_at,
  last_attempted_at,
  EXTRACT(EPOCH FROM (NOW() - last_attempted_at))::int AS seconds_since_last_attempt
FROM public.subscriber_retry_state
WHERE subscriber_name = '<the lagging subscriber from step 1>'
ORDER BY first_attempted_at ASC;
```

If rows accumulate with the same `last_error`, it's a handler bug — the subscriber will keep retrying until either the bug is fixed or the event lands in `subscriber_dead_letters` (after `maxRetries`). Identify the bug from the error message; fix in a follow-up PR; the retry loop drains automatically once the new code deploys.

If `attempt_count` is at the max and the event is about to land in dead letters, that's the expected escalation — proceed to step 7 then to [`dead-letter-inspection.md`](./dead-letter-inspection.md).

## 7. Check dead letters

```sql
SELECT event_id, subscriber_name, attempt_count, last_error, last_attempted_at
FROM public.subscriber_dead_letters
WHERE resolved_at IS NULL
ORDER BY last_attempted_at DESC;
```

Any unresolved dead letter requires per-event triage. Follow [`dead-letter-inspection.md`](./dead-letter-inspection.md). Do not auto-replay without inspecting the payload — the event may have been the originating bug, not the symptom.

## 8. Decide: continue, flip-off, or replay

**Continue (default):** if the handler bug is identified and a fix is in a PR, let the retry loop drain after the fix deploys. No operator action beyond merging the PR.

**Flip off (cascade risk):** if the subscriber is corrupting state (e.g., writing wrong values), flip `ff_projector_runner_v1` OFF immediately to stop further damage:

```sql
UPDATE public.feature_flags
SET is_enabled = false, updated_at = NOW()
WHERE flag_name = 'ff_projector_runner_v1';
```

This stops every subscriber, not just the broken one. Acceptable for short emergency windows. The 30-second `feature_flags` cache in `src/lib/feature-flags.ts` means the flip propagates within one cron tick. Document the action in `audit_logs` via the `/api/super-admin/flags` endpoint rather than direct SQL when there is time — the SQL above is the break-glass.

**Replay (after fix):** once the handler is fixed and deployed, replay-by-student is the surgical recovery tool. See `docs/runbooks/replay-by-student.md` (Iteration 3 — until then, escalate to architect for manual replay via `/api/super-admin/projectors/replay`).

## 9. Verification

After remediation:

```sql
SELECT subscriber_name, events_behind, events_in_retry, age_behind
FROM public.subscriber_lag
WHERE subscriber_name = '<the formerly-lagging subscriber>';
```

Expected within one health-check cycle (2 min):
- `events_behind = 0`
- `events_in_retry = 0`
- `age_behind` continues growing (this is wall-clock since last event; not a problem)

Look for `projector_health_degraded` PostHog events to stop arriving for that subscriber.

## Common causes (in order of historical frequency)

1. **Vault secret missing or rotated without coordination.** Symptom: cron `status = failed`, `return_message` mentions `null` URL or empty Authorization. Fix: recreate the secret per step 4.
2. **Edge Function deploy missed in CI** (e.g., esm.sh 522 during cold cache rebuild). Symptom: function returns 404 or stale code. Fix: force redeploy via touch + PR (PR #754 pattern).
3. **Handler bug introduced in recent deploy.** Symptom: `subscriber_retry_state` accumulating with identical `last_error`. Fix: revert or follow-up PR.
4. **Downstream DB pressure** (concept_mastery UPSERT slow during peak). Symptom: lag oscillates between healthy and degraded; no single error in retry state. Fix: usually self-corrects when load drops; investigate locks via `pg_stat_activity` if sustained.
5. **pg_cron extension missing** (staging-class environments). Symptom: cron migration's NOTICE in deploy logs; no `cron.job` row. Fix: enable extension via Supabase dashboard.

## Escalation

- 15 min unresolved at `critical` severity → page architect.
- 1 h unresolved at `critical` severity → coordinate flag-off + post-mortem to `docs/postmortems/`.
- Data corruption suspected (handler wrote wrong values to canonical state) → immediate flag-off, escalate to architect + assessment, file P0 incident.

## Related runbooks

- [`dead-letter-inspection.md`](./dead-letter-inspection.md) — per-event triage
- `replay-by-student.md` (Iteration 3) — surgical recovery
- `vault-secret-rotation.md` (Iteration 3) — secret lifecycle
- [`ai-outage-response.md`](./ai-outage-response.md) — when projector failure is downstream of AI being unable to publish
- [`database-outage-response.md`](./database-outage-response.md) — when the underlying Postgres is the problem
