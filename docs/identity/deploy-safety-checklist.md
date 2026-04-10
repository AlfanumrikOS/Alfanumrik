# Deploy Safety Checklist (Auth/Identity)

Last updated: 2026-04-02

## Overview

This checklist covers deployment safety for auth and identity-related code. It applies to any deploy that touches: authentication flows, Supabase Auth configuration, the `send-auth-email` Edge Function, auth middleware, onboarding, or RBAC.

## Pre-Deploy Checks

### Code Quality

- [ ] All auth tests pass: `npm test -- auth`
- [ ] TypeScript compiles: `npm run type-check`
- [ ] Production build succeeds: `npm run build`
- [ ] Lint passes: `npm run lint`
- [ ] No secrets in staged files: `git diff --cached --name-only | grep -iE '\.env|secret|credential'`
- [ ] No hardcoded secrets in code: grep for `sk_`, `rzp_live_`, `eyJ`, `service_role` in changed files

### Auth-Specific Checks

- [ ] `/auth/callback` route exists and handles token exchange
- [ ] `/auth/confirm` route exists and handles email confirmation
- [ ] Middleware (`src/middleware.ts`) correctly protects auth-required routes
- [ ] No changes to `supabase-admin.ts` that expose service role to client
- [ ] `authorizeRequest()` used on all new/modified API routes
- [ ] Grade format remains string in all auth/profile flows (P5)

## Environment Variable Checklist

All variables must be set in the target deployment environment.

| Variable | Required | Context | What Breaks if Missing |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Client + Server | All Supabase operations fail. App is non-functional. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client + Server | All Supabase operations fail. App is non-functional. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only | Admin operations fail: user repair, role assignment, onboarding RPC. |
| `SUPER_ADMIN_SECRET` | Yes | Server only | Super admin panel inaccessible. All admin API routes return 401. |
| `SEND_EMAIL_HOOK_SECRET` | Yes | Edge Function | Auth email webhook signature verification fails. No auth emails sent (401 from Edge Function). |
| `MAILGUN_API_KEY` | Yes | Edge Function | Auth emails not delivered. Users cannot confirm signup or reset password. |
| `MAILGUN_DOMAIN` | Yes | Edge Function | Auth emails not delivered. Same impact as missing API key. |

### Verification Command

After deploy, verify critical env vars are set (does not reveal values):

```bash
# Vercel environment (run via Vercel CLI)
vercel env ls | grep -E 'SUPABASE_URL|SUPABASE_ANON_KEY|SERVICE_ROLE_KEY|SUPER_ADMIN_SECRET'

# Supabase Edge Function secrets (check in Supabase dashboard)
# Edge Functions > send-auth-email > Secrets
# Verify: SEND_EMAIL_HOOK_SECRET, MAILGUN_API_KEY, MAILGUN_DOMAIN
```

## Preview vs Production Differences

| Aspect | Preview Deploy | Production |
|---|---|---|
| URL | `alfanumrik-git-*.vercel.app` | `alfanumrik.com` |
| Supabase project | Same as production (shared) | Same |
| Email links (SITE_URL) | Point to `alfanumrik.com` (R13) | Correct |
| Auth users | Shared with production | Same database |
| Env vars | Inherited from Vercel project settings | Same |
| Edge Functions | Same deployment (Supabase-side) | Same |

### Critical Implications

1. **Preview deploys share the same Supabase project.** Any auth action on a preview deploy affects production users. Do not create test users on preview deploys unless using clearly marked test accounts.

2. **Email links always point to production (R13).** When testing auth flows on preview deploys, clicking email links will redirect to `alfanumrik.com`, not the preview URL. This is a known limitation.

3. **Edge Functions are not per-branch.** The `send-auth-email` Edge Function runs the same version regardless of which Vercel deployment triggered the auth action. Edge Function changes require a separate `supabase functions deploy`.

## Callback URL Correctness

| Component | URL Construction | Correct for All Deploys? |
|---|---|---|
| `signUp()` emailRedirectTo | Uses `window.location.origin` | Yes -- adapts to current domain |
| `resetPasswordForEmail()` redirectTo | Uses `window.location.origin` | Yes -- adapts to current domain |
| `send-auth-email` Edge Function | Hardcoded `https://alfanumrik.com` | No -- only correct for production (R13) |
| Supabase Auth redirect allowlist | Must include all valid callback domains | Must be maintained manually |

### Supabase Auth Redirect Allowlist

In the Supabase dashboard under Authentication > URL Configuration, the following must be listed:

- `https://alfanumrik.com/**` (production)
- `https://alfanumrik-git-*.vercel.app/**` (preview deploys, if testing auth)
- `http://localhost:3000/**` (local development)

If a redirect URL is not in the allowlist, Supabase Auth will reject the callback and the user will see an error.

## Rollback Procedures

### Auth Flow Broken (Next.js code)

1. Open Vercel dashboard.
2. Navigate to Deployments.
3. Find the last known-good deployment.
4. Click "Promote to Production" (instant, zero-downtime).
5. Verify by hitting `GET /api/v1/health` and `GET /api/auth/onboarding-status` (with a test session).

### Migration Broke Auth Tables

1. Do NOT run `DROP` or destructive operations in panic.
2. Write a compensating migration that restores the previous state.
3. Test the compensating migration on a local Supabase instance first.
4. Apply via `supabase db push` or through the migration pipeline.
5. If data was corrupted, use `admin_repair_user_onboarding()` RPC for affected users.

### Edge Function Broke Email Delivery

1. Identify the last working commit for `supabase/functions/send-auth-email/`.
2. Check out that commit: `git checkout <commit> -- supabase/functions/send-auth-email/`
3. Redeploy: `supabase functions deploy send-auth-email`
4. Verify by triggering a password reset for a test account and checking Mailgun dashboard.

### Supabase Auth Hook Misconfigured

1. Open Supabase dashboard > Authentication > Hooks.
2. Verify the Send Email hook is enabled and pointing to the correct Edge Function.
3. Verify the hook secret matches `SEND_EMAIL_HOOK_SECRET` in the Edge Function secrets.
4. If the hook was accidentally disabled, re-enable it. Emails will resume immediately.

## CI/CD Auth Gates

### Current State

- Auth tests (117 tests) run as part of `npm test` in the `ci.yml` workflow.
- There is no separate CI job that gates deployment specifically on auth test results.
- There is no post-deploy auth smoke test.

### Recommended Improvements

1. **Separate auth test job in CI**: Add a dedicated job in `ci.yml` that runs `npm test -- auth` and must pass before the deploy job can proceed. This isolates auth failures and makes them immediately visible.

2. **Post-deploy smoke test**: After each production deploy, automatically hit:
   - `GET /api/v1/health` -- verify system is up
   - `GET /api/auth/onboarding-status` -- verify auth middleware and Supabase connectivity
   - If either fails, alert the team and consider automatic rollback.

3. **Edge Function deploy gate**: Before deploying `send-auth-email`, verify:
   - The function compiles without errors
   - `SEND_EMAIL_HOOK_SECRET` is set in Supabase secrets
   - A test webhook payload is accepted (integration test)

### Recommended CI Job (for `ci.yml`)

```yaml
auth-tests:
  name: Auth Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - run: npm test -- auth
      env:
        NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}

deploy-production:
  needs: [lint, type-check, tests, auth-tests, build]
  # ... existing deploy config
```
