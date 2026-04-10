# Auth Route Map

> Complete map of all authentication-related routes and their behavior.

## Public Auth Routes (No Session Required)

| Route | Type | Purpose | Session Behavior |
|---|---|---|---|
| `/login` | Page | Login/signup form | If logged in, redirects to dashboard |
| `/welcome` | Page | Landing page | No auth check |
| `/auth/callback` | Route Handler (GET) | PKCE code exchange | Creates session in cookies, passes tokens via hash for recovery |
| `/auth/confirm` | Route Handler (GET) | Token hash verification | Creates session in cookies, passes tokens via hash for recovery |
| `/auth/reset` | Page | Password reset form | Needs session (from URL hash or localStorage) |
| `/api/auth/bootstrap` | API (POST) | Server-controlled profile creation | Requires valid session |
| `/api/auth/onboarding-status` | API (GET) | Check onboarding state | Requires valid session |

## Protected Routes (Session Required)

### Middleware-Protected (cookie check)
| Route | Redirect on No Session |
|---|---|
| `/parent/children` | `/parent` |
| `/parent/reports` | `/parent` |
| `/parent/profile` | `/parent` |
| `/parent/support` | `/parent` |
| `/billing` | `/login` |

### Client-Protected (useAuth check in component)
| Route | Redirect on No Session |
|---|---|
| `/dashboard` | `/login` (via component) |
| `/quiz` | `/login` (via component) |
| `/profile` | `/login` (via component) |
| `/progress` | `/login` (via component) |
| `/foxy` | `/login` (via component) |

### Admin-Protected (secret + rate limit)
| Route | Auth Method |
|---|---|
| `/internal/admin/*` | `SUPER_ADMIN_SECRET` via query param or header |
| `/api/internal/admin/*` | `SUPER_ADMIN_SECRET` via header |
| `/super-admin/*` | RBAC via `authorizeRequest` |

## Auth Flow Routes

### Sign Up Flow
```
/login → AuthScreen (signup mode)
  → supabase.auth.signUp()
  → If session: POST /api/auth/bootstrap → redirect to portal
  → If no session: show "Check your email"
    → User clicks email link
    → /auth/confirm?token_hash=XXX&type=signup
      → verifyOtp() → bootstrap profile → redirect to portal
```

### Sign In Flow
```
/login → AuthScreen (login mode)
  → supabase.auth.signInWithPassword()
  → onSuccess() → router.replace(destination)
  → AuthContext detects SIGNED_IN → fetchUser()
```

### Password Reset Flow
```
/login → AuthScreen (forgot mode)
  → supabase.auth.resetPasswordForEmail()
  → "Reset link sent!"
  → User clicks email link
  → /auth/confirm?token_hash=XXX&type=recovery
    → verifyOtp() → getSession() → redirect to /auth/reset#access_token=...
  → /auth/reset detects session from URL hash via detectSessionInUrl
  → User enters new password → supabase.auth.updateUser({ password })
  → Sign out → redirect to /login
```

### Logout Flow
```
Any page → signOut()
  → supabase.auth.signOut()
  → Clear SWR cache, localStorage items
  → AuthContext sets all state to null
  → onAuthStateChange(SIGNED_OUT) propagates
```

## Redirect Rules

| Condition | Destination |
|---|---|
| Unauthenticated at `/` | `/welcome` |
| Student after login | `/dashboard` |
| Teacher after login | `/teacher` |
| Parent after login | `/parent` |
| After password reset | `/login` (via `/auth/reset` sign-out) |
| After signup confirmation | Portal based on role metadata |
