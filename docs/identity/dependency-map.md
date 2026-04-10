# Identity & Onboarding System: Dependency Map

Phase 0 discovery document. Maps the dependency graph between all identity components, external services, and critical paths as of 2026-04-02.

---

## Internal Dependency Graph

### Supabase Clients (Foundation Layer)

```
src/lib/env.ts
  ^
  | (validates env vars at import time)
  |
  +-- src/lib/supabase.ts (browser client)
  |     ^
  |     +-- src/lib/AuthContext.tsx
  |     +-- src/components/auth/AuthScreen.tsx
  |     +-- src/lib/useRequireAuth.ts
  |     +-- (all client components that fetch data)
  |
  +-- src/lib/supabase-server.ts (server client)
  |     ^
  |     +-- src/middleware.ts
  |     +-- src/app/auth/callback/route.ts
  |     +-- src/app/auth/confirm/route.ts
  |     +-- src/app/api/auth/onboarding-status/route.ts
  |     +-- (all API routes, server components)
  |
  +-- src/lib/supabase-admin.ts (admin client, service role)
        ^
        +-- src/app/api/auth/bootstrap/route.ts
        +-- src/app/api/auth/repair/route.ts
        +-- (admin API routes, super-admin routes)
```

**Risk**: `env.ts` is a single point of failure. If environment variables are missing or misconfigured, all three clients fail at import time. Mitigated by build-time validation.

### Auth Flow Dependencies

```
src/components/auth/AuthScreen.tsx
  |
  +-- depends on --> src/lib/supabase.ts (signIn, signUp, resetPassword)
  +-- depends on --> src/app/api/auth/bootstrap/route.ts (POST after signup)
  +-- depends on --> supabase/functions/send-welcome-email/ (invoke after signup)
  +-- depends on --> src/lib/AuthContext.tsx (consumes auth state)
  |
  v
src/lib/AuthContext.tsx
  |
  +-- depends on --> src/lib/supabase.ts (onAuthStateChange, session)
  +-- depends on --> src/app/api/auth/onboarding-status/route.ts (GET)
  +-- depends on --> src/app/api/auth/bootstrap/route.ts (POST, fallback)
  +-- depends on --> src/lib/rbac.ts (permission loading)
  +-- provides  --> { user, profile, role, permissions, isOnboarded, isHi }
  |
  v
src/lib/useRequireAuth.ts
  |
  +-- depends on --> src/lib/AuthContext.tsx (consumes auth state)
  +-- depends on --> next/navigation (redirect on unauthenticated)
```

### Bootstrap Pipeline Dependencies

```
src/app/api/auth/bootstrap/route.ts
  |
  +-- depends on --> src/lib/supabase-admin.ts (service role client)
  +-- depends on --> bootstrap_user_profile() RPC (Postgres)
  |                    |
  |                    +-- depends on --> students/teachers/guardians tables
  |                    +-- depends on --> onboarding_state table
  |                    +-- depends on --> user_roles table (via trigger)
  |                    +-- depends on --> sync_user_roles_for_user() (trigger function)
  |
  +-- depends on --> src/lib/admin-auth.ts (optional, for repair endpoint)
```

### Middleware Dependencies

```
src/middleware.ts
  |
  +-- depends on --> src/lib/supabase-server.ts (session refresh)
  +-- depends on --> @supabase/ssr (cookie handling)
  +-- depends on --> Upstash Redis (rate limiting)
  |                    +-- fallback --> in-memory rate limit store
  +-- depends on --> next/server (NextResponse, request handling)
  |
  +-- does NOT depend on --> AuthContext (server-side only)
  +-- does NOT depend on --> rbac.ts (middleware does route-level, not permission-level checks)
```

### Email Dependencies

```
supabase/functions/send-auth-email/
  |
  +-- depends on --> Mailgun API (external)
  +-- depends on --> SITE_URL (hardcoded, R13)
  +-- depends on --> Supabase Auth hook system (triggered by auth events)
  +-- triggered by --> supabase.auth.signUp(), resetPasswordForEmail()

supabase/functions/send-welcome-email/
  |
  +-- depends on --> Mailgun API (external)
  +-- depends on --> Supabase client (to read user profile for personalization)
  +-- triggered by --> AuthScreen.tsx (explicit invoke after signup)
```

### Repair Pipeline Dependencies

```
src/app/api/auth/repair/route.ts
  |
  +-- depends on --> src/lib/supabase-admin.ts (service role)
  +-- depends on --> src/lib/admin-auth.ts (RBAC: requires admin permission)
  +-- depends on --> admin_repair_user_onboarding() RPC (Postgres)
  |                    |
  |                    +-- depends on --> bootstrap_user_profile() (reuses)
  |                    +-- depends on --> sync_user_roles_for_user()
  |                    +-- depends on --> onboarding_state table
  +-- depends on --> src/lib/rbac.ts (authorizeRequest)
```

---

## External Service Dependencies

| Service | Used By | Failure Impact | Fallback |
|---------|---------|----------------|----------|
| **Supabase Auth** | All auth operations | Total auth outage: no login, signup, or session refresh | None. Complete dependency. |
| **Supabase Postgres** | Bootstrap RPC, profile storage, RLS | No profile creation, no data access | None. Complete dependency. |
| **Supabase Edge Functions** | send-auth-email, send-welcome-email | Email delivery fails | Supabase built-in email (not explicitly configured as fallback) |
| **Mailgun** | Email sending (confirmation, reset, welcome) | Users cannot verify email or reset password | Supabase built-in email (partial) |
| **Upstash Redis** | Rate limiting in middleware | Rate limiting ineffective | In-memory rate limit store (per-instance, not shared) |
| **Vercel** | Hosting, middleware execution, API routes | Total application outage | None. Complete dependency. |

### Supabase Auth Dependency Detail

```
Supabase Auth (external)
  |
  +-- signUp()        --> used by AuthScreen.tsx
  +-- signInWithPassword() --> used by AuthScreen.tsx
  +-- signOut()       --> used by AuthContext.tsx
  +-- resetPasswordForEmail() --> used by AuthScreen.tsx
  +-- exchangeCodeForSession() --> used by callback/route.ts
  +-- verifyOtp()     --> used by confirm/route.ts
  +-- getSession()    --> used by middleware.ts, AuthContext.tsx
  +-- onAuthStateChange() --> used by AuthContext.tsx
  +-- auth.admin.*    --> used by supabase-admin.ts (repair, user lookup)
```

If Supabase Auth is down, every auth operation fails. There is no local session cache that would allow even read-only access during an outage.

---

## Critical Paths

### Critical Path 1: New User Signup to First Dashboard Load

```
AuthScreen.tsx
  --> Supabase Auth (signUp)
    --> send-auth-email Edge Function
      --> Mailgun (confirmation email)
        --> User clicks link
          --> /auth/confirm (verifyOtp)
            --> bootstrap_user_profile() RPC
              --> Postgres (profile + onboarding_state + user_roles)
                --> AuthContext fetchUser()
                  --> /api/auth/onboarding-status
                    --> Redirect to dashboard
```

**Chain length**: 10 steps across 5 services (browser, Vercel, Supabase Auth, Supabase Postgres, Mailgun).

**Single points of failure**: Supabase Auth, Supabase Postgres, Mailgun (for email confirmation). Any one failure blocks the entire signup flow.

**Weakest link**: Mailgun. Email delivery is the only step that depends on a third-party service outside the Supabase/Vercel ecosystem, and it has no delivery tracking (R12).

### Critical Path 2: Returning User Login

```
AuthScreen.tsx
  --> Supabase Auth (signInWithPassword)
    --> onAuthStateChange fires
      --> AuthContext fetchUser()
        --> Postgres (profile query)
          --> Postgres (user_roles query)
            --> rbac.ts (permission resolution)
              --> Redirect to dashboard
```

**Chain length**: 7 steps across 3 services (browser, Supabase Auth, Supabase Postgres).

**Resilience**: Higher than signup. No email dependency. But still fully dependent on Supabase Auth and Postgres.

### Critical Path 3: Password Reset

```
AuthScreen.tsx
  --> Supabase Auth (resetPasswordForEmail)
    --> send-auth-email Edge Function
      --> Mailgun (reset email)
        --> User clicks link (URL hash contains token)
          --> /auth/reset page
            --> Supabase Auth (detectSessionInUrl reads hash)
              --> updateUser({ password })
                --> onAuthStateChange fires
                  --> AuthContext fetchUser()
                    --> Redirect to dashboard
```

**Chain length**: 10 steps. Same Mailgun weakness as signup.

**Additional risk**: Token expiry (F10). URL hash is client-side only, so if `detectSessionInUrl` fails, the token is lost with no server-side fallback.

### Critical Path 4: Middleware Session Refresh

```
Incoming request
  --> middleware.ts
    --> supabase-server.ts (getSession from cookie)
      --> Supabase Auth (refresh if near expiry)
        --> Set updated cookie in response
          --> Continue to page/API route
```

**Chain length**: 5 steps. Runs on EVERY authenticated request.

**Risk**: If Supabase Auth refresh fails, the middleware may pass a stale session to the route handler. The route handler may then get a 401 from Postgres when using the expired token.

---

## Dependency Chains: What Breaks What

### If Supabase Auth Goes Down

| Component | Impact |
|-----------|--------|
| AuthScreen.tsx | Cannot sign in, sign up, or reset password |
| middleware.ts | Cannot refresh sessions; existing sessions expire |
| AuthContext.tsx | onAuthStateChange stops firing; state goes stale |
| callback/confirm routes | Cannot exchange codes or verify tokens |
| All API routes | Session validation fails; 401 on all requests |
| **Result** | Total application outage for authenticated features |

### If Supabase Postgres Goes Down

| Component | Impact |
|-----------|--------|
| bootstrap_user_profile() | Cannot create profiles |
| AuthContext fetchUser() | Cannot load profile or permissions |
| All data queries | No data accessible |
| **Result** | Auth works (sessions valid) but app is non-functional |

### If Mailgun Goes Down

| Component | Impact |
|-----------|--------|
| send-auth-email | Confirmation and reset emails not sent |
| send-welcome-email | Welcome emails not sent |
| **Result** | New signups cannot verify email. Password resets blocked. Existing users unaffected. |

### If Upstash Redis Goes Down

| Component | Impact |
|-----------|--------|
| middleware.ts rate limiting | Falls back to in-memory store |
| **Result** | Rate limiting becomes per-instance instead of global. Reduced protection but no outage. |

### If Vercel Goes Down

| Component | Impact |
|-----------|--------|
| Everything | Total outage |
| **Result** | No mitigation possible. |

---

## Fragile Dependency Chains

### Chain 1: AuthContext fetchUser() Mega-Function

`AuthContext.tsx:fetchUser()` (220+ lines) has dependencies on:

```
fetchUser()
  +-- supabase.ts (getSession)
  +-- /api/auth/onboarding-status (fetch)
  +-- /api/auth/bootstrap (fetch, conditional)
  +-- students/teachers/guardians tables (query)
  +-- user_roles table (query)
  +-- rbac.ts (resolvePermissions)
  +-- Error handling: nested try-catch with fallback chains
```

This function is a convergence point for 6+ dependencies. A failure in any dependency triggers a fallback chain that is difficult to reason about. The nested try-catch blocks mean errors can be swallowed, making debugging hard.

### Chain 2: AuthScreen.tsx Signup Handler

`AuthScreen.tsx` signup flow orchestrates:

```
signup handler
  +-- supabase.auth.signUp() (must succeed)
  +-- /api/auth/bootstrap (must succeed, but has retries)
  +-- send-welcome-email (fire-and-forget, failure OK)
  +-- State update (set loading, set error, redirect)
```

The component handles auth UI, bootstrap orchestration, and email triggering. If bootstrap fails, the user is signed up in Supabase Auth but has no profile -- relying on Triggers 2 and 3 as safety nets.

### Chain 3: Duplicated Role-to-Destination Mapping

Role-based redirect logic exists in four places:

```
1. src/app/login/page.tsx        --> role -> destination mapping
2. src/app/auth/callback/route.ts --> role -> destination mapping
3. src/app/api/auth/bootstrap/route.ts --> role -> destination mapping
4. src/lib/AuthContext.tsx        --> role -> destination mapping
```

These are not shared from a single source. If a new role is added or a destination changes, all four files must be updated. Missing one creates inconsistent routing.

### Chain 4: Duplicated Profile Existence Checks

Profile existence is checked in four places with slightly different logic:

```
1. AuthContext.tsx fetchUser()          --> SELECT from profile tables
2. /auth/callback/route.ts             --> SELECT from profile tables
3. /auth/confirm/route.ts              --> SELECT from profile tables
4. /api/auth/onboarding-status/route.ts --> SELECT from profile tables + onboarding_state
```

Each check has its own error handling and fallback behavior. They do not share a utility function.

### Chain 5: Duplicated Open Redirect Validation

```
1. src/app/auth/callback/route.ts --> validates redirect URL
2. src/app/auth/confirm/route.ts  --> validates redirect URL
```

Both routes accept a `redirect_to` parameter and must validate it is not an open redirect. The validation logic is duplicated rather than shared.

---

## Dependency Matrix

Rows depend on columns. X = direct dependency. (i) = indirect/conditional.

```
                        | supabase | supabase | supabase | Auth    | rbac | env | middleware | Mailgun | Redis
                        | .ts      | -server  | -admin   | Context |      |     |           |         |
------------------------|----------|----------|----------|---------|------|-----|-----------|---------|------
AuthScreen.tsx          |    X     |          |          |   X     |      |     |           |         |
AuthContext.tsx          |    X     |          |          |   ---   |  X   |     |           |         |
middleware.ts            |          |    X     |          |         |      |     |   ---     |         |  X
callback/route.ts        |          |    X     |          |         |      |     |           |         |
confirm/route.ts         |          |    X     |          |         |      |     |           |         |
bootstrap/route.ts       |          |          |    X     |         |      |     |           |         |
onboarding-status        |          |    X     |          |         |      |     |           |         |
repair/route.ts          |          |          |    X     |         |  X   |     |           |         |
send-auth-email          |          |          |          |         |      |     |           |   X     |
send-welcome-email       |          |          |          |         |      |     |           |   X     |
useRequireAuth.ts        |          |          |          |   X     |      |     |           |         |
login/page.tsx           |          |          |          |   X     |      |     |           |         |
supabase.ts              |          |          |          |         |      |  X  |           |         |
supabase-server.ts       |          |          |          |         |      |  X  |           |         |
supabase-admin.ts        |          |          |          |         |      |  X  |           |         |
```

---

## Recommendations for Phase 1

Based on this dependency analysis, the highest-value structural improvements would be:

1. **Extract shared utilities**: Role-to-destination mapping, profile existence check, and open redirect validation should each be a single shared function.

2. **Decompose AuthContext fetchUser()**: Break the 220+ line function into discrete, testable steps (session check, onboarding check, profile load, role resolution).

3. **Decompose AuthScreen.tsx**: Separate the signup orchestration (bootstrap + email) from the UI form component.

4. **Add Mailgun delivery webhook**: Implement R12 to get visibility into email delivery failures.

5. **Parameterize SITE_URL**: Fix R13 so preview deploys can test email flows.

6. **Add automated health checks**: Cron job to detect orphan auth users (F1) and stuck onboarding states (F2).
