# Incident: Payment Integrity Watchdog — MCP Tools Unavailable

**Date:** 2026-09-05  
**Time:** 02:06 UTC  
**Severity:** High (P11 monitoring gap)  
**Status:** Open — manual remediation required

## Summary

The scheduled Payment Integrity Watchdog could not execute. All required external MCP integrations (`supabase`, `slack`) returned `No such tool available` in the scheduled session environment. No database queries were run; no Slack alert was posted. Payment split-brain monitoring was dark for this run.

## Checks NOT Performed

| Check | Query target | Risk if missed |
|---|---|---|
| Stuck subscriptions | `student_subscriptions` ⟷ `students` split-brain | Students with captured payment but `subscription_plan = 'free'` |
| Payment errors (24h) | `ops_events WHERE category='payment' AND severity IN ('error','critical')` | Silent failures not escalated |
| Payment volume (24h) | `payment_history` captured/failed/pending counts | Spike in failures undetected |

## Root Cause

The scheduled task session lacks MCP server connections:
- `mcp__supabase__execute_sql` → `No such tool available`
- `mcp__slack__post_message` → `No such tool available`
- `mcp__github__create_issue` → `No such tool available`
- Push notification tool → `No such tool available`

No credentials (Supabase URL, service role key) were present in the environment as fallback.

## Required Actions

### Immediate (today)
1. **Manual payment check**: Run `supabase/reconcile_stuck_payments.sql` in the Supabase Dashboard SQL Editor. This finds captured payments where `students.subscription_plan` doesn't match the paid plan.

2. **Stuck subscriptions query**: In Supabase SQL Editor, run:
```sql
SELECT ss.id, ss.student_id, ss.status, ss.plan_name, ss.created_at,
       s.subscription_plan, s.subscription_status
FROM student_subscriptions ss
JOIN students s ON s.id = ss.student_id
WHERE (ss.status = 'active' AND (s.subscription_plan = 'free' OR s.subscription_status != 'active'))
   OR (ss.status = 'pending' AND ss.created_at < NOW() - INTERVAL '10 minutes')
   OR (s.subscription_plan != 'free' AND s.subscription_status = 'active' AND ss.status != 'active');
```

3. **Payment errors (24h)**:
```sql
SELECT category, severity, message, occurred_at
FROM ops_events
WHERE category = 'payment' AND severity IN ('error', 'critical')
  AND occurred_at > NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC LIMIT 20;
```

### Fix Scheduled Task
1. Confirm `mcpServers` in project `.claude/settings.json` or global `~/.claude.json` includes both `supabase` and `slack` entries.
2. Ensure the Supabase MCP server is authorized with a valid service-role key for this project (`shktyoxqhundlvkiwguu`).
3. Ensure the Slack MCP server has a valid bot token with permission to post to `#general`.
4. Test by running the watchdog manually and confirming it completes without `No such tool available` errors.

## Reference

- Product invariant: **P11 — Payment Integrity** (`.claude/CLAUDE.md`)
- Runbook: `supabase/reconcile_stuck_payments.sql`
- Supabase project ID: `shktyoxqhundlvkiwguu`
