# Payment Integrity Watchdog — BLOCKED

**Date:** 2026-06-26 02:04 UTC  
**Scheduled routine:** Payment Integrity Watchdog (P11 split-brain detector)  
**Status:** ❌ COULD NOT RUN — infrastructure unreachable

---

## What Was Supposed to Run

The scheduled payment integrity audit of:
- **Stuck subscriptions**: `student_subscriptions.status = 'active'` where `students.subscription_plan = 'free'` OR status stuck `pending` > 10 min OR student says paid but no active sub record
- **Payment error events (24h)**: `ops_events` where `category = 'payment'` and `severity IN ('error', 'critical')`
- **Payment history summary**: Count of captured / failed / pending payments in last 24h

## Why It Couldn't Run

| Dependency | Status |
|---|---|
| `shktyoxqhundlvkiwguu.supabase.co` | ❌ Blocked by network egress allowlist |
| `slack.com` | ❌ Blocked by network egress allowlist |
| Supabase MCP tool `execute_sql` | ❌ Tool not available in this session |
| Slack MCP tool (any) | ❌ Tool not available in this session |
| Supabase CLI (`SUPABASE_ACCESS_TOKEN`) | ❌ Not authenticated |
| GitHub issue creation (fallback) | ❌ GitHub MCP not available; GH_TOKEN is proxy-injected only for git ops |
| Push notification tool | ❌ `mcp__claude-code-remote__send_notification` not available |

**This is the second scheduled audit to fail with identical infrastructure issues.**  
See `docs/audit-logs/2026-06-17-scoring-audit-blocked.md` (P1/P2/P3 audit, 9 days ago).

## Action Required

⚠️ **No payment data was inspected. This is NOT an all-clear.**

The scheduled watchdog has now failed at least twice. **This is a recurring infrastructure gap that needs a fix before the next run.**

### Option A — Add MCP servers to the scheduled session (recommended)
Configure both MCP servers in the scheduled session's tool config:
- **Supabase MCP** with project ref `shktyoxqhundlvkiwguu` and a management API token
- **Slack MCP** with a bot token scoped to `#general` (or `#alerts`)

### Option B — Fix network egress allowlist
In the scheduled session's environment settings, add:
- `shktyoxqhundlvkiwguu.supabase.co`
- `api.supabase.com`
- `slack.com`

And add these env vars:
```
SUPABASE_ACCESS_TOKEN=<supabase-management-api-token>
NEXT_PUBLIC_SUPABASE_URL=https://shktyoxqhundlvkiwguu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SLACK_WEBHOOK_URL=<slack-incoming-webhook-url>
```

### Option C — Move to Supabase cron instead
Run the payment integrity SQL as a pg_cron job that inserts rows into `ops_events`,
then have `alert-deliverer` Edge Function forward `category='payment'` critical events to Slack.
This bypasses the Claude Code session environment entirely.

## SQL Queries That Would Have Run

The three queries are in the session transcript. For reference, the stuck-subscription detection:
```sql
SELECT ss.id, ss.student_id, ss.status, ss.plan_name, ss.created_at,
       s.subscription_plan as student_plan, s.subscription_status as student_status
FROM student_subscriptions ss
JOIN students s ON s.id = ss.student_id
WHERE (
  (ss.status = 'active' AND (s.subscription_plan = 'free' OR s.subscription_status != 'active'))
  OR (ss.status = 'pending' AND ss.created_at < NOW() - INTERVAL '10 minutes')
  OR (s.subscription_plan != 'free' AND s.subscription_status = 'active' AND ss.status != 'active')
);
```

## Reference

- Invariant: **P11 Payment Integrity** (`.claude/CLAUDE.md`)
- Regression catalog: REG-46 (payment funnel E2E), REG-47 (atomic_plan_change atomicity)
- Supabase project: `shktyoxqhundlvkiwguu`
- Payment webhook: `src/app/api/payments/webhook/route.ts`
- Atomic RPC: `activate_subscription` → fallback `atomic_subscription_activation`
