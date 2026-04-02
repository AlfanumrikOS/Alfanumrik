# Identity Contract

> Explicit behavioral contract for all auth/onboarding flows.
> Any change that violates this contract is a blocking defect.

## 1. SIGN UP / CREATE ACCOUNT

### Preconditions
- Valid email (not already registered)
- Password meets complexity requirements (min 8 chars, mixed case, digit)
- Name provided (min 2 chars)
- Role selected (student/teacher/parent)
- Data consent given

### Steps
1. `supabase.auth.signUp()` creates auth identity with `user_metadata`
2. If session returned immediately (auto-confirm):
   a. `POST /api/auth/bootstrap` creates profile + onboarding_state
   b. Welcome email sent fire-and-forget
   c. Redirect to role-appropriate portal
3. If no session (email confirmation required):
   a. Show "Check your email" screen
   b. User clicks email link → `/auth/confirm` verifies token
   c. Bootstrap runs in callback route
   d. Welcome email sent
   e. Redirect to role-appropriate portal

### Postconditions
- `auth.users` row exists
- Profile row exists in `students`/`teachers`/`guardians`
- `onboarding_state` row exists with `step = 'completed'`
- `user_roles` row exists (via trigger)
- `auth_audit_log` entry for bootstrap

### Failure Behavior
- If bootstrap fails: error shown to user, `onboarding_state.step = 'failed'`
- AuthContext fallback will retry bootstrap on next page load
- Admin can repair via `POST /api/auth/repair`

---

## 2. SIGN IN

### Preconditions
- Valid email + password combination
- Account exists and is active

### Steps
1. `supabase.auth.signInWithPassword()` creates session
2. `onSuccess()` triggers router redirect
3. AuthContext detects `SIGNED_IN` event
4. `get_user_role()` RPC resolves roles from profile tables
5. Role determines redirect destination

### Postconditions
- Session stored in localStorage (browser client)
- AuthContext has `isLoggedIn = true`
- `activeRole` set from server-verified roles
- User on correct portal page

### Failure Behavior
- Invalid credentials: error message shown
- Network error: "Connection error" message
- No profile found: AuthContext triggers bootstrap fallback

---

## 3. FORGOT PASSWORD / RESET PASSWORD

### Preconditions
- User has a registered email

### Steps
1. `supabase.auth.resetPasswordForEmail()` triggers `send-auth-email` hook
2. Hook sends branded email via Mailgun with link to `/auth/confirm`
3. User clicks link → `/auth/confirm?token_hash=XXX&type=recovery`
4. `verifyOtp()` establishes server session
5. Session tokens passed via URL hash to `/auth/reset`
6. Client-side `detectSessionInUrl` picks up tokens
7. User enters new password → `supabase.auth.updateUser({ password })`
8. Audit log entry created
9. User signed out → redirected to login

### Postconditions
- Password changed in `auth.users`
- `audit_logs` entry with `action = 'password_reset'`
- User signed out (must log in with new password)

### Failure Behavior
- Invalid/expired token: "Invalid or Expired Link" shown
- Session not detected: 2-second timeout then fallback message
- Password validation failure: error message shown

---

## 4. LOGOUT

### Preconditions
- User is currently signed in

### Steps
1. `supabase.auth.signOut()` clears Supabase session
2. SWR cache cleared (prevents data leakage on shared devices)
3. localStorage items cleared: `alfanumrik_active_role`, `alfanumrik_guardian`, etc.
4. AuthContext state reset to defaults

### Postconditions
- No active session
- No cached user data
- Protected routes redirect to login
- `onAuthStateChange(SIGNED_OUT)` propagated

---

## 5. DEMO ACCOUNTS

### Creation
- Created via `POST /api/super-admin/demo-accounts` (admin only)
- Auth user created with `email_confirm: true` (no verification needed)
- Profile created with `is_demo: true` and `account_status: 'demo'`
- Tracked in `demo_accounts` table

### Sign In
- Same as regular sign in (email + password)
- Demo student accounts: go to `/dashboard`
- Demo teacher accounts: go to `/teacher`
- Demo parent accounts: use parent portal link code flow

### Protection
- `is_demo` flag prevents accidental deletion
- Admin can reset/regenerate via PUT
- `reset_demo_account()` RPC clears activity data
- Subscription set to 'unlimited' (no payment blocks)

### Differences from Real Accounts
- `account_status = 'demo'` (student)
- `is_demo = true` on profile
- `subscription_plan = 'unlimited'`
- `onboarding_completed = true` (skip onboarding flow)
- Tracked in `demo_accounts` table with persona metadata
