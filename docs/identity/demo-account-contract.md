# Demo Account Contract

**Status**: Behavioral specification
**Date**: 2026-04-02
**Scope**: Demo account provisioning, lifecycle, protection, and differences from real accounts

---

## 1. What a Demo Account IS

A demo account is a fully functional user account with synthetic data, used for demonstrations, testing, and investor presentations. It exercises the same code paths as a real account. There is no separate "demo mode" in the application.

A complete demo account consists of exactly these records:

| Table | Required Fields | Notes |
|-------|----------------|-------|
| `auth.users` | email, encrypted_password, `email_confirmed_at` set | Same as any auth user |
| `profiles` | `auth_user_id`, `full_name`, `avatar_url`, **`is_demo = true`** | The `is_demo` flag is the canonical marker |
| `demo_accounts` | `auth_user_id`, `role`, `is_active`, `last_reset`, `created_by` | Registry for admin management. Links to auth user. |
| `user_roles` | `role` (matches demo_accounts.role), `is_active = true` | Same as any user |
| `onboarding_state` | `status = 'completed'` OR `status = 'skipped'` | Demo accounts MUST have a completed/skipped onboarding state. They must never be stuck in onboarding. |
| `students` / `teachers` / `guardians` | Role-specific record | Same as any user of that role |
| `user_preferences` | Defaults or pre-configured | Same as any user |
| `subscription_plans` (user's subscription) | `plan = 'unlimited'`, `status = 'active'` | Demo accounts always have unlimited access. No payment required. |

**If any of these records are missing, the demo account is broken.** The `repair_user_identity()` RPC must be able to detect and fix missing records for demo accounts, including ensuring `onboarding_state` exists with status `completed` or `skipped`.

---

## 2. Provisioning Flow

Demo accounts are created exclusively through the super-admin API. There is no self-service demo account creation.

### Steps

1. Super admin navigates to `/super-admin/demo-accounts` (or calls API directly)
2. Super admin provides: email, password, full_name, role, grade (if student)
3. API route: `POST /api/super-admin/demo-accounts`
   - Requires: `authorizeRequest(request, 'admin.demo.manage')`
   - Validates: email format, role is valid, grade is TEXT "6"-"12" (if student)
4. API calls Supabase Admin Auth `createUser()` (service role, server-only)
   - Sets `email_confirmed_at = now()` (no confirmation email)
   - Sets `user_metadata.is_demo = true`
5. API calls `bootstrap_user_profile()` RPC with `skip_onboarding := true`
   - Creates: profiles (with `is_demo = true`), user_roles, onboarding_state (status = 'skipped')
   - Creates role-specific record (students/teachers/guardians)
6. API creates `demo_accounts` row:
   - `auth_user_id`, `role`, `is_active = true`, `created_by` (admin's profile ID)
7. API creates subscription record with `plan = 'unlimited'`, `status = 'active'`, `expires_at = NULL`
8. API creates `user_preferences` row with defaults
9. API logs to `auth_audit_log`: `event_type = 'demo_account_created'`
10. API returns the demo account details (NOT the password -- admin already knows it)

### Postconditions

- All records from Section 1 exist
- `onboarding_state.status` is `'skipped'` (not `'pending'`)
- `profiles.is_demo = true`
- `demo_accounts.is_active = true`
- `subscription` has unlimited plan
- Account can sign in immediately

---

## 3. Sign-In Behavior

Demo accounts sign in using the exact same flow as real accounts (Flow B in auth-contract.md). There is no special sign-in path, no demo-specific endpoint, and no bypass of any auth mechanism.

**Steps**:
1. Navigate to /login
2. Enter demo account email and password
3. Supabase Auth `signInWithPassword()` -- same as any user
4. Session established -- same as any user
5. `get_identity_state()` returns profile with `is_demo = true`
6. Redirect to role-appropriate dashboard -- same as any user

**What `is_demo = true` does NOT change**:
- Auth flow (identical)
- Session management (identical)
- RBAC checks (identical)
- RLS policies (identical)
- API authorization (identical)
- Rate limiting (identical)

**What `is_demo = true` DOES change**:
- Displayed in super-admin panel as a demo account
- Eligible for reset (Section 5)
- Protected from deletion by normal flows (Section 6)
- Unlimited subscription without payment verification

---

## 4. Required Data Checklist

Use this checklist to verify a demo account is complete. `repair_user_identity()` checks all of these.

```
[ ] auth.users row exists with email_confirmed_at set
[ ] profiles row exists with is_demo = true
[ ] profiles.full_name is non-empty
[ ] demo_accounts row exists with is_active = true
[ ] user_roles row exists with correct role and is_active = true
[ ] onboarding_state row exists with status = 'completed' or 'skipped'
[ ] Role-specific row exists:
    [ ] Student: students row with valid grade ("6"-"12")
    [ ] Teacher: teachers row
    [ ] Parent: guardians row
[ ] user_preferences row exists
[ ] Subscription record exists with plan = 'unlimited' and status = 'active'
```

### Verification Query

```sql
SELECT
  au.id AS auth_user_id,
  au.email,
  p.id AS profile_id,
  p.full_name,
  p.is_demo,
  da.is_active AS demo_active,
  ur.role,
  os.status AS onboarding_status,
  CASE ur.role
    WHEN 'student' THEN EXISTS(SELECT 1 FROM students s WHERE s.auth_user_id = au.id)
    WHEN 'teacher' THEN EXISTS(SELECT 1 FROM teachers t WHERE t.auth_user_id = au.id)
    WHEN 'parent' THEN EXISTS(SELECT 1 FROM guardians g WHERE g.auth_user_id = au.id)
    ELSE true
  END AS has_role_record
FROM auth.users au
LEFT JOIN profiles p ON p.auth_user_id = au.id
LEFT JOIN demo_accounts da ON da.auth_user_id = au.id
LEFT JOIN user_roles ur ON ur.user_id = p.id
LEFT JOIN onboarding_state os ON os.user_id = p.id
WHERE p.is_demo = true;
```

---

## 5. Reset Behavior

Demo accounts can be "reset" to clear activity data while preserving the account identity. This is used before demos, investor presentations, or when activity data becomes stale.

### What Reset CLEARS (activity data)

| Table | Action |
|-------|--------|
| `quiz_attempts` | DELETE all rows for this student |
| `quiz_results` | DELETE all rows for this student |
| `student_progress` | DELETE all rows for this student |
| `xp_transactions` | DELETE all rows for this user |
| `user_streaks` | DELETE all rows for this user |
| `ai_chat_history` | DELETE all rows for this user |
| `notifications` | DELETE all rows for this user |
| `student_mastery` | DELETE all rows for this student |
| `cognitive_profiles` | DELETE all rows for this student |

### What Reset PRESERVES (identity data)

| Table | Action |
|-------|--------|
| `auth.users` | Unchanged |
| `profiles` | Unchanged (is_demo stays true) |
| `demo_accounts` | `last_reset` updated to now() |
| `user_roles` | Unchanged |
| `onboarding_state` | Unchanged (stays completed/skipped) |
| `students` / `teachers` / `guardians` | Unchanged |
| `user_preferences` | Unchanged |
| Subscription record | Unchanged (stays unlimited) |
| `guardian_student_links` | Unchanged (if parent demo) |
| `class_enrollments` | Unchanged (if teacher demo) |

### Reset Flow

1. Super admin calls `POST /api/super-admin/demo-accounts/[id]/reset`
   - Requires: `authorizeRequest(request, 'admin.demo.manage')`
2. API uses service role client (bypasses RLS) to delete activity data
3. API updates `demo_accounts.last_reset = now()`
4. API logs to `auth_audit_log`: `event_type = 'demo_account_reset'`
5. API returns success with count of cleared records

### Reset is NOT

- Deletion (the account persists)
- Re-provisioning (identity records are untouched)
- Password change (auth credentials unchanged)
- Re-onboarding (onboarding state stays completed/skipped)

---

## 6. Protection Rules

Demo accounts have special protections to prevent accidental loss.

| Rule | Enforcement |
|------|-------------|
| Cannot be deleted by normal user-deletion flows | The user deletion API checks `profiles.is_demo` and rejects with "Demo accounts cannot be deleted through this endpoint. Use the demo account management API." |
| Cannot be deactivated by normal deactivation flows | Same check on deactivation endpoints |
| Password cannot be changed by the demo user themselves | RLS policy or API check: if `is_demo = true`, `updateUser({ password })` is rejected with "Demo account passwords can only be changed by an administrator." |
| Cannot create real payment subscriptions | Payment webhook handler checks `is_demo` and skips subscription creation for demo accounts. They already have unlimited. |
| Demo data does not appear in analytics aggregates | Analytics queries filter `WHERE profiles.is_demo = false` or `WHERE NOT EXISTS (SELECT 1 FROM demo_accounts WHERE ...)` |
| Only super_admin can manage demo accounts | All demo account endpoints require `admin.demo.manage` permission |

---

## 7. Differences from Real Accounts

| Aspect | Real Account | Demo Account |
|--------|-------------|--------------|
| **Creation** | Self-service sign-up | Admin-only via super-admin API |
| **Email confirmation** | Required (production) | Skipped (set at creation) |
| **Onboarding** | User completes steps | Skipped (status = 'skipped') |
| **`profiles.is_demo`** | `false` | `true` |
| **`demo_accounts` row** | Does not exist | Exists with `is_active = true` |
| **Subscription** | Paid via Razorpay or free tier | `unlimited` plan, no payment |
| **Password management** | User can change own password | Admin-only password changes |
| **Deletion** | Standard account deletion flow | Admin-only, special endpoint |
| **Activity data** | Persistent, user-generated | Can be reset by admin |
| **Analytics inclusion** | Included in all aggregates | Excluded from all aggregates |
| **Sign-in flow** | Standard | Standard (no difference) |
| **RBAC / RLS** | Standard | Standard (no difference) |
| **API access** | Standard | Standard (no difference) |
| **Rate limiting** | Standard | Standard (no difference) |
| **AI features** | Per plan limits | Unlimited (matches subscription) |
| **Session management** | Standard | Standard (no difference) |

---

## 8. Known Issues (Current State)

These are the issues that the target identity mechanism must resolve:

| Issue | Impact | Resolution |
|-------|--------|------------|
| Some demo accounts lack `onboarding_state` rows | Demo users may get stuck at onboarding screen | Backfill migration + `repair_user_identity()` handles this case |
| Demo account creation does not always set `is_demo = true` on profile | Account not recognized as demo; appears in analytics | Fix in provisioning flow; backfill existing accounts |
| No automated demo account health check | Broken demo accounts discovered during live demos | Add health check endpoint: `GET /api/super-admin/demo-accounts/health` |
| Demo account reset does not clear all activity tables | Stale data visible after reset | Audit all activity tables and add to reset list |

---

## 9. Invariants

1. **A demo account always has `profiles.is_demo = true`**. If this flag is false, the account is treated as a real account regardless of what `demo_accounts` says.
2. **A demo account always has `onboarding_state` with status `completed` or `skipped`**. Never `pending` or `in_progress`.
3. **A demo account always has an `unlimited` subscription**. If the subscription is missing or expired, it is a broken state.
4. **Demo accounts never appear in user-facing analytics**. Every analytics query must exclude `is_demo = true`.
5. **Demo account management requires super_admin privileges**. No self-service.
6. **Demo accounts use the same code paths as real accounts** for sign-in, RBAC, RLS, and API access. There is no "demo mode" branch in application code.
