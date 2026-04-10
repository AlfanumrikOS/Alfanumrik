# Current Auth Architecture (Pre-Hardening Audit)

> Captured 2026-04-02 during auth/onboarding hardening program.

## Auth Stack

| Component | Technology | File |
|---|---|---|
| Identity provider | Supabase Auth (email/password, PKCE) | Supabase hosted |
| Client library | `@supabase/supabase-js` | `src/lib/supabase.ts` |
| Server client | `@supabase/ssr` | `src/lib/supabase-server.ts` |
| Admin client | `@supabase/supabase-js` (service role) | `src/lib/supabase-admin.ts` |
| Auth context | React context + onAuthStateChange | `src/lib/AuthContext.tsx` |
| Session refresh | Middleware layer 0 | `src/middleware.ts` |
| PKCE callback | Route handler | `src/app/auth/callback/route.ts` |
| Token hash verify | Route handler | `src/app/auth/confirm/route.ts` |
| Password reset UI | Client component | `src/app/auth/reset/page.tsx` |
| Login/signup UI | Client component | `src/components/auth/AuthScreen.tsx` |
| Login page | Client component | `src/app/login/page.tsx` |

## Auth Flows

### Sign Up
1. User fills form in `AuthScreen.tsx`
2. Client calls `supabase.auth.signUp()` with `user_metadata` (name, role, grade, board)
3. If auto-confirm or email not required: session returned immediately
4. Client directly inserts into `students`/`teachers`/`guardians` table
5. Fire-and-forget welcome email via Edge Function
6. Redirect to dashboard/teacher/parent portal

### Sign In
1. User fills form in `AuthScreen.tsx`
2. Client calls `supabase.auth.signInWithPassword()`
3. On success, `onSuccess()` callback triggers router redirect
4. `AuthContext` detects `SIGNED_IN` event, calls `fetchUser()`

### Email Confirmation (PKCE)
1. User receives email with link to `/auth/callback?code=xxx&type=signup`
2. Server exchanges code for session via `exchangeCodeForSession()`
3. Redirects to appropriate portal based on `user_metadata.role`

### Password Reset
1. User requests reset via `AuthScreen` forgot mode
2. `supabase.auth.resetPasswordForEmail()` sends link
3. Link goes to `/auth/callback?code=xxx&type=recovery`
4. Code exchanged, redirects to `/auth/reset`
5. User sets new password via `supabase.auth.updateUser()`
6. Signed out, redirected to login

### Session Management
- Client: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`
- Middleware: refreshes session on every request via `supabase.auth.getUser()`
- `AuthContext` listens to `onAuthStateChange` for `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`

## Role Detection
1. Primary: `get_user_role()` RPC (checks students/teachers/guardians tables)
2. Fallback: Direct queries to each table
3. Last resort: Auto-create from `user_metadata` (client-side insert)
4. Emergency: Set role from metadata without profile

## Protected Routes
- Middleware protects: `/parent/children`, `/parent/reports`, `/parent/profile`, `/parent/support`, `/billing`
- Student routes (`/dashboard`, `/quiz`) use client-side `useAuth()` check
- `/` redirects to `/welcome` if no session cookie
