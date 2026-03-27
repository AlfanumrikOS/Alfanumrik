# Backup, Restore & Disaster Recovery Guide

## Supabase Backup Strategy

### Automatic Backups (Supabase Pro Plan)
- Supabase Pro plan includes **daily automatic backups** with 7-day retention
- Point-in-Time Recovery (PITR) available on Pro plan for up to 7 days
- Access via: Supabase Dashboard → Project Settings → Database → Backups

### Manual Backup (pg_dump)
```bash
# Export full database
pg_dump "postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres" \
  --format=custom \
  --no-owner \
  --file=alfanumrik_backup_$(date +%Y%m%d_%H%M%S).dump

# Export schema only (for migration verification)
pg_dump "postgresql://..." --schema-only --file=schema_$(date +%Y%m%d).sql

# Export specific tables
pg_dump "postgresql://..." --table=students --table=quiz_sessions --file=critical_tables.dump
```

### Restore from Backup
```bash
# Restore full backup
pg_restore --clean --if-exists \
  --dbname="postgresql://postgres.[ref]:[password]@..." \
  alfanumrik_backup_20260327.dump

# Restore specific tables
pg_restore --table=students --dbname="postgresql://..." backup.dump
```

## RTO / RPO Targets

| Metric | Target | Current Capability |
|--------|--------|--------------------|
| **RPO** (Recovery Point Objective) | < 24 hours | Daily backups (Supabase Pro) |
| **RTO** (Recovery Time Objective) | < 2 hours | Restore from backup + redeploy |
| **RPO with PITR** | < 5 minutes | Point-in-time recovery (Pro plan) |

## Data Retention Policy

| Data Type | Retention | Action After |
|-----------|-----------|-------------|
| Audit logs | 1 year | Archive to cold storage |
| Chat sessions | 6 months | Soft delete + archive |
| Quiz responses | 1 year | Keep for analytics |
| Student profiles | Until account deletion | GDPR compliant |
| Daily usage | 90 days | Aggregate into monthly_reports |
| Task queue (completed) | 30 days | Hard delete |
| Task queue (failed) | 90 days | Review then delete |
| Error reports | 30 days | Auto-purge |

## Vercel Deployment Rollback

### Instant Rollback
1. Go to **Vercel Dashboard → Alfanumrik → Deployments**
2. Find the last known-good deployment
3. Click **"..." → Promote to Production**
4. Deployment is instantly rolled back (< 30 seconds)

### Git-based Rollback
```bash
# Revert the last commit on main
git revert HEAD
git push origin main
# Vercel auto-deploys the reverted version
```

## Supabase Migration Rollback

### Before applying migrations
1. Always take a manual backup first
2. Test migration on a Supabase branch (if available)
3. Review the migration SQL for destructive operations

### Rollback a migration
```bash
# Supabase CLI
supabase db reset  # WARNING: resets entire database to migration 0

# Manual rollback: write a reverse migration
# e.g., 20260328_rollback_content_versioning.sql
DROP TABLE IF EXISTS content_versions;
ALTER TABLE chapters DROP COLUMN IF EXISTS content_status;
ALTER TABLE topics DROP COLUMN IF EXISTS content_status;
ALTER TABLE question_bank DROP COLUMN IF EXISTS content_status;
```

## Emergency Procedures

### 1. Database Corruption
1. Stop all Edge Functions (pause from Supabase dashboard)
2. Restore from most recent backup
3. Verify data integrity
4. Re-enable Edge Functions

### 2. Security Breach
1. Rotate all secrets immediately:
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPER_ADMIN_SECRET
   - RAZORPAY_KEY_SECRET
   - RAZORPAY_WEBHOOK_SECRET
2. Review audit_logs for unauthorized actions
3. Suspend affected user accounts
4. Deploy security patch

### 3. Payment System Failure
1. Toggle `razorpay_payments` feature flag OFF
2. Check Razorpay dashboard for failed transactions
3. Run `supabase/reconcile_stuck_payments.sql` to fix stuck subscriptions
4. Re-enable after verification

### 4. AI (Foxy) Overload
1. Toggle `foxy_ai_enabled` feature flag OFF
2. Check Claude API usage/limits
3. Review daily_usage table for abuse patterns
4. Adjust rate limits in Edge Function
5. Re-enable gradually

## Monitoring Checklist (Weekly)

- [ ] Check Supabase backup status
- [ ] Review failed jobs in admin dashboard → Support tab
- [ ] Check error trends in Sentry
- [ ] Review audit logs for unusual activity
- [ ] Verify Vercel deployment health
- [ ] Check subscription payment reconciliation
- [ ] Review AI usage metrics
