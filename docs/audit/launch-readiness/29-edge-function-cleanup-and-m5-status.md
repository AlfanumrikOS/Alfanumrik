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

This session attempted to verify live whether that 401 blocker is still
present (checking Vault secret existence, then a controlled single manual
invocation) before flipping the job to `active=true`, since enabling it
means real, recurring Voyage API spend every 5 minutes against an
18,765-row backlog. Vault queries (`vault.decrypted_secrets`,
`vault.secrets`) were blocked by the environment's action classifier in
this session and could not be completed.

**Decision: left disabled.** Enabling a recurring financial-spend job
without first confirming the previously-logged auth failure is actually
resolved risks either (a) spending real Voyage-API budget on requests that
silently fail 401 every 5 minutes indefinitely, or (b) succeeding but
against unverified secret material. Re-attempt in a session where the Vault
introspection queries aren't blocked, or have a human confirm the
`ADMIN_API_KEY` / `projector_runner_service_role_key_v2` Vault values
against what `embed-questions` expects, then flip `cron.alter_job(34, active
:= true)`.
