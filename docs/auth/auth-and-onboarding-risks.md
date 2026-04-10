# Auth and Onboarding Risks (Pre-Hardening Audit)

> Captured 2026-04-02. Each risk has a severity and the fix applied in this hardening program.

## Critical Risks

### R1: No RLS policies on identity tables
- **Severity**: CRITICAL
- **Tables**: `students`, `teachers`, `guardians`
- **Issue**: All three tables have `ENABLE ROW LEVEL SECURITY` but zero policies in migration files. This means either (a) all client operations are silently blocked, or (b) policies were manually added in production and are not version-controlled.
- **Impact**: Client-side profile inserts may fail silently. Cross-user data access is undefined.
- **Fix**: Migration `20260402100000` adds SELECT/INSERT/UPDATE own-record policies, teacher/guardian cross-read policies, and service role bypass.

### R2: Client-side profile creation is fragile
- **Severity**: CRITICAL
- **File**: `src/components/auth/AuthScreen.tsx`
- **Issue**: Profile creation happens via direct Supabase insert from the browser. If this fails (network, RLS, race condition), the error is logged to console but the user proceeds as if signup succeeded.
- **Impact**: Users end up authenticated with no profile. The system falls into increasingly desperate fallback logic in AuthContext.
- **Fix**: Replaced with server-controlled `POST /api/auth/bootstrap` that calls an idempotent RPC with proper error handling.

### R3: No server-controlled onboarding
- **Severity**: HIGH
- **Issue**: No API route handles profile creation. The entire flow is client -> Supabase direct. No atomic guarantee. No audit trail. No retry path.
- **Fix**: Created `bootstrap_user_profile()` RPC + `/api/auth/bootstrap` route + `/api/auth/onboarding-status` route.

### R4: Auto-bootstrap in AuthContext is unreliable
- **Severity**: HIGH
- **File**: `src/lib/AuthContext.tsx` (lines 252-283)
- **Issue**: If RPC and fallback queries fail to find a profile, AuthContext tries to auto-create one from `user_metadata`. This is a last-resort recovery buried in client state management with no error reporting.
- **Fix**: AuthContext now calls `/api/auth/bootstrap` (server-side) instead of client-side inserts. Fallback to metadata-only role still exists for graceful degradation.

### R5: Onboarding state is implicit
- **Severity**: MEDIUM
- **Issue**: The `onboarding_completed` boolean on each profile table is never checked. There's no centralized onboarding state tracking. Impossible to detect stuck/failed onboarding.
- **Fix**: Created `onboarding_state` table with explicit step tracking (`identity_created` -> `profile_created` -> `role_assigned` -> `completed` / `failed`).

### R6: Grade format inconsistency (P5 violation)
- **Severity**: MEDIUM
- **File**: `src/components/auth/AuthScreen.tsx`
- **Issue**: Signup stores grade as `"Grade 9"` but P5 mandates grades are strings `"6"` through `"12"`, never with prefix.
- **Fix**: Bootstrap RPC stores grade as plain string. AuthScreen now sends grade as `'9'` not `'Grade 9'`.

### R7: Role determined by client metadata
- **Severity**: MEDIUM
- **Issue**: Role comes from `user_metadata.role` which the client sets at signup. Server never independently validates. A malicious client could set `role: 'admin'`.
- **Fix**: Bootstrap RPC validates role against allowed values (`student`, `teacher`, `parent`). The `get_user_role()` RPC determines role from actual profile table presence, not metadata.

### R8: No auth event audit trail
- **Severity**: MEDIUM
- **Issue**: No structured logging of auth events (signup, login, bootstrap success/failure, password reset).
- **Fix**: Created `auth_audit_log` table. Bootstrap route logs success/failure events.

### R9: Email callback doesn't ensure profile exists
- **Severity**: MEDIUM
- **File**: `src/app/auth/callback/route.ts`
- **Issue**: When a user confirms their email (deferred confirmation), the callback sends a welcome email and redirects. But if the profile wasn't created during signup (because there was no session), the user arrives at the dashboard with no profile.
- **Fix**: Auth callback now checks if profile exists and runs bootstrap if not.

### R10: No repair capability for stuck users
- **Severity**: LOW
- **Issue**: If a user gets stuck in a partial signup state, there's no admin tool to diagnose or repair.
- **Fix**: Created `admin_repair_user_onboarding()` RPC + `POST /api/auth/repair` admin endpoint.
