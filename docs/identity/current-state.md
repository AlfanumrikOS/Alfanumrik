# Identity & Onboarding System: Current State

Phase 0 discovery document. Captures the full inventory of the identity and onboarding system as of 2026-04-02.

## Component Inventory

### Auth Layer

| File | Purpose | Lines | Health |
|------|---------|-------|--------|
| `src/lib/supabase.ts` | Browser Supabase client (localStorage sessions) | — | Stable |
| `src/lib/supabase-server.ts` | Server Supabase client (cookie sessions via @supabase/ssr) | — | Stable |
| `src/lib/supabase-admin.ts` | Admin Supabase client (service role, bypasses RLS, singleton) | — | Stable |
| `src/lib/AuthContext.tsx` | React context, onAuthStateChange listener, profile fetch, bootstrap fallback | ~425 | Fragile (fetchUser 220+ lines) |
| `src/middleware.ts` | Session refresh, protected routes, rate limiting, security headers, bot blocking | — | Stable |
| `src/app/auth/callback/route.ts` | PKCE code exchange after email link click | — | Stable |
| `src/app/auth/confirm/route.ts` | Token hash verification for email confirmation links | — | Stable |
| `src/app/auth/reset/page.tsx` | Password reset UI | — | Stable |
| `src/app/login/page.tsx` | Login page shell | — | Stable |
| `src/components/auth/AuthScreen.tsx` | Login, signup, forgot-password UI, bootstrap call, welcome email trigger | ~476 | Fragile (too many responsibilities) |
| `src/lib/useRequireAuth.ts` | Client-side route protection hook | — | Stable |
| `src/lib/env.ts` | Environment variable validation | — | Stable |

### Bootstrap Layer

| File | Purpose | Health |
|------|---------|--------|
| `src/app/api/auth/bootstrap/route.ts` | Server-controlled profile creation API | Stable |
| `src/app/api/auth/onboarding-status/route.ts` | Onboarding state query API | Stable |
| `src/app/api/auth/repair/route.ts` | Admin repair API (RBAC protected) | Stable |
| `bootstrap_user_profile()` (RPC) | Postgres SECURITY DEFINER function, idempotent profile creation | Stable |
| `admin_repair_user_onboarding()` (RPC) | Postgres repair function for stuck users | Stable |
| `sync_user_roles_for_user()` (RPC) | Postgres helper to sync user_roles table from profile tables | Stable |

### Database Tables (Identity-Owned)

| Table | Purpose | RLS |
|-------|---------|-----|
| `students` | Student profile (name, grade, school, preferences) | Own CRUD + teacher/guardian read + service role |
| `teachers` | Teacher profile | Own CRUD + public name read + service role |
| `guardians` | Guardian/parent profile | Own CRUD + service role |
| `onboarding_state` | Step tracking per user (signup, profile, preferences, complete) | Own CRUD + service role |
| `auth_audit_log` | Event trail (login, signup, bootstrap, errors) | Service role only |
| `demo_accounts` | Demo account registry | Service role only |
| `demo_seed_data` | Demo data snapshots for reset | Service role only |
| `user_roles` | RBAC role assignments (auto-synced via triggers) | Varies by operation |

### Email Layer

| File | Purpose | Health |
|------|---------|--------|
| `supabase/functions/send-auth-email/` | Supabase auth hook, sends via Mailgun (confirmation, reset, magic link) | Risk: hardcoded SITE_URL |
| `supabase/functions/send-welcome-email/` | Post-signup welcome email via Mailgun | Stable |

### Test Suite

| File | Tests | Lines | Health |
|------|-------|-------|--------|
| `src/__tests__/auth-bootstrap.test.ts` | Bootstrap API tests | 559 | Passing |
| `src/__tests__/auth-onboarding.test.ts` | Callback + onboarding flow tests | 532 | Passing |
| `src/__tests__/auth-middleware.test.ts` | Middleware layer tests | 368 | Passing |
| `src/__tests__/auth-admin.test.ts` | Admin auth tests | 199 | Passing |
| **Total** | **117 tests** | **1658** | **All passing** |

---

## Session Architecture

The system operates a dual session store:

```
Browser Client (supabase.ts)
  Session stored in: localStorage
  Used by: React components, client-side data fetching
  Refresh: onAuthStateChange listener in AuthContext

Server Client (supabase-server.ts)
  Session stored in: HTTP-only cookies (via @supabase/ssr)
  Used by: API routes, server components, middleware
  Refresh: middleware refreshes on every request
```

### Session Lifecycle

```
1. User logs in (AuthScreen.tsx)
   |
   v
2. Supabase Auth returns session
   |
   +---> localStorage (browser client)
   +---> Set-Cookie (server client, via callback/confirm route)
   |
   v
3. Middleware reads cookie session on every request
   +---> Refreshes if near expiry
   +---> Sets updated cookie in response
   |
   v
4. AuthContext reads localStorage session on mount
   +---> onAuthStateChange keeps it updated
   +---> fetchUser() loads profile + permissions
```

### Mismatch Window

There is an inherent mismatch window between the two stores. When the middleware refreshes the cookie-based session, the localStorage session does not update until the next `onAuthStateChange` event fires on the client. During this window, the server and client may disagree on session validity.

---

## Bootstrap Pipeline

Defense-in-depth: three trigger points ensure every authenticated user gets a profile.

```
Trigger 1: Signup
  AuthScreen.tsx signup handler
    --> POST /api/auth/bootstrap
      --> bootstrap_user_profile() RPC (SECURITY DEFINER)
        --> Creates: students/teachers/guardians row
        --> Creates: onboarding_state row (step = 'profile')
        --> Creates: user_roles row (via trigger)
        --> All idempotent via ON CONFLICT DO NOTHING

Trigger 2: Callback
  /auth/callback/route.ts (PKCE code exchange)
    --> Checks if profile exists
    --> If missing: calls bootstrap_user_profile()
    --> Redirects to appropriate destination by role

Trigger 3: AuthContext Fallback
  AuthContext.tsx fetchUser()
    --> On profile load, checks if profile exists
    --> If missing: calls /api/auth/bootstrap
    --> Last-resort safety net
```

### Bootstrap RPC (bootstrap_user_profile)

- SECURITY DEFINER: runs with elevated privileges to create profile regardless of RLS
- Idempotent: ON CONFLICT clauses prevent duplicate creation
- Atomic: single transaction creates profile + onboarding state
- Justified SECURITY DEFINER: new users have no profile row yet, so RLS would block their own insert

---

## Data Flow: Login to Dashboard

```
User enters credentials
  |
  v
AuthScreen.tsx --> supabase.auth.signInWithPassword()
  |
  v
Supabase Auth returns session + user
  |
  +---> onAuthStateChange fires in AuthContext
  |       |
  |       v
  |     fetchUser() begins
  |       |
  |       +---> GET /api/auth/onboarding-status
  |       |       (checks if profile + onboarding complete)
  |       |
  |       +---> If no profile: POST /api/auth/bootstrap (Trigger 3)
  |       |
  |       +---> Load full profile from students/teachers/guardians
  |       +---> Load user_roles for RBAC
  |       +---> Load permissions via rbac.ts
  |       |
  |       v
  |     AuthContext state updated:
  |       { user, profile, role, permissions, isOnboarded }
  |
  +---> Router redirects based on role + onboarding state
          student --> /dashboard
          teacher --> /teacher/dashboard
          parent  --> /parent/dashboard
          admin   --> /super-admin
```

## Data Flow: Signup to First Login

```
User fills signup form in AuthScreen.tsx
  |
  v
supabase.auth.signUp({ email, password, options: { data: { role, grade } } })
  |
  v
Supabase Auth creates auth.users row
  +---> Fires auth hook: send-auth-email Edge Function
  |       --> Sends confirmation email via Mailgun
  |
  v
AuthScreen.tsx calls POST /api/auth/bootstrap (Trigger 1)
  --> bootstrap_user_profile() RPC
    --> Creates profile row (students/teachers/guardians)
    --> Creates onboarding_state (step = 'profile')
    --> Trigger creates user_roles row
  |
  v
AuthScreen.tsx calls send-welcome-email Edge Function
  --> Sends welcome email via Mailgun
  |
  v
User clicks confirmation link in email
  |
  v
/auth/confirm/route.ts
  --> Verifies token hash
  --> Checks profile exists (Trigger 2 if missing)
  --> Sets session cookie
  --> Redirects to onboarding or dashboard
```

---

## Active Risk Register (Identity-Specific)

| ID | Risk | Severity | Status |
|----|------|----------|--------|
| R12 | Mailgun webhook for delivery tracking not implemented | LOW | Open |
| R13 | SITE_URL hardcoded in send-auth-email Edge Function | LOW | Open |
| R14 | Demo accounts not always tracked in onboarding_state | LOW | Open |
| R15 | No CI gate specifically for auth tests | MEDIUM | Open |
| R16 | Existing users may lack onboarding_state rows | LOW | Open |

---

## Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Defense-in-depth bootstrap (3 trigger points) | No single failure point can leave a user without a profile |
| 2 | Server-controlled onboarding via SECURITY DEFINER RPC | New users cannot write their own profile via RLS (no row exists yet to match) |
| 3 | Dual session stores (localStorage + cookies) | Browser client needs localStorage for SPA feel; server needs cookies for SSR/middleware |
| 4 | Password recovery tokens via URL hash | Supabase detectSessionInUrl reads fragment; keeps token out of server logs |
| 5 | All bootstrap is idempotent via ON CONFLICT | Any trigger point can fire without causing duplicate data |
| 6 | Auth audit log tracks all identity events | Forensic trail for debugging stuck users and security incidents |
