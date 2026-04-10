# Identity & Onboarding System: Failure Map

Phase 0 discovery document. Catalogs every known failure mode in the identity and onboarding system as of 2026-04-02.

---

## F1: Orphan Auth User

**Description**: A row exists in `auth.users` but no corresponding profile row exists in `students`, `teachers`, or `guardians`.

**Impact**: User can authenticate (has valid session) but sees empty dashboard, broken profile UI, and cannot use any features that require a profile FK.

**Root Cause**: Bootstrap failed at all three trigger points:
1. Signup handler in AuthScreen.tsx threw before calling `/api/auth/bootstrap`
2. Callback/confirm route's profile check failed silently
3. AuthContext fallback bootstrap also failed (e.g., network error, API timeout)

**Current Mitigation**: Three-layer defense-in-depth bootstrap. Admin repair API (`/api/auth/repair`) can manually create missing profiles. Auth audit log records bootstrap attempts for forensic analysis.

**Residual Risk**: LOW. Three independent trigger points make total failure unlikely, but not impossible. A Supabase outage during signup could defeat all three layers since they all call the same RPC.

---

## F2: Stuck Onboarding

**Description**: `onboarding_state.step` is set to a non-terminal value (e.g., `'profile'`, `'preferences'`, or `'failed'`) and the user cannot advance.

**Impact**: User is perpetually redirected to onboarding flow or sees an incomplete setup screen. Cannot reach the main application.

**Root Cause**: 
- Bootstrap created the `onboarding_state` row but the subsequent UI steps (profile completion, preference selection) failed without updating the step.
- No server-side onboarding step advancement -- steps are updated from the client, which can fail silently.
- No timeout or auto-recovery mechanism for stuck states.

**Current Mitigation**: Admin repair API can reset onboarding state. Auth audit log helps diagnose where the flow stalled.

**Residual Risk**: LOW-MEDIUM. Users who close the browser mid-onboarding will be stuck until they retry or admin intervenes. No automated detection of stuck users.

---

## F3: Session Mismatch

**Description**: The cookie-based session (used by middleware and server components) and the localStorage session (used by browser client) diverge in validity or user identity.

**Impact**: 
- Middleware sees valid session, client sees expired -- page loads but API calls from client fail with 401.
- Client sees valid session, middleware sees expired -- middleware redirects to login even though client thinks user is logged in.
- In the worst case, middleware session refreshes to a new token but localStorage still holds the old one, causing intermittent auth failures.

**Root Cause**: Dual session store architecture. Middleware refreshes cookie session on every request. Client session only updates when `onAuthStateChange` fires, which is asynchronous and not triggered by cookie updates.

**Current Mitigation**: Middleware session refresh keeps the cookie side fresh. `onAuthStateChange` eventually converges the client side. `useRequireAuth` hook redirects to login on client-side auth failure.

**Residual Risk**: MEDIUM. The mismatch window is real and observable. Users on slow connections or with stale tabs experience intermittent 401 errors that self-resolve on page refresh. No mechanism to force convergence.

---

## F4: Email Delivery Failure

**Description**: Confirmation email, password reset email, or welcome email fails to deliver.

**Impact**:
- Confirmation email failure: User cannot verify email, cannot complete signup.
- Password reset failure: User locked out, no recovery path except contacting support.
- Welcome email failure: Minor -- no functional impact, poor first impression.

**Root Cause**:
- Mailgun service outage or rate limiting.
- Mailgun API key misconfiguration in Edge Function environment.
- Email lands in spam (especially for new domains or Indian ISP email providers).
- `send-auth-email` Edge Function crashes or times out.

**Current Mitigation**: Supabase Auth has built-in email as a fallback if the custom auth hook fails (though this is not explicitly configured as a fallback). Users can request resend from the login page.

**Residual Risk**: MEDIUM. No delivery tracking webhook from Mailgun (R12). No alerting on email delivery failures. No way to know if a user is stuck because their confirmation email never arrived.

---

## F5: Bootstrap Race Condition

**Description**: Multiple concurrent calls to `bootstrap_user_profile()` RPC for the same user.

**Impact**: Potential for duplicate profile creation attempts. Could cause unique constraint violations that surface as user-visible errors.

**Root Cause**: Three trigger points (signup handler, callback route, AuthContext fallback) can fire in rapid succession. If Trigger 1 is slow, Trigger 2 or 3 may fire before Trigger 1 completes.

**Current Mitigation**: `ON CONFLICT DO NOTHING` in the RPC makes all bootstrap calls idempotent. The second and third calls simply no-op if the first succeeded.

**Residual Risk**: LOW. The idempotent design handles this correctly. The only concern is wasted database round-trips and potential for confusing audit log entries showing multiple bootstrap attempts.

---

## F6: Demo Account Data Inconsistency

**Description**: Demo accounts do not always have corresponding `onboarding_state` rows, and their profile data may not match the `demo_seed_data` snapshots.

**Impact**: Demo accounts may behave differently from real accounts in the onboarding flow. Admin tools that query `onboarding_state` may return incomplete results for demo users.

**Root Cause**: Demo accounts are created through a different code path (seed scripts or admin API) that does not always call the full bootstrap pipeline. The `demo_accounts` and `demo_seed_data` tables are managed separately from the normal identity flow.

**Current Mitigation**: Demo accounts are a small, known set. Manual repair when issues are noticed.

**Residual Risk**: LOW. Affects only demo accounts, not real users. But creates a false sense of test coverage -- if tests run against demo accounts, they may miss onboarding bugs that affect real users.

---

## F7: Preview Deploy Callback URL Mismatch

**Description**: Auth callback URLs (confirmation links, password reset links) point to the production domain instead of the Vercel preview deployment URL.

**Impact**: Users testing on preview deployments click email links and are redirected to production instead of the preview environment. Breaks the preview testing workflow entirely for any flow that involves email verification.

**Root Cause**: `SITE_URL` is hardcoded in the `send-auth-email` Edge Function (R13). Supabase Auth's redirect URL configuration is global, not per-deployment.

**Current Mitigation**: None. Preview deployments cannot test email-dependent flows.

**Residual Risk**: MEDIUM for development workflow. No production impact, but slows down testing of auth changes. Developers must test email flows directly on staging or production.

---

## F8: Missing Onboarding State for Legacy Users

**Description**: Users who signed up before the `onboarding_state` table was introduced do not have rows in that table.

**Impact**: 
- `GET /api/auth/onboarding-status` returns "not onboarded" for fully active legacy users.
- If any code path redirects non-onboarded users to the onboarding flow, legacy users get trapped.
- Admin reporting on onboarding completion rates is inaccurate.

**Root Cause**: The `onboarding_state` table was added after initial launch. No backfill migration was run for existing users.

**Current Mitigation**: AuthContext's `fetchUser()` checks for profile existence as the primary indicator, not just `onboarding_state`. The `onboarding-status` API treats "has profile but no onboarding_state" as "onboarded" (implicit completion).

**Residual Risk**: LOW. The fallback logic works, but it is an implicit assumption rather than an explicit guarantee. Any new code that relies solely on `onboarding_state` will break for legacy users.

---

## F9: Role Detection Fallback Chain Failure

**Description**: The system cannot determine a user's role, causing incorrect routing or permission denial.

**Impact**: User lands on the wrong dashboard, sees "access denied" on pages they should access, or gets stuck in a redirect loop between login and dashboard.

**Root Cause**: Role detection relies on a chain:
1. `user_roles` table (primary source)
2. Profile table existence check (if `user_roles` is empty, check which profile table has a row)
3. `auth.users.raw_user_meta_data.role` (signup-time metadata, last resort)

If all three are inconsistent or missing, the system cannot determine the role. This can happen if:
- `sync_user_roles_for_user()` trigger failed silently
- Profile was created in wrong table (e.g., student signed up as teacher)
- `raw_user_meta_data` was not set during signup

**Current Mitigation**: `sync_user_roles_for_user()` runs as a trigger on profile table inserts/updates. Admin repair API can force role re-sync. AuthContext logs role detection failures to auth_audit_log.

**Residual Risk**: LOW. The three-level fallback is robust. But role detection code is duplicated across multiple files (login page, callback route, bootstrap API, AuthContext), so a fix in one place may not propagate to others.

---

## F10: Password Reset Link Expired with No Clear UX

**Description**: User clicks a password reset link after the token has expired (default: 1 hour). The link fails silently or shows a generic error.

**Impact**: User cannot reset their password. May not understand why the link "doesn't work" and may assume the system is broken. No clear path to request a new link from the error state.

**Root Cause**: 
- Password reset tokens are time-limited by Supabase Auth.
- The `/auth/confirm` route handles the token verification but may not distinguish between "invalid token" and "expired token" in the error message.
- The `/auth/reset` page receives the token via URL hash (for `detectSessionInUrl`), and if the token is expired, the session detection fails silently.

**Current Mitigation**: Users can navigate back to the login page and request a new reset link. The forgot-password flow is accessible from AuthScreen.

**Residual Risk**: LOW for security, MEDIUM for user experience. Users (especially younger students or parents less familiar with the flow) may abandon the reset attempt rather than try again.

---

## Failure Severity Summary

| ID | Failure | Severity | Likelihood | Automated Detection |
|----|---------|----------|------------|---------------------|
| F1 | Orphan auth user | HIGH | LOW | Partial (audit log) |
| F2 | Stuck onboarding | MEDIUM | LOW-MEDIUM | None |
| F3 | Session mismatch | MEDIUM | MEDIUM | None |
| F4 | Email delivery failure | MEDIUM | MEDIUM | None (R12 open) |
| F5 | Bootstrap race condition | LOW | MEDIUM | None needed (handled) |
| F6 | Demo account inconsistency | LOW | HIGH (known) | None |
| F7 | Preview deploy callback URL | MEDIUM (dev) | HIGH (every preview) | None |
| F8 | Missing onboarding state (legacy) | LOW | LOW (diminishing) | None |
| F9 | Role detection chain failure | HIGH | LOW | Partial (audit log) |
| F10 | Password reset link expired | LOW-MEDIUM | MEDIUM | None |

---

## Cross-Cutting Observations

### No Automated Detection for Most Failures

Only F1 and F9 have partial detection via auth_audit_log. There is no:
- Cron job scanning for orphan auth users
- Alert on onboarding states stuck for > N hours
- Monitoring of session mismatch rates
- Mailgun delivery tracking webhook (R12)
- Dashboard showing legacy users without onboarding_state

### Repair Is Manual, Not Self-Healing

The admin repair API exists but requires a human to notice the problem, identify the affected user, and invoke the repair. There is no self-healing loop where the system detects and fixes its own identity inconsistencies.

### Duplication Amplifies Risk

Role detection, profile existence checks, and redirect logic are duplicated across 4+ files. A bug fix or behavior change in one location may not propagate, creating inconsistent failure handling across different entry points.
