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
- [ ] Feature flags reviewed (no unintended flags enabled)
- [ ] Database migrations applied (if any)
- [ ] RLS policies verified on new tables (if any)
- [ ] Sentry monitoring active
- [ ] Bundle sizes confirmed within budget

### Post-Deploy Verification
- [ ] Health check passes (CI does this automatically)
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
