# Auth & Onboarding Change Checklist

> Required reading before modifying any auth/onboarding file.
> Created 2026-04-02 as part of auth hardening program.

## Before Making Any Auth Change

- [ ] Read `docs/auth/target-onboarding-architecture.md`
- [ ] Identify which layer(s) you're changing (Identity / Bootstrap / Role Detection / Routing)
- [ ] Check if the change affects multiple trigger points (signup / callback / AuthContext fallback)

## If Changing These Files

### `src/components/auth/AuthScreen.tsx`
- [ ] Test signup with email confirmation enabled AND disabled
- [ ] Verify bootstrap API is called on signup with session
- [ ] Verify check-email mode shown when no session
- [ ] Test all three roles (student, teacher, parent)
- [ ] Verify grade sent as plain string (P5: "9" not "Grade 9")
- [ ] Run `npm test -- auth-bootstrap`

### `src/lib/AuthContext.tsx`
- [ ] Verify `fetchUser()` handles: profile found, no profile (triggers bootstrap), bootstrap failure
- [ ] Verify `signOut()` clears all state
- [ ] Verify `onAuthStateChange` handles SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED
- [ ] Test role switching only allows server-verified roles
- [ ] Run `npm test -- auth-onboarding`

### `src/app/auth/callback/route.ts`
- [ ] Test with `type=signup` (should bootstrap if no profile)
- [ ] Test with `type=recovery` (should redirect to /auth/reset)
- [ ] Test with no type (should redirect to /dashboard)
- [ ] Verify code exchange works
- [ ] Verify open redirect prevention (SAFE_NEXT_PATTERN)
- [ ] Run `npm test -- auth-onboarding`

### `src/app/auth/confirm/route.ts`
- [ ] Test with valid token_hash + type
- [ ] Test with invalid/expired token
- [ ] Verify redirect safety

### `src/app/auth/reset/page.tsx`
- [ ] Test with valid session (should show reset form)
- [ ] Test with no session (should show "Invalid or Expired Link")
- [ ] Test password update + sign out + redirect

### `src/middleware.ts`
- [ ] Verify /login, /auth/callback, /auth/confirm, /auth/reset are NOT blocked
- [ ] Verify protected routes (/parent/*, /billing) redirect to login
- [ ] Verify / redirects to /welcome without session
- [ ] Run `npm test -- auth-middleware`

### `src/app/api/auth/bootstrap/route.ts`
- [ ] Test all three roles
- [ ] Test validation (missing role, invalid grade, short name)
- [ ] Test idempotency (call twice, second returns already_completed)
- [ ] Test auth requirement (401 without session)
- [ ] Test RPC failure handling
- [ ] Run `npm test -- auth-bootstrap`

### `supabase/migrations/` (any auth-related)
- [ ] Verify migration is idempotent (DROP IF EXISTS, ON CONFLICT)
- [ ] Verify RLS policies don't break existing queries
- [ ] Test in staging before production
- [ ] Verify bootstrap_user_profile() still works

## After Any Auth Change

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (especially auth-* test files)
- [ ] `npm run build` succeeds
- [ ] Manual test: full signup flow (student)
- [ ] Manual test: login + session persists after refresh
- [ ] Manual test: forgot password + reset flow
