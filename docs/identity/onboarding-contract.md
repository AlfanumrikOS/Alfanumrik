# Onboarding Contract

**Status**: Behavioral specification
**Date**: 2026-04-02
**Layer**: App Identity (Layer 2 of the identity mechanism)
**Depends on**: Auth layer (valid session with `auth.uid()`)
**Depended on by**: Access Control (Layer 3), Delivery (Layer 4)

---

## 1. Purpose

Onboarding transforms an authenticated user (Layer 1 output: a JWT with `auth.uid()`) into a fully provisioned application user with a profile, role, and all role-specific records. Until onboarding is complete, the user cannot access any protected feature.

---

## 2. State Machine

### States

| State | `onboarding_state.status` | Meaning |
|-------|---------------------------|---------|
| NOT_STARTED | Row does not exist | Bootstrap has not run or failed. Requires repair. |
| PENDING | `'pending'` | Bootstrap created the row. User has not begun onboarding steps. |
| IN_PROGRESS | `'in_progress'` | User has completed at least one but not all onboarding steps. |
| COMPLETED | `'completed'` | All required steps for the user's role are done. |
| SKIPPED | `'skipped'` | Onboarding was bypassed (demo accounts, admin-created accounts). |

### Transitions

```
                +---------------+
                |  NOT_STARTED  |
                |  (no row)     |
                +-------+-------+
                        |
              bootstrap_user_profile()
              or repair_user_identity()
                        |
                +-------v-------+
                |    PENDING    |
                +-------+-------+
                        |
            complete_onboarding_step()
            (first step)
                        |
                +-------v-------+
                |  IN_PROGRESS  |
                +-------+-------+
                        |
            complete_onboarding_step()
            (final step)
                        |
                +-------v-------+
                |   COMPLETED   |
                +---------------+

    Demo / admin-created accounts:
                +---------------+
                |  NOT_STARTED  |----> bootstrap with skip_onboarding=true ----> SKIPPED
                +---------------+
```

### Transition Rules

| From | To | Guard | Trigger |
|------|----|-------|---------|
| NOT_STARTED | PENDING | `auth.uid()` exists in `auth.users` | `bootstrap_user_profile()` |
| NOT_STARTED | SKIPPED | `auth.uid()` exists AND (is_demo=true OR admin-created) | `bootstrap_user_profile(skip_onboarding := true)` |
| PENDING | IN_PROGRESS | At least one step completed | `complete_onboarding_step()` |
| IN_PROGRESS | COMPLETED | All required steps for role completed | `complete_onboarding_step()` (auto-transition when last step done) |
| PENDING | COMPLETED | All steps completed in a single submission | `complete_onboarding_step()` with batch mode |
| IN_PROGRESS | PENDING | Never. No backward transitions. | -- |
| COMPLETED | PENDING | Never. Completion is permanent. | -- |
| SKIPPED | COMPLETED | Admin or user explicitly completes onboarding | `complete_onboarding_step()` (optional upgrade path) |

**Backward transitions are forbidden.** Once a state advances, it cannot regress. The only exception is a full identity reset by a super_admin, which deletes and recreates all identity records.

---

## 3. Required Records by Role

When onboarding is COMPLETED, the following records MUST exist. If any are missing, the user is in a broken state that `repair_user_identity()` must fix.

### Student

| Table | Row | Key Fields |
|-------|-----|------------|
| `profiles` | 1 row | `auth_user_id`, `full_name`, `avatar_url` |
| `students` | 1 row | `auth_user_id`, `grade` (TEXT: "6"-"12"), `board` ("CBSE") |
| `user_roles` | 1 row | `user_id` (= profiles.id), `role` = "student", `is_active` = true |
| `onboarding_state` | 1 row | `user_id` (= profiles.id), `status` = "completed" |
| `user_preferences` | 1 row | `user_id`, `language` (default "en"), `theme` (default "light") |

**Onboarding steps for student**:
1. `select_grade` -- User selects their grade (6-12)
2. `select_subjects` -- User selects at least one subject
3. `set_name` -- User provides their display name (may be pre-filled from sign-up)

### Teacher

| Table | Row | Key Fields |
|-------|-----|------------|
| `profiles` | 1 row | `auth_user_id`, `full_name` |
| `teachers` | 1 row | `auth_user_id`, `subjects` (array), `school_name` |
| `user_roles` | 1 row | `role` = "teacher", `is_active` = true |
| `onboarding_state` | 1 row | `status` = "completed" |
| `user_preferences` | 1 row | defaults |

**Onboarding steps for teacher**:
1. `set_name` -- Display name
2. `select_subjects` -- Subjects they teach
3. `set_school` -- School name (optional but step must be visited)

### Parent / Guardian

| Table | Row | Key Fields |
|-------|-----|------------|
| `profiles` | 1 row | `auth_user_id`, `full_name` |
| `guardians` | 1 row | `auth_user_id`, `relation` (mother/father/guardian) |
| `user_roles` | 1 row | `role` = "parent", `is_active` = true |
| `onboarding_state` | 1 row | `status` = "completed" |
| `user_preferences` | 1 row | defaults |

**Onboarding steps for parent**:
1. `set_name` -- Display name
2. `set_relation` -- Relation to child (mother/father/guardian)
3. `link_child` -- Enter child's email or link code. Creates `guardian_student_links` row with `status = 'pending'`. This step can be completed or skipped (link later from dashboard).

### Admin / Super Admin

| Table | Row | Key Fields |
|-------|-----|------------|
| `profiles` | 1 row | `auth_user_id`, `full_name` |
| `user_roles` | 1 row | `role` = "admin" or "super_admin", `is_active` = true |
| `onboarding_state` | 1 row | `status` = "skipped"` (admins are created by other admins) |

**Onboarding steps for admin**: None. Admin accounts are created by super_admins via the admin API. Onboarding is automatically skipped.

### Tutor

| Table | Row | Key Fields |
|-------|-----|------------|
| `profiles` | 1 row | `auth_user_id`, `full_name` |
| `user_roles` | 1 row | `role` = "tutor", `is_active` = true |
| `onboarding_state` | 1 row | `status` = "completed" |
| `user_preferences` | 1 row | defaults |

**Onboarding steps for tutor**: Same as teacher.

---

## 4. Idempotency Rules

Every identity operation MUST be safe to call multiple times with the same inputs.

| Operation | Idempotency Mechanism | Result of Duplicate Call |
|-----------|-----------------------|--------------------------|
| `bootstrap_user_profile()` | `INSERT ... ON CONFLICT (auth_user_id) DO NOTHING` on all tables | No error. No duplicate rows. Returns existing profile. |
| `complete_onboarding_step()` | Checks if step already completed before writing | No error. Returns current state unchanged. |
| `repair_user_identity()` | For each required record: `INSERT ... ON CONFLICT DO NOTHING` | No error. Missing records created. Existing records untouched. |
| Role assignment | `INSERT ... ON CONFLICT (user_id, role) DO NOTHING` | No error. No duplicate roles. |
| Onboarding state transition | Only advances forward. If already at or past target state, no-op. | No error. Returns current state. |

### Why Idempotency Matters

The bootstrap RPC is called from three places (auth callback, AuthContext mount, manual repair). Network failures and retries mean any of these can fire multiple times. The system must handle this without creating inconsistent state.

---

## 5. Failure Handling

For each step in the onboarding pipeline, here is what happens on failure and how to recover.

### Bootstrap Failures

| Failure Point | System State After Failure | Automatic Recovery | Manual Recovery |
|---------------|----------------------------|--------------------|-----------------| 
| `profiles` INSERT fails | No profile, no role, no onboarding_state | AuthContext detects missing profile on next load, retries bootstrap | `repair_user_identity()` |
| `students` INSERT fails (student role) | Profile exists, no student record | Next bootstrap call is idempotent; creates student record | `repair_user_identity()` |
| `user_roles` INSERT fails | Profile exists, no role | AuthContext detects missing role, retries | `repair_user_identity()` |
| `onboarding_state` INSERT fails | Profile and role exist, no onboarding tracking | Middleware cannot determine onboarding status; user stuck at /onboarding | `repair_user_identity()` |
| Entire transaction fails | Nothing created (transaction rolled back) | Full retry on next page load | `repair_user_identity()` |

### Onboarding Step Failures

| Failure Point | System State After Failure | Recovery |
|---------------|----------------------------|----------|
| Step save fails (network) | Previous steps preserved. Current step not saved. | User retries. Step is idempotent. |
| Step validation fails (bad data) | Step not saved. Error returned to client. | User corrects input and resubmits. |
| Final step save fails | All previous steps saved. Status remains IN_PROGRESS. | User retries final step. |
| Status transition to COMPLETED fails | Steps saved but status not updated. | `complete_onboarding_step()` re-checks on next call and transitions if all steps are done. |

### Invariant: No Orphaned States

The system must never have:
- A `user_roles` row without a corresponding `profiles` row
- An `onboarding_state` row without a corresponding `profiles` row
- A `students` row without a corresponding `profiles` row with matching `auth_user_id`
- A `profiles` row without a corresponding `auth.users` row

`repair_user_identity()` checks for and fixes all of these conditions.

---

## 6. Repair Eligibility Rules

Not all broken states can be automatically repaired. Here is the classification.

### Auto-Repairable (repair_user_identity handles these)

| Broken State | Detection | Repair Action |
|--------------|-----------|---------------|
| Missing `profiles` row | `auth.users` exists but no `profiles` row with matching `auth_user_id` | Create profile from auth.users metadata |
| Missing `user_roles` row | `profiles` exists but no `user_roles` row | Create user_roles with default role from auth.users metadata (or 'student' if no metadata) |
| Missing `onboarding_state` row | `profiles` exists but no `onboarding_state` row | Create with `status = 'pending'` |
| Missing `students` row (student role) | `user_roles.role = 'student'` but no `students` row | Create students row with `grade = '6'` (default, user will update in onboarding) |
| Missing `user_preferences` row | `profiles` exists but no `user_preferences` row | Create with defaults (language='en', theme='light') |

### Requires Admin Intervention

| Broken State | Detection | Why Auto-Repair Cannot Help |
|--------------|-----------|----------------------------|
| Wrong role assigned | User reports being in wrong portal | Role changes have authorization implications. Only admin can reassign. |
| Duplicate profiles for same auth_user_id | Unique constraint should prevent this, but if it happens via direct DB access | Requires manual investigation: which profile has activity data? |
| Auth user deleted but profile exists | `profiles.auth_user_id` references non-existent auth user | Orphaned profile. Admin decides: delete profile or re-create auth user. |
| Onboarding stuck at COMPLETED but records missing | `onboarding_state.status = 'completed'` but required role-specific records missing | `repair_user_identity()` creates missing records. But if the user has activity data tied to the wrong records, admin must investigate. |

---

## 7. Server-Only Constraints

The following operations MUST only happen server-side. The client cannot perform them directly.

| Operation | Enforcement |
|-----------|-------------|
| Create `profiles` row | RLS: no INSERT policy for anon/authenticated. Only via `bootstrap_user_profile()` RPC (SECURITY INVOKER, but the RPC itself does the insert using the caller's context after validation). |
| Create `user_roles` row | RLS: no INSERT policy for non-admin. Only via bootstrap RPC or admin API. |
| Change `onboarding_state.status` | RLS: no UPDATE policy for authenticated users on the status column. Only via `complete_onboarding_step()` RPC which validates the transition. |
| Assign admin/super_admin role | Only via super-admin API (`/api/super-admin/users`). Requires `authorizeRequest(request, 'admin.users.manage')`. |
| Skip onboarding | Only via bootstrap RPC with `skip_onboarding := true`, which requires the caller to be admin or the account to be flagged as demo. |
| Delete identity records | Only via admin API or super-admin panel. No client-accessible delete path. |

### What the Client CAN Do

| Operation | How |
|-----------|-----|
| Read own identity state | `get_identity_state()` RPC (returns profile, role, onboarding status) |
| Submit onboarding step data | `complete_onboarding_step()` RPC with step name and data payload |
| Update own profile fields (name, avatar) | Direct UPDATE on `profiles` where `auth_user_id = auth.uid()` (RLS allows) |
| Read own onboarding progress | SELECT on `onboarding_state` where `user_id` matches (RLS allows) |

---

## 8. Onboarding State Table Schema (Target)

```sql
CREATE TABLE IF NOT EXISTS onboarding_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  current_step TEXT,
  steps_completed TEXT[] NOT NULL DEFAULT '{}',
  steps_required TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id)
);
```

Key fields:
- `steps_required`: Set by bootstrap based on role. Example for student: `{'select_grade', 'select_subjects', 'set_name'}`
- `steps_completed`: Populated as user completes each step. Example: `{'select_grade', 'set_name'}`
- `status`: Derived from the relationship between `steps_required` and `steps_completed`:
  - `pending`: `steps_completed` is empty
  - `in_progress`: `steps_completed` is non-empty but does not contain all of `steps_required`
  - `completed`: `steps_completed` contains all of `steps_required`
  - `skipped`: Set directly by bootstrap for demo/admin accounts
- `completed_at`: Set when status transitions to `completed` or `skipped`. Never cleared.

---

## 9. RPC Signatures (Target)

### complete_onboarding_step()

```sql
CREATE OR REPLACE FUNCTION complete_onboarding_step(
  p_step_name TEXT,
  p_step_data JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
-- Returns: { status, steps_completed, steps_required, is_complete }
-- Guards:
--   1. Caller must have a profiles row
--   2. Caller must have an onboarding_state row
--   3. p_step_name must be in steps_required
--   4. Status must not be 'completed' (no-op if already complete)
--   5. Step-specific validation (e.g., grade must be "6"-"12")
-- Side effects:
--   1. Appends p_step_name to steps_completed (if not already present)
--   2. Updates current_step
--   3. If all steps complete: sets status='completed', completed_at=now()
--   4. Writes step-specific data (e.g., updates students.grade)
--   5. Logs to auth_audit_log
$$;
```

### repair_user_identity()

```sql
CREATE OR REPLACE FUNCTION repair_user_identity()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
-- Returns: { repaired: boolean, actions: [...], state: {...} }
-- No inputs needed. Uses auth.uid() to identify the caller.
-- Checks for and fixes:
--   1. Missing profiles row
--   2. Missing user_roles row
--   3. Missing onboarding_state row
--   4. Missing role-specific row (students, teachers, guardians)
--   5. Missing user_preferences row
-- All fixes use INSERT ... ON CONFLICT DO NOTHING
-- Logs all repair actions to auth_audit_log
$$;
```

### get_identity_state()

```sql
CREATE OR REPLACE FUNCTION get_identity_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
-- Returns: {
--   profile: { id, full_name, avatar_url, grade, is_demo },
--   role: "student" | "parent" | "teacher" | "tutor" | "admin" | "super_admin",
--   onboarding: { status, current_step, steps_completed, steps_required },
--   subscription: { plan, status, expires_at },
--   is_complete: boolean
-- }
-- Single query. No side effects. Pure read.
-- Returns null if no profile exists (signals: bootstrap needed).
$$;
```
