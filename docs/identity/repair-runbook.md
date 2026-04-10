# Identity Repair Runbook

Last updated: 2026-04-02

## When to Use This Runbook

Use this runbook when a user reports any of the following:

- Cannot log in despite having an account
- Stuck on onboarding screen (spinner, error, or loop)
- Logged in but sees a blank dashboard or "no profile" error
- Sees the wrong portal (e.g., student seeing teacher portal)
- Password reset email never arrives
- Demo account is broken or inaccessible

## Diagnostic Steps

Before attempting any repair, gather information about the user's state.

### Step 1: Check auth.users

Open Supabase dashboard > Authentication > Users. Search by the user's email.

| Finding | Meaning |
|---|---|
| User exists, email confirmed | Auth layer is healthy. Problem is downstream (profile, onboarding, roles). |
| User exists, email NOT confirmed | User never clicked confirmation email. Resend or manually confirm. |
| User does not exist | User never completed signup, or account was deleted. They need to register again. |

Record the user's `id` (this is `auth_user_id` in application tables).

### Step 2: Check onboarding_state

Query in Supabase SQL Editor:

```sql
SELECT * FROM onboarding_state WHERE auth_user_id = '<auth_user_id>';
```

| Finding | Meaning |
|---|---|
| Row exists, step = 'completed' | Onboarding finished. Problem is in profile or roles. |
| Row exists, step = 'failed' | Onboarding failed mid-process. Needs repair. |
| Row exists, step is something else | Onboarding is incomplete. User may need to resume or repair. |
| No row | Onboarding never started or state was lost. Needs repair. |

### Step 3: Check Profile Tables

```sql
-- Check all profile tables for this user
SELECT 'student' as type, id, grade, full_name FROM students WHERE auth_user_id = '<auth_user_id>'
UNION ALL
SELECT 'teacher' as type, id, NULL, full_name FROM teachers WHERE auth_user_id = '<auth_user_id>'
UNION ALL
SELECT 'guardian' as type, id, NULL, full_name FROM guardians WHERE auth_user_id = '<auth_user_id>';
```

| Finding | Meaning |
|---|---|
| Profile row exists | Profile was created. Check if role assignment matches. |
| No profile row | Profile creation failed during onboarding. Needs repair. |
| Multiple rows in different tables | Possible data corruption. Investigate which role is correct. |

### Step 4: Check user_roles

```sql
SELECT * FROM user_roles WHERE auth_user_id = '<auth_user_id>';
```

| Finding | Meaning |
|---|---|
| Role matches expected portal | Role is correct. Problem may be in frontend routing or session. |
| Role does not match | Wrong role assigned. Use repair endpoint to fix. |
| No role row | Role assignment failed during onboarding. Needs repair. |

### Step 5: Check auth_audit_log

```sql
SELECT * FROM auth_audit_log
WHERE auth_user_id = '<auth_user_id>'
ORDER BY created_at DESC
LIMIT 20;
```

Look for: recent login attempts, failed auth events, repair actions, role changes.

## Repair Procedures

### A. Missing Profile (auth user exists, no profile row)

**Symptoms**: User can log in but sees "profile not found" or blank dashboard.

**Fix**:

```bash
curl -X POST https://alfanumrik.com/api/auth/repair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_session_token>" \
  -d '{
    "auth_user_id": "<auth_user_id>",
    "force_role": "student"
  }'
```

Replace `force_role` with the appropriate role: `student`, `teacher`, or `parent`.

**What this does**:
1. Calls `admin_repair_user_onboarding()` RPC
2. Creates the profile row in the appropriate table (students/teachers/guardians)
3. Creates or updates `onboarding_state` to `completed`
4. Creates or updates `user_roles` with the specified role
5. Logs the repair action in `auth_audit_log`

**Verification**: Ask the user to log out and log back in. They should see the correct portal.

### B. Stuck Onboarding (onboarding_state.step = 'failed')

**Symptoms**: User sees an error screen during onboarding, or is stuck in a loop.

**Fix**: Same as Procedure A. The repair endpoint upserts `onboarding_state` to `completed` and ensures all downstream records exist.

```bash
curl -X POST https://alfanumrik.com/api/auth/repair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_session_token>" \
  -d '{
    "auth_user_id": "<auth_user_id>",
    "force_role": "student"
  }'
```

**Verification**: Ask the user to refresh the page or log out and back in.

### C. Missing onboarding_state (profile exists, no onboarding_state row)

**Symptoms**: User has a profile but the app thinks they haven't completed onboarding. They may be redirected to the onboarding flow repeatedly.

**Fix**: Same repair endpoint. It detects the existing profile and creates the missing `onboarding_state` row with step = `completed`.

```bash
curl -X POST https://alfanumrik.com/api/auth/repair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_session_token>" \
  -d '{
    "auth_user_id": "<auth_user_id>",
    "force_role": "student"
  }'
```

### D. Demo Account Broken

**Symptoms**: A demo account cannot log in, shows wrong data, or has expired.

**Diagnostic**:

```sql
SELECT * FROM demo_accounts WHERE email = '<demo_email>';
```

**Fix**: Reset the demo account via the super admin API:

```bash
curl -X PUT https://alfanumrik.com/api/super-admin/demo-accounts \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: <SUPER_ADMIN_SECRET>" \
  -d '{
    "email": "<demo_email>",
    "action": "reset"
  }'
```

**Verification**: Attempt to log in with the demo account credentials.

### E. Password Reset Not Working

**Symptoms**: User requests a password reset but never receives the email.

**Diagnostic steps (in order)**:

1. **Check Mailgun dashboard**: Log in to Mailgun, check the sending domain's logs. Search for the user's email address. Look for delivery status (delivered, bounced, dropped, deferred).

2. **Check Edge Function logs**: In Supabase dashboard, go to Edge Functions > send-auth-email > Logs. Look for recent invocations. Check for errors.

3. **Verify webhook secret**: Ensure `SEND_EMAIL_HOOK_SECRET` in the Edge Function secrets matches the hook secret configured in Supabase dashboard > Authentication > Hooks.

4. **Check DNS records**: In Mailgun dashboard, verify the sending domain's DNS records (SPF, DKIM, DMARC) are all green.

5. **Check spam folder**: Ask the user to check their spam/junk folder.

**If Mailgun shows "delivered" but user says no email**:
- Email may be in spam. Ask user to check.
- Email provider may be silently dropping. Try a different email address.
- Wait 5-10 minutes; some providers have delivery delays.

**If Edge Function shows 401 errors**:
- Webhook secret mismatch. Update `SEND_EMAIL_HOOK_SECRET` in Supabase Edge Function secrets to match the Supabase Auth hook configuration. Redeploy the Edge Function.

**If Edge Function shows no recent invocations**:
- The Auth hook may be disabled. Check Supabase dashboard > Authentication > Hooks. Re-enable the Send Email hook.

### F. User Sees Wrong Portal

**Symptoms**: A student sees the teacher portal, or a teacher sees the student portal.

**Diagnostic**:

```sql
SELECT * FROM user_roles WHERE auth_user_id = '<auth_user_id>';
```

**Fix**: Use the repair endpoint with the correct `force_role`:

```bash
curl -X POST https://alfanumrik.com/api/auth/repair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_session_token>" \
  -d '{
    "auth_user_id": "<auth_user_id>",
    "force_role": "teacher"
  }'
```

This updates `user_roles` to the correct role and ensures the matching profile table has a row.

**Verification**: Ask the user to log out completely (clear cookies if needed) and log back in.

## Safety Rules

1. **Never delete from auth.users directly via SQL.** If a user must be deleted, use the Supabase dashboard Authentication panel, which handles cascading cleanup. Even then, consider disabling the account instead of deleting.

2. **The repair endpoint requires `admin.manage_users` permission.** Only users with this RBAC permission can call it. The super admin has this permission by default.

3. **All repair actions are logged.** Every call to the repair endpoint writes an entry to `auth_audit_log` with the repair action, the target user, and the admin who performed it.

4. **Test repairs in staging before production.** If you are unsure about the repair outcome, test with a staging account first. Note: staging and production share the same Supabase project (see deploy-safety-checklist.md), so use clearly marked test accounts.

5. **Do not manually INSERT into profile tables.** Always use the repair endpoint or the `admin_repair_user_onboarding()` RPC. Manual inserts may miss required fields, triggers, or audit logging.

6. **Verify the result after every repair.** Do not assume success. Check the API response, then verify by querying the database or asking the user to test.

## Escalation

### Repair Endpoint Returns an Error

1. Check the API response body for error details.
2. Check Supabase logs for RPC errors: Dashboard > Database > Logs, or query `pg_stat_activity`.
3. Common causes:
   - `auth_user_id` does not exist in `auth.users` (user was deleted)
   - `force_role` is not a valid role string
   - Database connection pool exhausted (transient, retry after 30 seconds)
4. If the RPC itself is broken (e.g., after a migration), check the function definition:
   ```sql
   SELECT prosrc FROM pg_proc WHERE proname = 'admin_repair_user_onboarding';
   ```

### Supabase Auth Is Down

1. Check [status.supabase.com](https://status.supabase.com) for incidents.
2. If Auth is down, users cannot log in or sign up. Existing sessions may continue to work until tokens expire.
3. No action can be taken on our side. Wait for Supabase to resolve.
4. Communicate to affected users if the outage is prolonged.

### Mailgun Is Down

1. Check [status.mailgun.com](https://status.mailgun.com) for incidents.
2. If Mailgun is down, auth emails are not delivered but auth flows still succeed (Edge Function returns 200).
3. Users who need to confirm email or reset password will be stuck until Mailgun recovers.
4. Once Mailgun recovers, users can retry their action (resend confirmation, re-request reset).
5. No manual intervention needed unless users report issues after Mailgun is restored.

### Multiple Users Affected Simultaneously

If multiple users report the same auth issue at the same time:

1. Check if a recent deployment or migration caused the issue.
2. Check Supabase status and Vercel status.
3. Check Edge Function logs for a spike in errors.
4. If caused by a deployment, initiate rollback (see deploy-safety-checklist.md).
5. If caused by a migration, write a compensating migration.
6. Notify the team and track as an incident.
