# Pre-Deployment Checklist

**Last updated**: 2026-04-02

## Before Every Deploy

### Automated (CI enforces)
- [ ] `npm run type-check` — 0 errors
- [ ] `npm run lint` — 0 errors (warnings OK)
- [ ] `npm test` — all tests pass
- [ ] `npm run build` — succeeds
- [ ] Secret scan — no hardcoded secrets
- [ ] Bundle sizes within P10 budget
- [ ] npm audit — no critical vulnerabilities

### Manual (developer confirms)
- [ ] `node --version` is 22.x and `>= 22.22.0` (`nvm use` reads `.nvmrc`). `engine-strict=true` makes a mismatch a hard `npm install` failure — see `docs/ops/rollback-plan.md` Scenario 6.
- [ ] If `engines.node`, `.nvmrc`, `.npmrc`, `Dockerfile`, or any workflow `node-version` changed: the pin is consistent across **all** of them, and `package-lock.json` was regenerated so its recorded workspace `engines` match `package.json`
      - Verify the lockfile actually picked the change up — `npm install` must be re-run on the pinned Node, or the lock keeps serving the old range:
        ```bash
        node -e "const p=require('./package-lock.json').packages;for(const k of ['','apps/host','packages/lib','packages/ui','eslint-plugin-alfanumrik'])console.log(k||'<root>',JSON.stringify(p[k]?.engines))"
        ```
- [ ] No `.env` files in commit
- [ ] No `console.log` with PII in production code
- [ ] No `supabase-admin` imports in client components
- [ ] If schema changed: migration is additive and rollback-safe
- [ ] If payment code changed: webhook idempotency preserved
- [ ] If scoring code changed: P1/P2 formula unchanged or user-approved
- [ ] If auth code changed: all routes still protected
- [ ] If AI code changed: safety filters intact

## Before Production Deploy (Main Branch)

### Additional Checks
- [ ] Staging deploy verified (if staging exists)
- [ ] Health endpoint responding: `GET /api/v1/health`
- [ ] **If `engines.node` changed — this is a production RUNTIME change, not a config change.** Treat it as a behavioural release and record it in the release evidence:
  - [ ] Capture the CURRENT production runtime *before* merging:
        `curl -fsS https://alfanumrik.com/api/v1/health | jq '.environment.node_version'`
  - [ ] A Vercel **preview** deploy of the branch is green — this is what proves the Vercel build image satisfies the effective floor (22.22.0). Preview failing `EBADENGINE` means the build image's 22.x minor is too old; do not merge.
  - [ ] The preview's runtime is the intended major:
        `curl -fsS <preview-url>/api/v1/health | jq '.environment.node_version'`
  - [ ] Rollback target identified: a known-good deployment built *before* the pin (see `docs/ops/rollback-plan.md` Scenario 7)
- [ ] Feature flags reviewed (no unintended flags enabled)
- [ ] Database migrations applied (if any)
- [ ] RLS policies verified on new tables (if any)
- [ ] Sentry monitoring active
- [ ] Bundle sizes confirmed within budget

### Post-Deploy Verification
- [ ] Health check passes (CI does this automatically)
- [ ] If `engines.node` changed: production runtime is the intended major and above the floor —
      `curl -fsS https://alfanumrik.com/api/v1/health | jq '.environment.node_version'`
      Record before/after values. A surprise here means the Vercel Root Directory resolved a different `package.json` than expected.
- [ ] Landing page loads (`/welcome`)
- [ ] Login flow works
- [ ] Quiz flow completes
- [ ] Payment flow initiates (if changed)
- [ ] Admin panel accessible (if changed)
- [ ] No new Sentry errors in first 15 minutes

## Rollback Procedure

1. Identify the last known good deployment
2. Revert via Vercel dashboard (instant rollback to previous deploy)
3. If database migration was involved:
   - DO NOT rollback migration automatically
   - Assess if rollback migration is needed
   - If needed: create additive rollback migration, test, deploy
4. Verify health endpoint after rollback
5. Monitor Sentry for 30 minutes post-rollback
