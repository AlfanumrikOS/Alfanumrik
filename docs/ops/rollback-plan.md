# Alfanumrik Rollback Plan

**Last verified**: 2026-04-02

## Rollback Scenarios

### Scenario 1: Bad Code Deployment (No Migration)

**Detection**: Health check failure in CI, Sentry error spike, user reports.

**Rollback steps**:
1. Open Vercel Dashboard > Deployments
2. Find the last known-good deployment
3. Click the three-dot menu > "Promote to Production"
4. Vercel instantly serves the previous deployment (no rebuild needed)
5. Verify health: `curl https://alfanumrik.vercel.app/api/v1/health`

**Time to rollback**: Under 60 seconds.

**Post-rollback**:
- Identify the breaking commit via Sentry or `git log`
- Create a fix on a feature branch
- Run full CI pipeline before re-deploying
- Add a regression test for the failure mode

### Scenario 2: Bad Database Migration

**Detection**: API errors, health check reports `database: "error"`, query failures in logs.

**Rollback steps**:
1. **Do NOT use `DROP` in a panic.** Data loss is worse than downtime.
2. Write a compensating migration that reverses the change:
   - Added a column: `ALTER TABLE ... DROP COLUMN ...` (only if no data written)
   - Added a table: `DROP TABLE IF EXISTS ...` (only if no data written)
   - Changed an RPC: Restore the previous function definition
   - Added an index: `DROP INDEX IF EXISTS ...`
   - Changed RLS policy: `DROP POLICY ... ; CREATE POLICY ...` with old definition
3. Apply the compensating migration to the affected Supabase project
4. If code depends on the rolled-back migration, also roll back the code deployment (Scenario 1)

**Time to rollback**: 5-30 minutes depending on complexity.

**If data was written to new structures**:
- Do NOT drop the structure
- Deploy code that handles both old and new schema
- Plan a proper data migration at lower urgency

### Scenario 3: Feature Flag Rollback

**Detection**: Feature causing issues for specific users/roles/environments.

**Rollback steps**:
1. Open super admin panel > Feature Flags (`/super-admin/flags`)
2. Toggle the flag to disabled
3. The change takes effect within 5 minutes (flag cache TTL)
4. For immediate effect: restart the Vercel deployment (redeploy same commit)

**Time to rollback**: Under 5 minutes (cache TTL).

**Alternative via API**:
```bash
curl -X PUT https://alfanumrik.vercel.app/api/super-admin/feature-flags \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"flag_name": "problematic_feature", "is_enabled": false}'
```

### Scenario 4: Payment System Issue

**Detection**: Failed webhooks, payment verification errors, subscription status mismatches.

**Rollback steps**:
1. Check Razorpay Dashboard for webhook delivery status
2. If webhook endpoint is broken: roll back code deployment (Scenario 1)
3. If payment records are inconsistent:
   - Use super admin panel to check affected subscriptions
   - Manually reconcile via Razorpay Dashboard + Supabase admin
4. If systematic failure: disable payment flows via feature flag

**Critical rule**: Never grant plan access without a verified payment record. It is safer to temporarily block new subscriptions than to grant unverified access.

### Scenario 5: AI/Edge Function Failure

**Detection**: Foxy tutor errors, quiz generation failures, circuit breaker activation.

**Rollback steps**:
1. Edge Functions are deployed independently from the Next.js app
2. Roll back the Edge Function via Supabase Dashboard:
   - Navigate to Edge Functions
   - Deploy the previous version of the affected function
3. If Claude API is down (external): the circuit breaker in Edge Functions should activate automatically
4. Verify via super admin diagnostics page

**Degraded mode**: AI features should fail gracefully -- students can still take quizzes from the question bank without AI generation.

### Scenario 6: Node Engine Pin Blocks Installs / Builds

**Detection**: `npm ci` or `npm install` fails with `npm error code EBADENGINE` / `Unsupported engine` — locally, in a GitHub Actions job, in the Docker build, or inside a Vercel build. Nothing reaches production; the pipeline stops at install.

**Cause**: Node is pinned to 22.x repo-wide, and the root `.npmrc` sets `engine-strict=true`, which converts npm's advisory engine warning into a hard install failure. Two floors apply:
- ours — `engines.node` = `>=22.0.0 <23.0.0` in the root and every workspace `package.json`;
- transitive — `posthog-node` = `^20.20.0 || >=22.22.0`, so the **effective floor is 22.22.0**. Node 22.0–22.21 fails even though it satisfies our own range.

**Rollback steps** (one line, no code change):
1. Set `engine-strict=false` in the root `.npmrc`.
2. Commit and push. Installs revert to npm's default behaviour: `EBADENGINE` prints as a warning and the install proceeds.
3. Do **not** delete `.npmrc` — it carries the documented floor and the rationale.

**Time to rollback**: One commit; effective on the next CI run.

**Scope and limits**:
- This unblocks *installs* only. It does **not** change the production runtime Node major — that is governed by `engines.node` in `package.json`, which **overrides** the Vercel dashboard "Node.js Version" setting.
- If the failure is Vercel reporting `Found invalid Node.js Version`, `engine-strict=false` will not help. That means Vercel offers no major satisfying `>=22.0.0 <23.0.0`; the fix is to widen the `engines.node` upper bound across all `package.json` files and refresh `package-lock.json` (architect-owned).

**Follow-up**: Treat any use of this switch as an incident. Open a task to restore `engine-strict=true` and record which environment was off-pin and why.

### Scenario 7: Production Runtime Regression After a Node Major Change

**This is a different incident from Scenario 6.** Scenario 6 is "nothing deployed, installs are blocked." Scenario 7 is "something deployed and the *running* Node major changed under it." `engine-strict=false` does **not** help here.

**Detection**: A deploy that changed `engines.node` goes out, and afterwards you see `TypeError: X is not a function`, `ReferenceError: X is not defined`, native-module (`sharp`, etc.) load failures, or a Sentry spike concentrated in server/API routes rather than the browser. Confirm with:

```bash
curl -fsS https://alfanumrik.com/api/v1/health | jq '.environment.node_version, .version.git_sha'
```

`environment.node_version` is `process.version` from the live serverless function — it is the authoritative answer to "what Node is production actually running." Compare it to the previous deployment's value.

**Cause**: `engines.node` in `package.json` selects the Vercel runtime and **overrides** the dashboard "Node.js Version" setting. Narrowing or moving that range moves the production runtime major. A downgrade is as breaking as an upgrade: a newer major's built-in APIs (for example `RegExp.escape`, `Error.isError`, `node:sqlite`) simply do not exist on an older one, and TypeScript will not catch it when `@types/node` is ahead of the pinned runtime.

**Rollback steps**:

1. **Fast path — Vercel Instant Rollback (under 60s).** Follow Scenario 1, targeting a deployment built *before* the `engines.node` change. This restores the previous runtime major, because the Node major is baked into each deployment's built function configuration at build time — you are not merely serving older application code, you are serving functions that were provisioned on the old runtime. Verify with the `node_version` curl above; it must show the old major.
2. **Durable path — revert the pin.** Revert `engines.node` in the root **and every workspace** `package.json`, regenerate `package-lock.json` on the target Node major, then redeploy.

**Reverting `engines.node` in git is NOT sufficient on its own.** The runtime is chosen at build time, so a revert has zero effect until a new deployment is built and promoted. If you need the runtime changed *now*, use the fast path first and land the revert afterwards.

**Time to rollback**: under 60s via Instant Rollback; one build cycle for the durable revert.

**Do not** reach for `engine-strict=false` in this scenario. It changes npm's install behaviour only and leaves the production runtime exactly where it is.

## Incident Response Steps

### Severity Levels

| Level | Definition | Response Time | Examples |
|---|---|---|---|
| SEV-1 | System unusable, all users affected | Immediate | Health check unhealthy, DB down, auth service down |
| SEV-2 | Major feature broken, many users affected | Within 1 hour | Quiz submission failing, payment processing broken |
| SEV-3 | Minor feature broken, workaround exists | Within 24 hours | Leaderboard not updating, export report timing out |
| SEV-4 | Cosmetic or minor UX issue | Next sprint | UI alignment issue, non-critical logging gap |

### SEV-1 Response Procedure

1. **Detect**: Health check failure, Sentry alert, or user report
2. **Acknowledge**: Note the time, affected systems, and symptoms
3. **Diagnose** (max 10 minutes):
   - Check `/api/v1/health` response body for which subsystem is failing
   - Check Sentry for error patterns
   - Check Vercel function logs
   - Check Supabase Dashboard for database/auth status
4. **Mitigate** (max 15 minutes):
   - If code-related: Vercel instant rollback (Scenario 1)
   - If migration-related: Compensating migration (Scenario 2)
   - If external service: Enable degraded mode via feature flags
5. **Communicate**: Update status page (if exists) or notify affected users
6. **Resolve**: Fix the root cause on a branch, full CI, then redeploy
7. **Post-mortem**: Document what happened, why, and what prevents recurrence
   - Add regression test
   - Update this rollback plan if a new scenario was encountered

### Communication Templates

**Internal (during incident)**:
```
INCIDENT: [brief description]
SEVERITY: SEV-[n]
DETECTED: [timestamp]
STATUS: [investigating | mitigating | resolved]
IMPACT: [who/what is affected]
NEXT STEP: [what is being done]
```

**Post-incident**:
```
RESOLVED: [brief description]
DURATION: [start] to [end] ([n] minutes)
ROOT CAUSE: [what broke]
FIX: [what was done]
PREVENTION: [what will prevent recurrence]
```

## Rollback Readiness Checklist

Before every production deployment, verify:

- [ ] Previous deployment is identifiable in Vercel Dashboard
- [ ] Health check endpoint is responding on current production
- [ ] No pending migrations that would be incompatible with a code rollback
- [ ] Feature flags exist for any new features being deployed
- [ ] Sentry is configured and receiving events
- [ ] Super admin panel is accessible for diagnostics

## What Is NOT Automated (Gaps)

| Gap | Current State | Risk |
|---|---|---|
| Automatic rollback on health failure | Health check fails CI but does not auto-rollback | SEV-1 requires manual Vercel rollback |
| Database migration rollback | No automated compensating migrations | Manual SQL required |
| Alerting | No PagerDuty/Betterstack integration | Team must notice failures manually |
| Status page | None | Users have no visibility into incidents |
| Backup verification | `backup_status` table exists but backup automation is not confirmed | Data loss risk if backups are not running |
