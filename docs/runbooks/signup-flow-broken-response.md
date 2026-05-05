# Signup Flow Broken Response Runbook

**Severity:** SEV-1 (Critical) — P15 invariant. Onboarding is the #1 user acquisition path; any breakage blocks revenue and growth.
**Time to respond:** 15 minutes.
**On-call:** [ON-CALL: TBD] (architect + backend; user/founder must be notified — signup loss is revenue-impacting).
**Scope:** signup returns 500, verification email not delivered, `bootstrap_user_profile` RPC failing, user stuck on `/onboarding`, role-specific onboarding broken.
**Related:** P15 invariant in `.claude/CLAUDE.md`. Critical files: `AuthScreen.tsx`, `auth/callback/route.ts`, `auth/confirm/route.ts`, `api/auth/bootstrap/route.ts`, `AuthContext.tsx`, `onboarding/page.tsx`, `send-auth-email/index.ts`, `lib/identity/`.

## 1. Detection

### Signals
- PostHog: `auth.signUp` success rate drops > 10% in any 15-min window vs prior 24h baseline.
- Sentry: spike in errors from `/api/auth/bootstrap`, `/auth/callback`, `/auth/confirm`, or `send-auth-email` Edge Function.
- Customer reports in support inbox: "didn't get verification email", "stuck after signup", "infinite loading on onboarding".
- Daily signup count drops to near-zero in `/super-admin` control room.

### PostHog query (Insights → SQL)
```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  countIf(event = '$signup_started') AS started,
  countIf(event = '$signup_verified') AS verified,
  countIf(event = '$signup_completed') AS completed,
  100.0 * countIf(event = '$signup_completed') / nullIf(countIf(event = '$signup_started'), 0) AS funnel_pct
FROM events
WHERE timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour DESC;
```
Threshold: `funnel_pct < 40%` for 2 consecutive hours = incident.

### Sentry queries
**Bootstrap RPC failures:**
```
event.type:error AND url:"*/api/auth/bootstrap*" AND timestamp:>-30m
```

**Email verification failures:**
```
event.type:error AND (
  message:"send-auth-email" OR
  message:"verification email" OR
  url:"*/auth/callback*" OR
  url:"*/auth/confirm*"
) AND timestamp:>-30m
```

### Edge Function logs (Supabase dashboard → Functions → send-auth-email → Logs)
```
Filter: severity:error OR status:!=200
Window: last 30 minutes
```
**P15 rule:** `send-auth-email` MUST return HTTP 200 on every code path. Any non-200 is a P0 — Supabase blocks signup entirely.

## 2. Triage

Determine which step is broken:

| Step | Symptom | Diagnosis path |
|---|---|---|
| 1. signup itself (Supabase Auth) | `auth.signUp()` returns error before email sent | Check Supabase Auth status; check `send-auth-email` is returning 200 |
| 2. verification email delivery | User completes signup but never receives email | Check Edge Function logs + email provider (Resend/SendGrid) dashboard |
| 3. callback / confirm route | User clicks link, lands on error page | Check `/auth/callback` and `/auth/confirm` routes; verify SITE_URL env |
| 4. bootstrap RPC | User verified but profile not created | Check `bootstrap_user_profile` RPC + `/api/auth/bootstrap` route |
| 5. onboarding page | Profile created but user stuck on `/onboarding` | Check `onboarding/page.tsx` + role-specific subforms |

## 3. Mitigation

### Step 3a — `send-auth-email` returning non-200 (highest impact)

Roll back to last-known-good Edge Function deploy:
```bash
# List recent deploys
supabase functions list-versions send-auth-email --project-ref <ref>

# Roll back to specific version
supabase functions rollback send-auth-email --project-ref <ref> --version <version_id>
```

If rollback unavailable, deploy a known-good revision from git:
```bash
git checkout <last-known-good-sha> -- supabase/functions/send-auth-email/
supabase functions deploy send-auth-email --project-ref <ref>
git restore supabase/functions/send-auth-email/  # don't commit the checkout
```

Verify it's returning 200:
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/send-auth-email \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"test@example.com","id":"00000000-0000-0000-0000-000000000000"},"email_data":{"token":"test","redirect_to":"https://alfanumrik.vercel.app/auth/callback","email_action_type":"signup"}}'
# Expect: HTTP 200, body {"success":true} or similar
```

### Step 3b — `bootstrap_user_profile` RPC failing

Verify the RPC exists and is idempotent:
```sql
\df+ bootstrap_user_profile

-- Inspect source
SELECT prosrc FROM pg_proc WHERE proname = 'bootstrap_user_profile';
```

P15 rule: must use `ON CONFLICT` so it's safe to call multiple times. If missing, the most recent migration that defines it (search `supabase/migrations/` for `bootstrap_user_profile`) must be re-applied.

Manual bootstrap for an affected user:
```sql
-- Find the auth user
SELECT id, email, created_at, email_confirmed_at
  FROM auth.users
 WHERE email = '<user_email>';

-- Manually run bootstrap
SELECT bootstrap_user_profile(
  p_auth_user_id := '<auth_user_id>',
  p_email := '<user_email>',
  p_role := 'student'  -- or 'teacher' / 'parent'
);

-- Verify profile created
SELECT * FROM students WHERE auth_user_id = '<auth_user_id>';
```

### Step 3c — Customer outreach for stuck users

Find affected users (signed up but no profile):
```sql
SELECT au.id, au.email, au.created_at
  FROM auth.users au
  LEFT JOIN students s ON s.auth_user_id = au.id
  LEFT JOIN teachers t ON t.auth_user_id = au.id
  LEFT JOIN guardians g ON g.auth_user_id = au.id
 WHERE au.created_at > '<incident_start>'
   AND s.id IS NULL AND t.id IS NULL AND g.id IS NULL
 ORDER BY au.created_at DESC;
```

Resend verification link via super-admin:
- `/super-admin/users` → search by email → "Resend verification link" action.
- Or via Supabase Auth API:
```bash
curl -X POST https://<project-ref>.supabase.co/auth/v1/admin/users/<user_id>/recover \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**Customer comms — English:**
> Hi — we noticed you tried to sign up for Alfanumrik but didn't complete verification due to a temporary issue on our end. We've fixed it and resent your verification link. Please check your inbox (and spam folder). If you still need help, reply to this email and we'll set up your account manually within 1 hour.

**Customer comms — Hindi (हिंदी):**
> नमस्ते — हमने देखा कि आपने Alfanumrik के लिए साइन-अप करने की कोशिश की लेकिन हमारी ओर से एक अस्थायी समस्या के कारण सत्यापन पूरा नहीं हो सका। हमने इसे ठीक कर दिया है और आपको सत्यापन लिंक फिर से भेज दिया है। कृपया अपना इनबॉक्स (और स्पैम फ़ोल्डर) देखें। यदि आपको अभी भी सहायता की आवश्यकता है, तो इस ईमेल का जवाब दें और हम 1 घंटे के भीतर आपका खाता मैन्युअल रूप से सेट कर देंगे।

## 4. Recovery — Per-role smoke tests

Create one test account per role end-to-end and verify dashboard loads. Use disposable emails like `qa-student-<timestamp>@alfanumrik-test.com`.

### Student smoke
1. Signup at `/auth?role=student` with grade `"7"` and board `"CBSE"`.
2. Receive verification email within 60s.
3. Click link → land on `/onboarding` → complete grade/board selection.
4. Verify redirect to `/dashboard`.
5. Assert profile row:
   ```sql
   SELECT id, grade, board, subscription_plan FROM students
    WHERE auth_user_id = '<test_user_id>';
   ```
   Expect: `grade = '7'`, `board = 'CBSE'`, `subscription_plan = 'free'`.

### Teacher smoke
1. Signup at `/auth?role=teacher`.
2. Verify email → land on `/onboarding`.
3. Enter school name + subjects (e.g., "Math, Science").
4. Verify redirect to `/teacher/dashboard`.
5. Assert profile row:
   ```sql
   SELECT id, school_name, subjects FROM teachers
    WHERE auth_user_id = '<test_user_id>';
   ```

### Parent smoke
1. Signup at `/auth?role=parent`.
2. Verify email → land on `/onboarding`.
3. Enter phone number + linking code (or skip with placeholder code).
4. Verify redirect to `/parent` dashboard.
5. Assert profile row:
   ```sql
   SELECT id, phone, linked_student_id FROM guardians
    WHERE auth_user_id = '<test_user_id>';
   ```

**All three flows must pass before declaring incident resolved.** Run via Playwright if smoke fixtures exist:
```bash
npx playwright test e2e/onboarding-3-roles.spec.ts --project=chromium
```

## 5. Cleanup
Delete the test accounts post-verification:
```sql
DELETE FROM auth.users WHERE email LIKE 'qa-%-@alfanumrik-test.com';
-- Cascade should clean up students/teachers/guardians via FK ON DELETE CASCADE.
```

## 6. Post-mortem checklist

1. Which P15 sub-rule was violated? (1: send-auth-email returned non-200 / 2: 3-layer failsafe broken / 3: callback flow / 4: RPC not idempotent / 5: role-specific bug / 6: hardcoded SITE_URL)
2. How many signups were lost during the incident window? (PostHog `$signup_started` minus `$signup_completed`)
3. Did the 3-layer failsafe (client insert → bootstrap API → AuthContext fallback) catch any users, or did all 3 layers fail?
4. Did automated PostHog alerts fire, or was this caught by user reports? Improve detection if the latter.
5. What regression test would catch this? Add to `.claude/regression-catalog.md` (P15 has `tested-only` status — promote to catalogued).
