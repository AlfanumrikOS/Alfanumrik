# Scoring & Anti-Cheat Invariant Audit — BLOCKED

**Date:** 2026-06-17 04:38 UTC  
**Scheduled routine:** P1/P2/P3 Invariant Validator  
**Status:** ❌ COULD NOT RUN — infrastructure unreachable

---

## What Was Supposed to Run

The scheduled daily audit of:
- **P1 — Score Accuracy**: Verify `score_percent = ROUND((correct / total) * 100)` for all sessions in last 24h
- **P2 — XP Economy**: Verify XP formula + 200 XP/day cap enforcement
- **P3 — Anti-Cheat**: Speed violations (<3s/question avg), response count mismatches
- **Ghost sessions**: Completed sessions with 0 responses (7-day window)

## Why It Couldn't Run

| Dependency | Status |
|---|---|
| `shktyoxqhundlvkiwguu.supabase.co` | ❌ Blocked by network egress allowlist |
| `slack.com` | ❌ Blocked by network egress allowlist |
| Supabase MCP tool `execute_sql` | ❌ Tool not available in this session |
| Supabase CLI (`SUPABASE_ACCESS_TOKEN`) | ❌ Not authenticated |

## Action Required

⚠️ **No data was inspected. This is NOT an all-clear.**

To fix this recurring scheduled audit, do ONE of the following:

### Option A — Fix network egress (recommended)
In the scheduled session's environment settings, add to the egress allowlist:
- `shktyoxqhundlvkiwguu.supabase.co`
- `slack.com`

### Option B — Add credentials as env vars
Set these in the scheduled session's environment:
```
SUPABASE_ACCESS_TOKEN=<supabase-management-api-token>
NEXT_PUBLIC_SUPABASE_URL=https://shktyoxqhundlvkiwguu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Option C — Add Supabase MCP server to session
Configure the Supabase MCP server in the scheduled session's tool config.

## Reference

- Invariants: P1, P2, P3 in `.claude/CLAUDE.md`
- Regression catalog entries: REG-45, REG-48, REG-51, REG-52 (P1/P2/P3 coverage)
- Supabase project: `shktyoxqhundlvkiwguu`
