# Auth Contract

**Status**: Behavioral specification
**Date**: 2026-04-02
**Scope**: All authentication flows (Layer 1 of the identity mechanism)
**Depends on**: Supabase Auth, middleware session management
**Depended on by**: App Identity (Layer 2), Access Control (Layer 3), Delivery (Layer 4)

---

## Conventions

- **Preconditions**: What must be true before the flow starts. If any precondition is false, the flow must not proceed.
- **Steps**: Numbered, deterministic, sequential. No optional steps. No branching unless explicitly noted.
- **Postconditions**: What must be true after the flow completes successfully. These are assertions, not aspirations.
- **Error handling**: What happens when a step fails. Every step has an explicit failure path.
- **Recovery path**: How to get from a broken state back to a valid state.

All flows log to `auth_audit_log` on completion (success or failure). The log entry includes: `auth_user_id`, `event_type`, `metadata` (JSON with flow-specific details), `created_at`.

---

## Flow A: Sign Up

### A1: Sign Up with Email Confirmation (Production Default)

**Preconditions**:
- User is not authenticated (no valid session)
- Email address is not already registered in Supabase Auth
- Email address is a valid format

**Steps**:
1. Client submits email + password to Supabase Auth `signUp()`
2. Supabase Auth creates the auth user with `email_confirmed_at = NULL`
3. Supabase Auth sends confirmation email via Mailgun Edge Function
4. Client displays "Check your email" message
5. User clicks confirmation link in email
6. Browser navigates to `/auth/callback` with token hash in URL fragment
7. Flow continues as Flow G (Auth Callback Handling) with `type=signup`

**Postconditions**:
- Auth user exists in `auth.users` with `email_confirmed_at` set
- Session cookie is set in browser
- `auth_audit_log` entry: `event_type = 'signup_complete'`
- Bootstrap has been triggered (see Flow G postconditions)

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 2 | Email already registered | Return error: "An account with this email already exists. Try signing in." |
| 2 | Weak password | Return error: "Password must be at least 8 characters." |
| 3 | Email delivery fails | Log error. User can request resend from /login page. |
| 6 | Token hash expired (> 24 hours) | Display "Link expired" with resend option. |
| 6 | Token hash invalid | Display "Invalid link" with resend option. |

**Recovery path**: If user never confirms email, the auth user exists but cannot sign in. User can request a new confirmation email from the sign-in page. The auth user is not deleted; Supabase handles unconfirmed user cleanup per project settings.

### A2: Sign Up without Email Confirmation (Development / Demo)

**Preconditions**:
- User is not authenticated
- Email address is not already registered
- Supabase project has email confirmation disabled (development only) OR account is being created as a demo account via admin API

**Steps**:
1. Client submits email + password to Supabase Auth `signUp()`
2. Supabase Auth creates the auth user with `email_confirmed_at = now()`
3. Supabase Auth returns a session immediately
4. Client receives session, sets cookie via middleware
5. Client detects new user (no profile), triggers bootstrap
6. `bootstrap_user_profile()` RPC creates profile, user_roles, onboarding_state
7. Client redirects to /onboarding

**Postconditions**:
- Auth user exists with confirmed email
- Session cookie is set
- `profiles` row exists
- `user_roles` row exists
- `onboarding_state` row exists with `status = 'pending'`
- `auth_audit_log` entry: `event_type = 'signup_no_confirm'`

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 2 | Email already registered | Same as A1 |
| 6 | Bootstrap RPC fails | Log error to `auth_audit_log`. Retry on next page load via AuthContext fallback. If retry fails, `repair_user_identity()` is available. |

---

## Flow B: Sign In

**Preconditions**:
- Auth user exists in `auth.users`
- Email is confirmed (`email_confirmed_at IS NOT NULL`)
- User knows their password

**Steps**:
1. Client submits email + password to Supabase Auth `signInWithPassword()`
2. Supabase Auth validates credentials
3. Supabase Auth returns a session (access_token + refresh_token)
4. Middleware intercepts the response and sets session cookie
5. Client calls `get_identity_state()` RPC with the new session
6. If identity state shows profile exists and onboarding complete: redirect to role-appropriate dashboard
7. If identity state shows profile exists but onboarding incomplete: redirect to /onboarding
8. If identity state shows no profile: trigger `bootstrap_user_profile()`, then redirect to /onboarding

**Postconditions**:
- Valid session cookie set
- User is on their role-appropriate page
- `auth_audit_log` entry: `event_type = 'signin'`

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 2 | Wrong password | Return error: "Invalid email or password." (Generic to prevent enumeration.) |
| 2 | Email not confirmed | Return error: "Please confirm your email first." with resend link. |
| 2 | Account locked / rate limited | Return error: "Too many attempts. Try again in [n] minutes." |
| 5 | `get_identity_state()` fails | Fallback: query profile table directly. If that also fails, redirect to /onboarding and let repair handle it. |
| 8 | Bootstrap fails | Log to `auth_audit_log`. Show error with retry button. |

**Recovery path**: If sign-in succeeds but the user lands in a bad state (wrong page, missing profile), reloading the page triggers AuthContext which calls `get_identity_state()` and repairs if needed.

---

## Flow C: Forgot Password

**Preconditions**:
- User is not authenticated (or is authenticated and wants to change password)
- User knows their email address
- Email is registered in Supabase Auth

**Steps**:
1. Client submits email to Supabase Auth `resetPasswordForEmail()`
2. Supabase Auth sends password reset email via Mailgun Edge Function
3. Client displays "Check your email" message
4. User clicks reset link in email
5. Browser navigates to `/auth/callback` with token hash and `type=recovery`
6. Flow continues as Flow G (Auth Callback Handling) with `type=recovery`

**Postconditions**:
- Reset email sent (or silently ignored if email not registered, to prevent enumeration)
- `auth_audit_log` entry: `event_type = 'password_reset_requested'`

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 1 | Email not registered | Supabase returns success (no enumeration leak). Client shows same "Check your email" message. |
| 2 | Email delivery fails | Silent failure from user perspective. Logged server-side. User can retry. |
| 5 | Token expired | Display "Link expired" with option to request a new one. |

**Recovery path**: User can request a new reset email at any time. Old tokens are invalidated when a new one is issued.

---

## Flow D: Reset Password

**Preconditions**:
- User has arrived at the reset password page via Flow C
- User has a valid session (token exchange happened in Flow G)
- The session was created from a recovery token (type=recovery)

**Steps**:
1. Client displays password reset form
2. User enters new password (minimum 8 characters)
3. Client calls Supabase Auth `updateUser({ password: newPassword })`
4. Supabase Auth updates the password hash
5. Client displays success message
6. Client redirects to role-appropriate dashboard (user is already authenticated)

**Postconditions**:
- Password is updated in `auth.users`
- Session remains valid
- `auth_audit_log` entry: `event_type = 'password_reset_complete'`

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 3 | Weak password | Return error: "Password must be at least 8 characters." |
| 3 | Session expired during reset | Redirect to /login with message: "Session expired. Please sign in with your new password if you already changed it, or request a new reset link." |

**Recovery path**: If the password update fails, the old password remains valid. User can retry or request a new reset link.

---

## Flow E: Logout

**Preconditions**:
- User has a valid session

**Steps**:
1. Client calls Supabase Auth `signOut()`
2. Supabase Auth invalidates the refresh token
3. Middleware clears the session cookie
4. Client clears any cached identity state (AuthContext resets)
5. Client redirects to /welcome

**Postconditions**:
- No valid session cookie in browser
- No cached user data in client memory
- Refresh token invalidated server-side
- `auth_audit_log` entry: `event_type = 'signout'`

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 1 | signOut() fails (network error) | Clear local state anyway. Cookie will expire naturally. On next page load, middleware will detect invalid session and clear cookie. |
| 3 | Cookie clearing fails | Same as above. Expired/invalid sessions are caught by middleware. |

**Recovery path**: If logout partially fails, the next page load detects the invalid session via middleware and completes the cleanup.

---

## Flow F: Session Persistence

### F1: Page Reload

**Preconditions**:
- User had a valid session before reload

**Steps**:
1. Browser sends request with session cookie
2. Middleware reads session cookie
3. Middleware calls Supabase Auth `getUser()` to validate the session
4. If session is valid but access token is near expiry (< 60 seconds): middleware refreshes the token using the refresh token
5. If session is valid: request proceeds normally
6. If session is invalid: middleware clears cookie, redirects to /login

**Postconditions**:
- Session is refreshed if it was near expiry
- User sees their authenticated page without interruption

### F2: Tab Switch (Returning to App)

**Preconditions**:
- User had a valid session when they left the tab

**Steps**:
1. Browser fires `visibilitychange` event when tab becomes visible
2. AuthContext listener detects visibility change
3. AuthContext calls Supabase Auth `getSession()` to check session validity
4. If session is valid: no action needed
5. If session expired: AuthContext triggers `onAuthStateChange` with SIGNED_OUT event
6. Client clears cached state and redirects to /login

**Postconditions**:
- Session validity is confirmed or user is signed out
- No stale session data displayed

### F3: Token Refresh (Background)

**Preconditions**:
- User has a valid session with a refresh token

**Steps**:
1. Supabase client library automatically refreshes the access token when it expires (every ~60 minutes)
2. If refresh succeeds: new access token is used for subsequent requests
3. If refresh fails (refresh token expired or revoked): `onAuthStateChange` fires SIGNED_OUT
4. Client clears state and redirects to /login

**Postconditions**:
- Access token is always valid for authenticated requests
- Users with long sessions (hours) are not interrupted

**Error handling for all F sub-flows**:
| Failure | Response |
|---------|----------|
| Network error during refresh | Retry on next request. If offline, cached data remains visible but no writes allowed. |
| Refresh token revoked (password changed elsewhere, admin action) | Sign out immediately. Redirect to /login. |
| Cookie tampered with | Middleware detects invalid session. Clears cookie. Redirects to /login. |

---

## Flow G: Auth Callback Handling

This is the critical flow that handles returns from email confirmation, password reset, and OAuth-style redirects.

**Preconditions**:
- Browser has navigated to `/auth/callback`
- URL contains either a `code` query parameter (PKCE) or a token hash in the URL fragment

**Steps**:
1. Callback page loads
2. Check for PKCE code in URL query parameters (`?code=...`)
3. If PKCE code present:
   a. Call Supabase Auth `exchangeCodeForSession(code)`
   b. If exchange succeeds: session is established
   c. If exchange fails: redirect to /login with error
4. If no PKCE code, check for token hash in URL fragment (`#access_token=...&type=...`)
5. If token hash present:
   a. Supabase client library automatically processes the hash via `onAuthStateChange`
   b. Event type is determined by the `type` parameter: `signup`, `recovery`, `magiclink`
   c. Session is established from the token
6. Determine the callback type:
   - `type=signup`: New user. Trigger `bootstrap_user_profile()`. Redirect to /onboarding.
   - `type=recovery`: Password reset. Redirect to /reset-password.
   - `type=magiclink`: Magic link sign-in. Check identity state. Redirect to appropriate page.
   - No type (PKCE exchange): Check identity state. Redirect to appropriate page.
7. For signup and first-time users:
   a. Call `bootstrap_user_profile()` with auth user metadata
   b. Wait for bootstrap to complete (max 5 second timeout)
   c. If bootstrap succeeds: redirect to /onboarding
   d. If bootstrap times out or fails: log to `auth_audit_log`, redirect to /onboarding (repair will trigger on load)

**Postconditions**:
- Session cookie is set
- For new users: profile, user_roles, and onboarding_state rows exist (or repair is queued)
- User is on the correct page for their state
- `auth_audit_log` entry: `event_type = 'auth_callback'` with `metadata.type` indicating the callback reason

**Error handling**:
| Step | Failure | Response |
|------|---------|----------|
| 3c | Code exchange fails (expired, already used) | Redirect to /login with "Session expired. Please sign in again." |
| 5 | Token hash invalid | Redirect to /login with "Invalid link. Please try again." |
| 7b | Bootstrap timeout | Proceed to /onboarding. AuthContext will detect missing profile and retry. |
| 7d | Bootstrap fails | Log error. Proceed to /onboarding. `repair_user_identity()` will handle on next AuthContext load. |

**Recovery path**: The callback flow is designed to be resilient to partial failures. If bootstrap fails, the user still gets a valid session and is redirected to /onboarding. The AuthContext mount cycle will detect the incomplete identity and trigger repair.

---

## Invariants (Must Always Be True)

1. **No session without auth.users row**: Every valid session cookie corresponds to a row in `auth.users`.
2. **No profile computation on client**: The client never creates or modifies `profiles`, `user_roles`, or `onboarding_state` rows directly. All writes go through RPCs.
3. **Consistent error messages**: Auth errors never reveal whether an email is registered (prevents enumeration).
4. **Session cookies are httpOnly**: Session tokens are never accessible to client-side JavaScript.
5. **Every auth event is logged**: Sign up, sign in, sign out, password reset, callback processing -- all write to `auth_audit_log`.
6. **Token refresh is automatic**: Users should never see a "session expired" error during normal usage within a single browser session.
7. **Logout is complete**: After logout, no cached user data remains in client memory or local storage.
