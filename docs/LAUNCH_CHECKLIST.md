# Launch & Rollback Checklist

## Pre-Launch Verification

### Infrastructure
- [ ] Supabase project status: ACTIVE_HEALTHY
- [ ] Vercel deployment status: READY
- [ ] Upstash Redis connected (check rate limiting works)
- [ ] Sentry DSN configured (error tracking active)
- [ ] All environment variables set in Vercel

### Database
- [ ] All migrations applied (check via `supabase db diff`)
- [ ] RLS enabled on all tables (verify via `list_tables`)
- [ ] admin_users table has founder accounts with `is_active = true`
- [ ] user_roles table has super_admin assignments for founder accounts
- [ ] feature_flags configured (at minimum: foxy_ai_enabled, razorpay_payments)

### Admin System
- [ ] Super Admin login works (Supabase session + admin_users check)
- [ ] Dashboard tab loads stats, observability, deploy info, backup status
- [ ] Users tab lists students/teachers/parents
- [ ] Roles tab shows all 11 roles and can assign/revoke
- [ ] Content tab CRUD works
- [ ] CMS page loads topics and questions with filters
- [ ] CMS create topic/question works (starts as draft)
- [ ] CMS workflow transitions work (draft→review→published)
- [ ] Feature flags toggle works
- [ ] Feature flag scoping (roles, environments) saves correctly
- [ ] Audit logs show recent admin actions
- [ ] Audit log filters (action, entity, date range) work

### Security
- [ ] /internal/admin returns 404
- [ ] No query-param secret patterns in codebase
- [ ] All admin APIs require authorizeAdmin()
- [ ] Middleware blocks unauthenticated access to /super-admin
- [ ] Rate limiting active (10 req/min on admin routes)

### Student App
- [ ] Student login works
- [ ] Dashboard loads (subjects, XP, streaks)
- [ ] Foxy AI chat responds
- [ ] Quiz generates and submits
- [ ] Subscription page loads plans

### Android App
- [ ] APK/AAB on Google Play (closed testing)
- [ ] App connects to Supabase backend
- [ ] Login, dashboard, chat, quiz flows work

## Post-Deploy Verification

1. Check /api/v1/health returns 200
2. Log in as admin — verify dashboard loads
3. Check audit logs for recent entries
4. Verify feature flags reflect correct state
5. Test one student login flow
6. Verify Sentry shows no new errors

## Backup Checks

- [ ] Supabase daily backups enabled (Pro plan)
- [ ] Last backup status known (check admin dashboard → Backup section)
- [ ] Restore procedure documented (docs/BACKUP_RESTORE.md)
- [ ] Point-in-Time Recovery available (Supabase Pro)

## Feature Flag Checks

- [ ] Critical flags exist: foxy_ai_enabled, razorpay_payments, quiz_module
- [ ] All flags default to enabled unless explicitly disabled
- [ ] Kill switch tested: toggle flag off, verify feature disabled
- [ ] Scoping verified: role/environment flags evaluate correctly

## Audit Log Checks

- [ ] Admin login generates no audit entry (reads are not audited)
- [ ] User ban/unban generates audit entry
- [ ] Feature flag toggle generates audit entry
- [ ] CMS topic create generates audit entry
- [ ] CMS workflow transition generates audit entry
- [ ] Role assignment generates audit entry

## Rollback Steps

### Application Rollback (Vercel)
1. Go to Vercel Dashboard → Alfanumrik → Deployments
2. Find the last known-good deployment (green "READY" status)
3. Click "..." → "Promote to Production"
4. Wait 30 seconds for DNS propagation
5. Verify /api/v1/health returns 200
6. Check admin dashboard loads correctly

### Database Rollback (Supabase)
1. Pause Edge Functions from Supabase dashboard
2. Go to Project Settings → Database → Backups
3. Select backup from before the issue
4. Use Point-in-Time Recovery if available
5. Verify data integrity
6. Re-enable Edge Functions
7. Record rollback in admin dashboard → Support tools

### Emergency Kill Switches
- Foxy AI overloaded → toggle `foxy_ai_enabled` OFF
- Payment issues → toggle `razorpay_payments` OFF
- Quiz problems → toggle `quiz_module` OFF
- Full lockdown → toggle all flags OFF from Flags tab

## Health Inspection Order

When investigating an issue, check in this order:
1. /api/v1/health — basic database connectivity
2. Admin Dashboard → Observability panel — system health, failed jobs
3. Sentry dashboard — error trends
4. Admin Dashboard → Audit Logs — recent admin actions
5. Supabase dashboard → Logs — database query errors
6. Vercel dashboard → Logs — runtime errors
