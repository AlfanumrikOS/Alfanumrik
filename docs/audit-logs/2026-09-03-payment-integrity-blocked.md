# Payment Integrity Watchdog — BLOCKED (3rd consecutive failure)

**Date:** 2026-09-03 UTC  
**Scheduled routine:** Payment Integrity Watchdog (P11 split-brain detector)  
**Status:** ❌ COULD NOT RUN — infrastructure unreachable  
**Recurrence:** This is the **3rd consecutive blocked run** (see also 2026-06-26 and 2026-06-17)

---

## What Was Supposed to Run

The scheduled P11 payment integrity audit of:
- **Stuck subscriptions**: `student_subscriptions ⨝ students` — split-brain detection (active sub + free student, pending >10 min, paid student + no active sub)
- **Payment error events (24h)**: `ops_events` where `category = 'payment'` and `severity IN ('error', 'critical')`
- **Payment history summary**: Captured / failed / pending counts in last 24h

## Why It Couldn't Run

| Dependency | Status |
|---|---|
| `shktyoxqhundlvkiwguu.supabase.co` | ❌ Blocked by network egress allowlist (HTTP 000, connection refused) |
| `slack.com` | ❌ Blocked by network egress allowlist (HTTP 000, connection refused) |
| Supabase MCP tool `execute_sql` | ❌ Tool not injected into this scheduled session |
| Slack MCP tool (any) | ❌ Tool not injected into this scheduled session |
| Supabase CLI (`SUPABASE_ACCESS_TOKEN`) | ❌ Not authenticated; no env var present |
| PushNotification tool | ❌ Not available in this session |
| `gh` CLI | ❌ Not available (proxy-injected GH_TOKEN for git ops only) |

**Network test results (2026-09-03):**
```
curl https://shktyoxqhundlvkiwguu.supabase.co/rest/v1/  → HTTP 000 (connection failed)
curl https://slack.com/api/api.test                     → HTTP 000 (connection failed)
```

## Impact

⚠️ **NO payment data has been inspected since this watchdog was created.**

The P11 split-brain detector (stuck subscriptions, payment errors) has **never successfully run**. Any split-brain state that exists in production has gone undetected since at least 2026-06-17. This is a critical gap for a live payment system accepting real INR transactions.

## Queries That Would Have Run

### 1. Stuck subscriptions (split-brain detection)
```sql
SELECT ss.id, ss.student_id, ss.status, ss.plan_name, ss.created_at,
       s.subscription_plan as student_plan, s.subscription_status as student_status
FROM student_subscriptions ss
JOIN students s ON s.id = ss.student_id
WHERE (
  -- Case 1: subscription says active but student record disagrees
  (ss.status = 'active' AND (s.subscription_plan = 'free' OR s.subscription_status != 'active'))
  OR
  -- Case 2: subscription stuck in pending for >10 minutes
  (ss.status = 'pending' AND ss.created_at < NOW() - INTERVAL '10 minutes')
  OR
  -- Case 3: student says paid but no active subscription record
  (s.subscription_plan != 'free' AND s.subscription_status = 'active' AND ss.status != 'active')
);
```

### 2. Payment error events (last 24h)
```sql
SELECT category, severity, message, occurred_at
FROM ops_events
WHERE category = 'payment'
  AND severity IN ('error', 'critical')
  AND occurred_at > NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC
LIMIT 20;
```

### 3. Payment history summary (last 24h)
```sql
SELECT COUNT(*) as total_payments,
       COUNT(*) FILTER (WHERE status = 'captured') as captured,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'pending') as pending
FROM payment_history
WHERE created_at > NOW() - INTERVAL '24 hours';
```

## Action Required — ESCALATION

**Three consecutive failures without being actioned is unacceptable for a P11 invariant.**

### Fix options (same as previous two audit logs — still unresolved):

**Option A — Fix network egress allowlist (recommended, solves both watchdogs)**
In the scheduled session's environment settings, add to the egress allowlist:
- `shktyoxqhundlvkiwguu.supabase.co`
- `api.supabase.com`  
- `slack.com`
And set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_WEBHOOK_URL`

**Option B — Configure MCP servers for the scheduled session**
- Supabase MCP with project ref `shktyoxqhundlvkiwguu` + management API token
- Slack MCP with bot token scoped to `#alerts` or `#general`

**Option C — Move to pg_cron (bypasses Claude session entirely)**
Run the stuck-subscription SQL as a pg_cron job → insert into `ops_events` → `alert-deliverer` 
Edge Function handles Slack delivery. No dependency on Claude session environment.

**Option D — Manual check NOW**
Until infrastructure is fixed, run the queries above directly in the Supabase Dashboard SQL editor:
- Project: `shktyoxqhundlvkiwguu`
- Dashboard: https://supabase.com/dashboard/project/shktyoxqhundlvkiwguu/editor

## Reference

- Invariant: **P11 Payment Integrity** (`.claude/CLAUDE.md`)
- Related blocked audits: `docs/audit-logs/2026-06-17-scoring-audit-blocked.md`, `docs/audit-logs/2026-06-26-payment-integrity-blocked.md`
- Regression catalog: REG-46 (payment funnel E2E), REG-47 (atomic_plan_change atomicity), REG-319 (payment verify-route forgery fix)
- Supabase project: `shktyoxqhundlvkiwguu`
- Payment webhook: `apps/host/src/app/api/payments/webhook/route.ts`
- Atomic RPCs: `activate_subscription` → fallback `atomic_subscription_activation`
