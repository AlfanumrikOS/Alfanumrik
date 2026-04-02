# Demo and Test Accounts

Last verified: 2026-04-02
Source files: `src/app/demo/page.tsx`, `src/app/api/super-admin/demo-accounts/route.ts`, `src/app/api/super-admin/test-accounts/route.ts`

## Two Separate Systems

There are two distinct account creation systems for non-production use:

1. **Demo Accounts** (`/api/super-admin/demo-accounts`) -- Full lifecycle management with personas, seeded data, reset/regenerate capabilities. Tracked in a `demo_accounts` table.
2. **Test Accounts** (`/api/super-admin/test-accounts`) -- Lightweight account creation for debugging. No tracking table, simpler setup.

Both require admin authentication via `authorizeAdmin()`.

## Demo Request Form (Public)

**Path:** `/demo` (public, no auth required)

This is a marketing page for schools/institutions to request a personalized demo. It is NOT related to demo account creation.

- Collects: name, email, phone, role (Principal/Admin/Teacher/IT Head/Parent/Other), school name, student count, message
- Inserts into `demo_requests` table via Supabase client
- Shows confirmation message after submission
- No account is created -- a human follows up within 24 hours

## Demo Account System

**API:** `POST /api/super-admin/demo-accounts`
**Auth:** Admin session required (checked via `admin_users` table)

### Creating Individual Demo Accounts

Request body:
```json
{
  "role": "student|teacher|parent",
  "persona": "weak|average|high_performer",
  "name": "Demo Student",
  "email": "demo.student@example.com"
}
```

What happens:
1. Creates auth user via Supabase Admin API with `email_confirm: true` and `user_metadata.is_demo_account: true`
2. Creates profile in role-appropriate table (`students`, `teachers`, `guardians`) with `is_demo: true`
3. For students: sets `account_status: 'demo'`, `subscription_plan: 'unlimited'`, grade `"10"`, board `CBSE`
4. For teachers: sets `is_verified: true`, `onboarding_completed: true`, demo school name
5. For parents: auto-links to an existing active demo student via `guardian_student_links`
6. Creates a `demo_accounts` record for tracking
7. Seeds persona-based data (XP, streaks) for student accounts
8. Logs to `admin_audit_log`
9. Returns credentials (email + generated password)

### Creating Demo Sets (Bulk)

Request body:
```json
{ "action": "create-set" }
```

Creates one student, one teacher, and one parent demo account in a single operation. Emails use format `demo.{role}.{timestamp}@alfanumrik.demo`. The parent is auto-linked to the first active demo student.

### Personas

| Persona | XP Total | Streak Days | Use Case |
|---------|----------|-------------|----------|
| `high_performer` | 2,500 | 45 | Showcase engaged learner |
| `average` | 800 | 12 | Default demo experience |
| `weak` | 150 | 3 | Showcase remediation features |

Persona data is stored in `demo_seed_data` table for future resets.

### Managing Demo Accounts

**List:** `GET /api/super-admin/demo-accounts`
- Returns all demo accounts with enriched profile data from the role-appropriate table

**Update:** `PUT /api/super-admin/demo-accounts`
- Actions: `reset`, `activate`, `deactivate`, `regenerate`, `reset-all`
- `reset`: Calls `reset_demo_account` RPC, clears seed data, re-seeds with same persona
- `regenerate`: Same as reset but randomizes to a different persona
- `activate` / `deactivate`: Toggles `is_active` on the `demo_accounts` record
- `reset-all`: Resets all active demo accounts in bulk

**Delete:** `DELETE /api/super-admin/demo-accounts?id={uuid}`
1. Sets `is_demo = false` on profile
2. Deletes `demo_seed_data` records
3. Deletes `demo_accounts` record
4. Deletes profile from role table
5. Deletes auth user via Supabase Admin API
6. Logs to audit trail

### Isolation from Production

| Mechanism | Implementation | Status |
|-----------|---------------|--------|
| `is_demo` column | Set to `true` on `students`, `teachers`, `guardians` profile rows | Exists |
| `account_status` | Set to `'demo'` or `'test'` on student profiles | Exists |
| `user_metadata.is_demo_account` | Set on Supabase auth user metadata | Exists |
| Demo email domain | Uses `@alfanumrik.demo` for bulk-created accounts | Exists |
| Separate tracking table | `demo_accounts` table tracks all demo accounts | Exists |
| Demo seed data table | `demo_seed_data` stores persona snapshots for resets | Exists |
| RLS isolation | No special RLS policies for demo accounts -- they follow normal RLS | Gap |
| Subscription isolation | Demo students get `subscription_plan: 'unlimited'` without payment | By design |

**Known gap:** Demo accounts are not isolated at the RLS level. They participate in leaderboards, analytics, and other aggregate queries alongside real users. Filtering by `is_demo = true` must be done at the application level.

## Test Account System

**API:** `POST /api/super-admin/test-accounts`
**Auth:** Admin session required

Simpler than demo accounts. No tracking table, no personas, no seed data.

Request body:
```json
{
  "role": "student|teacher|parent",
  "name": "Test User",
  "email": "test@example.com"
}
```

What happens:
1. Creates auth user with `user_metadata.is_test_account: true`
2. Creates profile with `is_demo: true` and `account_status: 'test'` (for students)
3. Students get grade `"10"`, board `CBSE`, `subscription_plan: 'free'`
4. Logs to `admin_audit_log`
5. Returns credentials

No lifecycle management (reset, regenerate, delete) -- cleanup is manual.

## Audit Trail

All demo/test account operations are logged to `admin_audit_log` with:
- `admin_id`: The admin who performed the action
- `action`: `create_demo_account`, `create_demo_set`, `create_test_account`, `reset_demo_account`, `delete_demo_account`, etc.
- `entity_type`: `demo_accounts` or table name
- `details`: Role, email, persona, admin name/email
- `ip_address`: Forwarded IP from request headers
