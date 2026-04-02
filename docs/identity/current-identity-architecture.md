# Identity System Architecture

> Alfanumrik Identity & Onboarding Reliability Reference
> Last updated: 2026-04-02

## System Components

| Component | Technology | Files | Owner |
|---|---|---|---|
| Identity Provider | Supabase Auth (email/password, PKCE) | Supabase hosted | Identity Agent |
| Browser Client | `@supabase/supabase-js` (localStorage sessions) | `src/lib/supabase.ts` | Identity Agent |
| Server Client | `@supabase/ssr` (cookie sessions) | `src/lib/supabase-server.ts` | Identity Agent |
| Admin Client | `@supabase/supabase-js` (service role, bypass RLS) | `src/lib/supabase-admin.ts` | Identity Agent |
| Auth Context | React context + onAuthStateChange | `src/lib/AuthContext.tsx` | Identity Agent |
| Session Refresh | Middleware Layer 0 | `src/middleware.ts` | Identity Agent |
| PKCE Callback | Route handler | `src/app/auth/callback/route.ts` | Identity Agent |
| Token Hash Verify | Route handler | `src/app/auth/confirm/route.ts` | Identity Agent |
| Password Reset UI | Client component | `src/app/auth/reset/page.tsx` | Identity Agent |
| Login/Signup UI | Client component | `src/components/auth/AuthScreen.tsx` | Identity Agent |
| Bootstrap API | Server API route | `src/app/api/auth/bootstrap/route.ts` | Identity Agent |
| Onboarding Status | Server API route | `src/app/api/auth/onboarding-status/route.ts` | Identity Agent |
| Admin Repair | Server API route | `src/app/api/auth/repair/route.ts` | Identity Agent |
| Auth Email Hook | Supabase Edge Function | `supabase/functions/send-auth-email/` | Identity Agent |
| Welcome Email | Supabase Edge Function | `supabase/functions/send-welcome-email/` | Identity Agent |
| Demo Accounts | Admin API + DB RPCs | `src/app/api/super-admin/demo-accounts/route.ts` | Identity Agent |
| Auth Audit Log | Database table | `auth_audit_log` table | Identity Agent |
| Onboarding State | Database table | `onboarding_state` table | Identity Agent |

## Session Architecture

**Critical Design Constraint**: The browser Supabase client (`src/lib/supabase.ts`) uses `createClient` which stores sessions in **localStorage**. The server Supabase client (`src/lib/supabase-server.ts`) uses `createServerClient` which stores sessions in **cookies**. These are separate session stores.

**Implication**: When a server route (callback/confirm) creates a session via `verifyOtp()` or `exchangeCodeForSession()`, that session exists in cookies but NOT in localStorage. The client won't see it unless:
1. Session tokens are passed via URL hash (for `detectSessionInUrl` to pick up), OR
2. The middleware session refresh syncs cookies on the next page load

**Current approach**: For password recovery flows, we pass tokens via URL hash. For other flows, the AuthContext `onAuthStateChange` listener detects sessions.

## Bootstrap Architecture (Defense in Depth)

Profile creation is attempted at three trigger points:

| # | Trigger | When | Mechanism |
|---|---|---|---|
| 1 | Signup (primary) | After `signUp()` returns session | AuthScreen → `POST /api/auth/bootstrap` |
| 2 | Email callback | User clicks confirmation link | `/auth/callback` → `bootstrap_user_profile()` RPC via admin |
| 3 | AuthContext fallback | App loads with auth but no profile | AuthContext → `POST /api/auth/bootstrap` |

All three are idempotent via `ON CONFLICT ON CONSTRAINT` in the bootstrap RPC.

## Database Tables (Identity-Owned)

| Table | Purpose | RLS |
|---|---|---|
| `students` | Student profiles | own SELECT/INSERT/UPDATE, teacher/guardian read, service role ALL |
| `teachers` | Teacher profiles | own SELECT/INSERT/UPDATE, public SELECT (name), service role ALL |
| `guardians` | Guardian profiles | own SELECT/INSERT/UPDATE, service role ALL |
| `onboarding_state` | Tracks bootstrap progress per user | own SELECT/INSERT/UPDATE, service role ALL |
| `auth_audit_log` | Auth event audit trail | service role ALL only |
| `demo_accounts` | Demo account registry | service role only |
| `demo_seed_data` | Demo persona data snapshots | service role only |
| `user_roles` | RBAC role assignments | auto-synced via trigger |

## Email System

| Email Type | Trigger | Template | Delivery |
|---|---|---|---|
| Signup confirmation | `supabase.auth.signUp()` | `send-auth-email` Edge Function | Mailgun |
| Password reset | `supabase.auth.resetPasswordForEmail()` | `send-auth-email` Edge Function | Mailgun |
| Welcome email | Post-signup/confirm | `send-welcome-email` Edge Function | Mailgun |
| Magic link | `supabase.auth.signInWithOtp()` | `send-auth-email` Edge Function | Mailgun |

## Environment Variables (Auth-Related)

| Variable | Context | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Yes | Admin client (bypasses RLS) |
| `SUPER_ADMIN_SECRET` | Server only | Yes | Admin panel access |
| `SEND_EMAIL_HOOK_SECRET` | Edge Function | Yes | Webhook signature verification |
| `MAILGUN_API_KEY` | Edge Function | Yes | Mailgun API authentication |
| `MAILGUN_DOMAIN` | Edge Function | Yes | Mailgun sending domain |
