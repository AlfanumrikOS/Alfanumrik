# Database Outage Response Runbook

**Severity:** SEV-1 (Critical) for full Supabase outage; SEV-2 for connection pool exhaustion or single-table corruption.
**Time to respond:** 15 minutes (SEV-1) / 1 hour (SEV-2).
**On-call:** [ON-CALL: TBD] (escalate to architect + ops; user/founder notified for SEV-1).
**Scope:** Supabase PostgreSQL unavailable, connection pool exhausted, single-RPC failure, or specific table corruption.
**Related runbooks:** `docs/BACKUP_RESTORE.md` (restore mechanics), `docs/runbooks/payment-webhook-recovery.md` (payment-table-specific), `docs/runbooks/schema-reproducibility-fix.md` (migration baseline).

## 1. Detection

### Signals
- Health endpoint returns `unhealthy` or 503: `curl https://alfanumrik.vercel.app/api/v1/health`
- Vercel function logs show `PrismaClientKnownRequestError`, `connection terminated`, or `ECONNREFUSED` against the Supabase host.
- Sentry: spike in `error.type:PostgrestError`, `Database connection error`, or `function timed out`.
- Super-admin diagnostics page (`/super-admin/diagnostics`) → System Health tile shows `degraded` or `unhealthy`.
- Customer reports: "page won't load", "submit button does nothing", "infinite spinner on dashboard".

### Sentry queries
**Connection pool exhaustion:**
```
event.type:error AND (
  message:"too many connections" OR
  message:"remaining connection slots" OR
  message:"FATAL:  sorry, too many clients already"
) AND timestamp:>-15m
```

**General DB errors:**
```
event.type:error AND (
  exception.type:PostgrestError OR
  exception.type:DatabaseError OR
  message:"connection terminated" OR
  message:"ETIMEDOUT" OR
  message:"ECONNREFUSED"
) AND tag.url:supabase.co AND timestamp:>-15m
```

### Vercel log greps
```bash
# Via Vercel CLI
vercel logs --since 15m --output json | grep -iE "supabase|postgres|connection|timeout"
```

### Health endpoint semantics (per `src/app/api/v1/health/route.ts`)
- `healthy`: DB query returns < 1s, no recent errors.
- `degraded`: DB responds but slow (> 1s) or recent error rate elevated.
- `unhealthy`: DB query throws or times out → HTTP 503 returned.

## 2. Triage

| Symptom | Diagnosis | Mitigation path |
|---|---|---|
| Health = `unhealthy` everywhere, all routes 503 | Full Supabase outage | Section 3a + 3c |
| Health = `degraded`, slow but works | Connection pool / overloaded | Section 3b |
| Single RPC fails, others work | RPC bug or table-level lock | Section 3d |
| Specific table read returns corrupt rows | Data corruption | Section 3e |
| `payment_history` or `student_subscriptions` corruption | Reconciliation required | See Section 3e + payment-webhook-recovery.md |

Quick check — is this our problem or Supabase's?
- Visit https://status.supabase.com/ — if their status page shows incident, it's upstream.
- Check Supabase project dashboard at app.supabase.com → Project → Database → Health.

## 3. Mitigation

### Step 3a — Read-only mode (full outage where DB is reachable but writes fail)

Create the flag if it does not exist:
```sql
INSERT INTO feature_flags (flag_name, is_enabled, target_environments)
VALUES ('ff_read_only_mode', true, ARRAY['production'])
ON CONFLICT (flag_name) DO UPDATE SET is_enabled = true, updated_at = now();
```

Then via super-admin: `/super-admin/flags` → toggle `ff_read_only_mode` to **on**.

API routes check this flag in middleware and short-circuit POST/PUT/DELETE with a 503 + bilingual message. Reads continue.

### Step 3b — Connection pool exhaustion

**Immediate:** Bounce Vercel serverless functions to release stale connections:
```bash
# Force redeploy (no code change) — releases all serverless function instances
vercel redeploy <production-deployment-url> --no-wait
```

**Investigate hot routes** (open many connections):
```sql
SELECT pid, usename, application_name, state, query_start, query
  FROM pg_stat_activity
 WHERE state != 'idle'
   AND backend_start > now() - interval '10 minutes'
 ORDER BY query_start ASC
 LIMIT 20;
```

**Kill long-running queries (last resort):**
```sql
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE state = 'active'
   AND query_start < now() - interval '5 minutes'
   AND application_name LIKE '%vercel%';
```

### Step 3c — Vercel maintenance page (full outage, DB unreachable)

Set the maintenance environment variable in Vercel:
```bash
vercel env add MAINTENANCE_MODE production
# Value: true
vercel redeploy <production-url>
```

Middleware (`src/middleware.ts`) checks `process.env.MAINTENANCE_MODE` and serves `/maintenance` page (must exist as static fallback at `public/maintenance.html`) for all non-health requests.

### Step 3d — Single RPC failure

Identify the RPC and inspect:
```sql
\df+ <rpc_name>
SELECT prosrc FROM pg_proc WHERE proname = '<rpc_name>';
```

If the RPC is broken due to recent migration, consider rolling back the migration or hot-patching the function definition. Coordinate with architect — do NOT manually edit production functions without a migration record.

### Step 3e — Table corruption

**Read-only quarantine first:**
```sql
REVOKE INSERT, UPDATE, DELETE ON <table> FROM authenticated, anon, service_role;
```

Then assess scope:
```sql
SELECT count(*) FROM <table>;
SELECT * FROM <table> WHERE <suspect_predicate> LIMIT 100;
```

For payment_history corruption — **STOP**. Do not restore from older backup without reconciling against Razorpay first. See Section 5 below and `docs/runbooks/payment-webhook-recovery.md`.

### Step 3f — Customer comms

**English:**
> We are experiencing a temporary database issue. Some features may be slow or unavailable. Your data is safe. We will update you within 30 minutes.

**Hindi (हिंदी):**
> हम अस्थायी डेटाबेस समस्या का सामना कर रहे हैं। कुछ सुविधाएँ धीमी या अनुपलब्ध हो सकती हैं। आपका डेटा सुरक्षित है। हम आपको 30 मिनट के भीतर अपडेट करेंगे।

Set via maintenance banner flag (see ai-outage-response.md Section 3c for the SQL pattern).

## 4. Recovery

### Standard restore from backup
Follow `docs/BACKUP_RESTORE.md`. Summary:
1. Identify last good backup: Supabase dashboard → Project → Database → Backups.
2. Run point-in-time restore via Supabase CLI:
   ```bash
   supabase db restore --project-ref <ref> --recovery-time "2026-05-05T10:30:00Z"
   ```
3. Wait for restore to complete (typically 5-30 min depending on DB size).
4. Apply any migrations created after the restore point:
   ```bash
   supabase db push --project-ref <ref>
   ```

### RTO / RPO commitments (TBD — must be documented by user/founder)
- **RTO (Recovery Time Objective):** [TBD — proposed: 1 hour for SEV-1 DB outage]
- **RPO (Recovery Point Objective):** [TBD — proposed: 5 minutes via Supabase point-in-time recovery]

These must be ratified and posted in `docs/ops/sla.md` before this runbook is operational.

### Smoke test SQL (run after restore)
```sql
-- 1. RLS still enabled on critical tables
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('students','student_subscriptions','quiz_sessions','payment_history','feature_flags');
-- Expect: rowsecurity = true for all.

-- 2. Critical RPCs exist
SELECT proname FROM pg_proc
 WHERE proname IN (
   'atomic_quiz_profile_update',
   'activate_subscription_locked',
   'atomic_subscription_activation_locked',
   'bootstrap_user_profile',
   'record_webhook_event'
 );
-- Expect: 5 rows.

-- 3. Recent activity sanity check
SELECT count(*) FROM quiz_sessions WHERE completed_at > now() - interval '1 hour';
SELECT count(*) FROM payment_history WHERE created_at > now() - interval '1 day';

-- 4. Feature flags intact
SELECT count(*), count(*) FILTER (WHERE is_enabled) AS enabled FROM feature_flags;
```

### Re-enable writes
```sql
GRANT INSERT, UPDATE, DELETE ON <table> TO authenticated, service_role;

UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_read_only_mode';
```

## 5. Specific scenario — payment_history table corruption

**DO NOT restore payment tables from an older backup blindly.** Razorpay is the source of truth; older backups will lose payments collected between the backup time and the corruption.

Procedure:
1. Quarantine the table (Section 3e).
2. Export current state to `payment_history_corrupt_<timestamp>` for forensic comparison.
3. Pull Razorpay payments for the affected period:
   ```bash
   curl https://api.razorpay.com/v1/payments?from=<unix_ts>&to=<unix_ts>&count=100 \
     -u $RAZORPAY_KEY_ID:$RAZORPAY_KEY_SECRET > razorpay_payments_window.json
   ```
4. Restore the most recent good backup of `payment_history` and `payment_webhook_events`.
5. Reconcile: for each Razorpay payment not present in restored `payment_history`, replay the corresponding webhook event using `record_webhook_event` + `activate_subscription_locked` per `docs/runbooks/payment-webhook-recovery.md`.
6. Verify zero divergence:
   ```sql
   SELECT count(*) FROM payment_history WHERE razorpay_payment_id IS NULL;  -- expect 0
   SELECT razorpay_payment_id, count(*) FROM payment_history GROUP BY 1 HAVING count(*) > 1;  -- expect 0 rows
   ```
7. Notify customers whose subscriptions were temporarily downgraded during the incident window (template via support tooling).

## 6. Post-mortem checklist

1. What caused the outage? (Supabase incident, our migration, runaway query, traffic spike)
2. Did read-only mode activate cleanly? Did writes fail loudly or silently?
3. Did the maintenance page render? In both Hi and En?
4. RTO / RPO actuals vs commitment (once commitments exist).
5. What monitoring would have caught this earlier? (e.g., `pg_stat_activity` connection-count alert)
