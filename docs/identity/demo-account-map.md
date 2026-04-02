# Demo Account Map

> How demo accounts are created, maintained, and protected.

## Demo Account Types

| Role | Email Pattern | Default Grade | Portal | Login Method |
|---|---|---|---|---|
| Student | `demo.student.{ts}@alfanumrik.demo` | 10 | `/dashboard` | Email + password |
| Teacher | `demo.teacher.{ts}@alfanumrik.demo` | N/A | `/teacher` | Email + password |
| Parent | `demo.parent.{ts}@alfanumrik.demo` | N/A | `/parent` | Link code (invite code) |

## Personas

| Persona | XP Total | Streak Days | Description |
|---|---|---|---|
| `high_performer` | 2500 | 45 | Advanced student |
| `average` | 800 | 12 | Typical student |
| `weak` | 150 | 3 | Struggling student |

## Database Tables

### `demo_accounts` (Registry)
- `id`, `auth_user_id`, `role`, `persona`, `display_name`, `email`, `is_active`
- Tracks all demo accounts with metadata
- Used by admin panel for management

### `demo_seed_data` (Persona Snapshots)
- `demo_account_id`, `data_type`, `seed_data`
- Stores initial state for reset operations

## Admin Operations

| Operation | Endpoint | Effect |
|---|---|---|
| Create set | `POST /api/super-admin/demo-accounts` `{action: 'create-set'}` | Creates student + teacher + parent demos |
| Create single | `POST /api/super-admin/demo-accounts` | Creates one demo account |
| Reset | `PUT` `{id, action: 'reset'}` | Clears activity, re-seeds persona data |
| Regenerate | `PUT` `{id, action: 'regenerate'}` | Resets with different persona |
| Activate | `PUT` `{id, action: 'activate'}` | Re-enables demo account |
| Deactivate | `PUT` `{id, action: 'deactivate'}` | Disables demo account |
| Reset all | `PUT` `{action: 'reset-all'}` | Resets all active demos |
| Delete | `DELETE ?id=xxx` | Removes auth user + profile + demo record |
| List | `GET` | Lists all demo accounts with enriched profile data |

## Parent Demo Linking
- On creation, parent demo auto-links to first active demo student
- Uses `guardian_student_links` with `status: 'active'`, `is_verified: true`
- Parent can then see demo student's data in parent portal

## Protection Rules
1. Demo accounts have `subscription_plan: 'unlimited'` — no payment gates
2. Demo accounts have `onboarding_completed: true` — no onboarding dead-ends
3. Demo student accounts have `account_status: 'demo'` — distinguishable in analytics
4. Reset operation preserves auth credentials but clears activity data
5. `is_demo: true` flag on profile prevents accidental inclusion in real analytics

## Repair Procedure
If a demo account stops working:
1. Check `demo_accounts` table — is it `is_active: true`?
2. Check auth.users — does the auth user exist?
3. Check profile table — does the profile exist with `is_demo: true`?
4. If profile missing: use `POST /api/auth/repair` to rebuild
5. If auth user missing: delete and recreate via admin panel
6. If data corrupted: use "Reset" action in admin panel
