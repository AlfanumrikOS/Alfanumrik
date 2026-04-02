# Operational Runbooks

Last verified: 2026-04-02
Source files: `src/app/api/v1/health/route.ts`, `src/lib/feature-flags.ts`, `src/app/api/super-admin/`, `docs/ADMIN_OPERATIONS.md`, `docs/BACKUP_RESTORE.md`

## 1. Check System Health

### Via Health Endpoint
```bash
curl -s https://alfanumrik.vercel.app/api/v1/health | jq .
```

Response:
```json
{
  "status": "healthy|degraded|unhealthy",
  "version": "2.0.0",
  "timestamp": "2026-04-02T...",
  "checks": {
    "database": { "status": "ok|error", "latency_ms": 42 },
    "auth": { "status": "ok|error" }
  },
  "uptime_seconds": 3600
}
```

**Status interpretation:**
- `healthy` -- Database and Auth both OK
- `degraded` -- One check failed (app can serve cached content)
- `unhealthy` -- Both checks failed

The endpoint always returns HTTP 200 so load balancers do not remove the instance. Monitor the `status` field for actual health.

**Timeout:** Each check has a 3-second timeout. If Supabase is slow, checks will fail with timeout errors.

### Via Super Admin Panel
Navigate to `/super-admin/diagnostics` for system diagnostics including:
- Database connectivity
- Queue health (pending/failed tasks in `task_queue`)
- Deployment history
- Backup status

### Via Sentry
- Client errors: Sentry dashboard, filtered by `environment: production`
- Server errors: Same dashboard, server-side events
- Session replay: Available for 1% of sessions, 100% of errored sessions

## 2. Toggle Feature Flags

### Via Super Admin Panel
1. Navigate to `/super-admin/flags`
2. Toggle the switch next to the flag name
3. The change takes effect within 5 minutes (cache TTL) or immediately if `invalidateFlagCache()` is called

### Via API
```bash
# List all flags
curl -H "Authorization: Bearer <admin_token>" \
  https://alfanumrik.vercel.app/api/super-admin/feature-flags

# Toggle a flag
curl -X PUT \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"flag_name": "feature_x", "is_enabled": false}' \
  https://alfanumrik.vercel.app/api/super-admin/feature-flags

# Create a new flag
curl -X POST \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"flag_name": "feature_x", "is_enabled": true, "target_roles": ["student"]}' \
  https://alfanumrik.vercel.app/api/super-admin/feature-flags
```

### Flag Evaluation Logic
Flags are evaluated in this order:
1. Flag exists? No --> disabled
2. `is_enabled` = false? --> disabled
3. `target_environments` set and current env not in list? --> disabled
4. `target_roles` set and user role not in list? --> disabled
5. `target_institutions` set and user institution not in list? --> disabled
6. `rollout_percentage` < 100? --> Currently treated as enabled for 1-99% (per-user rollout not yet implemented)
7. Otherwise --> enabled

**Cache:** Flags are cached in-memory for 5 minutes. Call `invalidateFlagCache()` after admin mutations to take effect immediately.

### Emergency Kill Switch
To disable a feature immediately:
1. Set `is_enabled = false` via the admin panel or API
2. The change propagates within 5 minutes due to cache
3. For immediate effect, redeploy the application (Vercel instant rollback also works)

## 3. Handle Payment Failures

### Identifying Payment Issues
- Check Razorpay dashboard for failed webhooks
- Check `subscription_events` table for failed payment events
- Check Sentry for payment-related errors

### Common Scenarios

**Webhook not received:**
1. Check Razorpay webhook configuration matches the production URL
2. Verify `RAZORPAY_WEBHOOK_SECRET` environment variable is set
3. Check middleware is not blocking Razorpay webhook requests (webhooks bypass auth)

**Subscription status mismatch:**
1. Query `student_subscriptions` table for the student
2. Compare with Razorpay dashboard subscription status
3. If mismatch, update via super admin panel or direct database update with service role

**Grace period:** Students with `past_due` status should retain access during the grace period. Check `subscription_expiry` column.

### Manual Subscription Fix
Via super admin API:
```bash
curl -X PUT \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"student_id": "<uuid>", "subscription_plan": "pro", "subscription_expiry": "2026-05-01T00:00:00Z"}' \
  https://alfanumrik.vercel.app/api/super-admin/users
```

## 4. Respond to Error Rate Spike

### Detection
- Sentry alerts (if configured)
- Health check returns `degraded` or `unhealthy`
- Users report issues

### Triage Steps
1. Check health endpoint: `curl https://alfanumrik.vercel.app/api/v1/health`
2. Check Sentry for error patterns (group by error type)
3. Check Vercel deployment logs for recent deployments
4. Check Supabase dashboard for database health

### If Database Is Down
1. Check Supabase status page
2. If Supabase is having an outage, the app will serve cached content where possible
3. Quiz submissions will fail -- students will see error messages
4. No manual intervention possible for Supabase outages -- wait for resolution

### If Error Rate Is High After Deploy
1. Identify the bad commit in Vercel deployment history
2. Rollback via Vercel dashboard (instant, no redeploy needed)
3. Investigate the error in the reverted code
4. Fix and redeploy

## 5. Roll Back a Bad Deployment

See `docs/ops/rollback-plan.md` for the full procedure.

Quick steps:
1. Go to Vercel dashboard --> Deployments
2. Find the last known good deployment
3. Click the three-dot menu --> "Promote to Production"
4. Verify health: `curl https://alfanumrik.vercel.app/api/v1/health`

If a database migration was involved:
- Do NOT run `DROP TABLE` or `DROP COLUMN` in panic
- Write a compensating migration that reverses the change safely
- Test the compensating migration in staging first

## 6. Create Test/Demo Accounts

### Quick Test Account
```bash
curl -X POST \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "student", "name": "Test Student", "email": "test@alfanumrik.demo"}' \
  https://alfanumrik.vercel.app/api/super-admin/test-accounts
```
Returns email + generated password.

### Full Demo Set (student + teacher + parent)
```bash
curl -X POST \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "create-set"}' \
  https://alfanumrik.vercel.app/api/super-admin/demo-accounts
```
Returns credentials for all three accounts. Parent is auto-linked to the demo student.

### Reset All Demo Accounts
```bash
curl -X PUT \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "reset-all"}' \
  https://alfanumrik.vercel.app/api/super-admin/demo-accounts
```

## 7. Investigate Audit Trail

### Via Super Admin Panel
Navigate to `/super-admin/logs` to browse admin audit entries.

### Via API
```bash
curl -H "Authorization: Bearer <admin_token>" \
  "https://alfanumrik.vercel.app/api/super-admin/logs?limit=50&action=permission_denied"
```

### Direct Database Query (service role)
```sql
-- Recent denied access attempts
SELECT * FROM audit_logs
WHERE status = 'denied'
ORDER BY created_at DESC
LIMIT 50;

-- Admin actions in last 24 hours
SELECT * FROM admin_audit_log
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

## 8. Handle Support Tickets

### Via Super Admin Panel
Navigate to `/super-admin` and use the support section. Features:
- User activity lookup (quiz + chat history)
- Fix guardian-student relationships
- Resend invitation emails
- Reset passwords

### Common Support Scenarios

**Student cannot log in:**
1. Check if the email exists in `auth.users`
2. Check if `students.is_active` is true
3. Check `account_status` is not `suspended` or `banned`
4. Trigger password reset via Supabase dashboard

**Parent cannot see child data:**
1. Check `guardian_student_links` for the parent-student pair
2. Verify `status = 'approved'` (or `'active'`)
3. If missing, create the link via support API with `support.fix_relationships` permission

**Teacher cannot see class:**
1. Check `class_teachers` for the teacher-class association
2. Check `classes.is_active` is true
3. Verify the teacher has the `teacher` role in `user_roles`

## 9. Monitor Content Coverage

### Content Gap Detection
```bash
npx ts-node scripts/check-content-gaps.ts
```

### Via Super Admin Panel
Navigate to `/super-admin/cms` to see:
- Question bank counts by subject and grade
- Content status (draft/review/published)
- Coverage gaps (topics without questions)

### Key Metrics
- Questions per subject per grade (target: minimum 50 per topic)
- Bloom's taxonomy distribution per topic (target: at least 3 levels represented)
- Difficulty distribution (target: roughly even easy/medium/hard)
