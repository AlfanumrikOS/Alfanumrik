# Edge Function cleanup completion, and M5 status — 2026-08-31

Follow-up to [28-m1-m10-and-h1-h4-remediation.md](28-m1-m10-and-h1-h4-remediation.md),
closing out the remaining H3 (orphaned Edge Functions) work and giving M5
(disabled embedding-backfill cron) a final status.

## H3 — Edge Function cleanup (closed)

**39 confirmed-dead functions permanently deleted** from production
(`shktyoxqhundlvkiwguu`) after their 30-day tombstone observation window
elapsed with zero hits. Verified via `supabase functions delete <slug>` per
function (all 39 returned a `Deleted Edge Function.` confirmation) and a
follow-up `list_edge_functions` call confirming none remain.

**11 more orphans found and tombstoned** (not yet deleted — see the
2026-08-31 entry in
[edge-function-drift-report.md](../../runbooks/edge-function-drift-report.md)
for the full list and reasoning). These differ from every prior orphan in
this repo's history: their `entrypoint_path` points at a Supabase CLI/
dashboard hand-deploy temp path, not the CI runner path, meaning they were
never deployed by CI and have zero source history in git. Repo-wide grep
confirmed zero application callers for all 11. Permanent deletion is
deferred to a clean 30-day window from 2026-08-31, consistent with every
prior tombstone in this project.

**3 special cases resolved individually:**
- `grade-written-answer` — real, working code (Claude-Haiku-based
  written-answer grader for SA/LA questions) that existed ONLY in production,
  never committed. Pulled into git via `supabase functions download`; left
  live and untouched. It has no application caller today (grep confirmed),
  so it is dormant but no longer at risk of being lost — this is the first
  time its source exists anywhere outside the live Supabase project.
- `export-report` — already archived to `supabase/functions/_archive/` in PR
  #1363 (superseded by `parent-report-generator`), so its observation window
  was effectively that archive commit. Deleted permanently from production.
- `edge-health-audit` — real, useful (health-check utility), simply unwired
  into any scheduled job or caller. Left as-is; not in scope for this pass.

## M5 — embedding-backfill cron (status: still correctly disabled, not re-enabled)

Re-investigated before touching `cron.job` id 34
(`embedding-backfill-tick`, `*/5 * * * *`, currently `active=false`).

`public.run_embedding_backfill_tick()` (SECURITY DEFINER) dispatches a
`net.http_post` to `embed-questions` using two Vault secrets
(`ADMIN_API_KEY`, `projector_runner_service_role_key_v2`) as auth headers.
Per `docs/audits/2026-08-21-out-of-band-write-incident-logs.md`, this
function and its supporting queue table were created directly against
production out-of-band (no migration in this repo) as part of a documented
security incident, and the job was created but **deliberately left
unscheduled** because `embed-questions` was rejecting the `pg_net` calls
with repeated 401s — an unresolved auth mismatch between the dispatched
headers and what `embed-questions` expects (`x-admin-key` matching
`ADMIN_API_KEY`).

This session verified live, with explicit user confirmation, whether that
401 blocker is still present: both Vault secrets (`ADMIN_API_KEY`,
`projector_runner_service_role_key_v2`) exist, and a single bounded manual
invocation (`SELECT public.run_embedding_backfill_tick()`, not the recurring
schedule) was run to test the real dispatch path. It reported
`dispatched request 12841; remaining before tick: 18765` — but that only
confirms `pg_net` accepted the request, not that `embed-questions` accepted
the call (pg_net dispatch is async). Checking the actual response via
`net._http_response WHERE id = 12841` showed:

```
status_code: 401
body: {"error":"deny_auth","message":"invalid jwt","request_id":"aab4fe2e-..."}
```

**This is the same failure mode the original 2026-08-21 incident logged —
confirmed still broken, not resolved.** `"invalid jwt"` (as opposed to an
`ADMIN_API_KEY` mismatch message) points specifically at
`projector_runner_service_role_key_v2`: the value currently stored in Vault
is stale, rotated, or was never a valid service-role JWT for this project.

**Decision: left disabled.** `cron.job` id 34 remains `active=false`.
Enabling it now would mean the recurring 5-minute schedule fails this exact
401 indefinitely — zero embeddings processed, and depending on how
`embed-questions` bills a rejected-auth request, possibly non-zero wasted
spend on every tick regardless. This requires a human to obtain a current,
valid Supabase service-role key for `projector_runner` and update the Vault
secret (`select vault.update_secret(...)` or the dashboard) before job 34 is
re-enabled — not something resolvable purely from this session.
